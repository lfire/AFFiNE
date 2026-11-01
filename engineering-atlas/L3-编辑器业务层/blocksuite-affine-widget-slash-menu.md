# `@blocksuite/affine-widget-slash-menu`

> 一句话定位：AFFiNE 编辑器里**敲 `/` 唤起的斜杠命令菜单**——在富文本中输入 `/` 立即弹出一个浮层列表，用户继续打字做模糊过滤、用方向键/Tab 导航、回车执行；菜单项按"组"分区显示、支持子菜单，命中后先清掉 `/查询串`再执行动作（插入块、转换块、插入日期、移动/复制/删除行等）。它是挂在 root（`affine:page`）上、监听 `beforeInput`/`compositionEnd` 的输入触发型 widget。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/slash-menu`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`TextSelection`/`UIEventStateContext`）、`@blocksuite/std/inline`（`InlineEditor`）、`@blocksuite/affine-rich-text`（`getInlineEditorByModel`/`cleanSpecifiedTail`/`insertContent`）、`@blocksuite/affine-shared`（`createKeydownObserver`/`getPopperPosition`/`isFuzzyMatch`/`substringMatchScore`）、`@blocksuite/affine-components`（`createLitPortal`/`icon-button`/`toast`）、`@blocksuite/affine-ext-loader`（`ViewExtensionProvider`）、`@floating-ui/dom`（`autoPlacement`/`offset`）、`lit`、`lodash-es`（`debounce`/`throttle`/`groupBy`） |
| 被谁依赖  | 编辑器预设（通过 `SlashMenuViewExtension` 注册）、各块包（通过 `SlashMenuConfigExtension` 注入自己的菜单项）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 对外入口  | `.`（`AFFINE_SLASH_MENU_WIDGET`/`SlashMenuExtension`/`SlashMenuConfigExtension`/类型）、`./view`（`SlashMenuViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

slash-menu 遵循 `widgets/*` 的统一范式（见 `blocksuite-affine-widget-drag-handle.md` §1）：

1. **`WidgetComponent` 子类**：`AffineSlashMenuWidget extends WidgetComponent`（`src/widget.ts:64`），挂在 `affine:page`（root）上。注意它**不自带**泛型宿主模型，因为它只关心"当前文本选区所在的那个块"，而非某个固定宿主块。
2. **`WidgetViewExtension` 注册到 block scope**：注册动作不在 `index.ts`，而在 `SlashMenuExtension.setup`（`src/extensions.ts:19`）里 `WidgetViewExtension('affine:page', AFFINE_SLASH_MENU_WIDGET, literal\`${unsafeStatic(...)}\`)`——这是 widget 注册的固定语法。
3. **`ViewExtensionProvider` 装配**：`SlashMenuViewExtension`（`src/view.ts:9`）在 `setup` 里 `context.register(SlashMenuExtension)`、在 `effect()` 里 `effects()` 定义自定义元素。它**显式跳过移动端**（`if (this.isMobile(context.scope)) return`，`view.ts:19`）——移动端另有 keyboard-toolbar 的 `/` 入口。
4. **监听 host 输入事件**：不同于 drag-handle 监听 `pointerMove`，slash-menu 监听的是**输入语义事件** `beforeInput` 与 `compositionEnd`（`widget.ts:190-191`）——它是**输入驱动**而非**指针驱动**的 widget。

### slash-menu 独有的问题

这个 widget 的复杂度集中在五件事，恰好对应"重点"：

- **触发（独有之一）**：如何在用户敲下 `/` 的一瞬间、且仅在"行首或单词边界的真实 `/`"时弹菜单，同时兼容 IME 输入法合成（中文/日文输入）、`disableWhen` 场景（如代码块内不弹）。
- **过滤（独有之二）**：弹出后用户继续打字形成"查询串"，要对两层菜单做**模糊匹配 + 子串打分排序**，并区分"无查询 / 有结果 / 无结果"三态。
- **分组（独有之三）**：菜单项用一个形如 `` `6_Date@0` `` 的字符串编码"组序号\_组名@项序号"，据此排序并分区渲染组标题——模仿 VSCode 的 menu contribution 语法。
- **键盘导航（独有之四）**：上下/Tab/Emacs 风格 `Ctrl+N/P` 移动高亮、左右进出子菜单、回车执行、Esc 关闭，全部在 capture 阶段拦截，避免事件漏到富文本。
- **动作执行（独有之五）**：命中项前**必须先清掉 `/查询串`**再执行 `action`——否则动作改了模型会导致查询串错位；执行后上报 telemetry。

