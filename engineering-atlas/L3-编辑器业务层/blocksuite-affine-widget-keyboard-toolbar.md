# `@blocksuite/affine-widget-keyboard-toolbar`

> 一句话定位：AFFiNE **移动端虚拟键盘上方那条工具条**——在手机/平板上编辑文档时，紧贴系统虚拟键盘顶部横向排布一排快捷按钮（格式化、插入块、缩进、撤销、日期、@链接…），点"更多"类按钮会把键盘压下、在原位置撑开一个**工具面板**（分组的图标网格）。它是挂在 root 上、仅在移动端 scope 启用的 widget，核心是**与虚拟键盘的高度/显隐联动**以及多级工具栏/面板的导航。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/keyboard-toolbar`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`ShadowlessElement`/`requiredProperties`）、`@blocksuite/std/inline`（`RANGE_SYNC_EXCLUDE_ATTR`）、`@blocksuite/std/gfx`、`@blocksuite/affine-shared/services`（`VirtualKeyboardProvider(WithAction)`/`FeatureFlagService`/`TelemetryProvider`）、`@blocksuite/affine-shared/commands`（`getSelectedModelsCommand` 等命令）、`@blocksuite/affine-fragment-doc-title`（`getDocTitleByEditorHost`）、一大批块包（note/paragraph/list/image/attachment/latex/table/database/embed/surface-ref）与 inline 包（preset/link/latex）提供面板动作、`@blocksuite/data-view`、`lit`、`@preact/signals-core` |
| 被谁依赖  | 移动端编辑器预设（通过 `KeyboardToolbarViewExtension` 注册）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 对外入口  | `.`（widget + config + `KeyboardToolbarConfigExtension`）、`./view`（`KeyboardToolbarViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

遵循 `widgets/*` 范式（见 `blocksuite-affine-widget-drag-handle.md` §1）：`AffineKeyboardToolbarWidget extends WidgetComponent<RootBlockModel>`（`src/widget.ts:22`）挂在 `affine:page`；`keyboardToolbarWidget = WidgetViewExtension('affine:page', AFFINE_KEYBOARD_TOOLBAR_WIDGET, literal\`…\`)`（`widget.ts:122`）注册；`KeyboardToolbarViewExtension`（`src/view.ts`）**只在移动端 scope 注册**（`context.scope === 'mobile-page'`或 legacy`'page' && IS_MOBILE`，`view.ts:20`）——与 toolbar/slash-menu/linked-doc 恰好互补：那几个在移动端被跳过，这个只在移动端存在。

一个结构上的区别：本包的 widget 本体与真正的工具条 UI **分离**。`AffineKeyboardToolbarWidget` 只做"该不该显示 + 取 keyboard provider + 取 config"，真正的工具条是独立的 `AffineKeyboardToolbar`（`keyboard-toolbar.ts`）与面板 `AffineKeyboardToolPanel`（`keyboard-tool-panel.ts`），都用 `ShadowlessElement`（无 Shadow DOM，样式走全局）经 `blocksuite-portal` 渲染。

### keyboard-toolbar 独有的问题

它的复杂度全在"**和虚拟键盘共处**"：

1. **虚拟键盘联动（独有之一）**：工具条要紧贴键盘顶部，键盘弹起/收起/改高都要跟随；点"插入图片"等面板按钮要先把键盘压下、腾出等高空间放面板，再恢复。这依赖 `VirtualKeyboardProvider` 暴露的 `visible$`/`height$`/`staticHeight$`/`appTabSafeArea$` 一组信号与 `show()`/`hide()` 动作。
2. **键盘高度兜底（独有之二）**：有些环境拿不到带 action 的 provider（`fallback`），widget 用操作 `rootComponent.inputMode`（`'none'` ↔ 原值）来间接控制系统键盘弹不弹。
3. **工具面板撑开（独有之三）**：面板高度要等于键盘高度（`panelHeight` 计算），这样"键盘 → 面板"的切换在视觉上是原地替换而非跳动。
4. **多级导航（独有之四）**：工具项分三类——动作项（直接执行）、子工具栏（进入下一级横条、带返回箭头）、工具面板（撑开图标网格）。用一个 `_path$`（索引栈）表达当前层级、`_currentPanelIndex$` 表达当前打开的面板。
5. **autoShow 子工具栏（独有之五）**：某些子工具栏可声明 `autoShow(ctx) => Signal<boolean>`，当条件（如进入某种块）满足时自动切入、离开时自动退回。
6. **可见性 + 滚动跟随（独有之六）**：仅在移动端、非只读、feature flag 开、编辑器聚焦时显示；每次光标变化把当前块滚动到工具条上方可见区。

