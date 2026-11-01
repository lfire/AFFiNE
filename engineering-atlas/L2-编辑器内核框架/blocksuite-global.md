# `@blocksuite/global`

> 一句话定位：BlockSuite 编辑器内核的**零依赖地基层**——把"所有包都要用"的横切能力沉淀成一处：轻量 DI 容器、带错误码的异常体系、运行环境探测、`DisposableGroup` 资源回收、Signal × Lit 的桥接 Mixin，以及一套纯函数式的图形几何（gfx）工具。它不感知任何"块"的概念，只提供工具。

| 项        | 值                                                                                           |
| --------- | -------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/framework/global`                                                                |
| 所属层    | L2 · 编辑器内核框架                                                                          |
| 语言/形态 | TypeScript 库                                                                                |
| 关键依赖  | `@preact/signals-core`、`lit`、`rxjs`、`lib0`                                                |
| 被谁依赖  | `@blocksuite/store`、`@blocksuite/sync`、`@blocksuite/std` 及所有 BlockSuite 上层包          |
| 对外入口  | `.`、`./utils`、`./env`、`./exceptions`、`./di`、`./types`、`./gfx`、`./disposable`、`./lit` |

## 1. 设计逻辑

BlockSuite 由几十个包组成（framework 三件套 + 几十个 affine-block-\*），它们面对一组**完全相同的底层需求**：需要抛结构化错误、需要知道"现在跑在什么环境"、需要统一回收事件监听与订阅、需要一个 DI 容器把扩展串起来、需要在 Lit 组件里消费 Preact Signal。如果每个包各写一份，不仅重复，还会因为"多实例"引发诡异 bug（典型如 Yjs 的 `instanceof` 检查会因重复打包而失效）。

`@blocksuite/global` 的立场就是**做最底层、最稳定、零业务的工具集合**：

1. **自己带一套 DI**（`./di`）。注意它**不是**复用 `@toeverything/infra` 的 `Framework`，而是 BlockSuite 独立实现的 `Container`/`ServiceProvider`——因为 BlockSuite 要作为独立 npm 包对外发布，不能依赖 AFFiNE 应用层的基础设施。`@blocksuite/store` 的 `Extension`、`@blocksuite/std` 的 `BlockStdScope` 全都建立在这套 DI 上。
2. **异常体系用错误码而非类继承**（`./exceptions`）。一个 `BlockSuiteError` + 一个 `ErrorCode` 枚举，用数值区间区分"可恢复运行时错误"与"致命错误"。
3. **把 Lit 与 Signal 缝起来**（`./lit`）。BlockSuite 的视图是 Lit，数据响应式是 Preact Signal，两套系统需要 `SignalWatcher`/`watch`/`WithDisposable` 三个 Mixin 来打通。
4. **几何计算独立成 gfx 子模块**，供 edgeless 白板使用，纯函数、可摇树。

它在整体架构中的角色，类比 L1 的 `@toeverything/infra`：都是"地基"，但 `infra` 服务于 AFFiNE 应用，`global` 服务于 BlockSuite 内核，两者可以共存于同一前端。

## 2. 目录与关键文件

```text
src/
├── index.ts            # 空导出（export {}）——真正入口是各子路径，强制按需引入、利于摇树
├── di/                 # 自研 DI 容器（BlockSuite 版）
│   ├── container.ts    # Container / ContainerEditor：注册 add/addImpl/override/scope
│   ├── provider.ts     # BasicServiceProvider：解析 get/getAll/getOptional
│   ├── identifier.ts   # createIdentifier<T>() / createIdentifierFromConstructor
│   ├── scope.ts        # 作用域 ServiceScope（string[]）
│   ├── stable-hash.ts  # 给"用类当标识符"生成稳定 hash
│   └── types.ts        # ServiceIdentifier / ServiceFactory / TypesToDeps 等类型
├── exceptions/
│   ├── code.ts         # ErrorCode 枚举（运行时 <10000，致命 ≥10000）
│   └── index.ts        # BlockSuiteError + handleError
├── env/index.ts        # IS_WEB / IS_NODE / IS_SAFARI / IS_MOBILE … 环境探测常量
├── disposable/index.ts # DisposableGroup：统一回收 Disposable/Subscription/Subject/回调
├── lit/
│   ├── signal-watcher.ts   # SignalWatcher Mixin：Lit 更新周期内追踪 Signal
│   ├── watch.ts            # watch 指令：局部订阅单个 Signal
│   └── with-disposable.ts  # WithDisposable Mixin：随 connected/disconnected 建/销资源组
├── utils/              # crypto(sha)/function(sleep,noop,nextTick)/logger/types
├── gfx/                # bound/curve/math/polyline/svg-path/xywh + perfect-freehand（手绘笔迹）
└── types/              # 全局类型声明（含 virtual-keyboard）
```

一个关键细节：`index.ts` 只有 `export {}`（`src/index.ts:1`），**没有**汇总导出。所有能力都必须经子路径（`@blocksuite/global/di` 等）引入——这是刻意的，保证打包工具能精确摇树，也避免"import 根包就把 gfx 几何库全拖进来"。

## 3. 实现细节

### 3.1 异常：用错误码区分致命性

`BlockSuiteError` 继承原生 `Error`，附加 `code` 与 `isFatal`（`exceptions/index.ts:3-16`）：

```ts
export class BlockSuiteError extends Error {
  static ErrorCode = ErrorCode;
  code: ErrorCode;
  isFatal: boolean;
  constructor(code: ErrorCode, message: string, options?: { cause: Error }) {
    super(message, options);
    this.name = 'BlockSuiteError';
    this.code = code;
    this.isFatal = code >= 10000; // 约定：≥10000 为致命
  }
}
```

`ErrorCode`（`exceptions/code.ts`）从 `1` 起排运行时错误（`ReactiveProxyError`、`ModelCRUDError`、`SchemaValidateError`、`TransformerError`、`CommandError`、`SelectionError`…），从 `10000` 起排致命错误（`NoRootModelError`、`NoSurfaceModelError`、`NoneSupportedSSRError`）。`handleError` 据此分流：致命错误包一层新 `Error` 并再抛，可恢复错误只 `console.error` 不中断用户体验。这些错误码在 store/std 中被大量引用——你在源码里看到 `ErrorCode.ModelCRUDError` 就知道问题出在数据层。

### 3.2 DisposableGroup：一处回收，四类资源

编辑器里充斥着 `addEventListener`、Yjs `observe`、RxJS `subscribe`，忘记解绑就是内存泄漏。`DisposableGroup`（`disposable/index.ts`）把四类"需要清理的东西"统一成 `DisposableMember`：

```ts
export type DisposableMember =
  | Disposable // { dispose() }
  | Subscription // rxjs
  | Subject<any> // rxjs
  | DisposeCallback; // () => void
