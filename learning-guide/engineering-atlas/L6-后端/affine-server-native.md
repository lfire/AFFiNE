# `@affine/server-native`

> 本包是重点包，运行机制、关键流程和易错点见 [重点包精讲](../重点包精讲/11-affine-server-native.md)。

> 一句话定位：AFFiNE 后端的 **Rust 原生模块**——用 napi-rs 把一套"计算密集 + 安全敏感 + 需强一致"的能力编译成 Node 可直接 `require` 的 `.node` 动态库，供 `@affine/server` 调用。它既提供 Yjs 二进制处理、hashcash、JWT 签名、图像处理、SSRF 安全抓取、内容合规扫描等无状态工具，也托管一个持有 PostgreSQL 连接池的有状态"控制面" `BackendRuntime`（权限、配额、搜索、嵌入、Copilot LLM、计费）。

| 项                | 值                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录              | `packages/backend/native`                                                                                                                                                                                                                          |
| 所属层            | L6 · 后端                                                                                                                                                                                                                                          |
| 语言/形态         | Rust（`crate-type = ["cdylib"]`）→ napi-rs 绑定 → Node 原生插件                                                                                                                                                                                    |
| 关键依赖（crate） | `napi`/`napi-derive`、`y-octo`(Yjs)、`sqlx`(postgres)、`affine_core`/`affine_common`、`llm_adapter`/`llm_runtime`、`aes-gcm`/`argon2`/`hmac`/`jsonwebtoken`/`p256`、`image`/`libwebp-sys`、`safefetch`、`tiktoken-rs`、`reqwest`/`rustls`、`tokio` |
| 被谁依赖          | `@affine/server`（经 `src/native.ts` 门面）；`env.ts` 直接用其 `ServerConfigHandle`                                                                                                                                                                |
| 产物              | `server-native.node`（构建镜像的 CI 编译 3 个 Linux 目标）+ `index.d.ts`（napi 自动生成的 TS 声明）                                                                                                                                               |

## 1. 设计逻辑

`@affine/server` 是 TypeScript，但有几类逻辑放在 Node 里并不合适：

1. **计算密集**：Yjs 文档二进制的 merge/解析、图像缩放转码、tiktoken 分词、嵌入匹配——在 V8 里既慢又会阻塞事件循环。
2. **安全敏感且需防篡改**：license 的 P256 签名校验、hashcash 工作量证明、JWT HMAC 签名、SSRF 防护的"安全抓取"、内容合规的 Unicode 归一与混淆字检测——这些要求可审计、实现稳定、不被 JS 原型污染影响。
3. **需与同步协议/其它语言共享的"真值"逻辑**：权限授权、文档身份规范化（`canonicalize_document_identity`）必须和前端/同步层用同一套 `affine_core` 实现，避免 TS 与 Rust 两份判定漂移。

于是 AFFiNE 把它们统一沉到一个 Rust crate，用 **napi-rs** 编译成原生插件。`@affine/server` 侧只保留一个薄门面（server 包里的 `src/native.ts`）做类型重导出与少量包装。

模块进一步分两类角色：

- **无状态函数/Task**：如 `merge_updates_in_apply_way`、`verify_challenge_response`、`process_image`、`scan_content_policy_v1`——纯输入输出，直接 `#[napi]` 导出。
- **有状态类 `BackendRuntime` / `StorageRuntime` / `ServerConfigHandle`**：`#[napi]` 修饰的 Rust struct，被导出为可 `new` 的 JS 类，内部持有 `PgPool`、配置、缓存、搜索/嵌入/计费子运行时。这就是 AFFiNE 后端近年的架构演进——**把"控制面"决策整体下沉到 Rust**（见 `affine-server.md` 第 5 章）。

## 2. 目录与关键文件

