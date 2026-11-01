# `@blocksuite/affine-widget-toolbar`

> 一句话定位：AFFiNE 编辑器那条**随选区浮现的上下文工具栏**——选中一段文字弹出格式化工具栏（加粗/链接/转块…）、选中块弹出块工具栏、白板选中图元弹出图元工具栏、悬停行内链接弹出链接卡片。它是一个"通用浮动工具栏外壳"：自身不含任何按钮，而是把"当前该显示哪些动作"交给 `ToolbarRegistry`（各块注入）、把"锚在哪、往哪弹"交给 floating-ui，用一组**位标志（Flag）** 统一调度五类触发源。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/toolbar`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`TextSelection`/`BlockSelection`）、`@blocksuite/std/gfx`（`GfxController`/图元模型）、`@blocksuite/affine-shared/services`（`ToolbarRegistryIdentifier`/`ToolbarContext`/`ToolbarFlag`/`ActionPlacement`）、`@blocksuite/affine-components/toolbar`（`EditorToolbar`/`editor-icon-button`/`editor-menu-button`）、`@blocksuite/affine-block-database`/`-table`/`-surface`（各自的 selection 与 legacy slot）、`@floating-ui/dom`（`computePosition`/`autoUpdate`/`flip`/`shift`/`hide`/`inline`/`size`）、`@preact/signals-core`（`signal`/`effect`/`batch`）、`lit`、`lodash-es`（`groupBy`/`orderBy`/`partition`/`mergeWith`） |
| 被谁依赖  | 编辑器预设（通过 `ToolbarViewExtension` 注册）；各块包通过 `ToolbarModuleExtension` 向 `ToolbarRegistry` 注入动作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 对外入口  | `.`（`AFFINE_TOOLBAR_WIDGET`/`AffineToolbarWidget`/`toolbarWidget`）、`./view`（`ToolbarViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

toolbar 遵循 `widgets/*` 范式（见 `blocksuite-affine-widget-drag-handle.md` §1）：`AffineToolbarWidget extends WidgetComponent`（`src/toolbar.ts:54`）挂在 `affine:page`（root）上；`toolbarWidget = WidgetViewExtension('affine:page', AFFINE_TOOLBAR_WIDGET, literal\`…\`)`（`src/index.ts:8`）完成注册；`ToolbarViewExtension`（`src/view.ts`）在 `setup`里`context.register(toolbarWidget)`、`effect()`里定义自定义元素。它把真正的工具栏 UI 委托给`@blocksuite/affine-components`的`EditorToolbar` 实例（`toolbar = new EditorToolbar()`，`toolbar.ts:270`），自己只负责"**何时显示、锚在哪、显示谁**"。

### toolbar 独有的问题

和其它 widget 不同，toolbar 的核心矛盾是**"一个浮层服务于五种完全不同的选区语义"**：

1. **多触发源归一（独有之一）**：note 内文本选区（格式化）、database/table 原生文本选区、note 内块选区、白板图元选区、行内链接 hover——五种来源各有各的监听方式与锚点，却共用同一个工具栏实例。本包用一组**位标志 `Flag`**（`Surface/Block/Text/Native/Hovering/Hiding/Accepting`，`flags.ts:3`）把它们编码进一个整数，用按位或组合、按位检查，统一驱动显隐。
2. **基于选区的浮动定位（独有之二）**：工具栏不是贴某个固定 DOM，而是贴"当前选区的包围盒"。选区形态各异——文本选区是 `Range`、块选区是一组 `BlockComponent`、白板选区是模型坐标图元、hover 是单个 HTML 元素——本包抽象出**四个 `setReferenceElementWith*` 方法**把它们统一成 floating-ui 的 `ReferenceElement`。
3. **内容由各块注入（独有之三）**：工具栏显示哪些按钮，取决于当前选中内容的 `flavour`。各块包把自己的动作注册进 `ToolbarRegistry`，widget 在显示时按 flavour **多级合并**模块配置、过滤、排序、溢出折叠成"More"菜单。
4. **移动端虚拟键盘适配（独有之四）**：移动端工具栏固定在屏幕底部、用 Visual Viewport API 顶在虚拟键盘上方。

这三者的切分非常清晰：**触发源 → Flag → 定位 + 渲染**，widget 是调度中枢，动作在块包、UI 在 components、定位在 floating-ui。

