# `@affine/web`

> 一句话定位：AFFiNE 的 **Web/PWA 外壳入口**——一个"薄"到只有 4 个源文件的应用壳，负责创建 `Framework` 容器、装配 `@affine/core` 的公共模块、填入浏览器平台的 `NbstoreProvider`/`PopupWindowProvider` 实现、把 React 根挂到 `#app`，并提供运行在（Shared）Worker 里的 nbstore 存储消费者。几乎所有业务与 UI 都来自 `@affine/core`，本包只做"组装 + 平台适配 + 打包"。

| 项        | 值                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `packages/frontend/apps/web`                                                                                                                                                                                                               |
| 所属层    | L5 · 多端外壳                                                                                                                                                                                                                              |
| 语言/形态 | TypeScript / React 应用（最终打包入口，产出静态站点）                                                                                                                                                                                      |
| 关键依赖  | `@affine/core`（业务总成）、`@toeverything/infra`（`Framework`/`FrameworkRoot`）、`@affine/nbstore`（存储 Worker）、`@affine/env`（`getWorkerUrl`/`BUILD_CONFIG`）、`@affine/track`、`@affine/component`、`react@19`、`react-router-dom@7` |
| 被谁依赖  | 无（终端应用，经 `affine bundle` 产出部署到 Web 服务器）                                                                                                                                                                                   |
| 构建      | `affine bundle`（rspack，见 `tools/cli/src/bundle.ts`）                                                                                                                                                                                    |

## 1. 设计逻辑

**外壳薄、核心厚**是整个 L5 层的共同范式，`@affine/web` 是其中最纯粹的样本：它的 `src/` 只有 `index.tsx`、`app.tsx`、`setup.ts`、`nbstore.worker.ts` 四个文件，没有一行业务逻辑。它存在的唯一理由，是把一个"与平台无关的业务世界"（`@affine/core`）**落到浏览器这个具体宿主**上。

落地要做三件、也只做三件事：

1. **挑模块**：`@affine/core` 只提供 `configureXxxModule` 这类注册函数（见 `affine-core.md` 第 6 章"`core` 不自带 `new Framework()`"），由 app 决定装哪些。web 装的是"浏览器档"组合：`configureCommonModules` + `configureBrowserWorkbenchModule` + `configureBrowserWorkspaceFlavours` + `configureLocalStorageStateStorageImpls`。
2. **填平台 impl**：`core` 把一切与宿主强相关的能力留成 provider 接口，web 用浏览器 API 把它们补齐——`NbstoreProvider`（用 `SharedWorker`/`Worker` 跑存储引擎）、`PopupWindowProvider`（用 `window.open` 开窗，跨源时走 `/redirect-proxy`）。
3. **挂载与引导**：`index.tsx` 把 `<App />` 渲染进 `#app`；`setup.ts` 以 `import` 副作用方式触发 `@affine/core/bootstrap/browser` 的引导序列。

与同层其它外壳的边界也由此确定：web 用的是 core 的**浏览器变体**（`bootstrap/browser`、`desktop/router`、`BrowserWorkbench`），而 `electron-renderer` 用 Electron 变体、`mobile` 用 mobile 变体。三者的 `app.tsx` 高度雷同，差异只在"挑哪些模块、填哪些 impl、用哪套 router"。

## 2. 目录与关键文件

```text
packages/frontend/apps/web/
├── package.json            # "browser": "src/index.tsx"；scripts: build=`affine bundle`, dev=`affine bundle --dev`
├── tsconfig.json           # references: core/component/env/nbstore/track/infra（取类型，增量构建）
└── src/
    ├── index.tsx           # 应用入口：import './setup' → createRoot(#app).render(<StrictMode><Telemetry/><App/>)
    ├── app.tsx             # 装配中心：new Framework → configure* → impl(平台 provider) → provider() → <App/> 组件树
    ├── setup.ts            # 纯副作用引导：bootstrap/browser + bootstrap/cleanup + component/theme
    └── nbstore.worker.ts   # 存储 Worker 入口：StoreManagerConsumer 挂 idb/broadcast-channel/cloud 存储
```