## 2. 目录与关键文件

```text
src/
├── index.ts                 # 导出 config + widget
├── view.ts                  # ★KeyboardToolbarViewExtension：仅移动端 scope 注册
├── effects.ts               # customElements.define（widget + toolbar + tool-panel）
├── widget.ts                # ★AffineKeyboardToolbarWidget：可见性门控 + 取 keyboard provider（含 fallback）+ Portal 渲染
├── keyboard-toolbar.ts      # ★AffineKeyboardToolbar：横条本体——三类项渲染、_path 导航、键盘联动、panelHeight、autoShow
├── keyboard-tool-panel.ts   # ★AffineKeyboardToolPanel：撑开的分组图标网格面板
├── config.ts                # ★默认 config：海量内置项/面板/子工具栏（Text/Heading/List/Image/Table/Date/@…）+ 类型 + KeyboardToolbarConfigExtension
├── icons.ts                 # 自定义图标（Heading/HighLight/Figma…）
├── styles.ts                # 全局样式（toolbar / tool-panel）
└── utils.ts                 # 三个类型守卫（isAction/isSubToolbar/isToolPanel）+ formatDate/formatTime
```

## 3. 实现细节

### 3.1 ★可见性门控与 keyboard provider

`AffineKeyboardToolbarWidget.render`（`widget.ts:97`）层层门控：`store.readonly` 或 `!IS_MOBILE` 或 feature flag `enable_mobile_keyboard_toolbar` 未开 → `nothing`；`!_show$.value`（未聚焦）→ `nothing`；否则用 `blocksuite-portal`（`shadowDom: false`）渲染 `affine-keyboard-toolbar`，把 `keyboard`/`config`/`rootComponent` 传入。

`_show$`（`widget.ts:23`）由 `std.event.active$`（编辑器是否聚焦活跃）驱动，并额外监听文档标题 inline 容器的 `focus`/`blur`（`widget.ts:88`）——因为标题不是普通块，但聚焦标题时工具条也该在。

**keyboard getter**（`widget.ts:27`）是关键适配：优先从 `std.get(VirtualKeyboardProvider)` 取 provider，若它 `isVirtualKeyboardProviderWithAction`（带 `show`/`hide`）直接用；否则造一个 `fallback` 对象，用操作焦点元素的 `inputMode`（设 `'none'` 收起系统键盘、恢复原值弹出）来模拟 `show`/`hide`。连接期若是 fallback，还会在 `_show$` 变 false 时恢复 `inputMode`（`widget.ts:76`）——保证工具条消失后系统键盘行为正常。

### 3.2 ★三类工具项与类型守卫

config 的每个 item 是三选一联合（`config.ts:127`）：

```ts
type KeyboardToolbarItem =
  | KeyboardToolbarActionItem
  | KeyboardSubToolbarConfig
  | KeyboardToolPanelConfig;
```

- **ActionItem**（`config.ts:136`）：`{ name, icon, action?, showWhen?, disableWhen?, background? }`——点击直接 `action(ctx)`。
- **SubToolbarConfig**（`:156`）：`{ icon, items, autoShow? }`——点击进入**下一级横条**。
- **ToolPanelConfig**（`:174`）：`{ icon, activeIcon?, groups }`——点击撑开**分组图标面板**；`groups` 项可为静态 `KeyboardToolPanelGroup` 或 `DynamicKeyboardToolPanelGroup`（`(ctx) => group | null` 运行时生成）。

