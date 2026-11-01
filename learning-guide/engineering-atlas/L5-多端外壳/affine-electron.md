# `@affine/electron`

> 一句话定位：AFFiNE 桌面版的 **Electron 主进程外壳**——它不渲染任何业务 UI（UI 全在 `@affine/electron-renderer` + `@affine/core`），而是提供桌面宿主的"操作系统侧能力"：进程模型（main 主进程 / preload 预加载 / helper 工具进程）、类型化 IPC 的 **handler 实现侧**（被 `@affine/electron-api` 代理调用）、多窗口与多标签管理、原生菜单/托盘/深链、Electron Forge 打包与自动更新。它是渲染层一切 `apis.xxx.yyy()` 调用的落地终点。

| 项        | 值                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/apps/electron`                                                                                                                                      |
| 所属层    | L5 · 多端外壳                                                                                                                                                          |
| 语言/形态 | TypeScript（Node/Electron 侧）；`main: ./dist/main.js`，经 esbuild 打成 main/preload/helper 三层                                                                       |
| 关键依赖  | `electron`、`electron-updater`、`async-call-rpc`（helper RPC）、`@affine/native`（napi→Rust）、`@affine/nbstore`、`@affine/i18n`、`zod`、`rxjs`、Electron Forge 全家桶 |
| 被谁依赖  | `@affine/electron-api`（**仅取类型**，见 `affine-electron-api.md`）；运行期加载 `@affine/electron-renderer` 的产物作为渲染页面                                         |
| 构建      | `build`=esbuild（`scripts/build-layers.ts`）；`package`/`make`=electron-forge（`forge.config.mjs`）                                                                    |

## 1. 设计逻辑

**外壳薄、核心厚**在桌面端有一个重要变形：薄的是"业务"，但"桌面宿主"本身并不薄——它必须认真处理 Electron 的**多进程模型**与**安全边界**。`@affine/electron` 承担的正是这块"宿主工程"，而把所有业务 UI 甩给渲染层（`electron-renderer` 装 `@affine/core` 的 Electron 变体）。

Electron 的进程模型决定了本包的三分结构：

1. **main（主进程）**：唯一能碰 Node/系统 API 的进程。负责应用生命周期（`app.whenReady`）、创建 `BrowserWindow`/`WebContentsView`、注册所有 IPC `handler`、菜单/托盘/深链/更新。一个应用一个 main。
2. **preload（预加载脚本）**：运行在渲染进程里、但先于网页脚本、且处于**隔离世界**。它是渲染层与系统之间唯一的受控通道——用 `contextBridge.exposeInMainWorld` 把 `__apis`/`__events` 挂到 `window`，渲染层（经 `@affine/electron-api`）再取用。
3. **helper（工具进程）**：用 `utilityProcess.fork` 开的独立 Node 进程，承载"重任务但不该阻塞主进程"的工作（本地数据库 nbstore、磁盘同步、工作区扫描、文件对话框/预览）。它与 main、与渲染层各自用 `MessagePort` + `async-call-rpc` 通信。

**为什么要 handler 侧独立于 electron-api**：`@affine/electron-api` 只是"类型镜像 + 取全局"，真正的 channel 字符串约定、`ipcMain.handle` 分发、安全校验、helper RPC 全在本包。两者通过 `exposed.ts`（main 侧）/ `exposed.ts`（helper 侧）导出的 `handlers`/`events` 对象形成**单一真相源**：渲染端的调用签名由它们的 `typeof` 反推，运行期的分发也由它们驱动（见 `affine-electron-api.md` 第 3 章）。

**为什么 contextIsolation 不可妥协**：渲染页面加载的是本地优先但仍是"网页"的内容，一旦 XSS 便可能触达系统。本包用 `sandbox:true` + `contextIsolation:true` + `nodeIntegration:false`（`web-preferences.ts`）把渲染进程关进沙箱，所有系统能力只能经 preload 暴露的、被 `checkSource` 校验来源的 IPC 通道通过——这是桌面安全的地基。

## 2. 目录与关键文件

```text
packages/frontend/apps/electron/
├── package.json            # main: ./dist/main.js；exports 暴露若干 ./main/* ./helper/* ./preload/* 供 electron-api 取类型
├── forge.config.mjs        # Electron Forge：makers（dmg/zip/squirrel/appimage/deb/flatpak）+ Fuses 安全加固 + 签名/公证
├── scripts/
│   ├── build-layers.ts     # esbuild 三入口构建 → dist/{main,preload,helper}.js
│   ├── common.ts           # esbuild 公共配置：entryPoints/external/define(BUILD_CONFIG)
│   ├── dev.ts make-*.ts sign-*.ts  # 开发热跑、squirrel/nsis 制包、macOS/Windows 签名
└── src/
    ├── main/               # ★ 主进程
    │   ├── index.ts        #   引导：app 开关、单实例锁、whenReady 链、Sentry、privileged scheme
    │   ├── handlers.ts     #   allHandlers 聚合 + registerHandlers（ipcMain.handle 分发）
    │   ├── exposed.ts      #   export {handlers, events} + getExposedMeta()（单一真相源）
    │   ├── events.ts       #   主进程 → 渲染层的事件（订阅/广播）
    │   ├── helper-process.ts  # HelperProcessManager：fork helper、桥接 renderer↔helper、main↔helper RPC
    │   ├── web-preferences.ts # 安全默认：sandbox/contextIsolation/nodeIntegration
    │   ├── security-restrictions.ts # checkSource、will-navigate/openWindow 拦截
    │   ├── windows-manager/   # 主窗口、标签视图(WebContentsView)、弹窗、启动器、onboarding
    │   ├── updater/           # electron-updater 封装 + AFFiNE 自定义 feed + Windows 特化
    │   ├── <能力域>/          # auth clipboard config-storage find-in-page import recording ui worker …
    ├── preload/            # ★ 预加载
    │   ├── bootstrap.ts    #   contextBridge.exposeInMainWorld('__apis'/'__events'/…)
    │   ├── electron-api.ts #   getMainAPIs / getHelperAPIs：把 meta 还原成可调用句柄
    │   └── shared-storage.ts worker.ts
    ├── helper/             # ★ 工具进程
    │   ├── index.ts        #   setupRendererConnection（AsyncCall over MessagePort）
    │   ├── exposed.ts      #   helper 的 handlers(db/nbstore/diskSync/workspace/dialog/preview)/events
    │   └── nbstore/ workspace/ disk-sync/ dialog/ preview/
    └── shared/             # 三进程共享：type.ts(channel 常量/RPC 接口)、internal-origin.ts、import.ts、utils.ts
