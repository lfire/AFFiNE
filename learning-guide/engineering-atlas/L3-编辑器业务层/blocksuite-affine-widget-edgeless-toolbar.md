# `@blocksuite/affine-widget-edgeless-toolbar`

> 一句话定位：白板**底部居中的主工具栏**——承载"快捷工具"（选择/手型/便签/画笔…，quick tools）与"高级工具"（形状/连线/图片/模板…，senior tools）两排可插拔工具；按容器宽度自适应折叠（溢出进"更多"菜单 / 左右翻页），支持从工具栏拖拽元素到画布、演示（present）模式自动隐藏。它是白板交互的总入口 UI。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/edgeless-toolbar`                                                                                                                                                                                                                                                                                                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`）、`@blocksuite/std/gfx`（`GfxController`/`ToolController`/`DefaultTool`）、`@blocksuite/affine-block-surface`（`EdgelessLegacySlotIdentifier`）、`@blocksuite/affine-components`（context-menu/toolbar 样式/smooth-corner）、`@blocksuite/affine-shared`（`ThemeProvider`/`EditPropsStore`/`ViewportElementProvider`）、`@floating-ui/dom`、`@lit/context`、`@preact/signals-core`、`rxjs`、`lodash-es`、`lit` |
| 被谁依赖  | 编辑器预设（通过 `EdgelessToolbarViewExtension` 注册，仅白板 scope）；各工具包通过 `QuickToolExtension`/`SeniorToolExtension` 向它注入工具                                                                                                                                                                                                                                                                                                           |
| 对外入口  | `.`（widget + 工具扩展 API + mixins + draggable 控制器）、`./view`                                                                                                                                                                                                                                                                                                                                                                                   |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

标准白板 widget：`EdgelessToolbarWidget extends WidgetComponent<RootBlockModel>`（`src/edgeless-toolbar.ts:64`），Shadow DOM 承载工具栏样式，`:host` 绝对定位 `bottom:0; left:50%; translateX(-50%)` 居中贴底、`pointer-events:none`（容器内再 auto）；`edgelessToolbarWidget = WidgetViewExtension('affine:page', …)`（`:730`）注册到 root；`EdgelessToolbarViewExtension`（`src/view.ts`）仅 edgeless scope。它监听的 host 状态是 `gfx.tool`（当前工具）、`gfx.viewport`、以及自身 `ResizeObserver`。

### 独有的问题：可插拔工具 + 响应式折叠 + 跨组件上下文

工具栏不是一堆写死的按钮，而要解决三类问题：

1. **工具可插拔**（独有之一）：形状、连线、便签、画笔等工具各自在独立包里实现，通过 DI（`QuickToolIdentifier`/`SeniorToolIdentifier`）注入工具栏。工具栏只按优先级排序、渲染，不知道具体工具——新增工具无需改本包。
2. **响应式折叠**（独有之二）：工具栏宽度随画布变化。手动计算每类工具的总宽，当放不下时：快捷工具溢出进"更多"弹出菜单（dense-quick），高级工具变成可左右翻页的滚动区（dense-senior）。这套宽度账全靠一组 getter 手算。
3. **跨组件上下文**（独有之三）：工具项是独立 Lit 元素（在各自包里），却要访问工具栏实例、主题、resize 事件。用 `@lit/context` 的 `ContextProvider` 把 `toolbar`/`theme`/`slots` 向下注入，工具项用 mixin `@consume` 消费。
4. **从工具栏拖到画布**（独有之四）：拖某些工具（如形状/便签）可直接拖出一个元素落到画布，由 `EdgelessDraggableElementController` 管理拖拽浮层与落位动画。
5. **演示模式**（独有之五）：进入 `frameNavigator`（演示）时切换成 `presentation-toolbar`，并支持鼠标移开自动隐藏。

## 2. 目录与关键文件

```text
src/
├── edgeless-toolbar.ts          # ★EdgelessToolbarWidget：布局、响应式折叠、present 模式（734 行）
├── context.ts                   # 三个 lit context：toolbar / slots / theme
├── extension/index.ts           # ★QuickTool/SeniorTool 的 DI 标识符与注册扩展
├── config/                      # types（QuickTool/SeniorTool 接口）/ utils / consts
├── mixins/
│   ├── tool.mixin.ts            # ★EdgelessToolbarToolMixin：工具项基类（active/popper/consume 上下文）
│   ├── quick-tool.mixin.ts      # QuickToolMixin
│   └── toolbar-button-with-menu.mixin.ts
├── button/                      # tool-icon-button / toolbar-button
├── menu/slide-menu.ts           # 可滑动菜单容器
├── panel/                       # font-family / font-weight-and-style 面板
├── draggable/
│   ├── draggable-element.controller.ts  # ★从工具栏拖元素到画布的 ReactiveController
│   ├── overlay-factory.ts / event-resolver.ts / types.ts
├── create-popper.ts             # 工具弹出菜单定位（floating-ui）
├── view.ts / effects.ts / index.ts
```

