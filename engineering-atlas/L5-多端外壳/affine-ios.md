# `@affine/ios`

> 一句话定位：AFFiNE 的 **iOS 外壳应用**——一个用 **Capacitor** 把 `@affine/core` 的 React Web 内容塞进 `WKWebView`、再通过一组 **Swift 原生插件桥**补齐 WebView 做不到的能力（本地 SQLite 存储、原生登录、StoreKit 付费墙、系统图片选择、Mermaid/Typst 原生渲染等）的"薄壳"。它只负责入口、平台适配与原生桥，业务逻辑全部复用 L4 的 `@affine/core`。

| 项        | 值                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/apps/ios`                                                                                                                                                                   |
| 所属层    | L5 · 多端外壳                                                                                                                                                                                  |
| 语言/形态 | TypeScript（Web 侧桥）+ Swift（原生壳）+ Capacitor 应用                                                                                                                                        |
| 关键依赖  | `@affine/core`、`@affine/mobile-shared`、`@affine/nbstore`、`@capacitor/core`、`async-call-rpc`、`react`、`react-router-dom`；原生侧 Capacitor iOS、Apollo-iOS、`affine_mobile_native`(UniFFI) |
| 被谁依赖  | 无（终端产物，产出 App Store 的 AFFiNE iOS App）                                                                                                                                               |
| 构建产物  | `dist/`（Web 资产）+ Xcode 工程编译出的 `.ipa`                                                                                                                                                 |

## 1. 设计逻辑

### 外壳薄、核心厚

AFFiNE 的"编辑器 + 工作区 + 同步"等全部业务都在 L4 的 `@affine/core` 里（React + BlockSuite）。iOS 端**不重写任何业务**，而是把这份 Web 应用原样跑在 `WKWebView` 中。`apps/ios` 本身只提供三样东西：

1. **入口与打包**：`src/index.tsx` 挂载 React 根、`capacitor.config.ts` 告诉 Capacitor 去哪找 Web 资产（`webDir: 'dist'`）。
2. **平台适配**：`src/setup.ts` 针对 `WKWebView` 的合成内存限制调 BlockSuite 视口参数；`src/app.tsx` 把一批移动端 Provider（键盘、触感、分享导入、付费墙）注册进 `@toeverything/infra` 的 `Framework` DI 容器。
3. **原生桥**：`src/plugins/*` 是 Capacitor 插件的 **TS 声明侧**，`App/App/Plugins/*` 是对应的 **Swift 实现侧**，两者靠 Capacitor 的 `registerPlugin` 按名字配对。

### Capacitor 混合应用模型

Capacitor 的核心模型是"**WebView 装 Web 内容 + 原生插件补能力**"：

- `WKWebView`（`AffineViewController` 持有）加载 `dist/index.html`，里面跑的就是 `@affine/core`。
- Web 侧想调用原生，用 `registerPlugin<T>('PluginName')` 拿到一个代理对象，调它的方法会被 Capacitor bridge 序列化成消息发给原生。
- 原生侧一个 `CAPPlugin` 子类声明同名 `jsName` 和方法表，收到消息后执行 Swift 代码、再 `call.resolve(...)` 把结果异步回传。

### iOS 独有部分

- **宿主语言是 Swift**，原生壳是一个标准 Xcode 工程（`App/App.xcworkspace`）。
- **渲染容器是 `WKWebView`**，其进程内存（GPU 合成的 IOSurface）一旦飙高会被系统 jetsam 杀掉——这是 `setup.ts` 大段视口调参注释的由来，是 iOS 外壳最独特的"平台适配税"。
- **GraphQL 绑定走 Apollo-iOS 代码生成**：原生登录/付费墙等纯 Swift 界面需要直接发 GraphQL，故用 `apollo-ios-cli` 把 schema 生成成 Swift 包 `AffineGraphQL`（与 Web 侧 `@affine/graphql` 同源不同产物）。
- **Rust 能力经 UniFFI 静态链接**：`codegen.ts` 用 `cargo` 把 `affine_mobile_native` 编成 `aarch64-apple-ios` 静态库，并生成 `affine_mobile_native.swift` 绑定（见 affine-mobile-native.md）。

### 与同层其它包的边界

`@affine/mobile-shared` 装 iOS/Android **共享的 TS 逻辑**（鉴权代理、blob 文件 token 解码）；`affine_mobile_native` 装**共享的 Rust 原生实现**。`apps/ios` 只装 **iOS 独有的 Swift 壳与 iOS 专属插件声明**，对称包 `apps/android` 装 Kotlin 壳。

## 2. 目录与关键文件

```text
apps/ios/
├── package.json             # name=@affine/ios；scripts: build(affine bundle)/sync(cap sync)/xcode/codegen
├── capacitor.config.ts      # appId=app.affine.pro, webDir='dist', ios.scheme='AFFiNE'；CAP_SERVER_URL 热重载
├── codegen.ts               # 生成 GraphQL(Swift) + Rust(UniFFI Swift 绑定)
├── apollo-codegen-chore.sh  # 下载 apollo-ios-cli → 生成 AffineGraphQL Swift 包
├── apollo-codegen-config.json # schemaNamespace=AffineGraphQL；operation/schema 搜索路径
├── setup.sh                 # 一键开发环境：yarn install→build→sync→rustup→codegen→open xcode
├── src/                     # ===== Web 侧（TypeScript）=====
│   ├── index.tsx            # 入口：bindNativeDBApis + createRoot 挂载 <App/>
│   ├── app.tsx              # Framework DI 装配 + window.* 原生回调 API + nbstore Worker 客户端
│   ├── setup.ts             # WKWebView 内存适配：viewportRuntimeConfig 一组覆盖
│   ├── setup-worker.ts      # Worker 侧 bootstrap（仅 import core/bootstrap/browser）
│   ├── nbstore.worker.ts    # 存储 Worker：StoreManagerConsumer + 原生 DB API 的 RPC 桥
│   ├── proxy.ts             # 鉴权请求代理（接 @affine/mobile-shared/auth）
│   └── plugins/             # 各 Capacitor 插件的 TS 声明侧（definitions.ts + index.ts）
│       ├── nbstore/         # 本地文档存储（jsName='NbStoreDocStorage'）
│       ├── auth/ hashcash/ affine-theme/ preview/
│       ├── image-picker/ navigation-gesture/ paywall/ share-inbox/
└── App/                     # ===== 原生侧（Swift / Xcode）=====
    ├── App.xcworkspace      # Xcode 工作区（含 CocoaPods）
    ├── App/
    │   ├── AppDelegate.swift          # @main，UIApplicationDelegate，URL/分享回调
    │   ├── AffineViewController.swift  # CAPBridgeViewController 子类：WKWebView 配置 + 注册插件实例
    │   ├── Plugins/*/                  # 各插件 Swift 实现（CAPPlugin + CAPBridgedPlugin）
    │   ├── uniffi/                     # 生成物：affine_mobile_native.swift + FFI 头/modulemap
    │   ├── SignIn/ Onboarding/         # 原生登录界面 / 引导页（SwiftUI）
    │   └── Info.plist / Products.storekit
    ├── Packages/            # 本地 SPM 包：AffineGraphQL(Apollo 生成)/AffinePaywall/Intelligents(AI)/AffineResources
    └── ShareExtension/      # iOS 分享扩展（把外部内容送进 share-inbox）