```

## 3. 实现细节

### 3.1 三层打包：一份源码，三个进程产物

本包不走 rspack，而用 esbuild 把**三个入口**打成三层（`scripts/common.ts:79-91`）：

```ts
return {
  entryPoints: [
    resolve(electronDir, './src/main/index.ts'),
    resolve(electronDir, './src/preload/index.ts'),
    resolve(electronDir, './src/helper/index.ts'),
  ],
  entryNames: '[dir]', // → dist/main.js dist/preload.js dist/helper.js
  outdir: resolve(electronDir, './dist'),
  bundle: true,
  target: `node22`,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'electron-updater', 'yjs', 'semver'], // 运行时由 Electron/依赖提供
  loader: { '.node': 'copy' }, // 原生 .node 直接拷贝（@affine/native）
  define: {/* BUILD_CONFIG.* 常量折叠，见下 */},
};
```

三个产物各自进入 Electron 的不同进程：`main.js` 由 Electron 主进程加载（`package.json` 的 `main`），`preload.js` 在创建窗口时经 `webPreferences.preload` 注入渲染进程，`helper.js` 由 main 用 `utilityProcess.fork` 拉起。`define` 里把 `BUILD_CONFIG.*` 全部在编译期折叠成常量（`common.ts:26-38`），`external` 刻意不打包 `electron`/`yjs` 等。`build-layers.ts` 还有一道 `assertNoRuntimeWorkspaceDependencies` 守卫——**所有 workspace 依赖必须是 devDependency 并被 bundle 进去**，禁止运行时残留 `workspace:*`，否则打包后找不到。

### 3.2 main：引导序列与应用生命周期

`main/index.ts` 是主进程的"开机脚本"。关键几步（`main/index.ts`）：

```ts
app.enableSandbox(); // 全局启用渲染进程沙箱
// 关 Chromium autofill、关原生窗口遮挡计算等一堆 feature flag（index.ts:35-61）
app.commandLine.appendSwitch('disable-features', disabledFeatures);

const isSingleInstance = app.requestSingleInstanceLock(); // 单实例：第二次启动交给首实例处理深链
if (!isSingleInstance) {
  app.quit();
  process.exit(0);
}