此外它还把"菜单项内容"做成**可被各块包注入扩展**的开放配置（`SlashMenuConfigExtension`），widget 本身只提供渲染与交互骨架。

## 2. 目录与关键文件

```text
src/
├── index.ts               # 导出 AFFINE_SLASH_MENU_WIDGET / extensions / types
├── view.ts                # SlashMenuViewExtension：装配入口（移动端跳过）
├── effects.ts             # customElements.define（widget + affine-slash-menu + inner-slash-menu）
├── extensions.ts          # ★SlashMenuExtension：注册 widget + 合并各处注入的 config；SlashMenuConfigExtension/Identifier
├── consts.ts              # 标签名 / 触发键 '/' / tooltip 延时 / 最大高度 390
├── widget.ts              # ★AffineSlashMenuWidget：监听 beforeInput/compositionEnd → 检测 '/' → showSlashMenu
├── slash-menu-popover.ts  # ★SlashMenu + InnerSlashMenu：浮层本体、过滤、分组、键盘导航、子菜单
├── config.ts              # defaultSlashMenuConfig：内置菜单项（Today/Now/Move Up/Copy/Delete…）
├── types.ts               # SlashMenuItem（Action/SubMenu）/ SlashMenuConfig / group 字符串类型
├── utils.ts               # ★buildSlashMenuItems（when 过滤+排序）/ parseGroup / mergeSlashMenuConfigs / isFuzzyMatch 调用
├── styles.ts              # Shadow DOM 样式
└── tooltips/              # 各内置项的图文 tooltip（today/now/copy/delete/move-up…）
```

## 3. 实现细节

### 3.1 ★触发：两条输入路径 + IME 兼容

widget 在 `connectedCallback`（`widget.ts:187`）只订阅两个事件：

```ts
this.handleEvent('beforeInput', this._onBeforeInput);
this.handleEvent('compositionEnd', this._onCompositionEnd);
```

- **普通输入** `_onBeforeInput`（`widget.ts:156`）：拿到 `InputEvent`，先做**廉价短路**——`event.data === null || event.isComposing` 直接返回（合成中交给 compositionEnd 处理）、`!event.data.includes('/')` 直接返回（绝大多数输入在这里被挡掉，零成本）。只有真含 `/` 才 `inlineEditor.waitForUpdate().then(() => this._handleInput(..., true))`——等 inline 编辑器把这次输入应用完、range 已同步后再检测。
- **输入法合成** `_onCompositionEnd`（`widget.ts:145`）：中文等 IME 下 `/` 不走 beforeInput，而是合成结束事件；判定 `event.data === '/'` 后同样走 `_handleInput`。

`_handleInput`（`widget.ts:86`）是触发判定的核心，它的精巧在**用 `inlineRangeApplyCallback` 对齐时序**：`isCompositionEnd` 为真时 range 已就绪、直接回调；否则订阅一次 `inlineEditor.slots.inlineRangeSync` 等光标位置同步后再判。回调里：

1. 守卫宿主必须是 `affine:page`（`widget.ts:104`）；
2. 走 `config.disableWhen?.({model, std})` 给出"此处不弹"的机会（`widget.ts:117`）；
3. 取当前 inline range、用 `getTextPoint` 拿到光标左侧文本，**只有 `text.endsWith('/')` 才触发**（`widget.ts:131`）——保证 `/` 确实紧贴光标，而非这行别处有个 `/`；
4. `closeSlashMenu()` 先关旧菜单，再 `showSlashMenu(...)`。

