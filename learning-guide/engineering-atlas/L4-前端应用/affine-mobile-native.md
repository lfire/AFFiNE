# `affine_mobile_native`（`packages/frontend/mobile-native`）

> 一句话定位：AFFiNE 移动端的**跨语言原生桥**——一个用 **UniFFI** 装配的 Rust crate，把本地文档存储（nbstore）、索引搜索、blob 缓存、hashcash、Mermaid/Typst 预览等能力，自动生成 **Swift / Kotlin 绑定**，供 iOS（`apps/ios`）与 Android（`apps/android`）通过 Capacitor 插件调用。它是移动端"JS → 原生 → Rust"链路的最底层。

| 项               | 值                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录             | `packages/frontend/mobile-native`（Rust crate，无 package.json）                                                                             |
| 所属层           | L4 · 前端应用                                                                                                                                |
| 语言/形态        | Rust crate（`affine_mobile_native`）+ UniFFI 生成的 Swift/Kotlin 绑定                                                                        |
| 关键依赖（Rust） | `uniffi`、`affine_nbstore`、`affine_common`(hashcash)、`affine_preview`、`tokio`、`base64-simd`、`objc2`(apple)/`homedir`(其它)、`lru`       |
| 被谁依赖         | `apps/ios`（生成 `App/App/uniffi/affine_mobile_native.swift`）、`apps/android`（生成 `uniffi/affine_mobile_native/affine_mobile_native.kt`） |
| 构建产物         | `cdylib`/`staticlib` + 一个 `uniffi-bindgen` 二进制                                                                                          |

## 1. 设计逻辑

移动端与桌面端的原生桥需求相同（都要复用 Rust 的 nbstore 等能力），但**边界语言不同**：桌面是 Node（用 napi-rs，见 affine-native.md），移动端的宿主是 **Swift（iOS）/ Kotlin（Android）**。为此 AFFiNE 选用 **UniFFI**——Mozilla 的跨语言 FFI 生成器：

1. **一套 Rust 源，多语言绑定**：Rust 侧用 `#[uniffi::export]`、`#[derive(uniffi::Record/Object/Error)]` 标注要跨语言的项，UniFFI 据此生成 Swift/Kotlin 的类型、函数与 FFI 胶水（含内存管理 `RustBuffer`、`FfiConverter`）。
2. **proc-macro 模式（无 .udl 文件）**：靠 `uniffi::setup_scaffolding!("affine_mobile_native")` 宏在编译期生成 scaffolding，无需手写接口描述文件。
3. **async 直通**：`#[uniffi::export(async_runtime = "tokio")]` 让 Rust 的 `async fn` 变成 Swift/Kotlin 的 `async`/`suspend` 方法，底层用 tokio 运行时驱动。
4. **DTO 层隔离**：`ffi_types.rs` 定义一组 `uniffi::Record` DTO（`DocRecord`/`Blob`/`IndexHit`…），用 `From`/`TryFrom` 在 nbstore 的原生类型与跨语言 DTO 间转换——跨 FFI 的数据形状由本 crate 独立掌控，不泄漏 nbstore 内部结构。

**与 affine-native（napi）的分工**：同样包装 nbstore，但目标边界不同——napi 面向 Node（桌面），UniFFI 面向 Swift/Kotlin（移动）。两者都依赖 `affine_nbstore` 与 `affine_common`。

## 2. 目录与关键文件

```text
mobile-native/
├── Cargo.toml          # crate-type=["cdylib","staticlib"]；[[bin]] uniffi-bindgen；feature use-as-lib
├── uniffi-bindgen.rs   # 生成绑定的 CLI 入口：uniffi::uniffi_bindgen_main()
└── src/
    ├── lib.rs          # setup_scaffolding! + #[uniffi::export] hashcash_mint；pub use 导出 DTO/对象
    ├── error.rs        # #[derive(uniffi::Error)] UniffiError + From<NbStoreError/serde_json::Error>
    ├── ffi_types.rs    # 全部 #[derive(uniffi::Record)] DTO + From/TryFrom 与 nbstore 类型互转
    ├── payload_codec.rs# base64 编解码（blob 数据跨 FFI 走 base64 字符串）
    ├── preview.rs      # #[uniffi::export] render_mermaid/typst_preview_svg（仅 android/ios 编译）
    ├── cache/          # MobileBlobCache：大 blob 落盘为文件 token（移动端内存敏感）
    └── storage/
        ├── mod.rs      # #[derive(uniffi::Object)] DocStoragePool + new_doc_storage_pool()
        ├── lifecycle.rs# connect/disconnect（+ 移动端 blob cache 注册）
        ├── docs.rs     # get_doc/delete_doc/get_doc_clock(s)
        ├── blobs.rs / peers.rs / indexer.rs  # blob / 同步对等端 / 索引搜索
```

