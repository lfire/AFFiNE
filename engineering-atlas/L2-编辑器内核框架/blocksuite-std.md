# `@blocksuite/std`

> 一句话定位：BlockSuite 的**视图层与编辑器运行时框架**——它把 `@blocksuite/store` 的"数据块树"渲染成 Lit 组件树（`EditorHost` + `BlockComponent`），并用一套 DI 驱动的 `Extension` 体系把命令链（`Command`）、UI 事件分发（`UIEventDispatcher`）、选择系统（`Selection`）、剪贴板、内联编辑、以及 edgeless 白板的 gfx 基础设施全部挂进一个 `BlockStdScope`。所有具体块（affine-block-\*）都是在 std 提供的"标准件"上拼装出来的。

| 项        | 值                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/framework/std`                                                                                                                                  |
| 所属层    | L2 · 编辑器内核框架                                                                                                                                         |
| 语言/形态 | TypeScript 库                                                                                                                                               |
| 关键依赖  | `@blocksuite/store`、`@blocksuite/global`、`lit`、`@lit/context`、`@preact/signals-core`、`@atlaskit/pragmatic-drag-and-drop`、`zod`、`fractional-indexing` |
| 被谁依赖  | 所有 `@blocksuite/affine-block-*`、`affine-widget-*`、编辑器预设（presets）                                                                                 |
| 对外入口  | `.`、`./gfx`、`./effects`、`./inline`                                                                                                                       |

## 1. 设计逻辑

`store` 给出的是"数据"（`BlockModel` 树），但编辑器真正要的是：**把数据渲染成 DOM、把用户操作（点击/键盘/拖拽）路由到正确的块、把一组操作组合成可复用的命令、把"选中了什么"统一管理、还要支持白板这种非文档流的布局**。这些都是视图层职责，且必须**可扩展**——因为 BlockSuite 的卖点就是"任何块、任何工具都能第三方插拔"。

`std` 的答案是一个围绕 **`BlockStdScope`** 的运行时：

1. **一切皆 Extension + DI**：命令、事件、视图、选择、剪贴板、gfx 全是注册进 DI `Container` 的扩展。`BlockStdScope` 构造时把内部扩展和用户扩展都 `setup` 进容器，再建 `provider`。
2. **生命周期由 `LifeCycleWatcher` 统一管理**：扩展按 `created → rendered → mounted → unmounted` 四阶段被回调，对应 `EditorHost` 这个 Lit 元素的挂载/卸载。
3. **视图是 Lit，但无 Shadow DOM**：用 `ShadowlessElement` 让块组件渲染到 light DOM（便于全局选区、样式、无障碍），用 `@lit/context` 把 `std`/`store` 向下注入。
4. **命令用"洋葱中间件"链式组合**：`Command` 是 `(ctx, next) => void`，`chain().pipe().run()` 串起来，类型系统累积每步的输出。
5. **事件分发按块树作用域路由**：`UIEventDispatcher` 把原生事件按"当前选区/目标块 → 冒泡到父块 → flavour 级 → 全局"的顺序派发给注册的 handler。

**边界**：std 不定义任何具体块（那是 affine-block-\* 的事），它只提供"块组件基类、宿主、命令/事件/选择/gfx 框架"这些**标准件**。`std` 之于 BlockSuite，相当于一个"编辑器 UI 运行时 + 扩展总线"。

## 2. 目录与关键文件

```text
src/
├── index.ts               # 汇总导出 clipboard/command/event/extension/scope/selection/spec/view
├── identifier.ts          # 一组 DI 标识符：Block/Widget View、Command、Config、Keymap、Std…
├── scope/
│   └── std-scope.ts       # BlockStdScope：编辑器运行时根；注册内部+用户扩展，建 provider
├── view/
│   ├── element/
│   │   ├── lit-host.ts            # EditorHost：顶层 Lit 元素，渲染根块、提供 context
│   │   ├── block-component.ts     # BlockComponent：块组件基类
│   │   ├── gfx-block-component.ts # 白板块组件基类
│   │   ├── widget-component.ts    # 挂件组件基类
│   │   └── shadowless-element.ts  # ShadowlessElement：无 Shadow DOM 的 LitElement
│   ├── view-store.ts      # ViewStore：id → BlockComponent/WidgetComponent 的运行时索引
│   └── decorators/        # requiredProperties / PropTypes（必填属性校验）
├── command/
│   ├── manager.ts         # CommandManager：chain / pipe / try / tryAll / exec
│   ├── types.ts           # Command / Chain 类型（输出类型累积）
│   └── consts.ts          # cmdSymbol
├── event/
│   ├── dispatcher.ts      # UIEventDispatcher：事件注册、作用域路由、active 管理
│   ├── base.ts            # UIEventState / UIEventStateContext / UIEventHandler
│   ├── keymap.ts          # 快捷键绑定
│   ├── control/           # pointer / keyboard / range / clipboard 四类底层控制器
│   └── state/             # 事件源状态（Selection / Target 两种来源）
├── selection/             # BlockSelection/TextSelection/SurfaceSelection/CursorSelection
├── extension/
│   ├── lifecycle-watcher.ts  # LifeCycleWatcher：created/rendered/mounted/unmounted
│   ├── flavour.ts            # FlavourExtension(flavour)
│   ├── block-view.ts         # BlockViewExtension(flavour, litTemplate)
│   ├── keymap.ts             # KeymapExtension
│   ├── service.ts/service-manager.ts # BlockService + 管理
│   └── dnd/                  # DndController（基于 pragmatic-drag-and-drop）
├── gfx/                   # edgeless 白板基础：controller/viewport/layer/grid/tool/model/view…
├── inline/               # 内联编辑器（RangeManager + inline-editor）
├── clipboard/            # 复制粘贴（adapter + snapshot）
└── spec/                 # BlockViewType / WidgetViewType 类型
```

## 3. 实现细节

### 3.1 `BlockStdScope`：编辑器运行时的根

`BlockStdScope`（`scope/std-scope.ts`）是整个 std 的中枢。构造时（`std-scope.ts:119-140`）：

```ts
this.container = new Container();
this.container.addImpl(StdIdentifier, () => this);
internalExtensions.forEach(ext => ext.setup(this.container)); // 内置扩展
this.userExtensions.forEach(ext => ext.setup(this.container)); // 用户扩展
this.provider = this.container.provider(undefined, this.store.provider); // 链到 store 的 provider
this._lifeCycleWatchers.forEach(w => w.created()); // 触发 created
```

`internalExtensions`（`std-scope.ts:34-49`）是一张"编辑器标配"清单：`ServiceManager`、`CommandManager`、`UIEventDispatcher`、`RangeManager`、`ViewStore`、`Clipboard`、`GfxController`、`GfxSelectionManager`、`GridManager`、`LayerManager`、`ViewManager`、`DndController`、`EditorLifeCycleExtension` 等。它们全是 `LifeCycleWatcher` 子类，经 DI 注册。`BlockStdScope` 把它们暴露成 getter（`std.command`/`std.event`/`std.view`/`std.selection`/`std.range`/`std.clipboard`/`std.dnd`），内部都是 `this.get(XxxManager)`。

注意 `provider` 的第二个参数 `this.store.provider`——**std 的 DI 作用域挂在 store 的 DI 作用域之下**，于是 std 扩展能解析到 store 注册的东西（如 `StoreSelectionExtension`），形成 global → store → std 的三层 DI 链。

### 3.2 `EditorHost`：数据树 → Lit 组件树

`EditorHost`（`view/element/lit-host.ts`）是编辑器唯一的顶层自定义元素 `<editor-host>`。它的类型签名就体现了 global 三件套的叠加：

```ts
@requiredProperties({
  store: PropTypes.instanceOf(Store),
  std: PropTypes.object,
})
export class EditorHost extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  @provide({ context: storeContext })
  @property({ attribute: false })
  accessor store!: Store;
  @provide({ context: stdContext })
  @property({ attribute: false })
  accessor std!: BlockStdScope;
}
```

`render()` 从 `store.root` 开始递归 `_renderModel`（`lit-host.ts:62-94`）：按块的 flavour 从 DI 取出该块的视图标签（`std.getView(flavour)` → `BlockViewIdentifier`），再把匹配该块的 widgets 一起拼成 `lit/static-html` 的模板。这里用了 `unsafeStatic` 把运行时拿到的标签名插入静态模板——因为块的标签是数据驱动的、编译期未知。`connectedCallback` 里校验 `store.root` 存在（否则抛致命的 `NoRootModelError`）并调 `std.mount()`，`disconnectedCallback` 调 `std.unmount()`，把 Lit 元素生命周期桥接到扩展生命周期。

`getUpdateComplete` 被覆写以**等待所有子块与 widget 渲染完成**（`lit-host.ts:146-190`），这是测试与协同场景拿到"稳定 DOM"的关键。

### 3.3 `ShadowlessElement`：为什么不用 Shadow DOM

`ShadowlessElement`（`view/element/shadowless-element.ts`）覆写 `createRenderRoot()` 直接 `return this`，让组件渲染进 **light DOM** 而非 shadow root。原因：编辑器需要**跨块的原生 Selection/Range**（光标能从一个段落连续选到另一个）、全局样式、无障碍——Shadow DOM 的隔离恰恰是障碍。

代价是样式不再自动隔离。它用两套 `WeakMap`（`connectedCount`/`onDisconnectedMap`）做**引用计数式样式注入**：`finalizeStyles` 把组件 `static styles` 注入 `document.head`；若元素恰好落在某个 shadow root 内，则按 root 维度注入并计数，最后一个同类元素断开时移除（`shadowless-element.ts:52-96`）。这是"无 Shadow DOM 又要管理样式"的务实折中。

### 3.4 `Extension` 与 `LifeCycleWatcher`：可插拔的生命周期

`Extension` 基类来自 store（`@blocksuite/store` 的 `Extension`，`setup(di)` 约定）。std 的 `LifeCycleWatcher`（`extension/lifecycle-watcher.ts`）在其上加四个生命周期钩子，并规定子类必须定义唯一 `key`：

```ts
static override setup(di: Container) {
  if (!this.key) throw new BlockSuiteError(ErrorCode.ValueNotExists, ...);
  di.add(this, [StdIdentifier]);                              // 注册构造器（依赖 std）
  di.addImpl(LifeCycleWatcherIdentifier(this.key), p => p.get(this)); // 注册成可枚举的 watcher
}
```

于是 `BlockStdScope` 能 `provider.getAll(LifeCycleWatcherIdentifier)` 拿到所有 watcher 并统一回调 `created/rendered/mounted/unmounted`（`std-scope.ts:137,147,157,165`）。`CommandManager`、`UIEventDispatcher`、`ViewStore`、`GfxController` 全是 `LifeCycleWatcher`——这就是"编辑器所有子系统都随宿主生命周期自动启停"的机制。

更轻量的扩展用**工厂函数**：`FlavourExtension(flavour)`（`extension/flavour.ts`）和 `BlockViewExtension(flavour, litTemplate)`（`extension/block-view.ts`）各自返回一个 `{ setup: di => di.addImpl(...) }` 的 `ExtensionType`，把"某 flavour 的存在声明"和"某 flavour 的视图模板"注册进 DI。一个块的完整装配，通常就是 `FlavourExtension + BlockSchemaExtension + BlockViewExtension + 若干 Command/Service` 的数组。

### 3.5 `CommandManager`：洋葱中间件式命令链

`Command`（`command/types.ts:18`）是一个中间件签名：

```ts
export type Command<Input = InitCommandCtx, Output = {}> = (
  input: Input & InitCommandCtx,
  next: (output?: Output) => void
) => void;
```

命令要么调 `next(data)` 继续（并向下传递数据），要么不调 `next` 直接返回（视为失败，链中断）。`CommandManager`（`command/manager.ts`）提供两种跑法：

- `exec(command, input)`：跑单个命令。
- `chain().pipe(cmd1).pipe(cmd2, input).run()`：串联。`run()` 把所有命令加一个"置 `success=true`"的尾命令后交给 `runCmds` 递归执行（`manager.ts:105-122`），返回 `[success, ctx]`。
- `try(fn => [chainA, chainB])`：**短路分支**，依次跑各分支，**第一个成功就停**（`manager.ts:134-162`）。
- `tryAll(...)`：**全跑**，有一个成功即整体成功（`manager.ts:163-195`）。

命令数组藏在用 `Symbol`（`cmdSymbol`）作 key 的字段里（`manager.ts:104`），避免与业务字段冲突。类型层面 `Chain<CommandCtx>` 的 `pipe` 用泛型**累积每步输出**（`Chain<CommandCtx & In & Out>`，`command/types.ts:26-34`），于是链越长、`ctx` 的类型越丰富，后续命令能静态看到前面命令产出的字段——"类型安全的管道"。

### 3.6 `UIEventDispatcher`：按块树作用域路由事件

`UIEventDispatcher`（`event/dispatcher.ts`）是键鼠/拖拽/剪贴板/合成输入的总线。它把原生事件归一成一批语义事件名（`click`/`pointerDown`/`dragMove`/`keyDown`/`paste`/`compositionStart`…，`dispatcher.ts:31-69`），由 `control/` 下的 `PointerControl`/`KeyboardControl`/`RangeControl`/`ClipboardControl` 四个控制器把原生 DOM 事件翻译后调 `run`。

注册用 `add(name, handler, { flavour?, blockId? })`（`dispatcher.ts:355`），把 handler 存进 `_handlersMap[name]`。派发的核心是 `buildEventScope`（`dispatcher.ts:371-412`）——它决定一个事件该给哪些 handler，顺序是**由具体到泛化**：

1. 从目标块（或当前选区的块）开始，收集绑定了这些 `blockId` 的 handler 与这些块 flavour 的 handler；
2. 沿 `store.getParent` **向上冒泡**到根，逐层收集；
3. 最后追加 `flavour`/`blockId` 都未指定的**全局** handler。

`run`（`dispatcher.ts:428-453`）依次调用这些 handler，**任一返回 truthy 即视为"已消费"**，`stopPropagation` 并停止派发（合成事件除外）。事件源分 `Selection`（按当前选区找块）和 `Target`（按事件 target 的 DOM 最近 `[data-block-id]` 找块）两种（`event/state/source.ts`），对应 `_buildEventScopeBySelection`/`_buildEventScopeByTarget`。

`active` 状态很关键：dispatcher 用静态 `_activeDispatcher` 保证**全局只有一个编辑器处于激活态**（多编辑器共存时），并监听 `focusin/focusout/pointerenter/visibilitychange/selectionchange` 等一大串事件精细地维护 `active$`（`dispatcher.ts:133-248`）——只有 active 的 dispatcher 才会 `run` 事件（`dispatcher.ts:433`）。快捷键通过 `KeymapIdentifier` 在 `mounted` 时统一 `bindHotkey`（`dispatcher.ts:420-425`）。

### 3.7 选择系统：std 定义类型，store 管状态

一个有意思的分工：**选区的"状态容器"在 store**（`StoreSelectionExtension`，见 store 篇），**选区的"类型"在 std**。`std/selection/` 定义了 `BlockSelection`/`TextSelection`/`SurfaceSelection`/`CursorSelection`，都继承 store 的 `BaseSelection`：

```ts
export class BlockSelection extends BaseSelection {
  static override group = 'note';
  static override type = 'block';
  static override fromJSON(json) { return new BlockSelection(BlockSelectionSchema.parse(json)); }
  override equals(other) { ... }
  override toJSON() { return { type: 'block', blockId: this.blockId }; }
}
export const BlockSelectionExtension = SelectionExtension(BlockSelection);
```

每个选区类型用 zod 校验 JSON、实现 `equals`/`toJSON`/`fromJSON`（可序列化进 awareness 做远端选区）。`BaseSelection.is(Type)`（store 侧）用 `static type` 字符串比对做类型守卫。`std.selection` getter 实际返回的就是 store 的 `StoreSelectionExtension`（`std-scope.ts:111-113`），于是 std 和 store 共享同一份选区真相。

### 3.8 gfx：白板（edgeless）的基础设施

`gfx/`（经 `@blocksuite/std/gfx` 导出）是把"文档流编辑器"扩展成"无限画布白板"的全部底座，围绕 `GfxController`（`gfx/controller.ts`，也是个 `LifeCycleWatcher`）：

- **`Viewport`**：缩放/平移/坐标换算（model 坐标 ↔ 视口坐标）。
- **`LayerManager`/`GridManager`**：图元的 z-order 分层与空间网格索引（快速命中测试）。
- **`GfxBlockElementModel`/`GfxPrimitiveElementModel`/`SurfaceBlockModel`**：白板里"块"和"画布原生图元（如手绘、连线）"的模型，配合 `model/surface/decorators`（`@field`/`@derive`/`@local`/`@observe` 等属性装饰器）声明可序列化/派生/本地属性。
- **`ToolController`/`BaseTool`**：画笔、选择、连线等工具的注册与切换。
- **`InteractivityManager`**：拖拽/缩放/旋转等交互的扩展点。

gfx 复用了文档侧同一套 DI/事件/选择机制，只是模型从"块树"换成"画布图元 + 分层"，体现了 std "一套运行时，两种布局"的设计。

## 4. 语法特色

- **装饰器密集**：Lit 的 `@property`/`@state`/`@consume`/`@provide`（`@lit/context`）用于属性与依赖注入；自定义 `@requiredProperties({...})`（`view/decorators`）在元素上做必填属性运行时校验；gfx 的 `@field`/`@derive`/`@local` 做模型属性声明。`accessor` 关键字配合 Lit 3 的标准装饰器（`accessor std!: BlockStdScope`）。
- **洋葱中间件 + 类型累积**：`Command = (ctx, next) => void`，`Chain.pipe` 返回 `Chain<Ctx & In & Out>`，用泛型交叉类型让链条逐步"长出"更完整的上下文类型——TS 层面的管道推断。
- **`Symbol` 做内部槽位**：`cmdSymbol`（命令数组）、`blockComponentSymbol`（标记块组件）、`storeContext`/`stdContext`（`createContext` 的 token）都用 Symbol/独立 token 避免命名冲突。
- **Mixin 叠加**：`SignalWatcher(WithDisposable(ShadowlessElement))` 三层 Mixin 组合，分别赋予"Signal 自动重渲 / 资源自动回收 / 无 Shadow DOM"能力。
- **`lit/static-html` 的 `unsafeStatic`**：块视图标签运行时才确定，用 `html\`<${tag} ...></${tag}>\``+`unsafeStatic` 动态拼模板（`lit-host.ts:89`）。
- **DI 标识符工厂**：`BlockViewIdentifier(flavour)`、`WidgetViewIdentifier`、`LifeCycleWatcherIdentifier(key)` 用 global 的 `createIdentifier` 带 variant，使"每个 flavour / 每个 key 一个标识符"成立（`identifier.ts`）。
- **非连续枚举做层级比较**：与 sync 同源的手法，gfx/event 里也用 step/order 数值表达阶段。

