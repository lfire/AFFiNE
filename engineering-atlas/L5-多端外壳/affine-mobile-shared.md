# `@affine/mobile-shared`

> 一句话定位：iOS/Android 两个 Capacitor 外壳**共享的移动端 TS 逻辑库**——把两端都要用、又不属于 `@affine/core` 业务的"胶水代码"抽成一个包：鉴权请求代理（给 `fetch`/`XMLHttpRequest` 自动挂 token 并在 401 时刷新重放）、主线程↔Worker 的鉴权 RPC 通道、以及移动端大 blob 的"文件 token"安全解码。它是外壳层的"**共享薄层**"，与原生侧的共享实现 `affine_mobile_native`（Rust/UniFFI）形成 TS / 原生两条并行复用线。

| 项        | 值                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/apps/mobile-shared`                                                                |
| 所属层    | L5 · 多端外壳                                                                                         |
| 语言/形态 | TypeScript 库（`sideEffects: false`，多子入口）                                                       |
| 关键依赖  | `@affine/core`（仅用 `base64ToUint8Array` 等编解码）、`@capacitor/core`（`Capacitor.convertFileSrc`） |
| 被谁依赖  | `@affine/ios`、`@affine/android`（经 `src/proxy.ts`、`src/app.tsx`、`plugins/nbstore` 等引用）        |
| 对外入口  | `.`、`./auth/channel`、`./auth/endpoint`、`./auth/request`、`./nbstore/optional`、`./nbstore/payload` |

## 1. 设计逻辑

### 为什么要单独成包

iOS 与 Android 的外壳 `src/` 结构高度镜像（见 affine-ios.md / affine-android.md），其中有几块逻辑**与宿主平台无关、却又不该放进 `@affine/core`**：

- **鉴权请求代理**：移动端的 token 由原生侧（Swift/Kotlin 的 `Auth` 插件）托管，Web 内容发任何 `fetch`/XHR 时都要自动带上 `Bearer`，并在收到 401 时静默刷新并重放——这套"劫持全局网络 API"的逻辑两端一字不差。
- **鉴权 RPC 通道**：nbstore 的存储引擎跑在 Worker 里，但 token 只在主线程（能调原生插件的 WebView 上下文）拿得到，于是需要一条 `MessagePort` 通道把"求 token"的请求从 Worker 转发回主线程。
- **blob 文件 token 解码**：移动端内存敏感，大 blob 不整块过 FFI，而是被原生侧落盘成 `__AFFINE_BLOB_FILE__:<path>` 形式的"文件 token"（见 affine-mobile-native.md 的 `MobileBlobCache`）。Web 侧读到这种 token 要安全地把文件读回 `Uint8Array`。

把它们沉淀为 `@affine/mobile-shared`，两端 `import` 同一份实现，杜绝"复制粘贴两份、改一处漏一处"。

### 核心边界

- 它**不含 UI、不含业务**，纯逻辑/工具；`sideEffects: false` 便于摇树。
- 它**不碰原生**，只与浏览器/WebView 环境的 `fetch`/`XMLHttpRequest`/`MessagePort`/`Capacitor.convertFileSrc` 打交道；真正的 token 托管与 blob 落盘在原生侧。
- 它与 `affine_mobile_native` 是**并行关系**：后者是两端共享的 **Rust 原生实现**，本包是两端共享的 **TS 胶水**，一个在 FFI 之下、一个在 WebView 之内，`__AFFINE_BLOB_FILE__:` 前缀是两者约定的契约。

## 2. 目录与关键文件

```text
mobile-shared/
├── package.json         # name=@affine/mobile-shared；sideEffects:false；exports 多子入口映射
├── tsconfig.json
└── src/
    ├── index.ts         # 聚合入口：re-export 全部子模块
    ├── auth/
    │   ├── endpoint.ts   # canonicalAuthEndpoint() 规范化 endpoint；shouldRefreshAccessToken() 判错误码
    │   ├── request.ts    # AuthRequestProvider 接口 + createAuthFetch + installAuthRequestProxy（劫持 fetch/XHR）
    │   ├── channel.ts    # serveAuthRequests（主线程服务端）+ MessagePortAuthProvider（Worker 客户端）
    │   └── auth.spec.ts
    └── nbstore/
        ├── payload.ts    # MOBILE_BLOB_FILE_PREFIX + decodePayload（base64 或文件 token）+ 路径安全校验
        ├── payload.spec.ts
        ├── optional.ts   # normalizeNativeOptional（undefined→null 归一）
        └── optional.spec.ts