`showSlashMenu`（`widget.ts:23`）本身被 `debounce(fn, 100, { leading: true })` 包裹——leading 让第一次立即弹、100ms 内的重复抑制，避免连打触发多次。它用一个**模块级** `globalAbortController`（`widget.ts:17`）保证全局同时只有一个菜单：`closeSlashMenu` 就是 `globalAbortController.abort()`。

### 3.2 浮层挂载与定位：`SlashMenu`

`showSlashMenu` 构造 `new SlashMenu(inlineEditor, abortController)`，设好 `context`/`items` 后直接 `container.append(slashMenu)`（`widget.ts:57`，`container` 默认 `document.body`）——源码注释自嘲这是"复用旧组件的临时手段"（`widget.ts:54`）。`items` 经 `buildSlashMenuItems` 预处理（见 §3.4）。

`SlashMenu extends WithDisposable(LitElement)`（`slash-menu-popover.ts:70`），不是 WidgetComponent 而是独立 Lit 元素。定位在 `willUpdate`（`:310`）首帧：用 `getCurrentNativeRange()` 拿光标原生 range 作参照，`getPopperPosition(this, currRange)` 算出 `{x, y, height}`，并监听 `window.resize` 用 `throttle(fn, 10)` 重算（`:319`）。render（`:328`）据此写 `transform: translate(x, y)`、`maxHeight` 取 `min(position.height, 390)`——菜单总在光标附近、不超屏。无位置时 `visibility: hidden` 占位不闪。

`_startRange`（`:127`）在构造时记下触发瞬间的 inline range 作为"查询串起点"。

### 3.3 ★过滤：两层遍历 + 模糊匹配 + 子串打分

查询串 `_query`（`:183`）= `getTextContentFromInlineRange(inlineEditor, _startRange)`，即"`/` 之后用户又打的字"。每当输入变化，`createKeydownObserver` 的 `onInput` 钩子触发 `_updateFilteredItems`（`:129`）：

```ts
const searchStr = query.toLowerCase();
if (searchStr === '' || searchStr.endsWith(' ')) {
  this._queryState = searchStr === '' ? 'off' : 'no_result'; // 空=展示全部；空格结尾=无结果
  return;
}
// 逐层遍历（最多第 1、2 层）
let depth = 0,
  queue = this.items;
while (queue.length !== 0) {
  this._filteredItems = this._filteredItems.filter(
    item => !isSubMenuItem(item)
  ); // 去掉上层子菜单壳
  this._filteredItems = this._filteredItems.concat(
    queue.filter(({ name, searchAlias = [] }) =>
      [name, ...searchAlias].some(str => isFuzzyMatch(str, searchStr))
    ) // 模糊匹配 name 或别名
  );
  if (this._filteredItems.length !== 0 && depth >= 1) break; // 搜到第二层就停
  queue = queue.flatMap(item => (isSubMenuItem(item) ? item.subMenu : []));
  depth++;
}
this._filteredItems.sort(
  (a, b) =>
    -(
      substringMatchScore(a.name, searchStr) -
      substringMatchScore(b.name, searchStr)
    )
); // 子串得分降序
this._queryState = this._filteredItems.length === 0 ? 'no_result' : 'on';
```

三个要点：**(1) 搜索会"拍平"子菜单**——无查询时菜单有层级，一旦搜索就把前两层菜单项一起纳入候选（搜索态下子菜单项直接可见，不必进子菜单）。**(2) 匹配用 `isFuzzyMatch`**（affine-shared 提供的模糊匹配，允许字符间隔命中），**排序用 `substringMatchScore`**（连续子串命中得分更高）——匹配宽松、排序精确。**(3) 三态** `_queryState: 'off' | 'on' | 'no_result'` 驱动 render：`off` 展示原始 `items`（带分组），`on` 展示 `_filteredItems`，`no_result` 时连遮罩都不画（`:339`）。

### 3.4 ★分组：VSCode 风格的 group 字符串

菜单项的 `group` 字段类型是模板字面量类型 `` `${number}_${string}@${number}` ``（`types.ts:25`），例如配置里的 `'6_Date@0'`、`'8_Actions@0'`（`config.ts:48`/`:82`）。`parseGroup`（`utils.ts:21`）把它拆成 `[组序号, 组名, 项序号]`：

