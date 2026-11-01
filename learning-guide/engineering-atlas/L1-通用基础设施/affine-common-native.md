# `@affine/native`（Rust crate `affine_common`）

> 一句话定位：AFFiNE **跨前后端共享的 Rust 基础 crate**——用 Cargo feature 开关提供两块能力：`hashcash`（SHA3 工作量证明"邮票"，用于防滥用/验证码挑战）与 `napi`（把 Rust 错误转成 N-API 错误的辅助工具）。它不是 npm 包，而是被 `packages/frontend/native`、`packages/backend/native`、`mobile-native`、`nbstore` 等 N-API 原生模块作为 Cargo 依赖复用的底层 crate。

| 项        | 值                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/common/native`                                                                                                                              |
| 所属层    | L1 · 通用基础设施                                                                                                                                     |
| 语言/形态 | Rust crate（`affine_common`，`publish = false`，workspace 成员）                                                                                      |
| 关键依赖  | `sha3`、`chrono`、`hex`、`rand`（均 optional，随 feature 启用）；`napi`（optional）                                                                   |
| 被谁依赖  | `packages/frontend/native`（`hashcash`）、`backend/native`（`hashcash` + `napi`）、`mobile-native`（`hashcash`）、`frontend/native/nbstore`（`napi`） |
| 对外形态  | Rust 模块 `affine_common::hashcash::Stamp`、`affine_common::napi_utils::{to_napi_error, map_napi_err}`                                                |

## 1. 设计逻辑

AFFiNE 的原生层（N-API）横跨多处：桌面端 `frontend/native`、移动端 `mobile-native`、后端 `backend/native`、以及 nbstore 的原生 SQLite 实现。这些 crate 各自是独立的 N-API 模块，但有两段逻辑它们**重复需要**：

1. **hashcash 工作量证明**：AFFiNE 用 hashcash（一种 CPU proof-of-work）做防滥用挑战——服务器要求客户端"算出一个满足难度的邮票（stamp）"才放行某些操作（如注册、验证码场景）。**铸造（mint）发生在客户端、校验（check）发生在服务端**，两端必须用**完全一致**的算法，否则校验不过。
2. **N-API 错误转换**：Rust 的 `Result<T, E>` 要跨 FFI 边界抛给 JS，需要统一转成 `napi::Error`。

与其让每个原生 crate 各写一份、埋下"客户端和服务端算法不一致"的隐患，AFFiNE 把这两段沉淀为共享 crate `affine_common`。**核心立场——单一算法真值源**：hashcash 的 mint 与 check 写在同一个文件里、被前端和后端同时依赖，从根上保证"前端铸造的邮票后端一定能校验"。

**用 feature 开关裁剪依赖**：不同消费者需求不同——前端只需 `hashcash`、nbstore 只需 `napi`、后端两者都要。crate 用 Cargo feature（`hashcash` / `napi`）把能力与其依赖（`sha3`/`chrono`/`hex`/`rand` vs `napi`）解耦，消费方按需启用，避免拉入无关依赖、也让不需要 N-API 的场景（如纯算法基准测试）能脱离 napi 编译。

**与其他 native 的区分**：本 crate 是"共享底层逻辑库"，`frontend/native`、`backend/native` 才是真正暴露 `#[napi]` 函数给 JS 的模块——它们 `use affine_common::hashcash::Stamp` 再包一层 N-API 接口。文件名用 `affine-common-native.md` 正是为与那些模块的文档区分。

## 2. 目录与关键文件

```text
packages/common/native/
├── Cargo.toml          # crate affine_common；features: hashcash / napi；依赖均 optional
├── LICENSE
├── benches/
│   └── hashcash.rs     # criterion 基准：mint（生成）与 check（校验）性能
├── fixtures/           # 测试夹具（供其它 native 模块复用：docx/pdf/ydoc/代码样例）
└── src/
    ├── lib.rs          # 仅按 feature 条件挂载 hashcash / napi_utils 两个模块
    ├── hashcash.rs     # Stamp：mint / check / format / TryFrom<&str>（175 行）
    └── napi_utils.rs   # to_napi_error / map_napi_err（22 行）
```

`lib.rs` 全文只有四行，用条件编译把模块按 feature 挂载：

```rust
// 来源：src/lib.rs
#[cfg(feature = "hashcash")]
pub mod hashcash;
#[cfg(feature = "napi")]
pub mod napi_utils;
```

## 3. 实现细节

### 3.1 `Stamp`：hashcash 邮票的数据结构

一张邮票由冒号分隔的 7 段组成：`version:claim:ts:resource:ext:rand:counter`。

```rust
// 来源：src/hashcash.rs:12
pub struct Stamp {
  version: String,   // "1"
  claim: u32,        // 声明的难度位数（bits）
  ts: String,        // 时间戳 %Y%m%d%H%M%S（UTC）
  resource: String,  // 绑定的资源名（防止邮票被挪用到别处）
  ext: String,       // 扩展（当前为空）
  rand: String,      // 16 位随机盐
  counter: String,   // 工作量证明的解（十六进制）
}
```