三个守卫 `isKeyboardToolBarActionItem`（`'action' in item`）、`isKeyboardSubToolBarConfig`（`'items' in item`）、`isKeyboardToolPanelConfig`（`'groups' in item`）（`utils.ts:8`）靠**结构特征字段**区分，`_handleItemClick`（`keyboard-toolbar.ts:93`）据此分派。

### 3.3 ★多级导航：_path 索引栈 + 面板索引

`AffineKeyboardToolbar` 用两个 signal 表达层级状态：

- `_path$: number[]`（`keyboard-toolbar.ts:121`）：子工具栏的进入路径（索引栈）。`_currentToolbarItems`（`:165`）从 `config.items` 出发，沿 `_path$` 逐级进入 `SubToolbar.items`，再按 `showWhen` 过滤——于是当前横条显示哪一层由 `_path$` 决定。`_goPrevToolbar`（`:85`）`slice(0, -1)` 回退一级，`_renderItems`（`:226`）在 `_isSubToolbarOpened` 时渲一个返回箭头。
- `_currentPanelIndex$: number`（`:83`）：当前打开的面板在当前横条中的索引，`-1` 为未开。`panelOpened`（`:48`）即 `!== -1`。

`_handleItemClick`（`:93`）的分派：action 项执行 `action`；sub-toolbar 项先 `_closeToolPanel()` 再 push 索引进 `_path$`；panel 项——若点的是已开面板则关、否则置 `_currentPanelIndex$`、`keyboard.hide()`（压下键盘给面板腾位）、并 `_scrollCurrentBlockIntoView()`。

### 3.4 ★panelHeight：键盘与面板的高度接力

面板高度 `panelHeight`（`keyboard-toolbar.ts:52`）是键盘联动的精髓：

```ts
if (keyboard.visible$.value) return `${keyboard.height$.value}px`; // 键盘在 → 用键盘实时高
if (panelOpened) return `${keyboard.staticHeight$.value || 330}px`; // 面板开 → 用键盘静态高(兜底 330)
return keyboard.appTabSafeArea$.value; // 都没有 → 安全区高度
```

于是"键盘收起、面板撑开"时，面板恰好占据键盘原来的高度——视觉上是原地替换，不跳动。`render`（`:367`）把 `panelHeight` 写进 `affine-keyboard-tool-panel` 的 `height`，`paddingBottom` 取 `appTabSafeArea$`（避开 home indicator 等安全区）。

`_closeToolPanel`（`:71`）反向操作：若键盘不可见先 `keyboard.show()`（把键盘弹回来），再延迟 100ms 置 `_currentPanelIndex$ = -1`——延迟是为了"防止键盘弹出动画期间面板闪烁"（源码注释）。还有一个 effect（`:297`）：Android 上点不同段落键盘会自动弹出，此时主动 `_closeToolPanel` 收起面板。

### 3.5 ★autoShow 子工具栏

`_watchAutoShow`（`keyboard-toolbar.ts:317`）在连接期递归遍历 config，收集所有声明了 `autoShow` 的子工具栏，记录其 `path` 与 `autoShow(ctx)` 返回的 `Signal<boolean>`。然后一个 effect（`:342`）监听这些信号：某信号变 true 且当前不在该 path → 记住 `prevPath`、切到该 path；变 false → 回退 `prevPath`。典型用途：进入某类块（如表格/代码）时自动切入对应的上下文工具栏、离开时自动退出——工具条随光标所在内容"变身"。

### 3.6 ★滚动跟随

`_scrollCurrentBlockIntoView`（`keyboard-toolbar.ts:123`）用命令链 `getSelectedModelsCommand` 拿到当前块，比较其底边 `y2` 与工具条顶边 `y1`，若块被工具条遮住（`y2 >= y1 + gap`）就 `scrollTo` 把块顶到工具条上方。它在三处触发：选区变化的 effect（`:286`，`requestAnimationFrame` 等光标更新后）、打开面板时、`firstUpdated` 延迟 700ms（等键盘弹出动画，`:357`）。保证"正在编辑的那行"永远不被工具条/键盘盖住。