## 3. 实现细节

### 3.1 ★工具的 DI 注入：QuickTool / SeniorTool

`extension/index.ts` 定义两类工具的注册机制：

```ts
export const QuickToolIdentifier = createIdentifier<ToolBuilder<QuickTool>>(
  'edgeless-quick-tool'
);
export const SeniorToolIdentifier = createIdentifier<ToolBuilder<SeniorTool>>(
  'edgeless-senior-tool'
);
export const QuickToolExtension = (id, builder) => ({
  setup: di => di.addImpl(QuickToolIdentifier(id), () => builder),
});
export const SeniorToolExtension = (id, builder) => ({
  setup: di => di.addImpl(SeniorToolIdentifier(id), () => builder),
});
```

`ToolBuilder<T>` 是 `(options:{block,gfx,toolbarContainer}) => T`——工具包用 `` QuickToolExtension('eraser', ({gfx})=>({ type:'eraser', content: html`...`, menu:..., priority:... })) ``注册。工具栏侧`_quickTools` getter（`edgeless-toolbar.ts:338`）用 `std.provider.getAll(QuickToolIdentifier)`取出所有 builder、调用、按`priority`降序排序、过滤`enable`；`_seniorTools`（`:392`）同理。**工具栏对具体工具零耦合**，这是"任何工具第三方插拔"卖点在 UI 层的落点。

`QuickTool`（`config/types`）含 `content`（渲染模板）、`menu`（dense 模式下进"更多"菜单的配置）、`priority`、`type`（用于 active 判定）；`SeniorTool` 含 `name`（翻页 tooltip）+ `content`。

### 3.2 ★响应式折叠：手算宽度账

工具栏用 `ResizeObserver` 观察自身（`connectedCallback`，`:587`），resize 经 `debounce(300, {leading})` 更新 `containerWidth`（`_onContainerResize`，`:238`）。一组 getter 据此算折叠策略：

- `_availableWidth = containerWidth - 2*SAFE_AREA_WIDTH`（`:293`）；
- `_quickToolsWidthTotal`/`_seniorToolsWidthTotal`：各工具数 × 单宽 + 间隙（`:355`/`:408`）；
- **`_denseQuickTools`**（`:301`）：可用宽减去高级工具区仍放不下全部快捷工具 → 快捷工具进入密集模式；
- **`_denseSeniorTools`**（`:311`）：可用宽减快捷工具与间距放不下全部高级工具 → 高级工具进入可翻页模式；
- `_visibleQuickToolSize`（`:419`）：密集时算能显示几个快捷工具，其余进"更多"菜单（`_hiddenQuickTools`，`:332`）；
- `scrollSeniorToolSize`（`:447`）：高级工具一屏能显示几个，配合 `scrollSeniorToolIndex` + 左右 nav 按钮翻页（`_onSeniorNavPrev/Next`，`:469`）。

render（`:661`）把 `data-dense-quick`/`data-dense-senior` 写到容器，CSS 据此展开"更多"按钮宽度、显示翻页箭头（`:180`/`:210`）。溢出菜单用 `popMenu` + floating-ui 的 `autoPlacement({allowedPlacements:['top']})` 向上弹出（`_openMoreQuickToolsMenu`，`:485`）。

这套"手动算宽 + data 属性驱动 CSS"把复杂的自适应布局做得精确可控——不依赖 flex wrap（工具栏必须单行居中）。

### 3.3 ★跨组件上下文：ContextProvider / consume

工具项（在各工具包里）是独立 Lit 元素，需访问工具栏。工具栏在构造时建三个 `ContextProvider`（`:275-288`）：

```ts
_slotsProvider = new ContextProvider(this, {
  context: edgelessToolbarSlotsContext,
  initialValue: { resize: new Subject() },
});
_themeProvider = new ContextProvider(this, {
  context: edgelessToolbarThemeContext,
  initialValue: ColorScheme.Light,
});
_toolbarProvider = new ContextProvider(this, {
  context: edgelessToolbarContext,
  initialValue: this,
});
```