```

`package.json` 的 `exports` 显式列出每个子入口，消费方可精确 `import ... from '@affine/mobile-shared/auth/request'`，配合 `sideEffects: false` 做细粒度摇树：

```jsonc
// 来源：package.json
"exports": {
  ".": "./src/index.ts",
  "./auth/channel": "./src/auth/channel.ts",
  "./auth/endpoint": "./src/auth/endpoint.ts",
  "./auth/request": "./src/auth/request.ts",
  "./nbstore/optional": "./src/nbstore/optional.ts",
  "./nbstore/payload": "./src/nbstore/payload.ts"
}
```

## 3. 实现细节

### 3.1 鉴权端点规范化（`auth/endpoint.ts`）

两个纯函数，是整套鉴权逻辑的"词汇表"：

```ts
// 来源：src/auth/endpoint.ts
export function canonicalAuthEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : endpoint;
  } catch {
    return endpoint;
  }
}
export function shouldRefreshAccessToken(code: unknown) {
  return code === 'ACCESS_TOKEN_EXPIRED' || code === 'ACCESS_TOKEN_INVALID';
}
```

`canonicalAuthEndpoint` 把任意 URL 收敛成 `origin`（同一服务器的不同路径共用一个 token 域）；`shouldRefreshAccessToken` 定义"什么错误码才值得刷新重试"，被 `request.ts` 复用，避免魔法字符串散落。

### 3.2 鉴权请求代理（`auth/request.ts`）——劫持全局网络 API

核心是 `installAuthRequestProxy`：把 `globalThis.fetch` 和 `globalThis.XMLHttpRequest` 整个替换掉，让 Web 内容无感知地获得"自动带 token + 401 刷新重放"。

**`AuthRequestProvider` 接口**是本包与外壳的契约——外壳用原生 `Auth` 插件实现它：

```ts
// 来源：src/auth/request.ts
export interface AuthRequestProvider {
  getValidAccessToken(endpoint: string): Promise<string | null>;
  refreshAccessToken(endpoint: string): Promise<string>;
}
```

**`fetch` 包装**：发请求前取 token 挂 `Authorization`，若响应 401 且错误码该刷新，则刷新后用请求的 clone 重放一次：

```ts
// 来源：src/auth/request.ts createAuthFetch
return async (input, init) => {
  const request = new Request(input, init);
  const retry = request.clone(); // 预先克隆，流只能读一次
  const endpoint = skipStoredAuth ? null : authEndpointForUrl(request.url);
  const token = endpoint ? await provider.getValidAccessToken(endpoint) : null;
  if (token) request.headers.set('Authorization', `Bearer ${token}`);
  const response = await rawFetch(request);
  if (response.status !== 401 || !endpoint) return response;
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  if (!shouldRefreshAccessToken(body?.code)) return response;
  const refreshed = await provider.refreshAccessToken(endpoint);
  retry.headers.set('Authorization', `Bearer ${refreshed}`);
  return rawFetch(retry);
};
```

**`XMLHttpRequest` 子类化**更繁琐，因为 XHR 是事件/状态机模型：子类重写 `open`/`setRequestHeader`/`send`/`abort`，在 `send` 前异步取 token、在 `readystatechange` 命中 401 时**吞掉该次完成事件**（`event.stopImmediatePropagation()`）、刷新 token 后用保存的方法/URL/头/body 重新 `open`+`send`，对调用方透明：

```ts
// 来源：src/auth/request.ts installAuthRequestProxy
globalThis.XMLHttpRequest = class extends rawXMLHttpRequest {
  override send(body?) {
    this.skipStoredAuth = shouldSkipStoredAuthToken(targetUrl);
    const sendVersion = this.sendVersion; // 版本号防竞态（abort/重开）
    (endpoint
      ? provider.getValidAccessToken(endpoint)
      : Promise.resolve(null)
    ).then(
      token => {
        if (sendVersion !== this.sendVersion) return; // 已被 abort/重开，放弃
        if (token) super.setRequestHeader('Authorization', `Bearer ${token}`);
        super.send(body);
      },
      () => super.send(body)
    );
  }
  private async replayWithFreshToken() {
    /* 刷新后重建 open+header+send，replaying 标志抑制旧事件 */
  }
};
```

`shouldSkipStoredAuthToken` 枚举了**不该挂 token 的路径**（`/socket.io`、`/api/auth/*`、`/api/oauth/*` 等登录/握手端点），避免给鉴权请求本身塞过期 token 造成死循环。`sendVersion` 单调递增，是防"刷新途中请求被 abort 或重开"竞态的关键。

### 3.3 鉴权 RPC 通道（`auth/channel.ts`）——跨线程求 token

为什么需要它：`request.ts` 的 proxy 装在 **Worker**（nbstore.worker.ts）里时，Worker 无法调原生 `Auth` 插件（插件只在主线程可用）。于是 token 的实际提供者在主线程，Worker 侧只持有一个"远程 Provider"，两者用 `MessagePort` 通信。

**主线程侧 `serveAuthRequests`**：收到 `{id, operation, endpoint}` 请求，调真正的 provider，把结果/错误码回传：

```ts
// 来源：src/auth/channel.ts
export function serveAuthRequests(
  port: MessagePort,
  provider: AuthRequestProvider
) {
  port.addEventListener('message', event => {
    const { id, operation, endpoint } = event.data;
    const request =
      operation === 'refresh'
        ? provider.refreshAccessToken(endpoint)
        : provider.getValidAccessToken(endpoint);
    request.then(
      token => port.postMessage({ id, token }),
      error => port.postMessage({ id, error: errorCode(error) })
    ); // 错误降级成错误码字符串
  });
  port.start();
}
```

**Worker 侧 `MessagePortAuthProvider`** 实现 `AuthRequestProvider`，把方法调用变成一条带 `id` 的消息、用 `pending` map 等回应，并加 **5 秒超时**兜底、对**终止性错误**（`terminalAuthErrors`：会话过期/撤销/refresh 失效等）直接返回 `null`（不再徒劳重试）：

```ts
// 来源：src/auth/channel.ts
export class MessagePortAuthProvider implements AuthRequestProvider {
  async getValidAccessToken(endpoint: string) {
    try { return await this.request('get-valid', endpoint); }
    catch (error) {
      if (error instanceof Error && terminalAuthErrors.has(error.message)) return null;  // 不可恢复→放弃
      throw error;
    }
  }
  private request(operation: AuthOperation, endpoint: string) {
    const id = String(++this.nextRequestId);
    return new Promise<string | null>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(temporaryAuthError)); }, 5000);
      this.pending.set(id, { resolve: t => { clearTimeout(timeout); resolve(t); }, reject: ... });
      port.postMessage({ id, operation, endpoint });
    });
  }
}
```

这套通道正是 affine-ios.md 3.4 节里 `createStoreManagerClient` 建的第二条 `MessageChannel`（`type: 'auth-access-token-channel'`）所承载的协议——两端 `app.tsx` 调 `serveAuthRequests`，Worker 里 `installAuthRequestProxy(new MessagePortAuthProvider())`。

### 3.4 blob 文件 token 解码（`nbstore/payload.ts`）——安全第一

原生侧把大 blob（超过 `MOBILE_PAYLOAD_INLINE_THRESHOLD_BYTES = 1MB`）落盘并返回 `__AFFINE_BLOB_FILE__:<path>` token。`decodePayload` 负责把 token 或普通 base64 都解成 `Uint8Array`：

```ts
// 来源：src/nbstore/payload.ts
export const MOBILE_BLOB_FILE_PREFIX = '__AFFINE_BLOB_FILE__:';
export async function decodePayload(data: string, prefix: string, options?): Promise<Uint8Array> {
  if (!data.startsWith(prefix)) return base64ToUint8Array(data);     // 普通内联 base64
  const normalizedPath = normalizeTokenFilePath(data.slice(prefix.length));
  assertMobileCachePath(normalizedPath);                             // ★ 严格路径白名单校验
  try { return await readTokenPayload(normalizedPath); }             // Capacitor.convertFileSrc + fetch
  catch (error) {
    const refreshed = await options?.onTokenReadFailure?.(...);      // 文件失效→回调重取 blob
    if (!refreshed) throw error;
    return decodePayload(refreshed, prefix);                         // 用新 token 再解一次
  }
}
```

**`assertMobileCachePath` 是本包安全含量最高的函数**：token 里的路径来自原生、经过 WebView，若不校验就 `fetch(file://...)` 会酿成任意文件读取漏洞。它逐段解码、拒绝 `.`/`..`/分隔符（防路径穿越），并要求路径**严格匹配移动端缓存目录结构**——文件名是 `[0-9a-f]{16}.blob`、桶名是 `[0-9a-f]{16}`、缓存目录名必须是 `nbstore-blob-cache`、父目录必须落在 iOS/Android 的合法缓存根（`Caches`/`cache`/`tmp`/`T`）下：

```ts
// 来源：src/nbstore/payload.ts
function assertMobileCachePath(fileUrl: string): void {
  // 解析 file:// → 逐段 decodeURIComponent，任何 '.'/'..'/'/'/'\\' 直接抛错
  if (
    !fileName ||
    cacheDir !== MOBILE_PAYLOAD_CACHE_DIR ||
    !MOBILE_PAYLOAD_BUCKET_PATTERN.test(bucket) ||
    !MOBILE_PAYLOAD_FILE_PATTERN.test(fileName) ||
    !MOBILE_PAYLOAD_PARENT_DIRS.has(parentDir) ||
    !isAllowedCacheParent(decodedSegments, parentDir, cacheParent)
  )
    throw new Error(
      `Refusing to read mobile payload outside cache dir: ${fileUrl}`
    );
}
```

`isAllowedCacheParent` 进一步按平台细分：iOS 的 `Library/Caches`（根在 `var`/`private`）、Android 的 `data/<包名>/cache`（`cacheParent` 要匹配 Android 包名正则）、临时目录 `tmp`/`T` 等——把"可信文件"收缩到最小集合。`readTokenPayload` 最终用 `Capacitor.convertFileSrc(filePath)` 把 `file://` 路径转成 WebView 可 `fetch` 的 URL 再读字节。

这个 token 在 iOS 的 `plugins/nbstore/index.ts` 里被消费：`getBlob` 拿到 `record.data` 后调 `decodePayload(record.data, MOBILE_BLOB_FILE_PREFIX, { onTokenReadFailure })`，`onTokenReadFailure` 会重新向原生 `getBlob` 要一次（处理缓存文件被系统清理的情况）。

### 3.5 可空值归一（`nbstore/optional.ts`）

一行工具，统一 FFI 边界的"无值"表达——UniFFI/Capacitor 过来的可能是 `undefined`，JS 侧统一成 `null`：

```ts
// 来源：src/nbstore/optional.ts
export function normalizeNativeOptional<T>(value: T | null | undefined) {
  return value ?? null;
}
```

## 4. 语法特色

- **`exports` 多子入口 + `sideEffects: false`**：`package.json` 用条件导出把每个文件映射成独立子路径，消费方按需 `import '@affine/mobile-shared/nbstore/payload'`，打包器据 `sideEffects: false` 摇掉未用模块——纯逻辑库的标准姿势。
- **`extends XMLHttpRequest` 类继承 + `override`**：用 ES class 继承原生 XHR 并 `override open/send/...`，在保持原生语义的同时注入鉴权逻辑；`super.open(...)`/`super.send(...)` 精确区分"框架语义"与"被劫持语义"。这是对内置构造函数做透明增强的高级用法。
- **`satisfies`/接口实现约束跨线程协议**：`port.postMessage({ id, token } satisfies AuthResponse)`（`channel.ts`）用 `satisfies` 保证消息形状符合协议类型又不放宽字面量类型——RPC 两端靠 `AuthRequest`/`AuthResponse` 类型对齐。
- **泛型工具 + `??` 归一**：`normalizeNativeOptional<T>(value: T | null | undefined): T | null`，泛型保留具体类型、`??` 把两种"空"收敛成一种。
- **版本号防竞态（`sendVersion`）**：用单调递增整数给异步操作打快照、回调时比对，是没有可取消 Promise 时在事件模型里防竞态的经典手法。
- **防御式字符串/正则校验**：`payload.ts` 大量用具名正则常量（`MOBILE_PAYLOAD_BUCKET_PATTERN` 等）与逐段白名单，体现"**来自原生的路径一律视为不可信输入**"的安全立场。
- **`Set` 做白名单查表**：`terminalAuthErrors`（`channel.ts`）、`MOBILE_PAYLOAD_PARENT_DIRS`（`payload.ts`）用 `Set.has(...)` 做 O(1) 归类，比一串 `||` 更清晰可维护。

## 5. 设计 / 实现亮点

- **"一次装好、全局透明"的鉴权**：`installAuthRequestProxy` 同时劫持 `fetch` 与 `XMLHttpRequest`，使 `@affine/core` 的所有网络调用（包括第三方库发的 XHR）无需改动即自动带 token、自动刷新重放，业务对移动端 token 托管完全无感。
- **线程边界的优雅抽象**：`AuthRequestProvider` 一个接口两种实现——主线程是原生插件适配器、Worker 是 `MessagePortAuthProvider`——让"token 在主线程、消费在 Worker"这个物理约束在类型层面被抹平。
- **安全优先的文件读取**：`assertMobileCachePath` 把"读原生落盘文件"这类高危操作关进极窄的路径白名单，正面防御路径穿越/任意文件读取，并有专门的 `payload.spec.ts` 守护。
- **失效自愈**：`decodePayload` 的 `onTokenReadFailure` 回调让"缓存文件被系统清掉"这种移动端常态能自动回源重取，而非直接报错。
- **TS/原生双共享线对称**：本包（TS 共享）与 `affine_mobile_native`（Rust 共享）以 `__AFFINE_BLOB_FILE__:` 为契约对接，外壳两端各自只写极薄的平台插件——复用被推到极致。

## 6. 对外 API 与注意事项

- **主要导出**：`installAuthRequestProxy`/`createAuthFetch`/`AuthRequestProvider`（`auth/request`）、`serveAuthRequests`/`MessagePortAuthProvider`（`auth/channel`）、`canonicalAuthEndpoint`/`shouldRefreshAccessToken`（`auth/endpoint`）、`decodePayload`/`MOBILE_BLOB_FILE_PREFIX`（`nbstore/payload`）、`normalizeNativeOptional`（`nbstore/optional`）。
- **`installAuthRequestProxy` 有全局副作用**：它替换 `globalThis.fetch`/`XMLHttpRequest`，应在应用启动极早期调用一次（iOS 在 `src/proxy.ts`、Worker 在 `nbstore.worker.ts`），重复安装会叠加包装层。
- **`skip` 名单要与后端对齐**：新增鉴权/握手端点时需同步 `shouldSkipStoredAuthToken` 的白名单，否则可能给登录请求塞上过期 token。
- **path token 校验勿放宽**：`assertMobileCachePath` 的规则与原生侧落盘目录强耦合；原生若改缓存目录结构，必须同步此处，且改动要经安全审查（放宽即引入文件读取风险）。
- **`MessagePortAuthProvider` 的 5s 超时与终止错误集**：`terminalAuthErrors` 决定哪些错误"放弃而非重试"，与后端错误码契约绑定，改后端码需同步。
- **依赖 `Capacitor.convertFileSrc`**：`readTokenPayload` 仅在 Capacitor WebView 环境有效，纯浏览器环境无法读 `file://` token。

## 7. 延伸

- **消费方**：`affine-ios.md`、`affine-android.md`（`src/proxy.ts` 装 `installAuthRequestProxy`、`app.tsx` 建 auth 通道、`plugins/nbstore` 用 `decodePayload`）。
- **原生对端**：`affine-mobile-native.md`（`MobileBlobCache` 产出 `__AFFINE_BLOB_FILE__:` 文件 token、`DocStoragePool` 的 blob 读写）。
- **复用的编解码**：`@affine/core` 的 `base64ToUint8Array`、`@affine/nbstore` 的存储契约。
- **基础设施**：`@toeverything/infra` 的 `OpClient`/Worker RPC（nbstore Worker 之上，见 toeverything-infra.md）。