app.on('window-all-closed', () => app.quit());
setupDeepLink(app); // affine:// 协议
registerSecurityRestrictions(); // 导航/开窗拦截（见 3.6）

app
  .whenReady()
  .then(registerProtocol) // 注册 assets:// 等自定义协议
  .then(registerHandlers) // ← 注册所有 IPC handler（见 3.3）
  .then(registerEvents) // ← 注册主进程 → 渲染事件
  .then(launch) // ← 创建并显示主窗口（见 3.5）
  .then(createApplicationMenu)
  .then(registerUpdater) // ← 自动更新（见 3.7）
  .then(setupRecordingFeature)
  .then(setupTrayState);
```

末尾还有 `protocol.registerSchemesAsPrivileged([{ scheme: 'assets', privileges: { secure, corsEnabled, supportFetchAPI, standard, stream }}])`——把 `assets://` 声明为特权协议，让渲染层能安全地 `fetch` 本地资源。

### 3.3 IPC handler 侧：单一真相源 + 一个通道分发

渲染层所有 `apis.ns.method(...)` 的终点是 `main/handlers.ts`。它先把各能力域的 handler 聚成一个 `allHandlers`（`handlers.ts:36-51`）：

```ts
export const allHandlers = {
  debug, ui, clipboard, updater, configStorage, findInPage,
  import, sharedStorage, worker, recording, popup, i18n, byokStorage, auth,
};  // 每个是 { 方法名: (event, ...args) => Promise<R> }
```

`exposed.ts` 把它与 `events` 一起导出，并提供 `getExposedMeta()` 把结构拍平成 `[namespace, 方法名[]]`（`main/exposed.ts:9-26`）——**这份 meta 既喂给 preload 在运行期生成句柄，又被 `@affine/electron-api` 用 `typeof` 反推类型**，是渲染↔主进程契约的单一真相源。

`registerHandlers` 只在**一个** channel 上收所有调用，按 `namespace:key` 分发（`handlers.ts:53-104`）：

```ts
const handleIpcMessage = async (e, ...args) => {
  if (!checkSource(e) || typeof args[0] !== 'string') return; // ① 安全校验来源
  const [namespace, key] = (args[0] as string).split(':'); // ② args[0] 是 "ns:method"
  const handler = allHandlers[namespace]?.[key]; // ③ 查表
  if (!handler) {
    logger.error('handler not found', args[0]);
    return;
  }
  return await handler(e, ...args.slice(1)); // ④ 调用，首参 event 由此注入
};
ipcMain.handle(AFFINE_API_CHANNEL_NAME, async (e, ...args) => {
  /* try/catch 包裹 */
});
ipcMain.on(AFFINE_API_CHANNEL_NAME, (e, ...args) => {
  /* 同步版本，写 e.returnValue */
});
```

两个要点呼应 `affine-electron-api.md` 第 3.2 节的类型变换：① handler 第一参恒为 `Electron.IpcMainInvokeEvent`，而渲染端调用**不传** event——所以类型桥用 `infer` 去掉首参；② 全走 `ipcRenderer.invoke` 返回 Promise——所以类型桥把返回值统一包 `Promise`。`AFFINE_API_CHANNEL_NAME = 'affine-ipc-api'`（`shared/type.ts:31`）是唯一的物理通道，`namespace:method` 只是通道内的逻辑路由。

### 3.4 preload：把 meta 还原成可调用句柄

preload 跑在渲染进程的隔离世界，先于网页脚本执行。`preload/bootstrap.ts` 只在**内部 URL**（自家页面）上挂全局，拒绝给外部内容暴露能力：

```ts
// 来源：src/preload/bootstrap.ts
if (currentUrl && isInternalUrl(currentUrl)) {
  contextBridge.exposeInMainWorld('__appInfo', appInfo);
  contextBridge.exposeInMainWorld('__apis', apis);
  contextBridge.exposeInMainWorld('__events', events);
  contextBridge.exposeInMainWorld('__sharedStorage', sharedStorage);
  listenWorkerApis();
}
```

`apis` 由 `getMainAPIs()` 动态生成（`preload/electron-api.ts:52-83`）：它读进程参数 `--main-exposed-meta=<JSON>`（即 main 的 `getExposedMeta()`），对每个 `namespace:method` 包一个走 `ipcRenderer.invoke` 的函数：

