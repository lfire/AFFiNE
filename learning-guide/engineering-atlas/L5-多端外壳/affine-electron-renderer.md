# `@affine/electron-renderer`

> 一句话定位：AFFiNE 桌面版的 **渲染进程外壳**——它是运行在 Electron `WebContentsView` 里的那个"网页应用"，装配 `@affine/core` 的 **Electron 变体**，经 `@affine/electron-api` 的 `apis`/`events` 调用主进程/helper 能力，用本地 sqlite + 磁盘同步替代 Web 版的 IndexedDB。它与 `@affine/web` 几乎同构，差异全在"换 Electron 变体 + 填桌面 provider + 多 HTML 入口"。

| 项        | 值                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/apps/electron-renderer`                                                                                                                                         |
| 所属层    | L5 · 多端外壳                                                                                                                                                                      |
| 语言/形态 | TypeScript / React 应用（`type: module`，经 `affine bundle` 产出多页静态资源，由 `@affine/electron` 加载）                                                                         |
| 关键依赖  | `@affine/core`（Electron 变体）、`@affine/electron-api`（IPC 桥）、`@toeverything/infra`、`@affine/nbstore`（sqlite/disk）、`@blocksuite/affine`、`react@19`、`react-router-dom@7` |
| 被谁依赖  | 无（终端渲染应用；产物由 `@affine/electron` 作为窗口页面加载）                                                                                                                     |
| 构建      | `affine bundle`（rspack，多 HTML 入口，见 `tools/cli/src/bundle.ts:135-161`）                                                                                                      |

## 1. 设计逻辑

**外壳薄、核心厚**在这里意味着：渲染层外壳只做"把 core 的 Electron 变体接上桌面宿主的手脚"。它与 `@affine/web` 对照着看最清楚——两者都 `new Framework()` → `configureCommonModules` → 填 `NbstoreProvider`/`PopupWindowProvider` → 渲染 `FrameworkRoot`，但在三处分叉：

1. **装 core 的 Electron 变体**：`setup.ts` 引 `@affine/core/bootstrap/electron`（而非 `browser`）；模块装配用 `configureDesktopWorkbenchModule`（而非 `Browser`）、`configureElectronStateStorageImpls`，并追加一批桌面专属模块：`desktop-api`、`app-tabs-header`、`find-in-page`、`spell-check`/`tray` 设置、`backup`。
2. **存储走原生**：不像 web 用 SharedWorker + IndexedDB，桌面端把 `apis.nbstore`/`apis.db` 绑到 `@affine/nbstore/sqlite`（原生 sqlite，实现在 `@affine/electron` 的 helper 进程），`setup.ts` 顶层就 `bindNativeDBApis(apis!.nbstore)`。
3. **平台 provider 走 IPC**：`PopupWindowProvider` 用 `apis.handler.ui.openExternal`、`ClientSchemeProvider` 用 `appInfo.scheme`、`ValidatorProvider`/`AuthProvider` 用 `apis.handler.auth.*`——全部经 `@affine/electron-api` 代理到主进程。

更关键的是它**不止一个页面**：一个 Electron 桌面有多种 webContents——主应用、外壳框架（标签栏+侧栏骨架）、系统弹窗、后台存储 worker。因此本包有**四个 HTML 入口**（`app`/`shell`/`popup`/`background-worker`），各自是独立的渲染上下文，各建各的 `Framework`。

## 2. 目录与关键文件

```text
packages/frontend/apps/electron-renderer/
├── package.json            # type: module；build=`affine bundle`
├── tsconfig.json           # references: core/component/electron-api/nbstore/blocksuite/infra…
└── src/
    ├── app/                # ★ 主应用页面（index 入口）
    │   ├── index.tsx       #   appConfigProxy.getSync() → mountApp(#app)
    │   ├── setup.ts        #   bootstrap/electron + 绑定原生 DB（apis.nbstore/apis.db）
    │   ├── app.tsx         #   setupEffects() + 分发守卫 + DesktopTheme/LanguageSync + WindowsAppControls
    │   ├── native-import.ts language-sync.ts theme-sync.ts
    │   └── effects/        #   setupModules（装配）/ store-manager / events / power / recording
    ├── shell/              # ★ 外壳框架页面（标签栏 + 侧栏骨架，无业务）
    │   ├── index.tsx app.tsx setup.ts
    ├── popup/              # ★ 系统弹窗页面（如录音悬浮窗）
    │   └── recording/
    ├── background-worker/  # ★ 后台存储 worker 页面（StoreManagerConsumer，桥接到 app）
    │   ├── index.ts disk-sync-bridge.ts
    └── global.d.ts