工具项通过 `EdgelessToolbarToolMixin`（`mixins/tool.mixin.ts`）继承一组 `@consume` 字段：`@consume(edgelessToolbarContext) toolbar`、`@consume(edgelessToolbarThemeContext, {subscribe:true}) theme`、`@consume(edgelessToolbarSlotsContext) toolbarSlots`（`:157-167`）。mixin 还提供 `active`（当前工具是否为本工具，比对 `gfx.tool.currentToolOption$`）、`createPopper`（同一时刻只保留一个 `activePopper`，新弹出前 dispose 旧的）、`setEdgelessTool = gfx.tool.setTool` 等——工具项只需继承 mixin 即获得全套"工具栏工具"能力。

`slots.resize`（rxjs `Subject`）在 resize 时 `.next({w,h})`，工具项可订阅以重新定位自己的弹出菜单。

### 3.4 ★从工具栏拖元素到画布

`draggable/draggable-element.controller.ts` 的 `EdgelessDraggableElementController<T>` 是个 Lit `ReactiveController`，实现"按住工具栏里的形状/便签拖到画布即落一个元素"：

- `mouseResolver`/`touchResolver`（`event-resolver.ts`）统一鼠标/触摸事件；
- 拖拽开始 `_createOverlay` 用 `createShapeDraggingOverlay`（`overlay-factory.ts`）在工具栏上方建一个跟手的浮层形状；
- 拖出工具栏区域（`dragOut`）即进入画布放置模式，落下时经 `options` 回调在 `gfx` 里建元素（坐标用 `ViewportElementProvider`/`Bound` 换算）；
- 取消时 `_animateCancelDrop`（`:76`）让浮层形状带 `transform` 过渡动画飞回原位——良好的"拖拽反悔"体感。

`defaultIsValidMove` 等策略在 `types.ts`，控制多大位移算有效拖拽。

### 3.5 演示模式与自动隐藏

`isPresentMode`（`:443`）= 当前工具是 `frameNavigator`。render 时若是演示模式，渲染 `<presentation-toolbar>`（放映控制条）而非普通工具内容（`:696`）。`_enableAutoHide`（`:323`）在演示模式 + `presentHideToolbar` 开关 + 无弹窗时为真，CSS `[data-enable='true']` 把工具栏下移 100px 藏起、hover 时滑回（`:93-101`）——放映时工具栏不挡画面、鼠标靠近才出现。

`Escape` 键（`connectedCallback` 的 `bindHotKey`，`:602`）分层处理：编辑中/演示中忽略；default 工具下关弹窗；其他工具则 `setTool(DefaultTool)` 回到选择工具。

### 3.6 主题与只读

`_appTheme$`（computed，`:227`）读 `ThemeProvider.app$`，写到 `data-app-theme`；`theme$` 变化时同步进 `_themeProvider` context 下发给工具项。只读时 render 直接 `nothing`（除非演示模式，`:663`）；`toolbarLocked` slot 切 `disabled` 属性禁用交互。

## 4. 语法特色

- **DI 工具注册 + `getAll`**：`createIdentifier<ToolBuilder<T>>(name)` + `di.addImpl(Id(id), ()=>builder)` + `provider.getAll(Id)`——用 variant 标识符让"每个工具一个注册项"，工具栏遍历全部，是"可插拔"的类型安全实现（见 `toeverything-infra.md` DI）。
- **`@lit/context` 三 provider / mixin consume**：`ContextProvider` + `@consume` 解决"深层独立组件访问工具栏实例/主题/slots"，避免逐层传 props；`subscribe:true` 让主题变化自动重渲工具项。
- **Mixin 组合工具项基类**：`EdgelessToolbarToolMixin(WithDisposable(SuperClass))` 叠加"可释放 + 工具栏工具能力"，返回带 `EdgelessToolbarToolClass` 类型的构造器——Lit 组件的能力复用范式。
- **响应式布局用 getter 而非模板计算**：`_denseQuickTools`/`_visibleQuickToolSize`/`scrollSeniorToolSize` 等纯 getter 封装宽度账，render 只读结果——逻辑集中、可读。
- **`debounce(fn, 300, {leading:true})`**：resize 高频，用 lodash debounce 首调即执行、后续合并，平衡响应与性能（`:238`）。
- **`data-*` 属性驱动 CSS 状态**：`data-dense-quick`/`data-dense-senior`/`data-enable`/`data-app-theme` 把布局/主题状态下发，过渡与显隐在 CSS 表达。
- **`ReactiveController` 封装拖拽**：`EdgelessDraggableElementController implements ReactiveController` + `host.addController(this)`——把"从工具栏拖元素"的复杂状态机封装成可复用控制器，挂到任意工具项宿主。
- **`cache` 指令**：翻页 tooltip 用 Lit `cache(...)` 缓存模板片段，减少 nothing↔tooltip 切换的 DOM 重建（`:545`）。
- **`computed` + `effect`**：`_appTheme$` 用 signals `computed`，工具 mixin 用 `effect` 订阅 `currentToolOption$` 自动更新 active 态。

