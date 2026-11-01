# `@affine/electron-api`

> 一句话定位：Electron **渲染进程调用主进程/helper 进程的类型化 IPC 桥**——它本身几乎不含运行时代码，而是从 `@affine/electron` 的 `exposed` 定义里"借类型"，把 preload 通过 `contextBridge` 挂到 `globalThis` 的 `__apis`/`__events`/`__appInfo` 重新声明成强类型的 `apis`/`events`/`appInfo`，让渲染层以类型安全的方式跨进程调用。

| 项        | 值                                                                               |
| --------- | -------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/electron-api`                                                 |
| 所属层    | L4 · 前端应用                                                                    |
| 语言/形态 | TypeScript 库（几乎纯类型 + 全局变量取值）                                       |
| 关键依赖  | `@affine/electron`（workspace，仅取类型）                                        |
| 被谁依赖  | `@affine/core`、`apps/electron-renderer`（渲染进程里所有需要调用桌面能力的模块） |
| 对外入口  | `.`（`apis`/`events`/`appInfo`/`sharedStorage` 及一众类型）、`./web-worker`      |

## 1. 设计逻辑

Electron 的进程模型：渲染进程（网页）不能直接碰 Node/系统 API，必须经 preload 脚本用 `contextBridge.exposeInMainWorld` 暴露受控接口，再通过 `ipcRenderer.invoke` 与主进程通信。AFFiNE 的难点是：**主进程有几十个 handler/event，渲染层要以类型安全方式调用它们，又不能把主进程代码打进渲染包**。本包的解法是"**类型借用 + 运行时取全局**"：

1. **运行时极薄**：真正把能力挂到 `window.__apis`/`__events` 的是 `@affine/electron` 的 preload（`bootstrap.ts` 调 `contextBridge.exposeInMainWorld`）。本包只是从 `globalThis` 把它们取出来并 `as` 成强类型。
2. **类型来自主进程的 `exposed`**：用 `typeof import('@affine/electron/...').handlers` 反推出主进程 handler 的形状，再用映射类型把"主进程 handler 签名"变换成"渲染端代理签名"（去掉第一个 `event` 参数、保证返回 `Promise`）。
3. **主进程 handler 与 helper handler 合并**：主进程（`main`）与 helper 进程（`helper`，跑重任务的独立进程）两套 handler/event 合并成统一的 `ClientHandler`/`ClientEvents`。

**为什么单独成包**：把"IPC 类型桥"独立出来，渲染层依赖它即可获得完整类型而无需 `import` 主进程实现；主进程改了 handler 签名，渲染层编译期立刻感知。

## 2. 目录与关键文件

```text
electron-api/
├── package.json        # exports: "." → src/index.ts；"./web-worker" → src/web-worker.ts
├── tsconfig.json       # references: ../apps/electron（取其类型）
└── src/
    └── index.ts        # 全部内容：类型变换 + 从 globalThis 取 __apis/__events/__appInfo/__sharedStorage
```

（`package.json` 声明了 `./web-worker` 子入口指向 `src/web-worker.ts`，当前 `src/` 下仅有 `index.ts`。）

## 3. 实现细节

### 3.1 从主进程 `exposed` 借类型

主进程在 `@affine/electron/main/exposed.ts` 导出 `handlers`/`events`，并提供 `getExposedMeta()` 把它们拍平成 `[namespace, 方法名[]]` 供 preload 注册：

```ts
// 来源：packages/frontend/apps/electron/src/main/exposed.ts
export { events, handlers };
export const getExposedMeta = () => ({
  handlers: Object.entries(handlers).map(([ns, h]) => [ns, Object.keys(h)]),
  events: Object.entries(events).map(([ns, h]) => [ns, Object.keys(h)]),
});
```

本包 `index.ts` 只 `import type` 它们的类型：

```ts
// 来源：src/index.ts
import type {
  events as helperEvents,
  handlers as helperHandlers,
} from '@affine/electron/helper/exposed';
import type {
  events as mainEvents,
  handlers as mainHandlers,
} from '@affine/electron/main/exposed';
import type { AppInfo } from '@affine/electron/preload/electron-api';
import type { SharedStorage } from '@affine/electron/preload/shared-storage';
```

### 3.2 核心映射类型：主进程签名 → 渲染端代理签名

主进程 handler 形如 `(event: IpcMainInvokeEvent, ...args) => R`，但渲染端调用时**不传 event**、且一律是异步。`MainClientHandlers` 用映射类型 + 条件类型 + `infer` 完成这个变换：

```ts
// 来源：src/index.ts
type MainClientHandlers = {
  [namespace in keyof MainHandlers]: {
    [
      method in keyof MainHandlers[namespace]
    ]: MainHandlers[namespace][method] extends (
      arg0: any,
      ...rest: infer A
    ) => any
      ? (...args: A) => ReturnType<
          MainHandlers[namespace][method]
        > extends Promise<any>
          ? ReturnType<MainHandlers[namespace][method]> // 已是 Promise 原样返回
          : Promise<ReturnType<MainHandlers[namespace][method]>> // 否则包一层 Promise
      : never;
  };
};
```

要点：`infer A` 捕获"去掉首个 event 参数后"的剩余参数元组；返回值若已是 `Promise` 则保留，否则包 `Promise`（因为 `ipcRenderer.invoke` 永远异步）。

### 3.3 合并 main / helper / 特例

渲染端最终可用的句柄是主进程 handler（除 `import` 外）叠加 helper handler，再把 `import` 单独扩展一个 preload 侧的 `createImportSessionFromSource`：

```ts
// 来源：src/index.ts
export type ClientHandler = Omit<MainClientHandlers, 'import'> &
  HelperHandlers & {
    import: MainClientHandlers['import'] & ImportPreloadHandlers;
  };