本包**没有** `index.html`——HTML 由构建器 `tools/cli` 的 `createHTMLTargetConfig` 从模板 `tools/cli/src/rspack-shared/template.html` 生成（见第 3.4 节）。

## 3. 实现细节

### 3.1 入口：先副作用引导，再挂载

`index.tsx` 的第一行是 `import './setup'`——这是**顺序敏感**的：引导副作用必须在任何业务代码（包括 `App`）求值之前完成。

```tsx
// 来源：src/index.tsx:1-24
import './setup';
import { Telemetry } from '@affine/core/components/telemetry';
import { createRoot } from 'react-dom/client';
import { App } from './app';

function mountApp() {
  const root = document.getElementById('app')!;
  createRoot(root).render(
    <StrictMode>
      <Telemetry />
      <App />
    </StrictMode>
  );
}
try {
  mountApp();
} catch (err) {
  console.error('Failed to bootstrap app', err);
}
```

`setup.ts` 则把三条引导副作用串起来（`src/setup.ts`）：

```ts
import '@affine/core/bootstrap/browser'; // env→public-path→polyfill→telemetry（ORDER MATTERS，见 affine-core.md）
import '@affine/core/bootstrap/cleanup';
import '@affine/component/theme';
```

`bootstrap/browser` 的第一件事是注入 `BUILD_CONFIG`（由 `@affine/env` 提供），后续代码里对 `BUILD_CONFIG.*`、`environment.*` 的读取才成立。

### 3.2 装配中心：`app.tsx`

`app.tsx` 是 web 外壳的"全部重量"。它在模块顶层（即 import 时）就完成容器构建，把 `configureCommonModules` 产出的 70 个公共模块装进 `Framework`，再叠加浏览器特化模块：

```ts
// 来源：src/app.tsx:56-86
const framework = new Framework();
configureCommonModules(framework); // ← core 的公共业务模块
configureBrowserWorkbenchModule(framework); // ← 浏览器版多标签工作台
configureLocalStorageStateStorageImpls(framework); // ← 用 localStorage 落地全局状态
configureBrowserWorkspaceFlavours(framework); // ← 浏览器可用的工作区"口味"
framework.impl(NbstoreProvider, {/* 见 3.3 */});
framework.impl(PopupWindowProvider, {/* 见 3.3 */});
const frameworkProvider = framework.provider(); // ← 注册期结束，转入运行期
```

随后立刻用解析器驱动生命周期（`app.tsx:89-92`）：监听 `window` 的 `focus` 调 `LifecycleService.applicationFocus()`，并同步发出 `applicationStart()`。

`App` 组件只是一层层 Provider 的包裹（`app.tsx:94-108`）：

```tsx
<Suspense fallback={<AppContainer fallback />}>
  <FrameworkRoot framework={frameworkProvider}>
    {' '}
    {/* 把容器注入 React 树，useService 由此取值 */}
    <CacheProvider value={cache}>
      {' '}
      {/* emotion 样式缓存 */}
      <I18nProvider>
        <AffineContext store={getCurrentStore()}>
          <RouterProvider router={router} />{' '}
          {/* router 来自 @affine/core/desktop/router */}
        </AffineContext>
      </I18nProvider>
    </CacheProvider>
  </FrameworkRoot>
</Suspense>
```

注意 `router` 直接 `import` 自 `@affine/core/desktop/router`——**页面、路由、几乎所有视图都在 core 里**，web 只是把它接上 `RouterProvider`。

### 3.3 两个平台 provider：浏览器如何补齐宿主能力

**`NbstoreProvider`**（存储引擎宿主）是 web 外壳最有分量的一段。它优先用 `SharedWorker`（多标签页共享一套存储引擎），不可用时退回普通 `Worker`：

```ts
// 来源：src/app.tsx:28-66
const workerUrl = getWorkerUrl('nbstore'); // → `/js/nbstore-<appVersion>.worker.js`
if (
  window.SharedWorker &&
  localStorage.getItem('disableSharedWorker') !== 'true'
) {
  const worker = new SharedWorker(workerUrl, { name: 'affine-shared-worker' });
  storeManagerClient = new StoreManagerClient(new OpClient(worker.port));
} else {
  const worker = new Worker(workerUrl);
  storeManagerClient = new StoreManagerClient(new OpClient(worker));
}
// 把窗口焦点/点击/失焦映射为存储引擎的 resume/pause，节省后台资源
window.addEventListener('focus', () => storeManagerClient.resume());
window.addEventListener('blur', () => storeManagerClient.pause());
// ...
framework.impl(NbstoreProvider, {
  realtime: storeManagerClient.realtime,
  openStore(key, options) {
    return storeManagerClient.open(key, options);
  },
});
```