### 3.2 `mint`：在客户端做工作量证明

`mint`（`hashcash.rs:58`）是 CPU 密集的核心——不断递增 counter，直到 SHA3-256 哈希的前若干个十六进制位全为 `0`：

```rust
// 来源：src/hashcash.rs:58
pub fn mint(resource: String, bits: Option<u32>) -> Self {
  let bits = bits.unwrap_or(20);
  let rand = /* 16 位 Alphanumeric 随机盐 */;
  let challenge = format!("{}:{}:{}:{}:{}:{}", version, bits, ts, resource, "", rand);
  // ...
  counter: {
    let hex_digits = ((bits as f32) / 4.).ceil() as usize;   // 每 4 bit = 1 个十六进制 0
    let zeros = "0".repeat(hex_digits);
    loop {
      hasher.update(format!("{challenge}:{counter:x}").as_bytes());
      let result = hex::encode(hasher.finalize_reset());
      if result[..hex_digits] == zeros { break format!("{counter:x}"); }  // 找到解
      counter += 1
    }
  }
}
```

难度 `bits` 决定要几个前导零十六进制位（`bits/4`），**难度每增 4 bit，期望计算量翻 16 倍**——这就是 proof-of-work 的"铸造慢、校验快"非对称性。`finalize_reset` 复用同一个 hasher 实例，省去循环里反复分配。

### 3.3 `check`：在服务端快速校验

`check`（`hashcash.rs:36`）只需算一次哈希即可验证，附带多重约束：

```rust
// 来源：src/hashcash.rs:36
pub fn check<S: AsRef<str>>(&self, bits: u32, resource: S) -> bool {
  if self.version == "1"
     && bits <= self.claim                    // 实际难度不低于要求
     && self.check_expiration()               // 未过期（5 分钟）
     && self.resource == resource.as_ref() {  // 资源名匹配，防挪用
    let hex_digits = ((self.claim as f32) / 4.).floor() as usize;
    let mut hasher = Sha3_256::new();
    hasher.update(self.format().as_bytes());
    let result = hex::encode(hasher.finalize());
    result[..hex_digits] == "0".repeat(hex_digits)   // 验证前导零
  } else { false }
}
```

四重校验缺一不可：版本、难度足够、未过期、资源名匹配。`check_expiration`（`hashcash.rs:24`）解析时间戳并加 5 分钟窗口——**邮票有时效，防止重放攻击**。注意 mint 用 `ceil`、check 用 `floor` 计算 `hex_digits`，这是刻意的边界处理（铸造时宁可多算、校验时按声明的 claim 下取整）。

### 3.4 解析与序列化：`TryFrom` 与 `format`

`format`（`hashcash.rs:50`）把结构体拼成冒号分隔串；`TryFrom<&str>`（`hashcash.rs:91`）反向解析并校验格式——必须 7 段，且除第 5 段（`ext` 可空）外都不能为空：

```rust
// 来源：src/hashcash.rs:91
impl TryFrom<&str> for Stamp {
  type Error = String;
  fn try_from(value: &str) -> Result<Self, Self::Error> {
    let stamp_vec = value.split(':').collect::<Vec<&str>>();
    if stamp_vec.len() != 7 || stamp_vec.iter().enumerate().any(|(i, s)| i != 4 && s.is_empty()) {
      return Err(format!("Malformed stamp, expected 6 parts, got {}", stamp_vec.len()));
    }
    // ...逐段赋值，claim 用 .parse() 转 u32
  }
}
```

这套"字符串 ↔ 结构体"的对称设计，让邮票能作为纯字符串在 JS 与 Rust、客户端与服务端之间传递。

### 3.5 N-API 暴露：由上层 crate 包装（非本 crate）

本 crate 只提供算法，`#[napi]` 接口在 `frontend/native` / `backend/native` 里。例如 `frontend/native/src/hashcash.rs` 把 mint/check 包成**异步 Task**（避免阻塞 JS 主线程）：

```rust
// 来源：packages/frontend/native/src/hashcash.rs:31（消费方，非本 crate）
#[napi]
pub fn mint_challenge_response(resource: String, bits: Option<u32>) -> AsyncTask<AsyncMintChallengeResponse> { ... }
#[napi]
pub fn verify_challenge_response(response: String, bits: u32, resource: String) -> AsyncTask<...> { ... }
```

因为 mint 可能跑很久（高 bits 时），用 `AsyncTask` 把计算丢到 libuv 线程池、`compute()` 里跑 `Stamp::mint`、`resolve()` 回 JS——这是 N-API 处理 CPU 密集任务的标准姿势。前端由此获得 `mintChallengeResponse()` 这样的 JS 异步函数。

### 3.6 `napi_utils`：错误转换辅助

```rust
// 来源：src/napi_utils.rs:5
pub fn to_napi_error<E: Display + Debug>(err: E, status: Status) -> Error {
  Error::new(status, err.to_string())
}
pub fn map_napi_err<T, E: Display + Debug>(value: std::result::Result<T, E>, status: Status) -> Result<T> {
  value.map_err(|err| to_napi_error(err, status))
}
```