```ts
(...args) =>
  ipcRenderer.invoke(AFFINE_API_CHANNEL_NAME, `${namespace}:${name}`, ...args);
```

`events` 则维护 `listenersMap` + `subscribeCounts` 做**引用计数订阅**（`electron-api.ts:86-165`）：同一 channel 多处订阅只向主进程 `send(subscribe)` 一次，最后一个退订才 `unsubscribe`——避免重复订阅与泄漏。helper 的 handler 则经 `getHelperAPIs()` 用 `async-call-rpc` 走 `MessagePort`（见 3.8），最终 `apis = { ...mainAPIs.apis, ...helperAPIs.apis, import: {...} }` 合并成统一门面。`import.createImportSessionFromSource` 是 preload 专属：它用 `webUtils.getPathForFile` 把浏览器 `File` 解析成真实磁盘路径再转调主进程（`electron-api.ts:309-337`）——这步只能在 preload 做，因为只有它能同时见到 `File` 对象与 `webUtils`。

### 3.5 窗口管理：主窗口与多标签 WebContentsView

`windows-manager/main-window.ts` 的 `MainWindowManager` 是单例，用 `electron-window-state` 记忆窗口位置，按平台设置标题栏样式，并在创建时拉起 helper：

```ts
// 来源：src/main/windows-manager/main-window.ts:180-202
const browserWindow = new BrowserWindow({
  titleBarStyle: isMacOS() ? 'hiddenInset' : isWindows() ? 'hidden' : 'default',
  minWidth: 640,
  minHeight: 480,
  vibrancy: 'under-window',
  show: false, // 用 'ready-to-show' 再显示，避免闪白
  webPreferences: buildWebPreferences({ webgl: true }), // ← 安全默认 + webgl
});
const helper = await ensureHelperProcess();
helper.connectMain(browserWindow); // 建立 main↔helper RPC（dialog 需要父窗口）
```

真正的"多标签"不是多 `BrowserWindow`，而是一个窗口内挂多个 `WebContentsView`（`windows-manager/tab-views.ts`）。每个 view 加载渲染页面时，通过 `additionalArguments` 把两份 meta 和窗口名传进 preload（`tab-views.ts:45-55`）：

```ts
return [
  `--main-exposed-meta=` + JSON.stringify(mainExposedMeta), // main handler 清单
  `--helper-exposed-meta=` + JSON.stringify(helperExposedMeta), // helper handler 清单（经 rpc.getMeta()）
  `--window-name=main`,
];
```

这解释了 preload 为何能"无中生有"地构造 `apis`——它要的全部信息（有哪些 namespace、哪些方法）都由主进程在启动 view 时以命令行参数注入。`main-window.ts` 还封装了 macOS 的 dock 显隐、"关闭到托盘"、全屏切换时的主题刷新 workaround 等桌面细节。

### 3.6 安全边界：沙箱 + 来源校验 + 导航拦截

安全默认集中在 `web-preferences.ts`，一处定义、处处复用：

```ts
// 来源：src/main/web-preferences.ts
const DEFAULT_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
};
export function buildWebPreferences(overrides = {}) {
  return { ...DEFAULT_WEB_PREFERENCES, ...overrides };
}
```

`security-restrictions.ts` 则守住两个攻击面（对照 Electron 官方安全清单 13/14/15 条）：`will-navigate` 拦截任何非内部 URL 的导航并转交系统浏览器；`setWindowOpenHandler` 一律 `deny`，外链用 `openExternalSafely` 打开，`/redirect-proxy` 还要过 `validateRedirectProxyUrl`。而 IPC 侧的 `checkSource(e)` 用 `isInternalUrl(senderFrame.url)` 校验每一条消息的来源帧（`security-restrictions.ts:10-21`），`registerHandlers` 在分发前必调它——即便 preload 被绕过，非内部页面也无法触发 handler。

### 3.7 自动更新：electron-updater + 自定义 feed

`updater/electron-updater.ts` 封装 `electron-updater`，Windows 用特化的 `WindowsUpdater`，feed 用自研的 `AFFiNEUpdateProvider`：