这里 `OpClient` 是 L1 infra 的跨线程 RPC（见 `toeverything-infra.md` 第 3.4 节 Op），`StoreManagerClient` 是 `@affine/nbstore` 的 Worker 客户端——业务代码调用存储，底层透明地跑在另一条线程里。

**`PopupWindowProvider`**（开窗）处理 OAuth 这类跨源跳转：同源直接 `window.open`，跨源则包进本站的 `/redirect-proxy`，避免 referrer 泄漏并统一回跳（`app.tsx:67-85`）：

```ts
framework.impl(PopupWindowProvider, {
  open: (target: string) => {
    const targetUrl = new URL(target);
    const url =
      targetUrl.origin === location.origin
        ? target
        : `${location.origin}/redirect-proxy?${new URLSearchParams({ redirect_uri: target })}`;
    window.open(url, '_blank', 'popup noreferrer noopener');
  },
});
```

### 3.4 构建：rspack 多目标，一个 HTML + 一组 Worker

`build` 脚本是 `affine bundle`，最终落到 `tools/cli/src/bundle.ts` 的 `getRspackBundleConfigs`。`@affine/web` 与 `@affine/mobile` 共用同一分支（`bundle.ts:88-110`）：

```ts
case '@affine/web':
case '@affine/mobile': {
  const workerConfigs = getBaseWorkerConfigs(pkg, createRspackWorkerTargetConfig);
  workerConfigs.push(
    createRspackWorkerTargetConfig(pkg, pkg.srcPath.join('nbstore.worker.ts').value)
  );
  return [
    createRspackHTMLTargetConfig(pkg, pkg.srcPath.join('index.tsx').value, {},
      workerConfigs.map(c => c.name)),
    ...workerConfigs,
  ];
}
```

于是 web 的产物是：**一个 HTML 目标**（入口 `index.tsx`，自动注入 `#app` 容器）+ **一组 Worker 目标**。Worker 们大多来自 core（`getBaseWorkerConfigs` 里的 `workspace-profile`、`pdf`、`turbo-painter`、`mermaid`、`typst` 等 `*.worker.ts`，`bundle.ts:42-74`），本包只额外贡献自己的 `nbstore.worker.ts`。Worker 的 URL 由 `getWorkerUrl` 以 `/js/<name>-<appVersion>.worker.js` 规则拼出（`packages/common/env/src/worker.ts`），注释特别说明 Worker **不能走 publicPath**，必须遵守同源策略。

### 3.5 存储 Worker 的另一端：`nbstore.worker.ts`

`app.tsx` 里是 `StoreManagerClient`（主线程客户端），`nbstore.worker.ts` 则是另一端的 `StoreManagerConsumer`（Worker 内服务端），装载浏览器可用的一组存储后端：

```ts
// 来源：src/nbstore.worker.ts
const consumer = new StoreManagerConsumer([
  ...idbStorages,
  ...idbV1Storages, // IndexedDB（含 v1 迁移）
  ...broadcastChannelStorages, // 跨标签页广播
  ...cloudStorages, // 云同步
]);
if ('onconnect' in globalThis) {
  // SharedWorker：每个标签页一个 port
  (globalThis as any).onconnect = (event: MessageEvent) => {
    consumer.bindConsumer(new OpConsumer<WorkerManagerOps>(event.ports[0]));
  };
} else {
  // 普通 Worker：直接以自身为通道
  consumer.bindConsumer(
    new OpConsumer<WorkerManagerOps>(globalThis as MessageCommunicapable)
  );
}
```