## 2. 目录与关键文件

```text
src/
├── index.ts     # toolbarWidget = WidgetViewExtension('affine:page', …) + 导出
├── view.ts      # ToolbarViewExtension：装配入口（移动端 scope 跳过注册）
├── effects.ts   # customElements.define(AFFINE_TOOLBAR_WIDGET, AffineToolbarWidget)
├── toolbar.ts   # ★AffineToolbarWidget：五类触发源订阅 + 四个 setReferenceElementWith* + Flag 调度 + 定位 effect（818 行）
└── utils.ts     # ★autoUpdatePosition（floating-ui 定位）/ renderToolbar（按 flavour 合并动作、More 折叠）/ combine / sideMap
```

本包极薄（仅 5 个源文件），真正的"重量"在两处依赖：工具栏 UI 组件 `EditorToolbar` 在 `@blocksuite/affine-components/toolbar`，动作注册中心 `ToolbarRegistry`/`ToolbarContext`/`Flag` 在 `@blocksuite/affine-shared/services/toolbar-service`。

## 3. 实现细节

### 3.1 ★位标志 Flag：把"显示状态"编码成一个整数

`Flag`（affine-shared `flags.ts:3`）是一组按位枚举：

```ts
export enum Flag {
  None = 0b0,
  Surface = 0b1,
  Block = 0b10,
  Text = 0b100,
  Native = 0b1000,
  Hovering = 0b10000, // 悬停行内链接
  Hiding = 0b100000, // 拖拽中/弹窗中，临时隐藏
  Accepting = 0b1000000, // 编辑器失活但仍接收 message
}
```

`Flags` 类（`flags.ts:17`）用一个 `value$ = signal(Flag.None)` 持有当前组合态，`toggle(flag, on)` 按位或/与非、`check(flag)` 判定某位是否置位、`contains(mask)` 判定是否命中掩码中任意位、`refresh(flag)` 先关后开（在 `batch` 内）强制触发一次订阅——这是"选区没变但锚点变了，要重新定位"的关键手段。widget 的收尾渲染就是一个订阅 `flags.value$` 的 `effect`（`toolbar.ts:739`）：值为 `None` 或含 `Hiding` 位就隐藏工具栏，否则 `renderToolbar`。用整数位运算做状态机，让"文本+悬停同时成立""拖拽时压制一切"这类组合逻辑变成一行按位判断。

### 3.2 ★五类触发源 → 统一 Flag

`connectedCallback`（`toolbar.ts:276`）挂了一串订阅，每个都把某种选区翻译成"置某个 Flag + 设锚点 + 设 flavour/placement"：

| 触发源                    | 监听                                              | 置位            | 锚点方法                              |
| ------------------------- | ------------------------------------------------- | --------------- | ------------------------------------- |
| note 内文本选区（格式化） | `std.selection.find$(TextSelection)`（`:401`）    | `Flag.Text`     | `setReferenceElementWithRange(range)` |
| database/table 原生选区   | `document` 的 `selectionchange`（`:428`）         | `Flag.Native`   | `setReferenceElementWithRange`        |
| note 内块选区             | `std.selection.filter$(BlockSelection)`（`:460`） | `Flag.Block`    | `setReferenceElementWithBlocks`       |
| 白板图元选区              | `gfx.selection.slots.updated`（`:514`）           | `Flag.Surface`  | `setReferenceElementWithElements`     |
| 悬停行内链接              | `toolbarRegistry.message$`（`:695`）              | `Flag.Hovering` | `setReferenceElementWithHtmlElement`  |

每个订阅都在 `batch(() => {...})` 内完成"toggle flag → 设锚点 → 设 `flavour$`/`placement$` → `flags.refresh`"一气呵成（signals 的 `batch` 合并成一次通知）。块选区还有一层精细判定（`:466`）：单块时若该 flavour 在 registry 有模块就用其 flavour，否则只对 paragraph/list/code/image 这几种 `matchModels` 的块激活。

另有三条"维持一致性"的订阅：`std.view.viewUpdated`（块视图切换如 card↔embed 后重设锚点，`:567`）、`store.slots.blockUpdated`（块内容更新后重算锚点，`:599`）、`surface.elementUpdated`（图元变化后重算，`:638`）——它们只在对应 Flag 已置位时 `refresh`，保证工具栏跟着内容走。