```ts
// 来源：src/main/updater/electron-updater.ts:16-17, 83-100
export const autoUpdater =
  process.platform === 'win32' ? new WindowsUpdater() : defaultAutoUpdater;
// registerUpdater():
autoUpdater.autoDownload = false; // 先探测，是否下载看 config
autoUpdater.allowPrerelease = buildType !== 'stable';
autoUpdater.setFeedURL(AFFiNEUpdateProvider.configFeed({ channel: buildType }));
autoUpdater.on('update-available', info => {
  if (config.autoDownloadUpdate) downloadUpdate(); /* 发事件给 UI */
});
autoUpdater.on('download-progress', e =>
  updaterSubjects.downloadProgress$.next(e.percent)
);
autoUpdater.on('update-downloaded', e =>
  updaterSubjects.updateReady$.next({ version: e.version, allowAutoUpdate })
);
```

`internal` 档与 dev 模式禁用更新（`disabled = buildType === 'internal' || isDev`）。进度/可用/就绪都经 `updaterSubjects`（RxJS `Subject`）广播，再由 `updater/handlers.ts` 暴露 `checkForUpdates`/`downloadUpdate`/`quitAndInstall`/`getConfig`/`setConfig` 给渲染层——又一次 handler 侧实现。窗口获得焦点时节流（30 分钟）地自动检查（`electron-updater.ts:142-155`）。

### 3.8 helper 工具进程：两条 RPC 链

helper 被 `HelperProcessManager`（单例）用 `utilityProcess.fork` 拉起（`main/helper-process.ts:57-62`，`serviceName: 'affine-helper'`），它同时维护两条独立的通信链：

- **main ↔ helper**：`connectMain` 用 `MessageEventChannel` + `AsyncCall` 把主进程的 `dialog.showOpenDialog`/`shell.openExternal`/`app.getPath` 等暴露给 helper（`helper-process.ts:110-140`，类型见 `shared/type.ts` 的 `MainToHelper`）——因为 helper 要弹文件对话框却需要父窗口，只能回调主进程。
- **renderer ↔ helper**：`connectRenderer` 用 `MessageChannelMain` 开一对 `port`，一端 `postMessage({channel:'renderer-connect'})` 给 helper，另一端 `postMessage('helper-connection')` 给渲染进程（`helper-process.ts:92-106`）。渲染侧 preload 收到 `helper-connection` 拿到 port，用 `async-call-rpc` 直连 helper（`preload/electron-api.ts:170-277`）——于是 nbstore 这类重 IO **不经主进程中转**，渲染直接与 helper 对话，主进程不被阻塞。

helper 自身的 `index.ts` 把 `exposed.ts` 的 handlers 拍平成 `namespace:name` 注册进 `AsyncCall`，并把 events 经 `rpc.postEvent` 推给渲染层（`helper/index.ts:7-73`）。`helper/exposed.ts` 的能力域是 `db`/`nbstore`/`diskSync`/`workspace`/`dialog`/`preview`——全是"重且独立"的任务。

## 4. 语法特色

- **进程隔离靠 `contextBridge` 而非挂 `window`**：`contextBridge.exposeInMainWorld('__apis', apis)` 把对象跨越"隔离世界"边界只读暴露，渲染页面拿到的是结构化克隆的代理，无法反向访问 preload 的闭包——这是 `contextIsolation:true` 下唯一合法的暴露方式。
- **命令行参数做进程间元数据传递**：`--main-exposed-meta=<JSON>` / `--helper-exposed-meta=<JSON>` 把 handler 清单从 main 传进 preload（`process.argv.find(...).split('=')[1]`），因为 preload 启动时无法 import 主进程模块，只能靠启动参数。
- **`async-call-rpc` over `MessagePort`**：`AsyncCall<HelperToMain>(server, { channel })` 把一个对象的方法变成可远程 `await` 的调用，通道用 `MessageChannelMain`/`MessagePort` 的 `postMessage`——纯消息通道上长出类型化 RPC。
- **`satisfies NamespaceHandlers`**：如 `updaterHandlers satisfies NamespaceHandlers`（`updater/index.ts:43`）在不拓宽字面量类型的前提下约束结构，既保留精确签名供 `typeof` 反推，又在编译期校验 handler 形状。
- **`#private` 字段 + 静态单例**：`HelperProcessManager` 用 `readonly #process` 真私有字段与 `static get instance`，`MainWindowManager.instance` 同理——主进程里这些宿主资源天然单例。
- **esbuild `define` 常量折叠 + `external`**：`BUILD_CONFIG.*` 在编译期替换为字面量（死代码消除按档位裁剪），`electron`/`yjs` 标 external 由运行时提供——Node 产物的标准做法。
- **`zod` 运行时解析配置/状态**：窗口状态、托盘设置等从磁盘读回后用 `MenubarStateSchema.parse(...)`/`tabViewsMetaSchema.parse(...)`（`main-window.ts`/`tab-views.ts`）兜底，弥补持久化数据的类型擦除。