```

## 3. 实现细节

### 3.1 入口与挂载（`src/index.tsx`）

入口极薄：先把原生 DB 适配器绑进 nbstore，再把 React 根挂到 `#app`：

```tsx
// 来源：src/index.tsx
import { bindNativeDBApis } from '@affine/nbstore/sqlite';
import { NbStoreNativeDBApis } from './plugins/nbstore';

bindNativeDBApis(NbStoreNativeDBApis); // 把"原生 SQLite"接到 nbstore

function mountApp() {
  const root = document.getElementById('app')!;
  createRoot(root).render(
    <StrictMode>
      <Telemetry />
      <App />
    </StrictMode>
  );
}
```

`import './setup'`（在 `index.tsx` 顶部通过 `app.tsx` 间接引入）必须在任何编辑器实例构造前执行，这是 `setup.ts` 大段注释强调"module load 时一次性应用"的原因。

### 3.2 WKWebView 内存适配（`src/setup.ts`）

iOS 外壳最具平台特异性的一段。`WKWebView` 在 edgeless 画布合成内存（GPU 侧 IOSurface tiles）飙升时会杀掉 Web 进程，故在模块加载时覆盖 BlockSuite 的视口运行时配置：

```ts
// 来源：src/setup.ts
viewportRuntimeConfig.ZOOM_MIN = 0.4; // 限制最小缩放
viewportRuntimeConfig.OVERSCAN_RATIO = 0.2; // 画布预绘制 20% 边距（连接线保活）
viewportRuntimeConfig.OVERSCAN_RATIO_BLOCK = 0; // DOM 块挂载不做 overscan（每块=一层合成子树）
viewportRuntimeConfig.CANVAS_DPR_CAP_BY_ZOOM = [
  [0.5, 1],
  [0.8, 2],
]; // 缩得越小 dpr 越低（内存∝dpr²）
```

