# `@affine/native`

> 一句话定位：AFFiNE 桌面端的**原生能力聚合包**——用 napi-rs 把多个 Rust crate（nbstore、sqlite_v1、media_capture、importer、preview、hashcash、disk_sync）编译成单个 Node 原生插件，并**自动生成 `index.d.ts` 的 TypeScript 包装**，供 Electron 主/helper 进程以普通 JS 模块方式调用 Rust。

| 项               | 值                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录             | `packages/frontend/native`                                                                                                                                               |
| 所属层           | L4 · 前端应用（JS 侧原生桥，区别于 L1 纯 Rust 的 `affine-common-native.md`）                                                                                             |
| 语言/形态        | Rust crate（`affine_native`）+ napi-rs 生成的 JS/TS 绑定                                                                                                                 |
| 关键依赖（Rust） | `napi`、`napi-derive`、`affine_nbstore`、`affine_sqlite_v1`、`affine_media_capture`、`affine_importer`、`affine_preview`、`affine_common`(hashcash)、`tokio`、`mimalloc` |
| 被谁依赖         | `@affine/electron`（主进程/helper 进程）、`__tests__`（ava）                                                                                                             |
| 对外入口         | `index.js`（运行时加载原生二进制）、`index.d.ts`（类型）                                                                                                                 |

## 1. 设计逻辑

AFFiNE 桌面端有一批"浏览器做不了/做不好"的能力：本地 SQLite 文档存储、系统音频采集与转录、文件导入、Mermaid/Typst 渲染、hashcash 工作量证明、磁盘同步。这些用 Rust 实现最合适。问题是如何让 Electron 的 JS 调用它们——答案是 **napi-rs**：

1. **单一原生插件聚合多 crate**：`lib.rs` 把若干 workspace crate `pub use` 汇到一起（`affine_nbstore`、`affine_sqlite_v1`、`affine_media_capture`、`disk_sync`、`import`、`preview`、`hashcash`），编译成一个 `.node` 二进制，避免桌面端加载多个原生模块。
2. **声明式 FFI**：Rust 侧用 `#[napi]` 系列宏标注导出项，napi-rs 在构建时既生成 C ABI 胶水，又生成 `index.d.ts`/`index.js`——**TS 类型由 Rust 源自动派生**，JS 侧零手写绑定。
3. **异步友好**：耗时计算用 napi 的 `Task`/`AsyncTask` 跑在 libuv 线程池，返回 JS `Promise`，不阻塞 Electron 主线程。

**与 L1 `affine-common-native.md` 的区别**：那篇讲纯 Rust 的 `affine_common` crate（领域逻辑，无 JS 边界）；本包是**面向前端 JS 的 napi 绑定聚合**——它依赖 `affine_common`（启用 `hashcash` feature）等，但职责是"把 Rust 能力暴露成 Node 模块"。

## 2. 目录与关键文件

```text
native/
├── Cargo.toml          # crate-type = ["cdylib","rlib"]；聚合各 workspace crate；按平台条件依赖 mimalloc/preview
├── build.rs            # napi_build::setup()（构建期生成胶水）
├── package.json        # napi 配置：binaryName=affine，6 个 target；scripts: napi build/artifacts/universal
├── index.js            # 【生成物】按平台/musl 探测加载对应 .node 二进制
├── index.d.ts          # 【生成物】全部导出的 TS 类型声明
├── src/
│   ├── lib.rs          # 入口：pub mod/pub use 聚合各子模块与 crate
│   ├── hashcash.rs     # #[napi] verify/mint_challenge_response（AsyncTask）
│   ├── import.rs       # #[napi] create/subscribe/poll/commit ImportSession（含全局会话表）
│   ├── preview.rs      # #[napi] render_mermaid_svg / render_typst_svg（非移动端）
│   └── disk_sync/      # DiskSync：本地磁盘↔Yjs 同步会话（frontmatter/state_db/session/...）
├── nbstore/            # 子 crate affine_nbstore（napi feature）：blob/doc/indexer/pool/storage
├── media_capture/      # 子 crate：macOS(ScreenCaptureKit/CoreAudio Tap) / Windows 音频采集
├── sqlite_v1/          # 子 crate：旧版 sqlite 读取
├── schema/             # schema 相关
└── __tests__/*.spec.mts# ava 测试（--no-worker-threads）
```

## 3. 实现细节

### 3.1 `lib.rs`：聚合与全局分配器