```text
packages/backend/native/
├── Cargo.toml              # crate-type=cdylib；edition 2024；依赖清单（见上表）
├── package.json            # @affine/server-native；napi.targets 6 三元组；build=napi build
├── build.rs                # napi-build：生成绑定样板
├── index.js / index.d.ts   # 手写的 JS 加载器 + napi 自动生成的 TS 声明
├── dts-header.d.ts         # 注入 index.d.ts 顶部的手写类型头
└── src/
    ├── lib.rs              # crate 根：声明各 mod；导出 merge_updates/validate_doc_update 等顶层 napi 函数；全局 mimalloc 分配器
    ├── doc.rs              # Yjs 文档解析/投影：project_doc_canvas / parse_doc_to_markdown / read_all_doc_ids...
    ├── doc_loader.rs       # 上传文件解析：包装 doc_extractor，切成文本块
    ├── hashcash.rs         # 工作量证明：mint/verify_challenge_response（AsyncTask）
    ├── auth_session.rs     # 会话 token：HS256 access token 签名/校验、refresh token 生成（crate 内部）
    ├── license.rs / license_import.rs  # 访问 app.affine.pro 的 license HTTP 客户端 / 导入归一
    ├── content_policy.rs   # 内容合规：Unicode 归一 + 混淆字 skeleton + url/域名扫描
    ├── html_sanitize.rs    # HTML 转义（v_htmlescape）
    ├── image.rs            # 图像处理：缩放/转 webp/EXIF（AsyncTask，限像素/边长）
    ├── file_type.rs        # 文件类型嗅探（infer/file-format）
    ├── safe_fetch.rs       # SSRF 安全抓取：safe_fetch / assert_safe_url（含私网拦截、ECH）
    ├── url_policy.rs       # 回调/重定向 URL 策略：build_safe_callback_url / evaluate_redirect_uri
    ├── tiktoken.rs         # tiktoken 分词器（Tokenizer，供 token 计数）
    ├── entitlement.rs      # 权益解析 resolve_entitlement_v1；license 签发 issue_license_v1
    ├── permission/         # 权限：canonicalize_document_identity + 决策类型（委托 affine_core）
    ├── llm/                # LLM：规范化请求构造、内置 prompt 目录、BYOK、JSON schema 校验、工具循环
    ├── search_index/       # 内存搜索索引：schema/query/document/result
    ├── audio_slice/        # 转写音频切片 split_transcript_audio
    └── runtime/            # 有状态控制面
        ├── mod.rs          # ServerConfigHandle 等；对象存储/迁移/HTTP(TLS) 装配
        ├── config/         # ServerConfigHandle：读 config.json、校验、保存 app config
        ├── backend_runtime/ # #[napi] class BackendRuntime（持有 PgPool 的核心）
        │   ├── mod.rs      # struct + #[napi(constructor)] new(...)；pool()/config() 等
        │   ├── control_plane.rs  # 配额读取、同步权限代际、迁移 run_migrations
        │   ├── permission/ domain_command/ quota_read_cache/ ...  # 领域命令与读缓存
        │   ├── copilot/ embedding/ search/ byok_api.rs            # AI 相关
        │   └── payment/                                            # 计费
        ├── storage_runtime/ object_storage/  # StorageRuntime：对象存储（rusty-s3）
        └── migrations.rs   # sqlx 迁移
```

## 3. 实现细节

### 3.1 napi 的两种导出形态

**(a) 顶层无状态函数**（`lib.rs:37`）：

```rust
#[napi(catch_unwind)]
pub fn merge_updates_in_apply_way(updates: Vec<Buffer>) -> Result<Buffer> {
  let mut doc = Doc::default();
  for update in updates {
    map_napi_err(doc.apply_update_from_binary_v1(update.as_ref()), Status::GenericFailure)?;
  }
  Ok(map_napi_err(doc.encode_update_v1(), Status::GenericFailure)?.into())
}
```

`#[napi]` 过程宏把 Rust 函数名 `merge_updates_in_apply_way` 自动转成 JS 的 `mergeUpdatesInApplyWay`（snake→camel），参数 `Vec<Buffer>` 映射为 `Buffer[]`，`Result<Buffer>` 映射为"返回 `Buffer` 或抛 JS 异常"。`catch_unwind` 让 Rust panic 不会直接杀进程而是转成 JS 错误。server 侧在 `native.ts:209` 直接 `export const mergeUpdatesInApplyWay = serverNativeModule.mergeUpdatesInApplyWay`。注意默认的落库合并走 JS yjs，这个 native 合并只用于同步网关的广播合并、存储层的 native 合并入口和 yocto 编解码对比实验（`packages/backend/server/src/core/doc/merge-updates.ts`）。