注释揭示了真实权衡：画布 backing-store 内存随 `dpr²` 增长，故对 `zoom < 0.5` 强制 `dpr=1` 把合成预算压住；而 DOM 块挂载因为"每块一层合成子树"最贵，所以 `OVERSCAN_RATIO_BLOCK=0`，靠画布 overscan 保视觉连续性而不付块挂载内存。这是外壳为宿主平台做的"退让性"适配，不改任何业务逻辑。

### 3.3 DI 装配与原生 Provider（`src/app.tsx`）

`app.tsx` 复用 `@affine/core` 的模块装配函数，再把一批**平台能力以 `framework.impl` 注入**——这正是"外壳只提供适配"的体现：

```ts
// 来源：src/app.tsx
const framework = new Framework();
configureCommonModules(framework);
configureBrowserWorkbenchModule(framework);
configureBrowserWorkspaceFlavours(framework);
configureMobileModules(framework);           // ← core 提供的移动端模块
// 把原生能力桥接成 core 定义的 Provider 接口：
framework.impl(HapticProvider, { impact: o => Haptics.impact(o), /* ... */ });
framework.impl(ValidatorProvider, {          // hashcash 挑战交给原生算
  async validate(_challenge, resource) {
    const res = await Hashcash.hash({ challenge: resource });
    return res.value;
  },
});
framework.scope(ServerScope).override(AuthProvider, resolver => ({  // 登录改走原生
  async signInMagicLink(email, linkToken, clientNonce) { await Auth.signInMagicLink({ ... }); },
  async signInOauth(code, state, _p, nonce) { await Auth.signInOauth({ ... }); return {}; },
  /* ... */
}));
framework.impl(NativePaywallProvider, { showPaywall: t => PayWall.showPayWall({ type: t }) });
```

此外 `app.tsx` 把一组函数挂到 `window` 上供 Swift 回调（反向桥：原生 → JS）：

```ts
// 来源：src/app.tsx —— Swift 侧通过 evaluateJavaScript 调这些
(window as any).getCurrentServerBaseUrl = () =>
  getCurrentServerForNative().baseUrl;
(window as any).getCurrentDocContentInMarkdown = async () => {
  /* 导出当前文档为 markdown */
};
(window as any).createNewDocByMarkdownInCurrentWorkspace = async (
  markdown,
  title
) => {
  /* ... */
};
(window as any).nativeStartOAuthSignIn = async provider => {
  /* 返回 OAuth URL */
};
```

### 3.4 nbstore 三段式存储链路

这是理解 iOS 数据层最关键的一环。本地文档存储既不想阻塞主线程，又要落到原生 SQLite，于是形成"**主线程 ↔ Worker ↔ 原生插件 ↔ Rust**"链：

1. **主线程**（`index.tsx`）：`bindNativeDBApis(NbStoreNativeDBApis)`。`NbStoreNativeDBApis`（`plugins/nbstore/index.ts`）把 nbstore 的抽象 API 翻译成对 `NbStore` 这个 Capacitor 插件的调用，并做 `Date↔毫秒`、`Uint8Array↔base64` 的编解码。
2. **Worker**（`nbstore.worker.ts`）：真正的 `StoreManagerConsumer` 跑在 Worker 里，组合 `sqliteStorages`/`idbStoragesIndexerOnly`/`cloudStorages` 等。
3. **跨线程桥**（`app.tsx` 的 `createStoreManagerClient`）：用 `MessageChannel` + `async-call-rpc` 把主线程持有的 `NbStoreNativeDBApis` 暴露给 Worker 调用——因为原生插件只能在主线程（WebView 上下文）调用，Worker 里无法直接 `registerPlugin`：