## 5. 设计 / 实现亮点

- **DI 作用域链 global→store→std**：std 的 provider 以 store 的 provider 为 parent，让三层能力无缝解析，又各自隔离，是"内核可裁剪、扩展可插拔"的结构性保证。
- **生命周期统一总线**：所有子系统都是 `LifeCycleWatcher`，随 `EditorHost` 的 connect/disconnect 自动 `mounted`/`unmounted`，彻底消除"手动 init/destroy 各子系统"的样板与泄漏。
- **事件按块树冒泡 + active 单例**：`buildEventScope` 把"事件该给谁"建模成沿块树向上收集的作用域，天然支持"段落处理不了的键给它父 note、再给全局"；静态 `_activeDispatcher` 优雅解决多编辑器焦点争用。
- **命令链的 `try/tryAll` 语义**：短路分支与全量分支两种组合子，让"尝试多种策略、取第一个成功"这类编辑器逻辑声明式表达，且类型安全。
- **无 Shadow DOM + 引用计数样式注入**：为连续选区/无障碍放弃 Shadow 隔离，又用 WeakMap 引用计数补回样式管理，取舍清晰。
- **一套运行时承载文档与白板**：gfx 复用 DI/事件/选择，仅替换模型与布局，避免维护两套编辑器内核。

## 6. 对外 API 与注意事项