### 3.7 面板渲染

`AffineKeyboardToolPanel`（`keyboard-tool-panel.ts:25`）把 `config.groups` 用 `repeat` 渲成若干 `.keyboard-tool-panel-group`：动态组 `(ctx) => group` 先求值、过滤 null（`:70`），组内项按 `showWhen` 过滤，每项是"图标按钮 + 名称"（`_renderItem`，`:58`），点击执行 `action`（受 `disableWhen` 拦截）。这是比横条更"铺开"的图标网格，适合放一屏的插入选项。

### 3.8 内置 config：动作全来自各块包

`defaultKeyboardToolbarConfig`（`config.ts`）是一份极长的内置配置，动作直接复用各包的命令：`updateBlockType`（note 包，转段落/标题/引用/代码）、`indentListCommand`/`dedentListCommand`（list 包）、`insertImagesCommand`/`insertDatabaseBlockCommand`/`insertTableBlockCommand`/`insertLatexBlockCommand`（各块包）、`toggleBold`/`toggleItalic`/`toggleLink`（inline preset/link 包）、`insertContent`（插日期）、`@` 唤起 linked-doc 等。每项用 `showWhen` 查 `std.store.schema.flavourSchemaMap.has(flavour)` 判断该块类型是否注册——**同一套工具条在不同编辑器预设下自动裁剪可用项**。config 可经 `KeyboardToolbarConfigExtension`（`ConfigExtensionFactory` 生成）覆盖/合并（`widget.ts:54`）。

## 4. 语法特色

- **`WidgetComponent<RootBlockModel>` + `ShadowlessElement` 分工**：widget 本体是标准 WidgetComponent，而工具条/面板用 `ShadowlessElement`（无 Shadow DOM，`keyboard-toolbar.ts:40`）——因为要贴合系统键盘、样式需与页面环境一致，隔离反而碍事。
- **三类项的判别联合 + 守卫**：`KeyboardToolbarItem` 三选一，守卫用 `'action'/'items'/'groups' in item` 的结构特征（`utils.ts`）做 `item is X` 收窄。
- **signal 驱动的层级状态机**：`_path$`（索引栈）+ `_currentPanelIndex$` + `_lastActiveItem$` 全是 `signal`，`SignalWatcher` mixin 让 render 自动跟随；`peek()` 读值不建依赖（如 `_closeToolPanel` 判断键盘可见）、`.value` 建依赖。
- **`VirtualKeyboardProviderWithAction` 的 duck-typing**：`isVirtualKeyboardProviderWithAction` 运行时判断 provider 是否带动作，不带就用 `inputMode` 构造 fallback（`widget.ts:27`）——对"键盘能力因宿主而异"的优雅适配。
- **`effect` 聚合多信号副作用**：连接期挂了多个 `effect`（切换 `data-keyboard-visible`/`data-panel-open` 属性、选区变化滚动、键盘可见即关面板），用 preact signals 的 `effect` 而非 Lit 响应式。
- **命令链 `std.command.chain().pipe(...).run()`**：`_scrollCurrentBlockIntoView` 与大量 config action 都用 BlockSuite 命令管道组合操作（`keyboard-toolbar.ts:124`）。
- **`RANGE_SYNC_EXCLUDE_ATTR`**：工具条设该属性（`keyboard-toolbar.ts:269`）+ `pointerdown` 阻止默认（`:282`），防止点工具按钮时编辑器失焦、选区被工具条 DOM 干扰。
- **动态组/图标函数**：`KeyboardIconType = TemplateResult | ((ctx) => TemplateResult)`、`DynamicKeyboardToolPanelGroup = (ctx) => group | null`（`config.ts:132`/`:186`）——图标与分组都可按上下文运行时生成。

## 5. 设计 / 实现亮点