```ts
// 来源：src/app.tsx createStoreManagerClient()
const worker = new Worker(getWorkerUrl('nbstore'));
const { port1: nativeDBApiChannelServer, port2: nativeDBApiChannelClient } =
  new MessageChannel();
AsyncCall<typeof NbStoreNativeDBApis>(NbStoreNativeDBApis, {
  channel: {/* postMessage 适配 */},
});
worker.postMessage(
  { type: 'native-db-api-channel', port: nativeDBApiChannelClient },
  [nativeDBApiChannelClient]
);
return new StoreManagerClient(new OpClient(worker));
```

Worker 侧（`nbstore.worker.ts`）收到 port 后 `AsyncCall<NativeDBApis>({}, {channel})` 建一个远端代理并 `bindNativeDBApis(rpc)`——于是 Worker 里的 SQLite 存储调用会经 RPC 回到主线程，再进原生。

4. **原生 → Rust**（`App/App/Plugins/NBStore/NBStorePlugin.swift`）：`NbStorePlugin` 持有一个 UniFFI 对象 `DocStoragePool`，方法全是 `async`：

```swift
// 来源：App/App/Plugins/NBStore/NBStorePlugin.swift
public class NbStorePlugin: CAPPlugin, CAPBridgedPlugin {
  private let docStoragePool: DocStoragePool = newDocStoragePool()   // ← UniFFI 自由函数构造
  public let jsName = "NbStoreDocStorage"                            // ← 与 registerPlugin('NbStoreDocStorage') 对应
  @objc func connect(_ call: CAPPluginCall) {
    Task {                                                           // async 方法在 Swift Task 中 await
      let db = peerDir.appending(path: spaceId + ".db")
      try await docStoragePool.connect(universalId: id, path: db.path())
      call.resolve()
    }
  }
}
```

### 3.5 Swift 插件范式（`App/App/Plugins/*`）

最小插件 `HashcashPlugin` 完整展示 Capacitor 原生插件三要素——`identifier`/`jsName`/`pluginMethods` 方法表，`@objc` 方法 + `CAPPluginCall`：

```swift
// 来源：App/App/Plugins/Cookie/HashcashPlugin.swift
@objc(HashcashPlugin)
public class HashcashPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "HashcashPlugin"
  public let jsName = "Hashcash"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "hash", returnType: CAPPluginReturnPromise),
  ]
  @objc func hash(_ call: CAPPluginCall) {
    DispatchQueue.global(qos: .default).async {
      let challenge = call.getString("challenge") ?? ""
      let bits = call.getInt("bits") ?? 20
      call.resolve(["value": hashcashMint(resource: challenge, bits: UInt32(bits))])  // ← UniFFI 调用
    }
  }
}
```

这对应 TS 侧的声明（`src/plugins/hashcash`）：

```ts
// 来源：src/plugins/hashcash/index.ts + definitions.ts
export interface HashcashPlugin {
  hash(options: {
    challenge: string;
    bits?: number;
  }): Promise<{ value: string }>;
}
const Hashcash = registerPlugin<HashcashPlugin>('Hashcash'); // 名字 'Hashcash' 必须等于 Swift jsName
```

插件实例在视图控制器加载时统一注册（而非自动发现）：

```swift
// 来源：App/App/AffineViewController.swift
override func capacitorDidLoad() {
  let plugins: [CAPPlugin] = [
    AffineThemePlugin(associatedController: self), AuthPlugin(), CookiePlugin(),
    HashcashPlugin(), ImagePickerPlugin(associatedController: self),
    NavigationGesturePlugin(), NbStorePlugin(), PayWallPlugin(associatedController: self),
    PreviewPlugin(), ShareInboxPlugin(),
  ]
  plugins.forEach { bridge?.registerPluginInstance($0) }
}
```

`PreviewPlugin` 则是把 BlockSuite 的代码块预览（Mermaid/Typst）下沉到 Rust：Web 侧在 `app.tsx` 里 `registerNativePreviewHandlers({ renderMermaidSvg: r => Preview.renderMermaidSvg(r), ... })`，Swift 侧调 UniFFI 的 `renderMermaidPreviewSvg` / `renderTypstPreviewSvg`。

### 3.6 WKWebView 的宿主配置（`AffineViewController.swift`）

外壳要把一个"桌面习惯"的 Web 应用驯服成移动体验：禁用 WebView 自带缩放/回弹（避免与 edgeless 画布手势冲突）、注入 viewport meta 防智能缩放、内存告警时向 JS 派发事件：