- 主要导出：`BlockStdScope`、`EditorHost`、`BlockComponent`/`WidgetComponent`、`ShadowlessElement`、`CommandManager`/`Command`/`Chain`、`UIEventDispatcher`、`LifeCycleWatcher`、`FlavourExtension`/`BlockViewExtension`/`KeymapExtension`、各 `*Selection` 与 `*SelectionExtension`；gfx 从 `@blocksuite/std/gfx`、内联从 `@blocksuite/std/inline` 引入。
- **扩展必须有唯一 `key`**：`LifeCycleWatcher`/`StoreExtension` 子类不定义 `static key` 会在 `setup` 时抛 `ValueNotExists`。
- **`std.host` 要在 `render()` 之后才可用**：过早访问抛错（`std-scope.ts:96-105`）；DOM 依赖逻辑放 `mounted`。
- **命令"不调 `next` = 失败"**：忘了 `next()` 会让链在此静默中断，`run()` 返回 `success=false`——这是最常见的"命令没生效"原因。
- **事件 handler 返回值语义**：返回 truthy 表示"消费并停止传播"，返回 falsy 才会继续派发给作用域内后续 handler。
- **只有 active 的 dispatcher 会处理事件**：多编辑器场景下，非激活编辑器收不到键鼠事件是预期行为。
- **`@blocksuite/std/effects`** 需在应用入口 import 一次以注册自定义元素（side-effect 入口）。

## 7. 延伸

- 同层：`@blocksuite/store`（数据与选区状态来源）、`@blocksuite/global`（DI、异常、Lit×Signal Mixin、gfx 几何）、`@blocksuite/sync`（经 store 间接使用）。
- 上层：`@blocksuite/affine-block-*`（用 `BlockViewExtension` + `BlockComponent` 实现具体块）、`affine-widget-*`、编辑器 presets。
- 对应教程：learning-guide 第 17 章《BlockSuite-Std：视图、扩展、命令、事件》。
