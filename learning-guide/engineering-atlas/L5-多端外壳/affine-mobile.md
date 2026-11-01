# `@affine/mobile`

> 一句话定位：AFFiNE 的 **移动端 Web 外壳入口**——与 `@affine/web` 同形的"薄壳"，但装配 `@affine/core` 的 **mobile 变体**（移动版路由、移动专属模块），并用 Web API 填入移动特有的 `HapticProvider`（振动）与 `VirtualKeyboardProvider`（软键盘高度）。它既是移动浏览器/PWA 的入口，也是 Capacitor 原生壳（`@affine/ios`/`@affine/android`）复用的同一套移动 Web 基座。

| 项        | 值                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/apps/mobile`                                                                                                                                  |
| 所属层    | L5 · 多端外壳                                                                                                                                                    |
| 语言/形态 | TypeScript / React 应用（`"browser": "src/index.tsx"`，经 `affine bundle` 产出移动 Web 静态站点）                                                                |
| 关键依赖  | `@affine/core`（mobile 变体）、`@toeverything/infra`、`@affine/nbstore`、`@affine/env`（`getWorkerUrl`）、`@blocksuite/affine`、`react@19`、`react-router-dom@7` |
| 被谁依赖  | 无（终端应用）；Capacitor 壳 `@affine/ios`/`@affine/android` 复用其 core mobile 变体与 provider 范式                                                             |
| 构建      | `affine bundle`（rspack，与 `@affine/web` 共用分支，见 `tools/cli/src/bundle.ts:88-110`）                                                                        |

## 1. 设计逻辑

**外壳薄、核心厚**在移动端的体现，是与 `@affine/web` 逐行对读后的"同骨不同皮"：同样的 4 文件结构（`index.tsx`/`app.tsx`/`setup.ts`/`nbstore.worker.ts`）、同样的 `new Framework()`→`configureCommonModules`→填 `NbstoreProvider`/`PopupWindowProvider`→`FrameworkRoot` 骨架。移动端只在三处分叉：

1. **装 core 的 mobile 变体**：`app.tsx` 追加 `configureMobileModules`，router 用 `@affine/core/mobile/router`，fallback 用 `@affine/core/mobile/components/app-fallback`；`setup.ts` 额外引 `@affine/core/mobile/styles/mobile.css`。移动端的页面、导航、交互全在 core 的 `src/mobile/` 里（见 `affine-core.md` 第 2 章的 `mobile/` 目录），外壳只负责接上。
2. **填移动特有 provider**：`HapticProvider`（触觉反馈）与 `VirtualKeyboardProvider`（虚拟键盘）是桌面/Web 不需要、而移动端刚需的两个宿主接口。本包用纯 Web API（`navigator.vibrate`、`visualViewport`）提供**可降级的默认实现**。
3. **其余与 web 一致**：存储仍走 SharedWorker/Worker + nbstore（IndexedDB/cloud），开窗仍走 `window.open` + `/redirect-proxy`，引导仍是 `bootstrap/browser`——因为移动 Web 本质还是浏览器环境。

**与 Capacitor 壳的分工**：`@affine/mobile` 是移动 **Web** 基座，它给出的 `HapticProvider`/`VirtualKeyboardProvider` 是 Web API 版实现（浏览器里能用、原生里是降级）。真正的原生 App 是同层的 `@affine/ios`/`@affine/android`——它们有各自的 `capacitor.config.ts`（`webDir: 'dist'`）与入口，复用 core 的同一套 mobile 变体，但把这些 provider **替换为 Capacitor 原生插件**（原生振动、原生键盘事件）。因此本包既能独立作为移动浏览器/PWA 跑，也是原生壳的参照与基座。

## 2. 目录与关键文件

```text
packages/frontend/apps/mobile/
├── package.json            # "browser": "src/index.tsx"；build=`affine bundle`
├── tsconfig.json           # references: core/component/env/nbstore/blocksuite/infra
└── src/
    ├── index.tsx           # 入口：import './setup' → createRoot(#app).render(<StrictMode><Telemetry/><App/>)
    ├── app.tsx             # 装配：Framework → configureCommonModules + configureMobileModules → impl(4 provider) → <App/>
    ├── setup.ts            # 引导：bootstrap/browser + cleanup + component/theme + mobile.css
    └── nbstore.worker.ts   # 存储 Worker（与 web 同构）