```swift
// 来源：App/App/AffineViewController.swift
webView?.scrollView.minimumZoomScale = 1.0; webView?.scrollView.maximumZoomScale = 1.0
webView?.scrollView.bounces = false
webView?.configuration.userContentController.addUserScript(
  WKUserScript(source: viewportScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
override func didReceiveMemoryWarning() {
  webView?.evaluateJavaScript("window.dispatchEvent(new Event('affine:memory-pressure'))")
}
```

### 3.7 构建与代码生成（`codegen.ts` / `apollo-codegen-chore.sh` / `setup.sh`）

`codegen.ts` 串起两类代码生成：

```ts
// 来源：codegen.ts
execSync(`${PackageRoot}/apollo-codegen-chore.sh "${version}"`); // 1. GraphQL → Swift 包
execSync(
  'cargo build -p affine_mobile_native --features use-as-lib --lib --release --target aarch64-apple-ios'
); // 2a. 编 Rust 静态库
execSync(`cargo run -p affine_mobile_native ... --bin uniffi-bindgen generate \
  --library .../libaffine_mobile_native.a --language swift --out-dir ${PackageRoot}/App/App/uniffi`); // 2b. 生成 Swift 绑定
```

`apollo-codegen-chore.sh` 下载 `apollo-ios-cli` 并按 `apollo-codegen-config.json`（`operationSearchPaths` 指向 `common/graphql`，`schemaSearchPaths` 指向 `backend/server/src/schema.gql`）生成 `AffineGraphQL` SPM 包。`setup.sh` 则是开发者一键环境脚本：`yarn install` → 临时把 `project.pbxproj` 的 `objectVersion` 设为 56 → `affine bundle` 构建 Web → `cap sync` 同步资产 → `rustup target add aarch64-apple-ios*` → codegen → `cap open ios`。

`package.json` 的 scripts 固化了日常循环：`build`=`affine bundle`、`sync`=`cap sync`、`sync:dev`=`CAP_SERVER_URL=http://localhost:8080 cap sync`（配 `dev` 的热重载）、`xcode`=`cap open ios`。

## 4. 语法特色

### TypeScript 侧

- **`registerPlugin<T>(name)` 泛型契约**：`registerPlugin<NbStorePlugin>('NbStoreDocStorage')` 用泛型参数把插件的 TS 接口与运行时代理绑定，字符串名字是与原生 `jsName` 对齐的唯一纽带——拼错即运行时找不到插件。`definitions.ts`/`index.ts` 分离是 Capacitor 约定：前者纯类型、后者 `registerPlugin` + `export *`。
- **`satisfies` 式接口实现**：`NbStoreNativeDBApis: NativeDBApis = {...}` 让这个纯桥接对象被 `@affine/nbstore` 的 `NativeDBApis` 类型精确约束，每个方法的入参/返回形状都被编译期校验。
- **`MessageChannel` + `async-call-rpc` 的类型化 RPC**：`AsyncCall<typeof NbStoreNativeDBApis>(...)` 用 `typeof` 取具体对象类型做 RPC 契约，Worker 侧 `AsyncCall<NativeDBApis>({}, ...)` 用空实现 + 泛型得到纯远端代理——同一接口两侧各取所需。
- **`(window as any).fn = ...` 反向桥**：原生要调 JS 时没有类型通道，只能挂 `window`，故用 `as any` 显式逃逸类型系统，这是混合应用"原生→JS"方向的惯用法。

### Swift 侧

- **`@objc(PluginName)` + `CAPBridgedPlugin` 协议**：Capacitor bridge 靠 Objective-C 运行时按名字查类、按 `pluginMethods` 表查方法，故插件类必须 `@objc` 暴露；`jsName`/`identifier`/`pluginMethods` 是协议要求的静态元数据。
- **`CAPPluginCall` 的可选取参**：`call.getString("challenge") ?? ""`、`call.getInt("bits") ?? 20` 体现跨桥参数天然是动态/可空的，Swift 用 `??` 兜底；自定义的 `call.getStringEnsure("id")`（见 `NBStorePlugin`）则用 `throws` 把缺参变成错误。
- **`async`/`await` + `Task { }`**：UniFFI 把 Rust `async fn` 生成为 Swift `async throws` 方法（见 affine-mobile-native.md），插件里用 `Task { try await docStoragePool.connect(...) }` 驱动，`call.reject("...", nil, error)` 回传错误。
- **UniFFI 生成符号直接当全局函数用**：`hashcashMint(resource:bits:)`、`newDocStoragePool()`、`renderMermaidPreviewSvg(...)` 都是 `uniffi/affine_mobile_native.swift` 里的符号，Swift 侧 `import` 后像本地函数一样调，命名由 UniFFI 自动从 snake_case 转 camelCase。