### 3.3 ★四种锚点抽象：选区 → ReferenceElement

floating-ui 只认一个有 `getBoundingClientRect`/`getClientRects` 的 `ReferenceElement`。widget 用 `referenceElement$`（一个 `signal<(() => ReferenceElement) | null>`，`:130`）保存"如何取锚矩形"，四个 setter 各自适配一种选区：

- `setReferenceElementWithRange(range)`（`:132`）：包一层代理，`getClientRects` 过滤掉宽度≈0 的空 rect——文本选区跨行时取真实可见矩形。
- `setReferenceElementWithHtmlElement(el)`（`:144`）：直接返回元素——hover 链接用。
- `setReferenceElementWithBlocks(blocks)`（`:148`）：取各块 `getBoundingClientRect` 用 `getCommonBound` 求**公共包围盒**，并缓存一帧（`requestAnimationFrame` 后清缓存）避免同帧重复测量。
- `setReferenceElementWithElements(gfx, elements)`（`:173`）：白板图元在**模型坐标**，用 `getCommonBoundWithRotation` 求含旋转的公共 bound，再 `gfx.viewport.toViewBound` 换算到屏幕像素，并加上 widget 自身 offset——把无限画布坐标映射到浮层坐标。

这就是"浮动工具栏紧贴任意选区"的几何底座：无论选的是什么，最终都归一成一个会算矩形的对象。

### 3.4 ★定位 effect：floating-ui autoUpdate

定位是另一个独立 `effect`（`toolbar.ts:768`）。每次 Flag/锚点/flavour 变化，它先 `abort` 上一个 `AbortController`、取当前 `referenceElement$.value?.()`，再调 `autoUpdatePosition(signal, toolbar, referenceElement, flavour, placement, sideOptions)`（`utils.ts:52`）。后者内部：

- 按场景选 middleware：普通浮栏用 `offset(10+offsetY)` + `size`(宽度 fit-content) + `inline()`(文本选区贴行) + `shift`(避让视口边、底部留 150px 给可能的键盘) + `flip`(上下翻转) + `hide()`(锚不可见时隐藏)（`utils.ts:82-102`）；`placement==='inner'` 的内嵌工具栏则用负 offset 叠在元素内部顶部、宽度跟随元素（`:67-78`）。
- `autoUpdate(..., { animationFrame: hasSurfaceScope })`：白板场景因视口持续变换，用 animationFrame 模式持续重算；其余只在滚动/resize 时重算。
- `hide()` middleware 的 `referenceHidden` 结果驱动 `data-open` 的增删——锚点滚出视口时工具栏自动消失（`utils.ts:129`）。

CSS 侧（`toolbar.ts:55`）用 `transition-behavior: allow-discrete` + `@starting-style` 让 `display:none↔flex` 带淡入淡出，`data-open`/`data-placement`/`data-inline`/`data-mobile` 等属性驱动不同形态的样式。

### 3.5 ★渲染：按 flavour 多级合并 + More 折叠

`renderToolbar`（`utils.ts:209`）决定"显示哪些按钮"。它按**五级优先级**从 `toolbarRegistry.modules` 取模块并拍平：

```ts
const actions = [
  flavour,
  `custom:${flavour}`,
  hasSurfaceScope ? ['affine:surface:*', 'custom:affine:surface:*'] : [],
  'affine:*',
  'custom:affine:*',
]
  .flat()
  .map(key => registry.modules.get(key))
  .filter(Boolean)
  .filter(m => m.config.when?.(context) ?? true)
  .flatMap(m => m.config.actions);
```

于是"某 flavour 专属动作 + 该 flavour 的自定义补丁 + 白板通用动作 + 全局通用动作"叠在一起——`custom:` 前缀是业务层（如 `@affine/core`）给 BlockSuite 默认动作打补丁的入口。随后 `combine`（`utils.ts:154`）把同 `id` 的动作 `mergeWith` 合并（数组字段递归再分组）、`generate(context)` 展开动态动作、按 `when` 过滤；`orderBy(['placement','id','score'])` 排序；`partition` 把 `ActionPlacement.More` 的动作劈出来塞进一个 `editor-menu-button`（"More" 溢出菜单，`utils.ts:255`），其余作为主按钮。最后 `render(join(...), toolbar)` 用 Lit 的 `render` 把模板打进工具栏 DOM。`primaryActionGroup` 为空就 `context.reset()` 收起——没有可用动作时不显示空栏。