**(b) 异步 Task**（`hashcash.rs:13`）：对可能耗时的计算实现 `napi::Task`，用 `AsyncTask` 投递到 libuv 线程池，不阻塞主事件循环（这里只借它演示形态：生产验证码走 `BackendRuntime.verifyAuthCaptchaV1`，这个顶层导出已无生产调用者）：

```rust
#[napi]
impl Task for AsyncVerifyChallengeResponse {
  type Output = bool;  type JsValue = bool;
  fn compute(&mut self) -> NapiResult<bool> {           // 在工作线程执行
    Ok(Stamp::try_from(self.response.as_str()).map(|s| s.check(self.bits, &self.resource)).unwrap_or(false))
  }
  fn resolve(&mut self, _: Env, output: bool) -> NapiResult<bool> { Ok(output) }  // 回主线程
}
#[napi]
pub fn verify_challenge_response(response: String, bits: u32, resource: String) -> AsyncTask<AsyncVerifyChallengeResponse> { ... }
```

JS 侧得到一个返回 `Promise<boolean>` 的函数。`image.rs` 的缩放、`validate_doc_update`（`lib.rs:52`，用 `tokio::task::spawn_blocking`）同理——**凡是 CPU 密集的都异步化**，这是把重活从 Node 事件循环移走的关键收益。

### 3.2 有状态控制面 `BackendRuntime`

`BackendRuntime`（`runtime/backend_runtime/mod.rs:109`）是本包最重的抽象——一个 `#[napi]` 的 Rust struct 被导出为 JS 类：

```rust
#[derive(Clone)]
#[napi_derive::napi]
pub struct BackendRuntime {
  server_config: Arc<ServerConfig>,
  pool: Arc<Mutex<Option<PgPool>>>,           // PostgreSQL 连接池
  config: Arc<RwLock<Arc<BackendRuntimeConfig>>>,
  search: Arc<Mutex<Option<Arc<SearchRuntime>>>>,
  embedding: Arc<Mutex<Option<Arc<embedding::EmbeddingService>>>>,
  quota_read_cache: Arc<Mutex<Option<Arc<quota_read_cache::QuotaReadCache>>>>,
  payment: Arc<Mutex<Option<Arc<payment::PaymentRuntime>>>>,
  // ...blob_access / invalidation / managed_token_providers / license_health_worker
}

#[napi_derive::napi]
impl BackendRuntime {
  #[napi(constructor)]
  pub fn new(server_config: &ServerConfigHandle, private_key: Option<String>,
             permission_telemetry: Option<ThreadsafeFunction<...>>,
             invalidation_events: Option<ThreadsafeFunction<...>>) -> Result<Self> { ... }
}
```

它的方法分散在 `control_plane.rs`、`permission/`、`domain_command/`、`copilot/`、`embedding/`、`search/`、`payment/`、`byok_api.rs` 等文件，每个都用 `#[napi] pub async fn` 导出异步方法。例如 `get_sync_permission_generation_v1`（`control_plane.rs`）直接用 `sqlx::query(...).execute(&pool)` 读写 Postgres——**数据库强一致逻辑在 Rust 里用编译期检查的 SQL 执行**。这些能力在 server 侧由 `BackendRuntimeProvider`（NestJS provider）包装后，被 `PermissionService`/`QuotaService` 等消费。

值得注意：构造器接收两个 `ThreadsafeFunction`（`permission_telemetry`、`invalidation_events`）——这是 napi 的**线程安全回调**，允许 Rust 工作线程反向调用 JS 函数（上报遥测、广播失效），实现双向互操作。

### 3.3 安全相关：license / auth / safe_fetch / content_policy