```ts
return [
  parseInt(group.split('_')[0]),
  group.split('_')[1].split('@')[0],
  parseInt(group.split('@')[1]),
];
```

- **排序**：`buildSlashMenuItems`（`utils.ts:49`）用 `itemCompareFn`（`:29`）按"组序号→组名→项序号"三级排序，无 group 的排最前。
- **分区渲染**：`InnerSlashMenu.render`（`:642`）用 `groupBy(menu, ({group}) => group && !searching ? parseGroup(group)[1] : '')` 按组名分桶；`_renderGroup`（`:464`）给每桶渲一个 `.slash-menu-group-name` 标题——但**搜索态下不显示组标题**（`when(!searching, ...)`，`:469`），因为搜索结果已跨组、分组失去意义。

### 3.5 ★键盘导航：capture 阶段双处理器

键盘交互分两处，都在 inline 编辑器的 `eventSource` 上监听、且 `capture: true`，抢在富文本之前处理：

**(A) `createKeydownObserver` 的 interceptor**（`slash-menu-popover.ts:230`，affine-shared 工具）管"关闭/放行"策略：

- `/` 与 IME `Process`+`Slash` 直接放行（让富文本能触发新菜单）；
- `no_result` 态下，非 Backspace 且非文本输入键 → `abort()` 关菜单；
- `Escape` → `abort()` + 阻止冒泡；
- `ArrowRight/Left` 放行（交给下面的 B 处理 + 让光标移动）；
- 其余 `next()`。

**(B) `InnerSlashMenu` 自己的 keydown**（`:554`，capture）管"移动/进出/执行"：

- **移动高亮**：`ArrowUp`/`Shift+Tab`/`Cmd+P`(Emacs) → `moveStep=-1`；`ArrowDown`/`Tab`/`Cmd+N` → `+1`；用 `(index + step + len) % len` 环形移动 `_activeItem`，`_scrollToItem` 滚动使其可见（`:566-595`）。
- **进/出子菜单**：`ArrowRight` 对子菜单项 `_openSubMenu`；`ArrowLeft` 在非顶层（`depth != 0`）时 `abort` 退出当前层（`:597-611`）。
- **执行**：`Enter` 对子菜单项开子菜单、对动作项调 `context.onClickItem`（`:620`）。

子菜单打开时（`_currentSubMenu` 非空）顶层 keydown 直接 return（`:557`），把键交给子菜单层——每层子菜单是独立的 `InnerSlashMenu` 实例、各自带 abortController，形成层级事件分发。

### 3.6 子菜单：Portal + floating-ui

`_openSubMenu`（`:384`）用 `createLitPortal`（affine-components）把子菜单渲成一个脱离文档流的浮层，`computePosition` 用 floating-ui 的 `offset(12)` + `autoPlacement({ allowedPlacements: ['right-start','right-end'] })` 贴在父项右侧，并 `autoUpdate` 跟随滚动。z-index 按 `depth` 递增（`:422`）——支持多层嵌套子菜单且层层叠在上面。鼠标 `mousemove` 到子菜单项即开、离开父菜单 `wheel` 时阻止滚动穿透（`:538`）。

### 3.7 ★动作执行：先清查询串，后执行

命中项走 `_handleClickItem`（`:81`，鼠标点击与回车都经 `onClickItem` 到这）：

```ts
cleanSpecifiedTail(this.context.std, this.context.model, AFFINE_SLASH_MENU_TRIGGER_KEY + (this._query || ''));
this.inlineEditor.waitForUpdate().then(() => {
  item.action(this.context);               // 执行动作
  this._telemetry?.track('SelectSlashMenuItem', { ... });
  this.abortController.abort();             // 关菜单
});
```