```

## 3. 实现细节

### 3.1 四个入口：rspack 的多 HTML 目标

构建分支里，`electron-renderer` 用一个 `createHTMLTargetConfig` 接收**对象形式的多入口**（`tools/cli/src/bundle.ts:135-161`）：

```ts
case '@affine/electron-renderer': {
  const workerConfigs = getBaseWorkerConfigs(pkg, createRspackWorkerTargetConfig,
    { includeMermaidAndTypst: false });          // 桌面端不内联 mermaid/typst worker
  return [
    createRspackHTMLTargetConfig(pkg, {
      index:            pkg.srcPath.join('app/index.tsx').value,
      shell:            pkg.srcPath.join('shell/index.tsx').value,
      popup:            pkg.srcPath.join('popup/index.tsx').value,
      backgroundWorker: pkg.srcPath.join('background-worker/index.ts').value,
    }, {
      additionalEntryForSelfhost: false,
      injectGlobalErrorHandler: false,           // 错误上报交给 Sentry main
      emitAssetsManifest: false,
    }, workerConfigs.map(c => c.name)),
    ...workerConfigs,
  ];
}
```

主进程按用途加载对应 HTML：主窗口/标签 view 加载 `index`，外壳框架加载 `shell`，录音悬浮窗加载 `popup`，而 `backgroundWorker` 是一个隐藏的 webContents，专门跑存储引擎。

### 3.2 启动序：先绑原生 DB，再装模块，再挂载

`app/setup.ts` 是桌面渲染层与 web 最本质的分叉点——它在模块顶层就把 `@affine/electron-api` 的 `apis` 绑进 nbstore 的原生 sqlite 适配器：

```ts
// 来源：src/app/setup.ts
import '@affine/core/bootstrap/electron'; // ← Electron 变体引导（非 browser）
import '@affine/core/bootstrap/cleanup';
import '@affine/component/theme';
import './global.css';
import './native-import';
import { apis } from '@affine/electron-api';
import { bindNativeDBApis } from '@affine/nbstore/sqlite';
import { bindNativeDBV1Apis } from '@affine/nbstore/sqlite/v1';