- **license**（`license.rs`）：访问 `app.affine.pro` 的 HTTP 客户端；签发在 `entitlement.rs` 的 `issue_license_v1`，验签在 `affine_core` 的权益解析里，用 `AFFINE_PRO_PUBLIC_KEY`（`lib.rs:80`，P256 公钥，编译期由 `option_env!` 注入，debug 下有内置 key）。`issueLicenseV1`/`validateLicenseSeatQuantityV1` 只在 `native.ts:513` 导出，server 里没有调用者。
- **auth_session**（`auth_session.rs`）：crate 内部函数，用 `Hmac<Sha256>` 签 HS256 access token、`rand` 生成 refresh token、`Sha256` 存 secret 哈希。放 Rust 保证签名实现稳定、带 `CLOCK_TOLERANCE_SECONDS` 的严谨过期判定。
- **safe_fetch**（`safe_fetch.rs`）：`safe_fetch`/`assert_safe_url` 做 SSRF 防护——限制方法、校验目标是否私网（`allow_private_target_origin`）、限制重定向与响应体大小、支持 ECH。server 用它安全抓取用户提供的远程附件/URL（`native.ts:309-312`）。
- **content_policy**（`content_policy.rs:40`）：`scan_content_policy_v1` 先做 Unicode NFKC 归一，再用 `unicode_skeleton` 生成"混淆字骨架"，检测伪装成合法域名的欺诈文本，返回 `matched`/`matches`/`flags`。

### 3.4 Yjs 与文档：和前端共享的二进制处理

`doc.rs` 基于 `y-octo`（Rust 版 Yjs）提供一组投影/解析函数：`project_doc_canvas_from_binary`、`project_workspace_root_from_binary`、`parse_doc_to_markdown`（`doc.rs:337`）、`read_all_doc_ids_from_root_doc`。它们把 Yjs 文档二进制解析成 server 需要的结构（Markdown、搜索投影、doc id 列表），供全文索引、AI 读取、内容渲染使用。`merge_updates_in_apply_way` 与 `validate_doc_update` 则服务同步落库——**同步协议的二进制正确性由 Rust 把关**。

### 3.5 构建与分发

`package.json` 的 `napi.targets` 声明 6 个目标三元组（darwin/linux/windows × arm64/x64），但构建镜像的 CI（`.github/workflows/build-images.yml`）只编译 x64、arm64、armv7 三个 Linux 目标，其中 armv7 不在 `napi.targets` 里。`index.js` 是手写的 14 行加载器，只按 CPU 架构 `require` 对应二进制，不区分操作系统（详见 [精讲](../重点包精讲/11-affine-server-native.md)）；`index.d.ts` 顶部拼接 `dts-header.d.ts` 后，其余由 napi 根据 `#[napi]` 标注**自动生成 TS 声明**——于是 server 侧 `import ... from '@affine/server-native'` 拥有完整类型。Cargo 里还按平台选用 `mimalloc` 作为全局分配器（`lib.rs:28`）以提升吞吐。

## 4. 语法特色

- **过程宏 `#[napi]` / `#[napi(object)]` / `#[napi(constructor)]`**：把 Rust 函数、struct、方法、字段自动暴露为 JS，并处理命名转换（snake_case → camelCase）、类型映射（`Buffer`↔`Buffer`、`Option<T>`↔`T | null`、`Result<T>`↔抛异常）。`#[napi(object)]`（如 `content_policy.rs:7`、`safe_fetch.rs:20`）把纯数据 struct 映射成 JS 普通对象（结构化传值），而非带方法的类。
- **`#[napi(js_name = "type")]`**：当 Rust 字段名是保留字（如 `type`）时，用 `match_type` 承载而对外叫 `type`（`content_policy.rs:21`）。`#[napi(ts_type = "bigint | number")]`（`runtime/types.rs`）手工指定 TS 类型。
- **`impl Task for X` + `AsyncTask`**：napi 的异步原语。`compute` 在线程池执行耗时逻辑、`resolve` 回主线程转 JS 值，JS 侧表现为 `Promise`。
- **`ThreadsafeFunction`**：允许任意 Rust 线程安全地调用 JS 回调，实现 Rust→JS 的反向通信（遥测/失效广播，`backend_runtime/mod.rs:140`）。
- **所有权与并发**：`Arc<Mutex<Option<PgPool>>>` / `Arc<RwLock<...>>`（`mod.rs:111`）——`Arc` 跨线程共享、`Mutex`/`RwLock` 保护可变状态、`Option` 表达"运行时启动前尚未初始化"。`Zeroizing<String>` 包裹私钥，`Drop` 时清零内存。
- **`catch_unwind` / `map_napi_err`**：把 Rust panic 与 `anyhow::Error` 转成携带 `Status` 的 JS 异常，保证原生层错误不会崩掉 Node 进程。
- **`edition = "2024"` + `crate-type = ["cdylib"]`**：编译为 C ABI 动态库供 Node 的 N-API 加载。
- **编译期注入**：`option_env!("AFFINE_PRO_PUBLIC_KEY")`（`lib.rs:80`）在编译期读环境变量定公钥，生产用真 key、debug 用内置 key，兼顾安全与可测。