```rust
// 来源：src/lib.rs
pub mod disk_sync;
pub mod hashcash;
mod import;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod preview;              // 预览仅桌面端

#[cfg(not(target_arch = "arm"))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;   // 非 arm 用 mimalloc 提速

pub use affine_media_capture::*;
pub use affine_nbstore::*;
pub use affine_sqlite_v1::*;
pub use disk_sync::*;
pub use import::*;
```

`pub use xxx::*` 把各子 crate 的 `#[napi]` 导出项"提升"到本 crate 顶层，于是它们统一出现在最终 `index.d.ts` 里。`#[cfg(...)]` 条件编译让 preview/mimalloc 按平台取舍（移动端不编 preview；arm 不用 mimalloc）。

### 3.2 `#[napi]` 同步函数 + 对象（`import.rs`）

普通函数直接 `#[napi]`，结构体用 `#[napi(object)]` 声明为可在 JS 侧构造的普通对象：

```rust
// 来源：src/import.rs
#[napi(object)]
pub struct CreateImportSessionOptions {
  pub format: String,
  pub source: CreateImportSessionSource,
  pub batch_limits: Option<CreateImportBatchLimits>,
}

#[napi]
pub fn create_import_session(options: CreateImportSessionOptions) -> Result<String> {
  let source = match options.source.kind.as_str() {
    "filePath" => ImportSource::FilePath(PathBuf::from(options.source.path)),
    "directoryPath" => ImportSource::DirectoryPath(...),
    kind => return Err(Error::new(Status::InvalidArg, format!("unsupported ... {kind}"))),
  };
  // 会话存入全局 Lazy<Mutex<HashMap<...>>>，返回自增 id
}
```

会话状态用 `once_cell::Lazy<Mutex<HashMap>>` + `AtomicU64` 的全局表管理（`IMPORT_SESSIONS`/`NEXT_SESSION_ID`/`IMPORT_REGISTRY`）。错误经 `map_import_error` 把领域错误映射到 napi 的 `Status`（`Cancelled`/`InvalidArg`/`GenericFailure`），JS 侧收到对应异常。

### 3.3 `Task`/`AsyncTask`：把耗时计算放线程池（`hashcash.rs`）

hashcash 的铸造/校验是 CPU 密集，用 napi 的 `Task` trait 异步化：

```rust
// 来源：src/hashcash.rs
pub struct AsyncMintChallengeResponse { bits: Option<u32>, resource: String }

#[napi]
impl Task for AsyncMintChallengeResponse {
  type Output = String;  type JsValue = String;
  fn compute(&mut self) -> Result<Self::Output> {       // 在 libuv 线程池执行
    Ok(Stamp::mint(self.resource.clone(), self.bits).format())
  }
  fn resolve(&mut self, _: Env, output: String) -> Result<Self::JsValue> { Ok(output) }  // 回主线程
}

#[napi]
pub fn mint_challenge_response(resource: String, bits: Option<u32>) -> AsyncTask<AsyncMintChallengeResponse> {
  AsyncTask::new(AsyncMintChallengeResponse { bits, resource })
}
```

`compute` 在工作线程跑、`resolve` 回 JS 主线程，napi-rs 自动把 `AsyncTask<T>` 映射成 JS `Promise`。对应生成的类型见 `index.d.ts`：`verifyChallengeResponse(...): Promise<boolean>`、`mintChallengeResponse(...): Promise<string>`。

### 3.4 生成的 TS 类型（`index.d.ts`）

Rust 的 class/object/函数被忠实翻成 TS。注意命名与可空性的自动转换（`snake_case` → `camelCase`、`Option<T>` → `T | null`）：

```ts
// 来源：index.d.ts（生成物，顶部 /* auto-generated by NAPI-RS */）
export declare class ShareableContent {
  static applications(): Array<ApplicationInfo>;
  static isUsingMicrophone(processId: number): boolean;
}
export declare function startRecording(
  opts: RecordingStartOptions
): Promise<RecordingSessionMeta>;
export declare class DiskSync {
  startSession(sessionId: string, options: DiskSessionOptions): Promise<void>;
  applyLocalUpdate(
    sessionId: string,
    update: DiskDocUpdateInput
  ): Promise<DiskDocClock>;
  subscribeEvents(
    sessionId: string,
    callback: (err: Error | null, arg: DiskSyncEvent) => void
  ): Promise<DiskSyncSubscriber>;
}
```

### 3.5 `index.js`：跨平台二进制加载（生成物）