## 5. 设计 / 实现亮点

- **零业务重写的混合架构**：iOS 端不含任何文档/工作区逻辑，`@affine/core` 的同一份 React 代码在桌面、Web、移动三端跑，外壳只补"WebView 做不到的事"，把跨端一致性做到极致。
- **存储链路的线程/进程解耦**：主线程持桥、Worker 跑存储引擎、原生落 SQLite、Rust 做重活，四段之间用 `MessageChannel`/`async-call-rpc`/Capacitor bridge/UniFFI 四种机制逐层桥接，既不阻塞 UI 又复用了 Rust 实现。
- **针对 WKWebView 的内存工程**：`setup.ts` 把"画布 backing-store 内存 ∝ dpr²""每个 DOM 块是一层合成子树"这类底层事实量化成几个运行时旋钮，是外壳为宿主平台做深度适配而不侵入业务的范本。
- **双 GraphQL 产物同源**：Web 侧 `@affine/graphql` 与原生 `AffineGraphQL`(Apollo-iOS) 从同一份 `.gql` 与 `schema.gql` 各自生成，保证原生登录界面与 Web 的接口契约一致。
- **反向桥集中管理**：所有 `window.*` 原生回调集中在 `app.tsx`，并通过 `frameworkProvider.get(...)` 复用 DI 容器里的服务，让"原生→JS"也能拿到完整业务能力。

## 6. 对外 API 与注意事项

- **本包无 JS 导出给其它包**：它是终端应用，`src/plugins/*` 的导出仅供自身 `app.tsx`/`index.tsx` 使用。
- **插件名三处必须一致**：TS `registerPlugin<T>('X')`、Swift `jsName = "X"`、`capacitorDidLoad` 里注册的实例类型。例如 nbstore 的名字是 `'NbStoreDocStorage'` 而非类名 `NbStorePlugin`——改名需三处同步。
- **原生插件只能在主线程/WebView 上下文调用**：Worker 里的存储引擎必须经 `MessageChannel` RPC 回主线程才能触达原生，不能直接 `registerPlugin`。
- **`uniffi/*.swift`、`AffineGraphQL/Sources/*` 都是生成物**：改 Rust 导出或 `.gql` 后需重跑 `yarn codegen`（本文不触发构建）；`setup.sh` 里对 `project.pbxproj` 的 `objectVersion` 改写是临时兼容措施。
- **blob 可能是文件 token**：`getBlob` 返回的 `data` 可能是 `__AFFINE_BLOB_FILE__:` 前缀的大对象文件路径，经 `@affine/mobile-shared/nbstore/payload` 的 `decodePayload` 解码，勿当普通 base64。
- **热重载**：`yarn dev` + `sync:dev`（`CAP_SERVER_URL=http://localhost:8080`）让 WebView 指向本地 dev server；生产构建务必清掉该环境变量。
- **`webContentsDebuggingEnabled: true`**：当前配置允许 Safari 远程调试 WebView，发布前需关注。

## 7. 延伸

- **原生桥底座**：`affine-mobile-native.md`（UniFFI Rust→Swift 绑定，`DocStoragePool`/`hashcashMint`/`renderMermaidPreviewSvg` 的 Rust 实现）。
- **共享 TS 逻辑**：`affine-mobile-shared.md`（鉴权请求代理、blob 文件 token 解码，被 `src/proxy.ts`、`plugins/nbstore` 复用）。
- **对称外壳**：`affine-android.md`（Kotlin/Gradle 版，结构对称、差异在原生实现与构建链）。
- **复用的核心**：`@affine/core`（`configureMobileModules`、`configureCommonModules`）、`@affine/nbstore`（存储引擎与 `NativeDBApis` 契约）、`@toeverything/infra`（`Framework` DI、`OpClient`，见 toeverything-infra.md）。