## 5. 设计 / 实现亮点

- **控制面整体 Rust 化**：`BackendRuntime` 把权限、配额、搜索、嵌入、Copilot、计费这些"强一致 + 需防篡改 + 常计算密集"的逻辑统一托管于一个持有 `PgPool` 的 Rust 对象，TS 层退化为编排。相比"逻辑散落在 TS service"，它让安全/一致性关键路径单点可审计。
- **重活异步化**：图像、Yjs 校验、hashcash 等一律走 `AsyncTask`/`spawn_blocking`，从源头避免阻塞 Node 事件循环——这是 Node + 原生插件组合的正确姿势。
- **类型零手工同步**：`#[napi]` 标注直接生成 `index.d.ts`，server 侧 `native.ts` 再重导出，Rust 改签名 → TS 类型自动跟进，跨语言边界也做到"单一真值源"。
- **双向互操作**：不止 JS→Rust 调用，还经 `ThreadsafeFunction` 支持 Rust→JS 回调，使遥测与缓存失效这类需要回到 Node 生态的场景成为可能。
- **安全原语集中**：SSRF 防护、混淆字扫描、license 验签、JWT/HMAC 都在 Rust，实现稳定、可测、不受 JS 侧依赖影响。

## 6. 对外 API 与注意事项

- **唯一消费者是 `@affine/server`**：务必经其 `src/native.ts` 门面使用（它做了 `AbortSignal` 封装、缓存、类型收窄，如 `validateDocUpdate`、`getTokenEncoder`），不要在业务代码里直接 `require` 原生模块。
- **改 Rust 要重新 `napi build`**：`.node` 是二进制产物，改签名后需重建并同步 `index.d.ts`；未重建会导致 TS 类型与运行时不符。本任务不执行 build。
- **`BackendRuntime` 有启动顺序**：`new` 之后需先 `start`/`run_migrations` 等（`pool()` 在未启动时抛 "must be started before using postgres operations"，`mod.rs:178`），否则读 Postgres 会报 `invalid_state`。
- **与前端 native 的异同**：前端 `@affine/native`（crate `affine_native`，`packages/frontend/native`）同样用 napi-rs，但面向**本地/桌面**：SQLite 本地存储（`nbstore`/`sqlite_v1`）、磁盘同步、媒体采集、预览、import。二者**都含 hashcash**，但 server-native 面向**服务端 Postgres 控制面 + 安全抓取 + LLM**，frontend-native 面向**端侧本地持久化**；它们是"同一绑定技术、不同部署侧"的两套原生模块。
- **平台限制**：构建镜像的 CI 只产出 x64、arm64、armv7 三个 Linux 二进制；其他平台无预编译二进制。

## 7. 延伸

- 上层使用者：`@affine/server`（`affine-server.md`）——其 `BackendRuntimeProvider`、`PermissionService`、`QuotaService`、`DocReader/DocWriter`、Copilot 插件均建立在本包之上。
- 姊妹包：`@affine/native`（前端/桌面原生模块，端侧 nbstore/SQLite），对比见第 6 章。
- 共享内核 crate：`affine_core`（access_control / auth 常量）、`affine_common`（hashcash / napi_utils），是前后端 Rust 逻辑的公共真值源。
- 对应教程：learning-guide 关于"napi-rs 原生模块与跨语言边界"的章节。