## 5. 设计 / 实现亮点

- **单一真相源驱动的类型化 IPC**：`exposed.ts` 的 `handlers` 对象同时是①运行期分发表、②preload 句柄的 meta 来源、③`@affine/electron-api` 的类型母版。改一个 handler 签名，渲染层编译即报错——彻底消除 channel 字符串/参数错配（与 `affine-electron-api.md` 互为表里）。
- **三进程、两 RPC 的清晰分工**：重 IO（nbstore/磁盘/工作区）放 helper 且**渲染直连 helper**不经主进程；系统 UI（对话框/外链）helper 回调 main；业务调用走 main handler。每条链各担其责，主进程不被重任务拖垮。
- **安全纵深**：`sandbox + contextIsolation + nodeIntegration:false`（渲染沙箱）→ preload 只在内部 URL 暴露 → `checkSource` 逐条校验来源 → 导航/开窗一律拦截 → Forge `Fuses` 关掉 `RunAsNode`/强制 `OnlyLoadAppFromAsar` + ASAR 完整性校验。五层叠加，任何单点被绕过都不致失守。
- **窗口即标签**：用单窗口 + 多 `WebContentsView` 实现浏览器式多标签，配合把 meta 经命令行注入各 view 的 preload，复用同一套 IPC 基建。
- **打包守卫**：`assertNoRuntimeWorkspaceDependencies` 在构建期就拦住"运行时 workspace 依赖"这一类分发事故，比运行时崩溃早得多。

## 6. 对外 API 与注意事项

- **对外导出仅供 electron-api 取类型**：`package.json` 的 `exports` 开放 `./main/exposed`、`./helper/exposed`、`./preload/electron-api`、`./preload/shared-storage`、`./shared/import`、`./main/windows-manager` 等——它们被 `@affine/electron-api` 以 `import type` 借用（见 `affine-electron-api.md`），**不应被当运行时库 import**。
- **channel 常量**：`AFFINE_API_CHANNEL_NAME`/`AFFINE_EVENT_CHANNEL_NAME`/`AFFINE_EVENT_SUBSCRIBE_CHANNEL_NAME`（`shared/type.ts`）是三进程共识，改动需三侧同步。
- **新增 handler 的套路**：在某能力域写 `handlers.ts` → 汇入 `main/handlers.ts` 的 `allHandlers`（或 helper 的 `exposed.ts`）→ 渲染层经 `@affine/electron-api` 的 `apis.ns.method` 自动获得类型，无需改 electron-api 运行时。
- **handler 首参恒为 event**：主进程 handler 签名第一参必须是 `IpcMainInvokeEvent`（即便不用），否则类型桥的 `infer` 去参会错位。
- **构建两条线**：`build`（esbuild 出 dist 三层）与 `make`/`package`（Forge 出安装包）是不同阶段；`forge.config.mjs` 的 `ignore`/`Fuses`/签名仅在制包阶段生效。
- **dev 注意**：dev 模式与 `internal` 档禁用自动更新；`host-resolver-rules` 把 `0.0.0.0` 映射到 `127.0.0.1` 以让 dev server 可达（`main/index.ts:27-32`）。

## 7. 延伸

- 类型桥：`@affine/electron-api`（渲染端的类型镜像与取全局，见 `affine-electron-api.md`）——与本包的 `exposed.ts` 互为表里。
- 渲染层：`@affine/electron-renderer`（装 core 的 Electron 变体、消费 `apis`/`events`，见 `affine-electron-renderer.md`）。
- 业务核心：`@affine/core`（Electron 变体的 `bootstrap/electron`、`desktop/router`、`configureDesktopWorkbenchModule`，见 `affine-core.md`）。
- 原生能力：`@affine/native`（主进程/helper 经 napi 调 Rust，`.node` 由 esbuild `copy`）。
- 存储：`@affine/nbstore`（helper 的 `nbstore`/`disk` handler 承载本地 sqlite 与磁盘同步）。
- 对应教程：learning-guide 桌面端章节（Electron 进程模型、IPC 契约与安全边界）。