## 3. 实现细节

### 3.1 scaffolding 与最小导出（`lib.rs`）

```rust
// 来源：src/lib.rs
uniffi::setup_scaffolding!("affine_mobile_native");   // proc-macro 生成全部胶水

#[uniffi::export]
pub fn hashcash_mint(resource: String, bits: u32) -> String {
  Stamp::mint(resource, Some(bits)).format()
}

pub use ffi_types::{ Blob, BlockInfo, CrawlResult, DocClock, DocRecord, IndexHit, IndexSearchResult, ... };
pub use storage::{ DocStoragePool, new_doc_storage_pool };
```

`setup_scaffolding!` 是 proc-macro 模式的关键——它扫描 crate 内所有 `#[uniffi::export]`/`#[derive(uniffi::*)]` 并生成 scaffolding，省去传统 `.udl` 接口文件。`hashcash_mint` 是最简单的导出函数，直接对应移动端一个顶层函数。

### 3.2 UniFFI 对象：带 async 方法的 `DocStoragePool`

存储池是一个有状态对象，用 `#[derive(uniffi::Object)]`；构造走一个被导出的自由函数（UniFFI 对象的惯用构造方式）：

```rust
// 来源：src/storage/mod.rs
#[derive(uniffi::Object)]
pub struct DocStoragePool {
  inner: SqliteDocStoragePool,
  #[cfg(any(target_os = "android", target_os = "ios", test))]
  mobile_blob_cache: Arc<MobileBlobCache>,
}

#[uniffi::export]
pub fn new_doc_storage_pool() -> DocStoragePool { DocStoragePool { inner: Default::default(), ... } }
```

方法分散在多个文件，用 `#[uniffi::export(async_runtime = "tokio")] impl DocStoragePool` 导出 async 方法：

```rust
// 来源：src/storage/docs.rs
#[uniffi::export(async_runtime = "tokio")]
impl DocStoragePool {
  pub async fn get_doc(&self, universal_id: String, doc_id: String) -> Result<Option<DocRecord>> {
    let Some(record) = self.inner.get(universal_id.clone()).await?.get_doc(doc_id).await? else { return Ok(None) };
    let timestamp = record.timestamp.and_utc().timestamp_millis();
    let bin = self.encode_doc_data(&universal_id, &record.doc_id, timestamp, &record.bin).await?;
    Ok(Some(DocRecord { doc_id: record.doc_id, bin, timestamp }))
  }
}
```

```rust
// 来源：src/storage/lifecycle.rs
#[uniffi::export(async_runtime = "tokio")]
impl DocStoragePool {
  /// Initialize the database and run migrations.
  pub async fn connect(&self, universal_id: String, path: String) -> Result<()> { ... }
  pub async fn disconnect(&self, universal_id: String) -> Result<()> { ... }
}
```

### 3.3 DTO 与双向转换（`ffi_types.rs`）

跨 FFI 的数据不直接用 nbstore 内部类型，而是定义一套 `uniffi::Record`（跨语言值对象），并用 `From`/`TryFrom` 与 nbstore 原生类型互转、同时做单位换算（如 `NaiveDateTime` ↔ 毫秒时间戳）：