```

## 3. 实现细节

### 3.1 入口与引导：与 web 同形

`index.tsx` 与 web 逐行一致（`src/index.tsx`）：`import './setup'` 触发引导副作用，再 `createRoot(document.getElementById('app')!).render(<StrictMode><Telemetry /><App /></StrictMode>)`。`setup.ts` 则比 web 多一行移动样式（`src/setup.ts`）：

```ts
import '@affine/core/bootstrap/browser'; // 移动 Web 仍是浏览器环境，用 browser 档引导
import '@affine/core/bootstrap/cleanup';
import '@affine/component/theme';
import '@affine/core/mobile/styles/mobile.css'; // ← 移动专属样式
```

### 3.2 装配：公共模块 + mobile 模块

`app.tsx` 的装配比 web 多一行 `configureMobileModules`（`app.tsx:40-45`）：

```ts
const framework = new Framework();
configureCommonModules(framework);
configureBrowserWorkbenchModule(framework); // 移动端也用 Browser 版工作台
configureLocalStorageStateStorageImpls(framework);
configureBrowserWorkspaceFlavours(framework);
configureMobileModules(framework); // ← 移动专属模块（haptics/virtual-keyboard 等的 service 侧）
```

存储 provider 与 web 几乎一致——同样 `getWorkerUrl('nbstore')` + `SharedWorker ? : Worker` + `StoreManagerClient`（`app.tsx:27-57`），只是移动端省去了 web 的 `focus/blur → resume/pause` 细节（移动端生命周期由 `visibilitychange`/原生壳管理）。`PopupWindowProvider` 与 web 的跨源 `/redirect-proxy` 逻辑完全相同（`app.tsx:58-76`）。

### 3.3 `HapticProvider`：触觉反馈的 Web 降级实现

移动端点按需要触觉反馈，本包用 `navigator.vibrate` 给出 Web 版实现（`app.tsx:77-98`）：

```ts
framework.impl(HapticProvider, {
  impact: options =>
    new Promise(resolve => {
      const style = options?.style ?? 'LIGHT';
      const pattern = { LIGHT: [10], MEDIUM: [20], HEAVY: [30] }[style];
      const result = navigator.vibrate?.(pattern); // ← Web Vibration API
      if (!result)
        console.warn('vibrate not supported, or user not interacted');
      resolve();
    }),
  notification: () => Promise.reject('Not supported'), // Web 无法区分通知型触觉
  vibrate: () => Promise.reject('Not supported'),
  selectionStart: () => Promise.reject('Not supported'), // 选择类触觉 Web 不支持
  selectionChanged: () => Promise.reject('Not supported'),
  selectionEnd: () => Promise.reject('Not supported'),
});
```

只有 `impact`（轻/中/重三档映射到振动时长）能在 Web 落地，其余 `notification`/`selection*` 直接 `reject('Not supported')`——这是刻意的"诚实降级"：接口形状齐全（满足 core 的 `HapticProvider` 契约），但 Web 做不到的明确拒绝，留给 Capacitor 原生壳去 `override` 成真正的原生触觉。

### 3.4 `VirtualKeyboardProvider`：用 `visualViewport` 算键盘高度

移动端软键盘弹出会遮挡输入框，core 需要知道"键盘占了多高"来调整布局。Web 没有直接的键盘 API，本包用 `visualViewport` 的尺寸差推算（`app.tsx:99-136`）：

```ts
framework.impl(VirtualKeyboardProvider, {
  onChange: callback => {
    if (!visualViewport) {
      console.warn('visualViewport is not supported');
      return () => {};
    }
    const listener = () => {
      if (!visualViewport) return;
      const windowHeight = window.innerHeight;
      callback({
        visible: window.innerHeight - visualViewport.height > 0, // 可视视口变矮 ⇒ 键盘弹出
        height: windowHeight - visualViewport.height - visualViewport.offsetTop, // 键盘在布局视口中的高度
      });
    };
    visualViewport.addEventListener('resize', listener);
    visualViewport.addEventListener('scroll', listener);
    return () => {
      visualViewport?.removeEventListener('resize', listener);
      visualViewport?.removeEventListener('scroll', listener);
    };
  },
});
```

源码里还画了一张 ASCII 图说明 `window / visualViewport / keyboard` 三者的几何关系（`app.tsx:110-122`）——键盘高度 = 窗口高 − 可视视口高 − 可视视口上偏移。返回一个退订函数，符合 core 对 provider "订阅即清理"的约定。

### 3.5 组件树与存储 Worker

`App` 组件比 web 略简（无 `CacheProvider`，fallback 换成移动版，`app.tsx:145-157`）：

```tsx
<Suspense fallback={<AppFallback />}>
  {' '}
  {/* 移动版骨架屏 */}
  <FrameworkRoot framework={frameworkProvider}>
    <I18nProvider>
      <AffineContext store={getCurrentStore()}>
        <RouterProvider router={router} />{' '}
        {/* router 来自 @affine/core/mobile/router */}
      </AffineContext>
    </I18nProvider>
  </FrameworkRoot>