`index.js`（`@ts-nocheck`、auto-generated）负责运行时选对二进制：探测 `process.platform`/`arch`，Linux 下还用三重手段判断 glibc/musl（`isMuslFromFilesystem`/`isMuslFromReport`/`isMuslFromChildProcess`），再 `require` 对应的 `affine.<platform>.node`。`package.json` 的 `napi.targets` 列了 6 个目标三元组（darwin/linux/windows × x64/arm64）。

### 3.6 preview：Mermaid/Typst（`preview.rs`）

桌面端把图表/排版渲染也放原生侧：`render_mermaid_svg(request)` 接 `#[napi(object)]` 的选项（theme/fontFamily/fontSize），委托 `affine_preview::render_mermaid_svg` 返回 SVG 字符串；Typst 同理。仅在非 Android/iOS 编译（`Cargo.toml` 的 target 条件依赖）。

## 4. 语法特色（Rust / napi-rs）

- **属性宏 `#[napi]` 家族**：`#[napi]`（函数/impl）、`#[napi(object)]`（JS 可构造的纯数据对象）、`#[napi]` on `impl Task`（异步任务）——过程宏在编译期生成 C ABI 胶水与 TS 声明，是"声明式 FFI"的核心。
- **`Task` trait 的关联类型**：`type Output`/`type JsValue` 分离"工作线程产物"与"回传 JS 的值"，`compute`/`resolve` 分别运行在线程池/主线程，天然表达 async FFI。
- **`#[cfg(...)]` 条件编译**：按 `target_os`/`target_arch` 裁剪模块与依赖（移动端无 preview、arm 无 mimalloc、Linux arm 用 `local_dynamic_tls`），一套源码多平台产物。
- **`#[global_allocator]`**：用静态项替换全局分配器为 mimalloc，提升原生侧内存分配性能。
- **`crate-type = ["cdylib","rlib"]`**：cdylib 产出可被 Node 加载的动态库，rlib 供 Rust 侧（测试/其它 crate）复用同一代码。
- **`once_cell::Lazy<Mutex<...>>` + `AtomicU64`**：进程级全局可变状态（会话表、自增 id）的线程安全封装。
- **错误到 `Status` 的映射**：`napi::Error::new(Status::InvalidArg, msg)` 把 Rust `Result::Err` 转成 JS 异常，`Status` 决定错误类别。

## 5. 设计 / 实现亮点

- **类型零漂移**：TS 声明从 Rust 源自动生成，Rust 改签名则 `index.d.ts` 随之更新，杜绝手写绑定的类型不一致。
- **单插件聚合**：把 6+ 能力 crate 聚成一个 `.node`，桌面端只加载一个原生模块，分发与加载都简化。
- **主线程零阻塞**：CPU 密集（hashcash）与 IO（录制/导入/同步）均走 `AsyncTask`/回调，Electron UI 不卡。
- **条件编译驱动的平台矩阵**：同一 crate 通过 `#[cfg]` 与 `napi.targets` 覆盖 macOS/Windows/Linux × x64/arm64，移动端自动剔除桌面专属能力。
- **音频采集的平台抽象**：`media_capture` 对 macOS（ScreenCaptureKit/CoreAudio Tap）与 Windows 各出一套实现、统一 `startRecording/stopRecording` 接口（见 `index.d.ts` 的 `RecordingArtifact`/`RecordingSessionMeta`）。

## 6. 对外 API 与注意事项

- JS 侧 `import { mintChallengeResponse, startRecording, DiskSync, ShareableContent } from '@affine/native'`（camelCase）。
- **生成物勿手改**：`index.js`/`index.d.ts` 由 `napi build` 生成；改接口要动 Rust 源后重编（`yarn build` = `napi build -p affine_native --platform --release`）。本文严格不触发构建。
- 仅桌面端可用：preview（Mermaid/Typst）与音频采集在移动端不编译；调用方需按 `BUILD_CONFIG.isElectron` 守卫。
- `Option<T>` 在 TS 侧为 `T | undefined | null`，注意三态；错误以 JS 异常抛出，`Status` 决定类型。
- 运行需对应平台的 `affine.<platform>.node` 产物存在，否则 `index.js` 的加载探测会抛错。

## 7. 延伸

- 子 crate：`affine_nbstore`（本地文档存储，另见 nbstore 相关文档）、`affine_sqlite_v1`、`affine_media_capture`、`affine_importer`、`affine_preview`。
- L1 对照：`affine-common-native.md`（纯 Rust 的 `affine_common`，本包依赖其 hashcash feature）。
- 消费方：`@affine/electron`（主/helper 进程）；渲染进程经 IPC 间接使用（见 affine-electron-api.md）。
- 工具链：`@napi-rs/cli`。