### 3.6 拖拽/缩放时的压制与移动端适配

- **压制**：拖拽（`dragStart`/`nativeDrop`、`host` 的 `dragenter`/`dragleave`）与白板图元缩放（`EdgelessLegacySlotIdentifier` 的 `elementResizeStart/End`）期间置 `Flag.Hiding`（`toolbar.ts:654-691`），工具栏临时隐藏，避免挡住操作；`dragleave` 用 `throttle(fn, 144)` 且判断指针是否真离开 host 才解除。
- **移动端**：`IS_MOBILE` 分支（`toolbar.ts:310`）把工具栏 `position:fixed` 固定屏幕底部居中，用 `window.visualViewport` 的 `resize`/`scroll` 事件算出虚拟键盘高度 `innerHeight - vv.height - vv.offsetTop`，把工具栏顶到键盘上方（`:318`）。移动端还因长按选区偶尔不走 std selection 流，额外用 `document` 的 `selectionchange` + `host` 的 `touchend`（带 debounce）兜底同步 `Flag.Text`（`:336-386`）。注意 `ToolbarViewExtension` 在**移动端 scope 下不注册本 widget**（`view.ts:19`）；`IS_MOBILE` 分支服务的是"桌面构建跑在触摸设备"等运行时移动场景。

## 4. 语法特色

- **位运算状态机**：`Flag` 用二进制字面量 `0b1`/`0b10`…定义，`toggle` 用 `|=`/`&= ~`、`check` 用 `(flag & value) === flag`、`contains` 用 `!== None`（`flags.ts`）。把多维显隐状态压进一个整数，组合判定成本 O(1)。
- **`signal`/`effect`/`batch`（preact signals）**：widget 不用 Lit 的响应式，而直接用 `@preact/signals-core`——`referenceElement$`/`sideOptions$` 是 signal，两个核心 `effect`（渲染、定位）自动随依赖重跑，多次 `toggle` 包在 `batch` 内合并通知（`toolbar.ts:254`/`:411`）。
- **`ReferenceElement` 鸭子类型适配**：四个 setter 都返回"带 `getBoundingClientRect`/`getClientRects` 的对象字面量"而非真实 DOM，用结构化类型满足 floating-ui 接口（`toolbar.ts:132-189`）——把异构选区统一成一个协议。
- **`AbortController` 做定位生命周期**：每次重定位先 abort 旧 controller、新建一个传给 `autoUpdatePosition`，`signal.addEventListener('abort', cleanup)` 保证 `autoUpdate` 的 teardown 被调用（`toolbar.ts:766-814`）——effect 的返回清理函数 + AbortSignal 双保险。
- **`Promise.race` 等渲染或中断**：`autoUpdatePosition.update` 用 `Promise.race([abort 信号, toolbar.updateComplete])`（`utils.ts:104`）——要么等工具栏渲染完再定位，要么被 abort 提前退出，避免对半更新的 DOM 测量。
- **lodash 管道做动作编排**：`groupBy`→`toPairs`→`mergeWith`（`combine`/`group`，`utils.ts:182`）合并同 id 动作、`orderBy` 多键排序、`partition` 劈分 More——声明式数据变换表达复杂的"合并去重排序折叠"。
- **Lit `keyed`/`join`/`repeat`/`ifDefined` 指令**：`keyed(flavour:key, ...)` 让 More 菜单在模型切换时强制重建（`utils.ts:266`）、`join(items, separator)` 插分隔符、`repeat(..., a => a.id, ...)` 按 id 稳定 diff。
- **`RANGE_SYNC_EXCLUDE_ATTR`**：`connectedCallback` 给自身设该属性（`toolbar.ts:279`），告诉 inline 编辑器"别把这个浮层里的 range 同步进文档选区"——浮层与文档选区的隔离。

## 5. 设计 / 实现亮点