关键顺序（源码注释特别强调，`:82-84`）：**先 `cleanSpecifiedTail` 删掉 `/` + 查询串**，等 inline 编辑器 `waitForUpdate` 应用完删除，**再执行 `item.action`**。因为 action 往往会改模型（如把当前段落转成标题、插入新块），若不先清掉 `/foo`，删除操作的坐标就会错位。动作类型由 `defaultSlashMenuConfig`（`config.ts`）定义：插入日期（`insertContent`）、`Move Up`/`Move Down`（操作 `store.getPrev`/`getParent` 重排）、`Copy`（`Slice` 复制）、`Delete` 等。

### 3.8 ★开放配置：各块注入菜单项

widget 不硬编码菜单，而是收集所有注入的 config 合并。`SlashMenuConfigIdentifier`（`extensions.ts:38`）是个按 id 索引的 DI 标识符，`SlashMenuConfigExtension(id, config)`（`:42`）把一份 config 塞进容器。`SlashMenuExtension` 构造时（`:30`）`mergeSlashMenuConfigs(this.std.provider.getAll(SlashMenuConfigIdentifier))` 把所有来源合并：

```ts
// utils.ts:72
items: ctx => Array.from(configs.values()).flatMap(({ items }) =>
  typeof items === 'function' ? items(ctx) : items),
disableWhen: ctx => configs.values().map(({disableWhen}) => disableWhen?.(ctx) ?? false).some(Boolean),
```

于是 paragraph 包注入"转标题/引用"、list 包注入"转列表"、database 包注入"插入数据库"……widget 保持中立。`buildSlashMenuItems`（`utils.ts:49`）在弹出时再用每项的 `when(ctx)` 做上下文过滤（如某项只在页面模式出现），并递归处理子菜单。

## 4. 语法特色

- **模板字面量类型编码分组** `` group?: `${number}_${string}@${number}` ``（`types.ts:25`）：用 TS 模板字面量类型在**类型层面**约束分组字符串格式，配错格式编译期即报错——把 VSCode 的 menu 字符串约定搬进类型系统。
- **判别联合 + 类型守卫**：`SlashMenuItem = SlashMenuActionItem | SlashMenuSubMenu`（`types.ts:47`），用 `isActionItem`/`isSubMenuItem`（`'action' in item`/`'subMenu' in item`，`utils.ts:9`/`:13`）做 `item is X` 守卫，render 时据此分派 `_renderActionItem`/`_renderSubMenuItem`（`:477`）。
- **`debounce(fn, 100, { leading: true })`**：lodash debounce 的 leading 变体让首次立即生效、后续抑制（`widget.ts:23`），避免连续输入弹多个菜单。
- **`handleEvent('beforeInput' | 'compositionEnd', ...)`**：继承自 `WidgetComponent`，订阅 `UIEventDispatcher` 的语义化输入事件而非裸 DOM 事件——IME 合成被单独抽成 `compositionEnd`。
- **`WithDisposable(LitElement)` mixin**：`SlashMenu`/`InnerSlashMenu` 用 mixin 获得 `_disposables`/`disposables`，配 `AbortController.signal` 统一清理监听（`:70`/`:373`）。
- **`@state accessor` / `@property accessor`**：`_filteredItems`/`_position`/`_activeItem` 用 `@state accessor`（内部响应式），`items`/`context`/`menu`/`depth` 用 `@property({attribute:false}) accessor`（外部传入、非 HTML 属性）——标准装饰器 + accessor 关键字。
- **`literal`/`unsafeStatic` 注册 widget**：`literal\`${unsafeStatic(AFFINE_SLASH_MENU_WIDGET)}\``（`extensions.ts:22`）把运行时标签名安全注入静态模板。
- **`when`/`ifDefined`/`styleMap` 指令**：render 用 Lit 指令做条件渲染（组标题 `when(!searching)`）、可选属性（`subText=${ifDefined(description)}`）、动态样式（定位 `styleMap`）。

## 5. 设计 / 实现亮点