- **键盘高度接力**：`panelHeight` 在"键盘实时高 / 键盘静态高(兜底 330) / 安全区高"之间取值，让"键盘↔面板"切换原地等高替换——移动端编辑体验里最难做顺滑的一环，这里用一组键盘信号精确接管。
- **provider 能力分级 + inputMode 兜底**：带动作的 provider 直接用，没有就用 `inputMode='none'` 间接压键盘——在不同 WebView/浏览器下都能把键盘收放做出来。
- **三类项统一一套导航**：动作、子工具栏（横向下钻 + 返回箭头）、工具面板（纵向撑开网格）共用 `_path$`/`_currentPanelIndex$` 两个状态表达任意层级，结构清晰且可无限嵌套子工具栏。
- **autoShow 随内容变身**：子工具栏可声明条件信号，光标进入某类块时自动切入对应工具集、离开自动退回——工具条"跟着你在编辑什么"变化，是移动端省空间的巧思。
- **滚动跟随**：每次光标/面板变化把当前块顶到工具条上方，保证正在编辑的行永不被遮——移动端小屏的关键可用性细节。
- **动作全外借、按 schema 裁剪**：工具条自己几乎不实现业务动作，全复用各块/ inline 包的命令，并用 `flavourSchemaMap.has` 自动隐藏当前预设不支持的项——一套 config 适配多种移动编辑器。
- **防闪烁的延时与 rAF**：关面板延迟 100ms、滚动用 `requestAnimationFrame`/700ms 等键盘动画——处处针对"虚拟键盘有弹出动画"这一移动端现实做时序对齐。

## 6. 对外 API 与注意事项

- **主要导出**：`AffineKeyboardToolbarWidget`、`AFFINE_KEYBOARD_TOOLBAR_WIDGET`、`keyboardToolbarWidget`、`KeyboardToolbarConfig`/`KeyboardToolbarItem`（三类）/`KeyboardToolbarContext` 等类型、`defaultKeyboardToolbarConfig`、`KeyboardToolbarConfigExtension`、`KeyboardToolbarViewExtension`（`./view`）。
- **扩展方式**：注册 `KeyboardToolbarConfigExtension({ items })` 覆盖/替换默认 items；项用三类结构 + `showWhen`/`disableWhen`/`autoShow` 控制可见与行为；面板组可用 `DynamicKeyboardToolPanelGroup` 按上下文动态生成。
- **注意**：
  - 仅在**移动端 scope**（`mobile-page` 或 `page && IS_MOBILE`）注册，且需 feature flag `enable_mobile_keyboard_toolbar`、非只读、编辑器聚焦才显示。
  - 强依赖 `VirtualKeyboardProvider`——其 `visible$`/`height$`/`staticHeight$`/`appTabSafeArea$` 信号质量直接决定工具条贴合效果；无动作能力时退化为 `inputMode` 兜底。
  - 面板撑开会主动 `keyboard.hide()`、关面板会 `keyboard.show()`，这套显隐与系统键盘动画有 100ms/rAF/700ms 等时序 workaround，调整需谨慎。
  - 工具条/面板是 `ShadowlessElement`，样式走全局 `styles.ts`，与其它 Shadow DOM widget 不同。
  - 内置动作依赖大量块包/ inline 包；某项是否出现取决于对应 flavour 是否在 schema 注册。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`ShadowlessElement`）、`@blocksuite/affine-shared/services`（`VirtualKeyboardProvider(WithAction)`/`FeatureFlagService`，键盘信号的来源）。
- 动作来源：note/paragraph/list/image/attachment/latex/table/database/embed/surface-ref 等块包命令、inline preset/link/latex 的格式化命令、`@blocksuite/affine-widget-linked-doc`（`@` 唤起）。
- 协作：`@blocksuite/affine-fragment-doc-title`（标题聚焦联动）、`@blocksuite/data-view`（database 视图预设）。
- 对照阅读：`blocksuite-affine-widget-toolbar.md`（桌面/通用浮动工具栏，移动端那条是另一套 Visual Viewport 定位；两者都处理"工具栏 vs 键盘"但路径不同）、`blocksuite-affine-widget-linked-doc.md`（移动端 `@` 菜单同样贴键盘）、`blocksuite-affine-widget-slash-menu.md`（桌面 `/` 入口的移动端对位）、`toeverything-infra.md`（signal/effect 响应式）。