</Suspense>
```

`nbstore.worker.ts` 与 web 同构（装 idb/broadcast-channel/cloud 存储的 `StoreManagerConsumer`），rspack 构建也与 web 共用 `case '@affine/web': case '@affine/mobile':` 分支（`bundle.ts:88`），同样产出"一个 HTML + 一组 Worker（含自家 `nbstore.worker.ts`）"。

## 4. 语法特色

- **可选链探测宿主能力**：`navigator.vibrate?.(pattern)`、`visualViewport?.removeEventListener(...)`——用可选链对"可能不存在的移动 Web API"安全降级，不存在时静默返回假值，再据此 `console.warn`。
- **`Promise.reject('Not supported')` 显式声明能力缺口**：`HapticProvider` 对 Web 做不到的方法不静默吞掉，而是明确拒绝——让上层能感知"此端不支持"，也给原生壳留出 `override` 的语义位。
- **退订函数作为 provider 契约**：`VirtualKeyboardProvider.onChange` 返回 `() => void` 清理函数，与 RxJS/infra 的订阅模型一致；不支持时返回空函数 `() => {}` 保证调用方无需判空。
- **查找表映射枚举**：`{ LIGHT: [10], MEDIUM: [20], HEAVY: [30] }[style]` 用对象字面量把触觉强度枚举映射成振动时长数组，比 `switch` 紧凑。
- **`import './setup'` 顺序化引导**：与 web 同样靠 import 副作用保证 `BUILD_CONFIG` 先于业务就位（见 `affine-web.md` 第 4 章）。
- **`configureMobileModules` 单行切换端变体**：mobile 专属 service（haptics/virtual-keyboard 的服务侧、移动导航等）由 core 导出、外壳一行注册——"厚核心"把端差异也做进了可组合的 `configure*`。

## 5. 设计 / 实现亮点

- **与 web 同构、差异最小**：移动外壳与 Web 外壳共享骨架与构建分支，差异收敛到"+1 行 mobile 模块、+2 个移动 provider、换 router/样式"。一个团队维护两端 Web 入口的成本因此极低。
- **provider 的"诚实降级 + 可覆盖"**：`HapticProvider`/`VirtualKeyboardProvider` 的 Web 实现把能做的做了、做不到的明确拒绝，接口完整；原生壳（iOS/Android）只需 `override` 这两个 provider 即可获得原生体验——这是 core 的 provider 抽象在"同一业务、多种宿主能力"上的漂亮落地。
- **用 `visualViewport` 攻克移动 Web 键盘难题**：不依赖任何原生桥，纯 Web API 推算键盘高度并响应式回调，使移动 Web/PWA 也能获得接近原生的输入体验。
- **一套 core mobile 变体服务三端**：移动 Web、iOS、Android 共用 `@affine/core/mobile/*`，`@affine/mobile` 是其最轻的宿主示范，Capacitor 壳在此基础上替换宿主 provider——跨端复用的最大化。

## 6. 对外 API 与注意事项

- **无对外导出**：终端应用，`"browser": "src/index.tsx"` 仅作打包入口。
- **挂载点与引导顺序**：同 web，根 DOM 需 `id="app"`；`setup.ts` 的 `bootstrap/browser` 必须最先。
- **provider 是降级实现、非完整原生能力**：`HapticProvider` 仅 `impact` 可用，其余 `reject`；移动 Web 上触觉/键盘行为受浏览器限制（如 `navigator.vibrate` 需用户先交互）。要原生体验须由 Capacitor 壳覆盖这些 provider。
- **`visualViewport` 兼容性**：不支持的环境下 `onChange` 返回空函数、键盘高度不可用——布局应有回退。
- **与 web 共用构建分支**：改 rspack 行为会同时影响 web 与 mobile（`bundle.ts` 的 `case '@affine/web': case '@affine/mobile':`）。

## 7. 延伸

- 业务核心：`@affine/core`（mobile 变体：`mobile/router`、`mobile/modules`、`HapticProvider`/`VirtualKeyboardProvider` 的定义与 service 侧，见 `affine-core.md` 第 2 章 `mobile/`）。
- 地基：`@toeverything/infra`（`Framework`/`FrameworkRoot`/`OpClient`，见 `toeverything-infra.md`）；`@affine/nbstore`（存储 Worker）。
- 同层对照：`affine-web.md`（Web 外壳，最适合逐段对读异同）。
- 原生壳：`@affine/ios`/`@affine/android`（Capacitor 封装，`webDir: 'dist'`，复用本 core mobile 变体并 `override` 宿主 provider）。
- 构建工具：`tools/cli`（`affine bundle` → rspack，与 web 同分支）。