```rust
// 来源：src/ffi_types.rs
#[derive(uniffi::Record)]
pub struct DocClock { pub doc_id: String, pub timestamp: i64 }

impl From<NbDocClock> for DocClock {
  fn from(c: NbDocClock) -> Self { Self { doc_id: c.doc_id, timestamp: c.timestamp.and_utc().timestamp_millis() } }
}
impl TryFrom<DocClock> for NbDocClock {
  type Error = UniffiError;
  fn try_from(c: DocClock) -> Result<Self> {
    Ok(Self { doc_id: c.doc_id,
      timestamp: DateTime::<Utc>::from_timestamp_millis(c.timestamp).ok_or(UniffiError::TimestampDecodingError)?.naive_utc() })
  }
}
```

blob 的二进制跨 FFI 走 base64 字符串（`payload_codec.rs`），移动端大 blob 还会被 `MobileBlobCache` 落盘成以 `__AFFINE_BLOB_FILE__:` 为前缀的**文件 token**（`ffi_types.rs` 注释），避免把大对象整块塞过 FFI 边界——这是移动端内存敏感性的直接体现（`storage/mod.rs` 的 `decode_blob_data` 会识别 token 并 `run_mobile_cache_io` 读文件）。

### 3.4 错误类型（`error.rs`）

```rust
// 来源：src/error.rs
#[derive(uniffi::Error, thiserror::Error, Debug)]
pub enum UniffiError {
  #[error("Error: {0}")] Err(String),
  #[error("Base64 decoding error: {0}")] Base64DecodingError(String),
  #[error("Timestamp decoding error")] TimestampDecodingError,
}
impl From<NbStoreError> for UniffiError { fn from(e: NbStoreError) -> Self { Self::Err(e.to_string()) } }
```

`#[derive(uniffi::Error)]` 让这个枚举跨语言成为 Swift 的 `throws` 错误 / Kotlin 的异常；`From` 实现让 `?` 运算符能把 nbstore/serde 错误自动归一到 `UniffiError`。

### 3.5 生成的绑定与 app 衔接

`uniffi-bindgen.rs` 是一个独立 `[[bin]]`，内容仅 `uniffi::uniffi_bindgen_main()`——它就是 UniFFI 的代码生成 CLI，构建流程用它读编译好的库生成各语言绑定。产物已入库，衔接两端：

- **iOS**：`packages/frontend/apps/ios/App/App/uniffi/` 下有 `affine_mobile_native.swift`、`affine_mobile_nativeFFI.h`、`affine_mobile_nativeFFI.modulemap`。Swift 侧生成 `public protocol DocStoragePoolProtocol`（全是 `async throws` 方法）与 `open class DocStoragePool`：

```swift
// 来源：apps/ios/App/App/uniffi/affine_mobile_native.swift（生成物）
public protocol DocStoragePoolProtocol: AnyObject, Sendable {
    /** Initialize the database and run migrations. */
    func connect(universalId: String, path: String) async throws
    func getDoc(universalId: String, docId: String) async throws -> DocRecord?
    func indexSearch(universalId: String, table: String, query: String, options: String) async throws -> IndexSearchResult
    // ...
}
```

- **Android**：`packages/frontend/apps/android/App/app/src/main/java/uniffi/affine_mobile_native/affine_mobile_native.kt`。Kotlin 侧由 Capacitor 插件消费，例如 `HashCashPlugin` 直接 import 并调用生成的 `hashcashMint`：

```kotlin
// 来源：apps/android/.../plugin/HashCashPlugin.kt
import uniffi.affine_mobile_native.hashcashMint
@PluginMethod fun hash(call: PluginCall) {
  val hash = hashcashMint(resource = challenge, bits = bits.toUInt())  // ← 对应 Rust #[uniffi::export] hashcash_mint
  call.resolve(JSObject().apply { put("value", hash) })
}
```

注意命名自动转换：Rust `hashcash_mint`/`u32` → Kotlin `hashcashMint`/`UInt`、Swift `connect(universalId:path:)`。至此链路闭环：**WebView 里的 JS → Capacitor 插件（Swift/Kotlin）→ UniFFI 绑定 → Rust**。

## 4. 语法特色（Rust / UniFFI）