## 5. 设计 / 实现亮点

- **工具栏与工具彻底解耦**：工具栏只认 `QuickTool`/`SeniorTool` 接口，具体工具经 DI 注入、按 priority 排序。于是形状/连线/画笔各自在独立包演进，工具栏零改动——这是 BlockSuite 可扩展性在主 UI 上的样板。
- **精确的响应式折叠**：不用 flex-wrap（会破坏单行居中），而是手算每类宽度、分级降级（溢出菜单 → 翻页），`data-*` + CSS 过渡呈现。复杂但可控，适配从手机到宽屏。
- **上下文注入解决深层依赖**：三个 context + 消费 mixin，让散落在各包的工具项无需 props 钻透即可访问工具栏/主题/resize——大型可插拔 UI 的依赖传递范式。
- **拖拽即创建的流畅体感**：`EdgelessDraggableElementController` 管理跟手浮层 + 拖出落位 + 取消飞回动画，把"从工具栏拖一个形状到画布"做成一等交互。
- **演示模式的沉浸式隐藏**：放映时工具栏下沉、hover 浮现，`_enableAutoHide` 用多条件 getter 精确判定，不打扰演示又随时可用。

## 6. 对外 API 与注意事项

- **主要导出**：`EdgelessToolbarWidget`、`EDGELESS_TOOLBAR_WIDGET`、`edgelessToolbarWidget`、`EdgelessToolbarViewExtension`（`./view`）；**工具注册 API** `QuickToolExtension`/`SeniorToolExtension`、`QuickToolIdentifier`/`SeniorToolIdentifier`、`QuickTool`/`SeniorTool` 类型；**mixins** `EdgelessToolbarToolMixin`/`QuickToolMixin`；**draggable** `EdgelessDraggableElementController`；三个 context。
- **装配**：仅 edgeless scope；具体工具由各工具包用 `*ToolExtension` 注入，不在本包。
- **注意**：
  - 新增工具应通过 `QuickToolExtension`/`SeniorToolExtension` 注册，并实现 `QuickTool`/`SeniorTool` 接口；`priority` 决定排序、`menu` 决定 dense 模式下能否进"更多"菜单（无 menu 的快捷工具在密集时会被隐藏且不可达）。
  - 工具项必须继承 `EdgelessToolbarToolMixin`/`QuickToolMixin` 才能拿到 `toolbar`/`theme`/`slots` 上下文与 `active`/`createPopper`。
  - `EditPropsStore` 的 `presentHideToolbar` 非响应式——外部改动需靠 `storageUpdated` slot 触发重渲（`:652`）。
  - 只读且非演示模式时工具栏不渲染；`toolbarLocked` 会禁用交互。
  - 宽度计算基于固定常量（`QUICK_TOOL_SIZE` 等），改工具项尺寸需同步常量，否则折叠判断失准。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`）、`@blocksuite/std/gfx`（`ToolController.setTool`/`currentToolName$`、`DefaultTool`）、`@blocksuite/global/di`（`createIdentifier`）、`@lit/context`、`@floating-ui/dom`。
- 协作：`@blocksuite/affine-components`（context-menu/toolbar 样式/smooth-corner/tooltip）、`@blocksuite/affine-shared`（`ThemeProvider`/`EditPropsStore`/`ViewportElementProvider`）；各工具包（shape/connector/note…）经 `*ToolExtension` 注入工具。
- 对照阅读：`blocksuite-affine-widget-edgeless-zoom-toolbar.md`（白板另一条控制条，同为底部浮层）、`blocksuite-affine-block-root.md` §3.4（白板工具与 `firstUpdated` 里设 DefaultTool/PanTool）、`toeverything-infra.md`（DI/signal）。