```

`add` 时若 group 已 disposed 则立即清理该成员；`dispose()` 一次性清空。`disposeMember` 用 `instanceof` 分派到 `unsubscribe()` / `complete()` / 直接调用 / `.dispose()`（`disposable/index.ts:88-102`）。`addFromEvent` 还用 TypeScript **方法重载**为 `Window`/`Document`/`HTMLElement`/`VisualViewport`/`VirtualKeyboard` 各写一组签名，让 `handler` 的事件参数类型被精确推断。

### 3.3 DI 容器：三层嵌套 Map 存 `[scope, identifier, variant] → factory`

`Container`（`di/container.ts`）只存**定义**、不存实例。核心数据结构是三层 `Map`：

```ts
private readonly services = new Map<
  string,                                        // scope（string[] 序列化后）
  Map<string, Map<ServiceVariant, ServiceFactory>> // identifier → variant → factory
>();
```

注册 API 由 `ContainerEditor` 提供链式方法：`add(Class, [deps])`、`addImpl(Id, Class|Instance|Factory, [deps])`、`override(...)`、`scope(ScopeA)`。依赖关系**不单独存储**，而是在注册时被 `dependenciesToFactory` 编译进工厂闭包（`di/container.ts:417-448`）：

```ts
services.add(ServiceB, [ServiceA]);
// 等价于
services.addFactory(ServiceB, provider => new ServiceB(provider.get(ServiceA)));
```

依赖项还支持 `[[Id]]` 这种"取全部实现"的写法（对应 `provider.getAll`），用于一个标识符挂多实现的场景。解析侧 `BasicServiceProvider.get` 按 scope 向上查找并缓存实例。这套容器正是 `@blocksuite/store` 的 `Extension`、`@blocksuite/std` 的 `BlockStdScope` 得以"注册即用"的根基（见 store/std 两篇）。

### 3.4 Lit × Signal 三件套

BlockSuite 视图层用 Lit，数据层用 `@preact/signals-core`，`./lit` 负责缝合：

- **`SignalWatcher(Base)`**（`lit/signal-watcher.ts`）：覆写 `performUpdate`，把 `super.performUpdate()` 包进一个 Preact `effect`。于是组件 `render` 期间**读过的任意 Signal** 都被自动追踪，Signal 变化时触发 `requestUpdate` 重渲。它还在 `connectedCallback` 里主动 `requestUpdate` 以便重连后重新捕获依赖。
- **`watch(signal)`**（`lit/watch.ts`）：一个 Lit `AsyncDirective`，用于"只想订阅某个 Signal 又不想让整个组件重渲"的场景——用 `signal.peek()` 读值以避开 `SignalWatcher` 的 effect 追踪，自己用 `signal.subscribe` 精确更新那一处。
- **`WithDisposable(Base)`**（`lit/with-disposable.ts`）：给 Lit 元素挂一个 `_disposables: DisposableGroup`，`connectedCallback` 建、`disconnectedCallback` 销，彻底解决"组件卸载忘了解绑"。

三者常叠加使用，如 std 的 `EditorHost extends SignalWatcher(WithDisposable(ShadowlessElement))`。

### 3.5 gfx：纯函数几何库

`gfx/` 聚合了白板需要的几何原语：`Bound`/`xywh`（矩形与序列化）、`polyline`/`curve`/`svg-path`（路径）、`math`，以及 `perfect-freehand`（压感手绘笔迹算法）。它们不依赖 DOM、不依赖块模型，纯输入输出，既被 `@blocksuite/std` 的 gfx 子系统使用，也能被上层 edgeless 代码直接调用。

## 4. 语法特色

- **泛型标识符 + 幻影类型**：`createIdentifier<T>(name)`（`di/identifier.ts:78`）返回的对象既带 `identifierName`/`variant` 字段，本身**又是可调用函数**（`Object.assign(fn, {...})`），于是 `const Local = Storage('local')` 能派生 variant。类型 `ServiceIdentifier<T>` 携带 `__TYPE__: T` 幻影字段（`di/types.ts:20`），使 `provider.get(Id)` 的返回类型被精确推断——整套 DI 类型安全的关键。
- **映射类型推导依赖列表**：`TypesToDeps<ConstructorParameters<T>>`（`di/types.ts:33`）把构造函数参数元组映射为"标识符元组"，其中 `T[index] extends (infer I)[] ? [GeneralServiceIdentifier<I>] : never` 这一支专门表达 `[[Id]]`（取全部）语法。`add` 方法再用 `...[deps]: Deps extends [] ? [] : [Deps]` 让"无依赖时第二个参数可省略"。
- **Mixin 工厂 + 声明合并**：`WithDisposable<T extends Constructor<LitElement>>(SuperClass)` 返回匿名子类并 `as unknown as T & Constructor<DisposableClass>`；配合单独 `declare class DisposableClass` 导出类型（`lit/with-disposable.ts:8`），这是 Lit 官方推荐的"Mixin 在 TS 里暴露类型"写法。
- **环境探测的空值短路**：`env/index.ts` 大量使用 `globalThis.navigator?.userAgent ?? ''`，保证在 Node/SSR（无 `window`/`navigator`）下不抛错，这是 BlockSuite 支持服务端渲染的前提（对应致命错误 `NoneSupportedSSRError`）。
- **`static` 字段挂枚举**：`BlockSuiteError.ErrorCode = ErrorCode`，让调用方 `BlockSuiteError.ErrorCode.XXX` 就近取码，无需额外 import。

## 5. 设计 / 实现亮点

- **根 `index.ts` 故意留空**：以子路径入口强制按需引入，把"摇树友好"做进包的物理结构，而非指望使用者自觉。
- **错误码区间即语义**：用 `code >= 10000` 一刀切分"可忽略/必须炸"，比起庞杂的异常类继承树，判断成本为 O(1)，且错误码可跨进程/日志传递。
- **依赖关系编译进工厂闭包**：DI 不在运行时维护依赖图，注册即"固化"为一个闭包，解析时只做 Map 查找 + 调用，简单且快。
- **一个 Signal 两种消费姿势**：`SignalWatcher`（整组件级，自动追踪）与 `watch`（指令级，精确更新）并存，让开发者按粒度选择重渲范围，这是把细粒度响应式塞进 Lit 的工程化答案。
- **自带 DI 而非复用 infra**：保证 BlockSuite 作为独立开源包的自洽，不把 AFFiNE 应用层耦合进内核。

## 6. 对外 API 与注意事项

- 导入必须走子路径：`import { Container } from '@blocksuite/global/di'`、`import { DisposableGroup } from '@blocksuite/global/disposable'`、`import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions'`。直接 `from '@blocksuite/global'` 拿不到任何东西。
- **DI 注册重复会抛 `DuplicateServiceDefinitionError`**：同一 `[scope, identifier, variant]` 重复注册且未标 `override` 即报错；测试里用 `override` 替换实现。
- **`SignalWatcher` 只追踪 render 期间同步读到的 Signal**：异步回调里读的 Signal 不会被追踪，需要显式 `requestUpdate` 或改用 `watch`。
- **`DisposableGroup` 已 disposed 后再 `add` 会立即清理**——这是特性不是 bug，用于防止"晚到的订阅"泄漏。
- gfx 下的 `perfect-freehand` 体量较大，仅在白板笔迹场景按需引入。

## 7. 延伸

- 同层：`@blocksuite/store`（数据层，`Extension` 建立在本包 DI 上）、`@blocksuite/sync`（同步层，用本包 `Logger`、`sha`）、`@blocksuite/std`（视图层，用本包的 Lit Mixin 与 gfx）。
- 对照：L1 的 `@toeverything/infra`——同为"地基 DI + 响应式"，服务对象不同（AFFiNE 应用 vs BlockSuite 内核）。
- 对应教程：learning-guide 第 16 章《BlockSuite 架构与 Store 数据层》开篇的分层说明。