`onconnect` 分支是 `SharedWorker` 的标准握手：多个标签页各自 `connect`，Consumer 为每个 `port` 绑定一个 `OpConsumer`，共享同一套存储引擎——这正是 web 端"多开一个浏览器标签不会各自开一份数据库"的根因。它同样顶部 `import '@affine/core/bootstrap/browser'`，因为 Worker 环境里也需要 `BUILD_CONFIG`。

## 4. 语法特色

- **`import './setup'` 作为顺序化副作用**：ES 模块的"import 即执行一次"语义被当作引导钩子用——没有显式函数调用，纯靠 import 顺序保证 `BUILD_CONFIG` 在业务代码前就位。这是 L5 各外壳统一的引导手法。
- **模块顶层副作用建容器**：`app.tsx` 在模块求值阶段（而非某个 `init()` 里）就 `new Framework()`、`configure*`、`provider()`。因为整个应用只有一个容器、生命周期与页面同长，顶层单例最简单。
- **`!` 非空断言 + oxlint 注释**：`document.getElementById('app')!` 对一个"构建器保证存在"的 DOM 容器用非空断言，并以 `// oxlint-disable-next-line` 显式豁免 lint——边界处的务实取舍。
- **`SharedWorker ? : Worker` 的能力探测**：以 `window.SharedWorker` 是否存在来分支，用联合的方式兼容不支持 SharedWorker 的环境，`storeManagerClient` 的类型保持统一。
- **全局 `BUILD_CONFIG`/`environment`**：构建期由 rspack `define` 注入的全局常量（见 `@affine/env`），在 `.worker.ts` 与主线程里一致可用，属编译期常量折叠而非运行时查表。

## 5. 设计 / 实现亮点

- **极致的薄**：4 个文件、零业务逻辑，却是一个完整产品的 Web 版入口。它证明了 core 的"注册/解析分离 + provider 接口"设计是成立的——换一个宿主，只需换一组 `configure*` 与 `impl`。
- **SharedWorker 单例存储**：把 nbstore 引擎放进 `SharedWorker`，多标签页共享一套本地数据库与同步连接，天然避免重复连接/重复写入；并用 `focus/blur → resume/pause` 做后台降频。
- **跨源开窗的安全处理**：`PopupWindowProvider` 对跨源目标统一走 `/redirect-proxy` 并加 `noreferrer noopener`，把 OAuth 回跳的安全细节收敛在外壳一处。
- **构建配置复用**：web 与 mobile 共享 rspack 分支，Worker 清单大部分来自 core，外壳只贡献 `nbstore.worker.ts`——构建层面同样体现"薄外壳、厚核心"。

## 6. 对外 API 与注意事项

- **本包无对外导出**：它是终端应用，`package.json` 只声明 `"browser": "src/index.tsx"` 作为打包入口，不被任何包 `import`。
- **挂载点约定**：根 DOM 必须是 `id="app"`（由构建器模板保证）；`index.tsx` 对其用了非空断言，模板若改动需同步。
- **引导顺序不可乱**：`index.tsx` 必须 `import './setup'` 在最前；`setup.ts` 内 `bootstrap/browser` 必须先于 `bootstrap/cleanup` 与主题——顺序错会导致 `BUILD_CONFIG` 未注入而崩溃。
- **SharedWorker 开关**：`localStorage.disableSharedWorker === 'true'` 可强制退回普通 Worker，用于排查多标签页存储问题。
- **Worker 同源限制**：`getWorkerUrl` 刻意不加 publicPath——若把 Worker 部署到 CDN 跨源，会违反同源策略而失败。

## 7. 延伸

- 上游核心：`@affine/core`（业务总成，见 `affine-core.md`）——web 消费它的 `configureCommonModules`、`desktop/router`、各 provider 接口。
- 地基：`@toeverything/infra`（`Framework`/`FrameworkRoot`/`OpClient`，见 `toeverything-infra.md`）；`@affine/nbstore`（`StoreManagerClient`/`StoreManagerConsumer`）。
- 同层对照：`affine-electron-renderer.md`（桌面渲染层，换 Electron 变体与 sqlite 存储）、`affine-mobile.md`（移动 Web，换 mobile 变体）。
- 构建工具：`tools/cli`（`affine bundle` → rspack，`bundle.ts`/`rspack/index.ts`）。