- **触发的廉价短路链**：`beforeInput` 极高频，判定链从最便宜到最贵——先 `data===null || isComposing` 再 `!includes('/')` 再 `waitForUpdate` 再 `endsWith('/')`，绝大多数按键在第二步就被挡掉，几乎零成本。
- **输入时序的两种对齐**：普通输入 `waitForUpdate`、合成结束直接处理、range 未就绪时订阅 `inlineRangeSync` 一次——把"DOM/光标何时就绪"这个异步难题用三种精确时机覆盖，是富文本交互的硬功夫。
- **匹配宽松、排序精确**：`isFuzzyMatch` 做召回（打字少也能命中）、`substringMatchScore` 做排序（连续子串优先）——两种算法分工，兼顾"搜得到"与"排得对"。
- **搜索即拍平层级**：无查询时保留分组与子菜单结构，一搜索就把前两层拍平、隐藏组标题——两种心智（浏览 vs 搜索）用同一数据两种呈现。
- **配置开放、骨架中立**：widget 只提供触发/过滤/导航/渲染骨架，菜单内容由各块包 `SlashMenuConfigExtension` 注入、运行时 `merge` + `when` 过滤——块的能力"长"在块包里，slash-menu 不需要认识任何具体块。
- **全局单菜单 + AbortController 贯穿**：模块级 `globalAbortController` 保证同时只有一个菜单，子菜单每层独立 controller 且随父 abort 级联——生命周期清晰、无悬挂监听。
- **清串在前、动作在后**：命中后先删 `/查询串`再 action 的顺序，规避了"动作改模型导致删除坐标错位"的隐蔽 bug——顺序即正确性。

## 6. 对外 API 与注意事项

- **主要导出**：`AFFINE_SLASH_MENU_WIDGET`、`AffineSlashMenuWidget`、`SlashMenuExtension`、`SlashMenuConfigExtension`/`SlashMenuConfigIdentifier`、`mergeSlashMenuConfigs`/`buildSlashMenuItems`、类型 `SlashMenuItem`/`SlashMenuConfig`/`SlashMenuContext`、`SlashMenuViewExtension`（`./view`）。
- **扩展方式**：给某块加斜杠项 → 实现一份 `SlashMenuConfig` 并 `SlashMenuConfigExtension('<id>', config).setup(di)`；项里用 `when(ctx)` 控制可见、`group` 控制分区排序、`disableWhen` 控制整体禁用。
- **注意**：
  - 仅注册在 `affine:page` scope，`_handleInput` 还硬校验宿主 `flavour === 'affine:page'`（`widget.ts:104`），非 root 环境会报错并跳过。
  - **移动端被 `SlashMenuViewExtension` 显式跳过**（`view.ts:19`），移动端的 `/` 走 keyboard-toolbar。
  - 触发只认"光标左侧文本 `endsWith('/')`"，粘贴进来的 `/`、非紧贴光标的 `/` 不会弹。
  - 菜单通过 `document.body.append` 挂载而非进文档树（源码注释标注为临时方案），定位靠 `getPopperPosition` + `window.resize` 重算。
  - 执行前的 `cleanSpecifiedTail` 依赖 `/` + 查询串完整存在；若中途结构被外部改动，清理可能不准。
  - 查询串以空格结尾即判 `no_result`（`:137`）——斜杠命令不支持含空格的查询。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`TextSelection`/`UIEventDispatcher`，见 `blocksuite-std.md`）、`@blocksuite/std/inline` + `@blocksuite/affine-rich-text`（inline 编辑器、`getInlineEditorByModel`/`cleanSpecifiedTail`/`insertContent`）。
- 协作：`@blocksuite/affine-shared`（`createKeydownObserver`/`getPopperPosition`/`isFuzzyMatch`/`substringMatchScore`）、`@blocksuite/affine-components`（`createLitPortal`/`icon-button`/`affine-tooltip`）、`@floating-ui/dom`（子菜单定位）。
- 配置来源：各块包各自的 `SlashMenuConfigExtension`（paragraph/list/database/embed…）。
- 对照阅读：`blocksuite-affine-widget-linked-doc.md`（同为输入触发型浮层，`@`/`[[` 唤起，共享"触发+过滤+Portal 定位"范式）、`blocksuite-affine-widget-keyboard-toolbar.md`（移动端 `/` 入口）、`blocksuite-affine-widget-drag-handle.md`（指针触发型 widget 对照）、`toeverything-infra.md`（DI 标识符与 `getAll`）。