export type ClientEvents = MainEvents & HelperEvents;
```

`import` 之所以特殊：`createImportSessionFromSource` 需要在 preload 里把浏览器 `File`/目录解析成真实文件路径（`webUtils.getPathForFile`），再转调主进程的 `createImportSession`——这步只能在 preload 做（见 `preload/electron-api.ts` 的 `resolveNativeImportSource`），故作为 preload 专属 handler 叠加进 `import` 命名空间。

### 3.4 运行时：从 `globalThis` 取值

本包真正的"运行时"只有四行——把 preload 挂上去的全局变量取出来并断言类型：

```ts
// 来源：src/index.ts
export const appInfo = (globalThis as any).__appInfo as AppInfo | null;
export const apis = (globalThis as any).__apis as ClientHandler | undefined;
export const events = (globalThis as any).__events as ClientEvents | undefined;
export const sharedStorage = (globalThis as any).__sharedStorage as
  SharedStorage | undefined;
```

`undefined`/`null` 是关键：在**非 Electron 环境（Web）**里这些全局不存在，调用方必须判空——这正是"桌面能力可选"的类型表达。

### 3.5 全局是怎么挂上去的（上游 preload，供理解）

虽然不在本包，但理解链路必须知道 `@affine/electron/preload/bootstrap.ts`：

```ts
// 来源：packages/frontend/apps/electron/src/preload/bootstrap.ts
if (currentUrl && isInternalUrl(currentUrl)) {
  contextBridge.exposeInMainWorld('__appInfo', appInfo);
  contextBridge.exposeInMainWorld('__apis', apis);
  contextBridge.exposeInMainWorld('__events', events);
  contextBridge.exposeInMainWorld('__sharedStorage', sharedStorage);
}
```

而 `apis` 在 `preload/electron-api.ts` 里由 `getMainAPIs()` 动态生成：读进程参数里的 `--main-exposed-meta=`（即 `getExposedMeta()` 的 JSON），对每个 `namespace:method` 包一个 `(...args) => ipcRenderer.invoke(AFFINE_API_CHANNEL_NAME, channel, ...args)`；`events` 则维护 `listenersMap` + 引用计数的订阅/退订（`subscribe/unsubscribe` 经 `AFFINE_EVENT_SUBSCRIBE_CHANNEL_NAME`）。helper 侧用 `async-call-rpc` 走 `MessagePort`。本包提供的类型，正是这套运行时的"类型镜像"。

## 4. 语法特色

- **`import type` 仅借类型、零运行时依赖**：对 `@affine/electron` 全部用 `import type`，主进程实现代码不会进渲染包，只有类型参与编译。
- **映射类型 + 条件类型 + `infer` 元组**：`[k in keyof T]`、`extends (arg0:any, ...rest: infer A) => any`、`ReturnType<...> extends Promise<any> ? ... : Promise<...>`——三件套把"主进程签名"系统性变换为"渲染端代理签名"，是本包全部价值所在。
- **`Omit` + 交叉类型做局部覆盖**：`Omit<MainClientHandlers,'import'> & HelperHandlers & { import: ... }` 精确替换单个命名空间的形状。
- **`as` 断言表达"可能不存在"**：`(globalThis as any).__apis as ClientHandler | undefined`，用联合 `undefined` 把跨环境可用性编码进类型。
- **TS project references**：`tsconfig.json` 的 `references: [{ path: '../apps/electron' }]` 让类型借用在增量构建下成立。
- **声明再导出类型**：末尾大量 `export type { UpdateMeta, TabAction, WorkbenchMeta, ... } from '@affine/electron/...'`，把主进程的领域类型"转口"给渲染层，渲染层无需知道它们的物理位置。

## 5. 设计 / 实现亮点

- **类型驱动的 IPC 契约**：主进程 handler 的签名就是契约，渲染层通过类型变换自动获得精确调用签名——改主进程签名，渲染层编译即报错，彻底消除 IPC channel 字符串/参数错配。
- **运行时极简、心智清晰**：本包几乎没有逻辑，只做"取全局 + 断言类型"，把复杂度留在 preload（运行时）与类型系统（编译期），各司其职。
- **main/helper 双进程统一门面**：渲染层不关心某能力在主进程还是 helper 进程，`ClientHandler`/`ClientEvents` 合并后是一个平滑接口。
- **可选性入编译期**：`apis: ClientHandler | undefined` 强制调用方在非 Electron 环境判空，天然支持 Web/Desktop 同构代码。

## 6. 对外 API 与注意事项

- 用法：`import { apis, events, appInfo } from '@affine/electron-api'`；调用前**务必判空**（`apis?.xxx.yyy(...)`），Web 环境下它们是 `undefined`/`null`。
- `events.ns.name(callback)` 返回退订函数；底层有引用计数，多处订阅同一 channel 只向主进程订阅一次。
- `import.createImportSessionFromSource` 是 preload 专属（接受浏览器 `File`/目录并解析真实路径），区别于主进程的 `createImportSession`。
- 本包类型依赖 `@affine/electron` 的 `exposed`/`preload` 结构，修改主进程 handler 组织方式需同步；它不负责运行时注册。

## 7. 延伸

- 运行时来源：`@affine/electron` 的 `preload/electron-api.ts`（`getMainAPIs`/`getHelperAPIs`）、`preload/bootstrap.ts`、`main/exposed.ts`、`helper/exposed.ts`。
- 原生能力：`@affine/native`（主进程经 napi 调用 Rust，见 affine-native.md）。
- helper RPC：`async-call-rpc`（helper 进程走 `MessagePort`）。
- 消费方：`@affine/core`、`apps/electron-renderer`。