bindNativeDBApis(apis!.nbstore); // 把 IPC 句柄注入 nbstore 的 sqlite 后端
bindNativeDBV1Apis(apis!.db); // v1 迁移用的旧库
```

`apis!` 的非空断言在这里是安全的：桌面渲染页一定由 Electron 加载、preload 一定挂好了 `__apis`（Web 环境才会是 `undefined`，见 `affine-electron-api.md` 第 3.4 节）。`app/index.tsx` 随后先 `appConfigProxy.getSync()` 读持久化配置，再 `mountApp()`（`app/index.tsx:10-29`）。

### 3.3 装配：桌面档模块 + IPC provider

`app/effects/modules.ts` 的 `setupModules` 是桌面版的"装配中心"（对照 web 的 `app.tsx`）：

```ts
// 来源：src/app/effects/modules.ts:39-50
const framework = new Framework();
configureCommonModules(framework);
configureElectronStateStorageImpls(framework); // 状态落地走 Electron（config-storage handler）
configureBrowserWorkspaceFlavours(framework);
configureDesktopWorkbenchModule(framework); // ← 桌面版工作台（多标签，含 DesktopStateSynchronizer）
configureAppTabsHeaderModule(framework); // 标签栏
configureFindInPageModule(framework); // 页内查找（Electron findInPage）
configureDesktopApiModule(framework); // 封装 @affine/electron-api 为 DesktopApiService
configureSpellCheckSettingModule(framework);
configureTraySettingModule(framework);
configureDesktopBackupModule(framework);
```

`configureDesktopWorkbenchModule` 正是 `affine-core.md` 第 5 章展示的"同构分叉"：公共逻辑一份（`configureWorkbenchCommonModule`），桌面特化靠 `impl` 覆盖 `WorkbenchDefaultState`/`WorkbenchNewTabHandler` 并注册 `DesktopStateSynchronizer`（依赖 `DesktopApiService`）。

四个平台 provider 全部经 `DesktopApiService`（即 `@affine/electron-api` 的封装）走 IPC（`modules.ts:52-129`）：

```ts
framework.impl(PopupWindowProvider, p => {
  const apis = p.get(DesktopApiService).api;
  return {
    open: url => {
      apis.handler.ui.openExternal(url).catch(console.error);
    },
  };
});
framework.impl(ClientSchemeProvider, p => ({
  getClientScheme: () => p.get(DesktopApiService).appInfo?.scheme,
}));
framework.impl(ValidatorProvider, p => ({
  async validate(_c, resource) {
    return p
      .get(DesktopApiService)
      .api.handler.ui.getChallengeResponse(resource);
  },
}));
framework.scope(ServerScope).override(AuthProvider, p => {
  // ← 在 ServerScope 覆盖鉴权
  const apis = p.get(DesktopApiService).api;
  return {
    async signInMagicLink(email, token, nonce) {
      /* apis.handler.auth.signInMagicLink(...) */
    } /* oauth/password/signOut… */,
  };
});
```

`AuthProvider` 用 `.scope(ServerScope).override(...)`——因为桌面端的登录要走主进程的安全存储（加密 cookie/secret），而 `ServerScope` 对应"每台后端服务器一套鉴权"（见 `affine-core.md` 第 3.4 节）。`signInMagicLink` 等返回里若 `sessionOnly` 为真（加密存储不可用）还会 `notify.warning` 提示用户重启后需重新登录。

### 3.4 app.tsx：分发守卫与桌面同步组件

`app/app.tsx` 在顶层 `setupEffects()`（装模块 + 存储 + 事件 + 电源），再做一个**防跑错端**的守卫（`app.tsx:18-34`）：

```ts
const desktopWhiteList = [
  '/open-app/signin-redirect',
  '/share',
  '/oauth',
  '/magic-link' /* … */,
];
if (
  !BUILD_CONFIG.isElectron &&
  BUILD_CONFIG.debug &&
  desktopWhiteList.every(path => !location.pathname.startsWith(path))
) {
  document.body.innerHTML = `<h1 ...>Don't run electron entry in browser.</h1>`;
  throw new Error('Wrong distribution');
}
```

组件树与 web 同形（`FrameworkRoot > CacheProvider > I18nProvider > AffineContext > RouterProvider`），但多挂了桌面专属件：`DesktopThemeSync`/`DesktopLanguageSync`（把系统主题/语言同步进应用），以及 Windows 下右上角的 `WindowsAppControls`（自绘最小化/最大化/关闭，因为标题栏是 `hidden`）。`useIsOnBattery` 还会给 `body` 加 `on-battery` 类用于降耗渲染。

### 3.5 存储：渲染直连后台 worker 页面

桌面端的存储拓扑比 web 多一跳。`app/effects/store-manager.ts` 在主应用页里并不直接连 Worker，而是经主进程 `apis.worker.connectWorker` 把自己与 `background-worker` 页面用 `MessagePort` 对接起来（`store-manager.ts:9-43`）：

```ts
const { port1: portForOpClient, port2: portForWorker } = new MessageChannel();
window.addEventListener('message', ev => {
  if (ev.data.type === 'electron:worker-connect' && ev.data.portId === portId) {
    portFromWorker = ev.ports[0];
    // 把来自主进程的 port 与本地 portForWorker 双向转发
    portFromWorker.onmessage = e =>
      portForWorker.postMessage(e.data, [...e.ports]);
    portForWorker.onmessage = e =>
      portFromWorker.postMessage(e.data, [...e.ports]);
  }
});
apis!.worker.connectWorker('affine-shared-worker', portId); // ← 请主进程牵线
const storeManager = new StoreManagerClient(new OpClient(portForOpClient));
```

另一端 `background-worker/index.ts` 是一个独立页面，跑 `StoreManagerConsumer`，装的存储后端是**桌面专属组合**：sqlite（原生）、disk（磁盘同步）、broadcast-channel、cloud（`background-worker/index.ts:39-45`）。它顶层同样 `bindNativeDBApis`、`bindDiskSyncApis(createDiskSyncApis(apis!.diskSync, events!.diskSync))`，并 `configureSocketAuthMethod` 用 `apis.auth.getValidAccessToken` 为云同步取 token。于是：**UI 页面 ↔ background-worker 页面** 的存储 RPC 由主进程牵线建立 `MessagePort`，而真正的 sqlite 读写又经 `apis.nbstore` 下沉到 `@affine/electron` 的 helper 进程——两跳之后业务代码依然只见 `NbstoreProvider`。

### 3.6 shell 页面：零业务的框架骨架

`shell/app.tsx` 是"外壳的外壳"——它只渲染标签栏与侧栏骨架，不加载任何文档业务，所以只装极少模块、建自己的小 `Framework`（`shell/app.tsx:19-27`）：

```ts
const framework = new Framework();
configureStorageModule(framework);
configureElectronStateStorageImpls(framework);
configureAppTabsHeaderModule(framework);
configureAppSidebarModule(framework);
configureI18nModule(framework);
configureDesktopApiModule(framework);
configureAppThemeModule(framework);
// 渲染：<AppTabsHeader mode="shell" /> + <ShellAppSidebarFallback /> + （Windows）<WindowsAppControls/>
```

它是多标签窗口顶部那条"始终在场"的框架 UI，与各标签 view（`index` 页面）相互独立——这也解释了为何要把它拆成单独的 HTML 入口。

## 4. 语法特色

- **`apis!` 非空断言表达"桌面一定存在"**：`@affine/electron-api` 把 `apis` 类型声明成 `ClientHandler | undefined`（Web 下为 `undefined`），桌面渲染页用 `!` 断言消解，边界清晰——断言成立的前提是"这段代码只在 Electron 跑"。
- **工厂形态 `impl`**：`framework.impl(PopupWindowProvider, p => {...})` 用 `(provider) => impl` 工厂而非声明式数组，因为实现需要运行时 `p.get(DesktopApiService)` 取依赖并闭包捕获（对照 `affine-core.md` 第 4 章工厂形态注册）。
- **`.scope(ServerScope).override(...)`**：在特定作用域覆盖已注册接口，桌面端用它把 `AuthProvider` 换成走主进程安全存储的实现——作用域化 DI 的典型用法。
- **多入口对象 + 顶层单例容器**：每个 HTML 入口各自在模块顶层 `new Framework()`，页面即容器生命周期；`index` 页用 `setupModules` 的满配，`shell` 页用精简配置——同一套 DI 机制按页面职责裁剪。
- **`MessagePort` 双向转发桥**：`portFromWorker.onmessage → portForWorker.postMessage(e.data, [...e.ports])` 手工转发并透传 `ports`，把"主进程牵的线"接成一条直达通道——跨 webContents 通信的底层手法。
- **`BUILD_CONFIG.isElectron` 编译期常量守卫**：配合 rspack `define`，在错误分发（electron 包跑进浏览器）时立即报错并替换 DOM。

## 5. 设计 / 实现亮点

- **与 web 高度同构、差异收敛**：同样的 `new Framework()`→`configure*`→`impl`→`FrameworkRoot` 骨架，桌面差异只落在"换 Electron 变体模块 + 走 IPC 的 provider + 原生 sqlite"几处——印证 core 的 provider/作用域设计让换宿主成本极低。
- **四页分治**：主应用、外壳框架、系统弹窗、后台存储各自独立 HTML + 独立 `Framework`，职责清晰、互不拖累；外壳框架常驻、标签页可换，天然契合多标签桌面形态。
- **存储两跳透明化**：UI 页 ↔ background-worker 页（主进程牵线 MessagePort）↔ helper 进程 sqlite（IPC）。两跳转发全封装在 `store-manager`/`background-worker`，业务层仍只见 `NbstoreProvider`。
- **桌面原生体验的接入点**：主题/语言同步、页内查找、拼写检查、托盘设置、备份、`WindowsAppControls` 自绘窗控——这些"桌面才有"的能力通过追加模块干净地叠加，不污染公共逻辑。

## 6. 对外 API 与注意事项

- **无对外导出**：终端渲染应用，产物由 `@affine/electron` 作为窗口页面加载，不被 import。
- **四入口对应关系**：`app/index.tsx`(主) / `shell/index.tsx`(框架) / `popup/index.tsx`(弹窗) / `background-worker/index.ts`(存储)；改入口须同步 `bundle.ts` 的 `electron-renderer` 分支。
- **`apis`/`events` 判空豁免仅限桌面页**：本包代码默认运行在 Electron，故大量用 `apis!`；若有代码可能在非 Electron 环境执行（如共享到 web 的组件），不可照搬该断言。
- **引导顺序**：`app/setup.ts` 必须 `bootstrap/electron` 在前且先于 `bindNativeDBApis`——DB 绑定依赖 `apis` 已由 preload 注入。
- **存储连接依赖主进程**：`store-manager` 的 `MessagePort` 需 `apis.worker.connectWorker` 牵线，若主进程 `worker` handler 未就绪则连接失败——排查存储问题先看主进程 helper/worker 日志。

## 7. 延伸

- 宿主：`@affine/electron`（主进程/preload/helper，提供 `apis`/`events` 的运行时与窗口加载，见 `affine-electron.md`）。
- IPC 桥：`@affine/electron-api`（`apis`/`events`/`appInfo` 的类型与取全局，见 `affine-electron-api.md`）。
- 业务核心：`@affine/core`（Electron 变体：`bootstrap/electron`、`configureDesktopWorkbenchModule`、`DesktopApiService`，见 `affine-core.md`）。
- 同层对照：`affine-web.md`（Web 外壳，最适合逐段对读差异）。
- 存储：`@affine/nbstore`（`sqlite`/`disk` 后端与 `StoreManagerClient/Consumer`）。