- **`uniffi::setup_scaffolding!` proc-macro 模式**：无 `.udl` 文件，宏在编译期扫描标注项生成全部 FFI scaffolding——比传统 UDL 更贴近"Rust 即接口定义"。
- **`#[uniffi::export]` 导出函数 / impl**：标注自由函数与 `impl` 块；`impl` 上加 `(async_runtime = "tokio")` 即把 `async fn` 暴露为宿主语言的 async/suspend。
- **`#[derive(uniffi::Record / Object / Error)]`**：Record 是跨语言值对象（按值传递）、Object 是带身份的引用对象（按指针/句柄，宿主持有 Rust 分配的实例）、Error 变成宿主异常。
- **`From`/`TryFrom` 做 DTO 边界转换**：`From` 用于不会失败的方向，`TryFrom<_, Error=UniffiError>` 用于可能失败（时间戳/base64 解码），配合 `?` 自动错误归一。
- **`#[cfg(any(target_os = "android", target_os = "ios", test))]` 条件编译**：blob 文件缓存、preview 等只在移动端（或测试）编译，桌面/CI 下走退化分支——同一 crate 适配多运行环境。
- **`crate-type = ["cdylib","staticlib"]`**：cdylib 供 Android（.so 动态库），staticlib 供 iOS（静态链接进 App），覆盖两端链接方式。
- **`Arc<MobileBlobCache>` + `tokio::task::spawn_blocking`**：把阻塞文件 IO 丢到阻塞线程池（`run_mobile_cache_io`），不堵塞 async 运行时。

## 5. 设计 / 实现亮点

- **一套 Rust、双端绑定**：UniFFI 让 iOS/Android 共享同一份存储/索引/预览实现，杜绝"两端各写一遍原生代码"的分叉与行为不一致。
- **async FFI 直通**：`async fn` 经 `async_runtime="tokio"` 原样暴露成 Swift `async`/Kotlin `suspend`，宿主侧不必手搓回调桥，心智极简。
- **DTO 层解耦 + 单位归一**：`ffi_types.rs` 用 Record + From/TryFrom 把时间戳统一成毫秒、把二进制统一成 base64，跨 FFI 契约清晰且与 nbstore 内部演进隔离。
- **大 blob 文件 token**：移动端内存紧张，大对象落盘走 `__AFFINE_BLOB_FILE__:` token 而非整块过 FFI，是对移动场景的针对性优化。
- **与 napi 桥的对称设计**：桌面（napi）与移动（UniFFI）两条桥包装同一批 Rust crate，架构对称、复用最大化。

## 6. 对外 API 与注意事项

- 宿主调用面：顶层函数 `hashcashMint`、`renderMermaidPreviewSvg`/`renderTypstPreviewSvg`（仅移动端编译）；对象 `DocStoragePool`（`newDocStoragePool()` 构造，方法全为 async/throws）。
- **绑定是生成物**：iOS/Android 仓内的 `.swift`/`.kt`/`.h`/`.modulemap` 由 `uniffi-bindgen` 生成，勿手改；改 Rust 导出需重新生成并重编原生库（本文不触发构建）。
- blob 数据跨 FFI 为 base64 字符串；大 blob 可能是文件 token（`__AFFINE_BLOB_FILE__:` 前缀），读取需经存储池解码，勿当普通 base64 处理。
- 时间戳跨 FFI 统一为毫秒 `i64`，解码失败抛 `UniffiError::TimestampDecodingError`。
- preview/blob 文件缓存受 `#[cfg]` 限定移动端；桌面/测试环境行为不同。
- 该目录无 `package.json`，不参与 Node 包体系；由移动端原生工程（Xcode/Gradle）经 Cargo 构建。

## 7. 延伸

- 复用的 Rust 能力：`affine_nbstore`（文档/blob/索引）、`affine_common`（hashcash）、`affine_preview`（Mermaid/Typst）。
- 对称实现：`@affine/native`（桌面 napi 桥，见 affine-native.md）。
- 宿主衔接：`apps/ios`（Swift + Capacitor）、`apps/android`（Kotlin + Capacitor，`HashCashPlugin`/`PreviewPlugin` 等）。
- 工具：UniFFI（`uniffi-bindgen`）。