`map_napi_err` 把任意 `Result<T, E>`（E 可展示）转成 N-API 的 `Result<T>`，统一了原生模块"Rust 错误 → JS 异常"的转换，被 nbstore、doc_loader、doc 等多处复用。

## 4. 语法特色

- **Cargo feature 条件编译（`#[cfg(feature = "...")]`）**：`lib.rs` 按 feature 挂载模块，依赖在 `Cargo.toml` 里声明为 `optional = true` 并绑定到 feature（`hashcash = ["chrono", "hex", "sha3", "rand"]`）——按需裁剪、编译期开关，是 Rust 库管理可选能力的惯用法。
- **`TryFrom<&str>` + 自定义 `Error` 类型**：用标准转换 trait 实现"可失败的解析"，调用方用 `?` 传播错误，比手写解析函数更符合 Rust 习惯。
- **泛型 + trait bound（`<S: AsRef<str>>`、`<E: Display + Debug>`）**：`check` 接受任意能当字符串用的类型；`map_napi_err` 接受任意可展示的错误类型——泛型约束提升 API 通用性。
- **`loop { ... break value }`**：Rust 的 loop 可作为表达式返回值，mint 里直接把 counter 的解作为块结果赋给字段。
- **迭代器链构造随机盐**：`Alphanumeric.sample_iter(rng()).take(16).map(char::from)` 函数式生成随机字符串。
- **`finalize_reset` 复用哈希器**：避免 PoW 循环里反复分配 hasher，是性能细节。
- **`edition = "2024"` + workspace 依赖继承（`{ workspace = true }`）**：统一 Rust 版本与依赖版本，消费 crate 用 `features = [...]` 按需启用。
- **`#[napi] impl Task`（消费方）**：N-API 的异步任务 trait，`compute`/`resolve` 分离计算与回传，CPU 密集逻辑不阻塞 JS。

## 5. 设计 / 实现亮点

- **算法单一真值源**：hashcash 的 mint 与 check 同处一文件、被前后端共同依赖，彻底消除"客户端铸造 / 服务端校验算法漂移"的风险——跨语言（Rust 原生被 JS 调用）协议一致性的典范。
- **feature 精准裁剪依赖**：前端不拉 napi、nbstore 不拉 sha3，各取所需，保持原生产物精简、编译快。
- **mint/check 的非对称成本**：工作量证明天然"生成慢、验证快"，服务端校验几乎零成本却能挡住批量滥用。
- **时效 + 资源绑定防重放/挪用**：5 分钟过期窗口 + resource 名绑定，让邮票不能被重复使用或用到其他操作上。
- **异步 Task 包装（消费方）**：高难度 mint 丢进线程池，不卡 JS 事件循环。
- **错误转换收口**：`map_napi_err` 让所有原生模块的 FFI 错误处理一致。
- **共享 fixtures**：`fixtures/` 提供 docx/pdf/ydoc/代码样例，供其它 native 模块的解析测试复用。

## 6. 对外 API 与注意事项

- **主要 API（Rust）**：
  - `affine_common::hashcash::Stamp`：`Stamp::mint(resource, bits?)`（铸造）、`stamp.check(bits, resource)`（校验）、`stamp.format()`（序列化）、`Stamp::try_from(&str)`（解析）。
  - `affine_common::napi_utils::{to_napi_error, map_napi_err}`：Rust 错误 → N-API 错误。
- **启用方式**：在消费 crate 的 `Cargo.toml` 里 `affine_common = { workspace = true, features = ["hashcash"] }`（按需加 `"napi"`）。
- **暴露给 JS**：本 crate 不含 `#[napi]`；JS 侧的 `mintChallengeResponse`/`verifyChallengeResponse` 由 `frontend/native`、`backend/native` 等包装后导出。
- **坑**：
  - **难度 `bits` 要前后端一致**：服务端 `check(bits, ...)` 要求 `bits <= claim`，客户端 mint 的 bits 不能低于服务端要求，否则校验失败。
  - **5 分钟时效**：客户端算完邮票要尽快提交；高 bits 本身耗时久，若再延迟提交可能过期。
  - **resource 必须严格匹配**：铸造与校验传入的 resource 字符串不一致会被拒。
  - **不要在 JS 主线程同步调用高 bits 的 mint**：务必走上层的 `AsyncTask` 异步包装，否则阻塞事件循环。
  - 本 crate `publish = false`，仅供 workspace 内部通过 `path` 依赖，不发布到 crates.io/npm。

## 7. 延伸

- 直接消费者：`packages/frontend/native`（桌面 N-API）、`packages/backend/native`（服务端 N-API + captcha）、`packages/frontend/mobile-native`（移动端）、`packages/frontend/native/nbstore`（原生 SQLite，用 `napi_utils`）。
- 相关：hashcash 的服务端校验用于防滥用/验证码（见 `backend/native` 的 `captcha.rs`）。
- 对应教程：learning-guide 关于"Rust N-API 原生模块与跨端共享逻辑"的章节。