- **一个浮层服务五种选区**：把 note 文本、database 原生文本、块、白板图元、hover 链接五类触发源统一成 Flag + ReferenceElement + flavour 三要素，共用一套定位与渲染——避免为每种场景各写一个工具栏。
- **位标志调度**：用一个整数的按位组合表达"谁在显示、是否被拖拽压制、是否接受 message"，`refresh`（先关后开）优雅解决"状态没变但锚点变了需重定位"——这是信号式 UI 里很见功力的技巧。
- **选区→ReferenceElement 的协议化**：四种锚点 setter 把异构几何统一成 floating-ui 协议，`WithBlocks` 的公共包围盒 + 一帧缓存、`WithElements` 的模型坐标换算，都处理得干净。
- **内容完全外置**：工具栏不含任何按钮，动作由各块经 `ToolbarRegistry` 注入，`custom:` 前缀让业务层打补丁；widget 按 flavour 五级合并——块的能力长在块包里，工具栏保持中立骨架。
- **More 溢出折叠**：主栏放常用、`ActionPlacement.More` 的塞进"更多"菜单，`keyed` 保证模型切换时正确重建——信息密度与可用性的平衡。
- **拖拽/缩放压制 + 锚点失视自动隐藏**：`Flag.Hiding` 一键压制、floating-ui `hide()` middleware 在锚滚出视口时撤 `data-open`——交互细节（不挡操作、不悬空）照顾到位。
- **移动端键盘联动**：Visual Viewport API 精确顶在虚拟键盘上方，并用 `selectionchange`+`touchend` 兜底移动端不稳定的选区流。

## 6. 对外 API 与注意事项

- **主要导出**：`AFFINE_TOOLBAR_WIDGET`、`AffineToolbarWidget`、`toolbarWidget`（ViewExtension 片段）、`ToolbarViewExtension`（`./view`）。动作的注入 API（`ToolbarModuleExtension`/`ToolbarRegistryIdentifier`/`ToolbarContext`/`Flag`/`ActionPlacement`）在 `@blocksuite/affine-shared/services`，不在本包。
- **扩展方式**：给某 flavour 加工具栏按钮 → 向 `ToolbarRegistry` 注册一个 module（含 `config.actions`/`when`/`placement`），动作项带 `id`/`score`（排序）/`when`/`active`/`disabled`/`run`/`placement`(Normal 或 More)；给默认动作打补丁用 `custom:<flavour>` key。
- **注意**：
  - 仅注册在 `affine:page` scope，且 `ToolbarViewExtension` 在移动端 scope 跳过注册。
  - 工具栏是**单实例**（`toolbar = new EditorToolbar()`），五类触发源复用它——同一时刻只呈现一种语义（由 Flag 优先级与 `renderToolbar` 决定）。
  - 定位依赖 `referenceElement$` 能算出非空矩形；选区为空、锚点滚出视口（`hide()` middleware）或 `primaryActionGroup` 为空都会收起。
  - 白板场景 `autoUpdate` 走 `animationFrame: true` 持续重算，开销高于页面场景，属预期。
  - `placement==='inner'` 是特殊内嵌形态（叠在元素内部，如图片顶部工具条），样式与定位都另走一套分支。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`TextSelection`/`BlockSelection`）、`@blocksuite/std/gfx`（`viewport.toViewBound` 坐标换算）、`@floating-ui/dom`（`computePosition`/`autoUpdate`/中间件）、`@preact/signals-core`（signal/effect/batch，见 `toeverything-infra.md` §3.3 响应式基础）。
- 动作中心：`@blocksuite/affine-shared/services/toolbar-service`（`ToolbarRegistry`/`ToolbarContext`/`Flag`/`ActionPlacement`/`getModulePlacement`）——本包的"内容"全来自这里。
- UI 组件：`@blocksuite/affine-components/toolbar`（`EditorToolbar`/`editor-icon-button`/`editor-menu-button`/主题样式）。
- 协作：`@blocksuite/affine-block-database`/`-table`（原生选区）、`@blocksuite/affine-block-surface`（`EdgelessLegacySlotIdentifier` 缩放 slot）。
- 对照阅读：`blocksuite-affine-widget-edgeless-selected-rect.md`（白板选中框几何、同样的模型坐标→屏幕换算）、`blocksuite-affine-widget-slash-menu.md`（同为浮层但输入触发）、`blocksuite-affine-widget-keyboard-toolbar.md`（移动端另一套工具条）。
