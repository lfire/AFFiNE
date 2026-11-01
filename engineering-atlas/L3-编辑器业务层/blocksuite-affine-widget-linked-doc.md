# `@blocksuite/affine-widget-linked-doc`

> 一句话定位：AFFiNE 编辑器里**敲 `@` 或 `[[` 唤起的"链接文档"弹层**——在富文本中输入触发键立即弹出一个浮层，边打字边模糊搜索工作区里已有的文档、或当场"创建一份新文档"、或从 Markdown/Notion/Obsidian/docx/pdf 等外部格式导入，选中后把一个**内联引用节点**插回当前光标处。它是挂在 root 上、监听 `beforeInput` 的输入触发型 widget，桌面端用 popover、移动端用贴键盘的底部菜单，并附带一整套文档导入转换器。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/linked-doc`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`ConfigExtensionFactory`/`requiredProperties`）、`@blocksuite/std/inline`（`InlineEditor`/`InlineRootElement`）、`@blocksuite/std/gfx`（`GfxControllerIdentifier` 视口）、`@blocksuite/affine-inline-reference`（`insertLinkedNode`）、`@blocksuite/affine-rich-text`（`cleanSpecifiedTail`/`getTextContentFromInlineRange`）、`@blocksuite/affine-shared`（`getRangeRects`/`getPopperPosition`/`createKeydownObserver`/`isFuzzyMatch`/`createDefaultDoc`/`FeatureFlagService`/`VirtualKeyboardProvider`）、`@blocksuite/affine-components`（`blocksuite-portal`/`icon-button`）、`zod`、`jszip`/`fflate`/`mammoth`/`js-yaml`（导入解析）、`lit`、`@preact/signals-core` |
| 被谁依赖  | 编辑器预设（通过 `LinkedDocViewExtension` 注册）；`@affine/core` 可传入 options 定制触发键/菜单                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 对外入口  | `.`（widget + config + 导入 transformers + `LinkedWidgetUtils`）、`./view`（`LinkedDocViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

linked-doc 遵循 `widgets/*` 范式（见 `blocksuite-affine-widget-drag-handle.md` §1）：`AffineLinkedDocWidget extends WidgetComponent<RootBlockModel>`（`src/widget.ts:37`）挂在 `affine:page`；`linkedDocWidget = WidgetViewExtension('affine:page', AFFINE_LINKED_DOC_WIDGET, literal\`…\`)`（`widget.ts:334`）注册；`LinkedDocViewExtension`（`src/view.ts`）在 `setup`里`context.register(linkedDocWidget)`、可选 `register(LinkedWidgetConfigExtension(options))`、`effect()`定义自定义元素。它和 slash-menu 是**近亲**——同为"输入某键 → 弹浮层 → 边打字边过滤 → 命中执行 → 先清查询串"的范式，共享`cleanSpecifiedTail`/`getPopperPosition`/`createKeydownObserver`/`isFuzzyMatch` 等 affine-shared 工具。

### linked-doc 独有的问题

它和 slash-menu 的差异恰是"重点"所在：

1. **多触发键 + 等价转换（独有之一）**：触发键不止一个——`['@', '[[', '【【']`（`widget.ts:223`）。`@` 是主键，`[[`/`【【`（中文方括号）是等价别名，输入后自动**转换成主键** `@`。这比 slash-menu 的单字符 `/` 复杂。
2. **输入遮罩（独有之二）**：弹层打开后，用户在原文里继续输入的"查询串"（触发键之后的字）要被一层**半透明遮罩** `input-mask` 盖住——视觉上提示"这段是搜索词、不是正文"，关闭后随 `cleanSpecifiedTail` 删除。这需要把 inline range 换算成屏幕矩形并随视口刷新。
3. **文档搜索（独有之三）**：查询串对工作区所有文档标题做 `isFuzzyMatch`，命中项显示文档图标（页面/白板两种），选中则 `insertLinkedNode` 插入引用。
4. **创建 / 导入（独有之四）**：搜不到就"创建 `"查询串"` doc"（`createDefaultDoc` 新建并引用）；桌面端还有"Import"项，拉起导入弹窗，支持 Markdown/Notion HTML/Obsidian/Bear/HTML/docx/pdf/zip 等格式——本包自带一整套 `transformers/`。
5. **桌面/移动双形态（独有之五）**：桌面端是跟随光标的 popover（`LinkedDocPopover`），移动端是贴在虚拟键盘上方的底部菜单（`AffineMobileLinkedDocMenu`），由 feature flag 决定。
6. **分组 + 溢出折叠（独有之六）**：菜单项按组（"Link to Doc" / "New Doc"）展示，每组有 `maxDisplay`，超出折叠成"N more docs"，组可异步 loading。

## 2. 目录与关键文件

```text
src/
├── index.ts                 # 导出 config / import-doc / transformers / widget
├── view.ts                  # ★LinkedDocViewExtension：zod options schema + 注册 widget/config
├── effects.ts               # customElements.define（widget + popover + mobile-menu + import 相关）
├── widget.ts                # ★AffineLinkedDocWidget：监听 beforeInput → 触发键匹配/转换 → show()；输入遮罩；桌面/移动分派
├── config.ts                # ★默认 config（triggerKeys/ignore*/getMenus）；createLinkedDocMenuGroup（搜索）/createNewDocMenuGroup（新建+导入）；LinkedWidgetConfigExtension
├── linked-doc-popover.ts    # ★LinkedDocPopover：桌面弹层——搜索/过滤/分组/键盘导航/定位
├── mobile-linked-doc-menu.ts# 移动端底部菜单（贴虚拟键盘）
├── styles.ts                # Shadow DOM 样式（popover / input-mask / mobile）
├── utils.ts                 # resolveSignal（signal 或裸值归一）
├── import-doc/              # 导入弹窗 UI（import-doc.ts / loader / styles）
└── transformers/            # ★各格式导入器：markdown / notion-html / obsidian / bear / html / docx / pdf / zip + import-batch
```

## 3. 实现细节

### 3.1 ★触发：多键匹配 + 等价转换

widget 在 `connectedCallback`（`widget.ts:237`）调 `_watchInput()`，只订阅 `beforeInput`（`widget.ts:124`）。判定链：

1. 已在显示中（`_mode$.peek() !== 'none'`）直接返回——避免重复弹。
2. 必须是折叠光标（`range.collapsed`）、容器未命中 `config.ignoreSelector`（白板各类标题编辑器，`widget.ts:143`）、块 flavour 不在 `ignoreBlockTypes`（如 `affine:code`，`:148`）、处于 inline 根内。
3. **主键匹配**：取光标前 `primaryTriggerKey.length`（`@` 为 1）个字符，等于 `@` 即命中。
4. **等价转换**（`convertTriggerKey`，`widget.ts:170`）：若不等于主键，遍历 `triggerKeys.slice(1)`（`[[`/`【【`）；命中则 `deleteText` 删掉别名、`insertText` 插入主键 `@`、重设光标——把 `[[` 就地改写成 `@`，再继续。
5. 命中后 `inlineEditor.waitForUpdate().then(() => this.show({...}))`，mode 取 `IS_MOBILE ? 'mobile' : 'desktop'`。

这套"主键 + 别名 → 统一转主键"让下游只需认 `@` 一种起点，`[[` 只是输入习惯的糖。

### 3.2 ★show：建立上下文 + 输入遮罩

`show`（`widget.ts:244`）是弹层生命周期的起点。若带 `addTriggerKey`（从菜单命令而非打字唤起），先 `_addTriggerKey` 手动插入 `@`、等 `inlineRangeSync` 同步后再递归 `show`。随后：

- 记下 `startRange`/`startNativeRange`（触发瞬间的 inline/原生 range，后续查询串与定位都以此为锚）；
- 订阅 `inlineEditor.slots.renderComplete` → `_updateInputRects()`（每次富文本重渲刷新遮罩矩形）；
- 构造 `_context: LinkedDocContext`（`widget.ts:293`），含 `std`/`inlineEditor`/`startRange`/`triggerKey`/`config`/`close`——`close` 负责退订、清遮罩、置 `_mode$='none'`、清 context；
- 按 feature flag `enable_mobile_linked_doc_menu` 决定 `_mode$` 为 `mobile` 还是强制 `desktop`。

**输入遮罩** `_updateInputRects`（`widget.ts:59`）：把"从触发键前 `startIndex` 到当前光标"这段 inline range 用 `inlineEditor.toDomRange` 转 DOM Range，再 `getRangeRects(range, viewportElement)` 得到一组 `SelectionRect`，存进 `_inputRects$`（signal）。render 时 `_renderInputMask`（`:102`）用 `repeat` 把每个矩形画成一个 `.input-mask` 半透明块盖在查询串上；最后一个若光标在行尾则额外加宽 10px。`_watchViewportChange`（`:212`）订阅 `gfx.viewport.viewportUpdated` 在白板缩放/平移时重算遮罩位置。

### 3.3 ★render：Portal + choose 分派桌面/移动

`render`（`widget.ts:316`）：`_mode$==='none'` 返回 `nothing`；否则先渲输入遮罩，再用 `blocksuite-portal`（`shadowDom: false`）把菜单渲到文档流外，`choose(_mode$.value, [['desktop', popover], ['mobile', menu]])`（`:322`）按模式选渲 `affine-linked-doc-popover` 或 `affine-mobile-linked-doc-menu`，两者都接 `_context`。Portal 让浮层脱离 widget 的层叠上下文，避免被裁剪。

### 3.4 ★桌面弹层：搜索 / 过滤 / 分组 / 导航

`LinkedDocPopover`（`linked-doc-popover.ts:30`，`SignalWatcher(WithDisposable(LitElement))`）是桌面核心：

- **查询串**：`_query`（`:121`）= `getTextContentFromInlineRange(inlineEditor, startRange)`，即 `@` 之后用户打的字。
- **拉菜单**：`_updateLinkedDocGroup`（`:50`）在查询变化时调 `context.config.getMenus(query, abort, host, inlineEditor, signal)` 得到 `LinkedMenuGroup[]`；查询以空格开头即 `close`。每次拉取用独立 `AbortController` 取消上一次（异步搜索可能乱序返回）。
- **默认 getMenus**（`config.ts:209`）返回两组：`createLinkedDocMenuGroup`（`:75`）过滤 `workspace.meta.docMetas`（排除当前文档、`isFuzzyMatch(title, query)`），每项图标按 `DocModeProvider.getPrimaryMode` 选页面/白板图标，`action` 调 `insertLinkedNode` 插引用并上报 telemetry，`maxDisplay: 6` + `overflowText: "N more docs"`；`createNewDocMenuGroup`（`:119`）给"Create 查询串 doc"（`createDefaultDoc` 新建后引用）和桌面端"Import"（拉 `showImportModal`）。
- **分组渲染 + 折叠**：`_getActionItems`（`:128`）对超 `maxDisplay` 的组截断并追加一个"more"项（点开 `_expanded.set(name, true)` 展开）；render（`:257`）按组画 `.group-title`（含 loading 图标）+ 分隔线，loading/hidden 组用 `resolveSignal` 解包 signal 后过滤。
- **键盘导航**：`createKeydownObserver`（`:180`）——`onMove(step)` 在 `_flattenActionList`（跨组拍平）上环形移动 `_activatedItemKey`、`scrollToFocusedItem` 滚动可见；`onConfirm` 执行当前项 `action`；`Escape`/`onAbort` 关闭；`ArrowLeft/Right` 拦掉（留给光标）。`_updateAutoFocusedItem`（`:82`）支持 config 自定义默认高亮项、否则高亮首项。
- **定位**：`willUpdate`（`:347`）首帧用 `getPopperPosition(this, startNativeRange)`（宽度兜底 280px）定位，监听 `window.resize`/scrollContainer `scroll`/`gfx.viewport.viewportUpdated` 用 `throttle(fn,10)` 重算。render 写 `transform: translate(x,y)` + `maxHeight: min(height, 390)`。

### 3.5 ★动作执行：先清查询串

和 slash-menu 一致，执行前必须清掉 `触发键 + 查询串`。`_abort`（`linked-doc-popover.ts:35`）：`context.close()` 移除弹层 + `cleanSpecifiedTail(std, inlineEditor, triggerKey + (query||''))` 删掉 `@foo`。各 `action` 内先调传入的 `abort`（即 `_abort`）清串，再 `insertLinkedNode({ inlineEditor, docId })` 插入内联引用节点——由 `@blocksuite/affine-inline-reference` 提供，引用在文档删/改名时自动跟随。

### 3.6 ★移动端菜单

`AffineMobileLinkedDocMenu`（`mobile-linked-doc-menu.ts:29`）结构类似但贴底：用 `VirtualKeyboardProvider` 感知虚拟键盘、`config.mobile.scrollContainer`/`scrollTopOffset` 控制滚动，菜单项横向排布、同样支持分组 `maxDisplay` 折叠。它由 feature flag `enable_mobile_linked_doc_menu` 启用，未启用则移动端也回落到 desktop popover（`widget.ts:310`）。

### 3.7 ★文档导入：transformers 家族

"Import"项拉起 `showImportModal`（`import-doc/`），背后是 `transformers/` 一组格式转换器（`transformers/index.ts` 导出）：`MarkdownTransformer`、`NotionHtmlTransformer`、`ObsidianTransformer`、`BearTransformer`、`HtmlTransformer`、`DocxTransformer`（基于 `mammoth`）、`PdfTransformer`、`ZipTransformer`（基于 `jszip`/`fflate`）。它们把外部文件解析成 BlockSuite 快照，经 `import-batch.ts` 的 `commitImportBatchToWorkspace` 批量落库，成功后对每个新文档 `insertLinkedNode` 插引用并 toast 提示（`config.ts:169`）。这使 `@` 菜单不仅能链接已有文档，还是**外部内容进入 AFFINE 的入口之一**。

### 3.8 ★config 可注入 + zod 校验

默认 config 在 `widget.ts:221` 的 getter 里给出（触发键、忽略规则、`getMenus`、移动端滚动），末尾 `...this.std.getOptional(LinkedWidgetConfigExtension.identifier)` 允许业务层**部分覆盖**。`LinkedWidgetConfigExtension` 由 `ConfigExtensionFactory('affine:widget-linked-doc')` 生成（`config.ts:228`）。`LinkedDocViewExtension` 用 `zod` schema（`view.ts:13`）在注册时**运行时校验** options——触发键必须是非空 tuple、`getMenus`/`autoFocusedItemKey` 的函数签名都用 `z.function().args(...).returns(...)` 描述，弥补类型擦除后的运行时缺口。

## 4. 语法特色

- **`WidgetComponent<RootBlockModel>` 泛型**：绑定宿主为 root（`widget.ts:37`），`this.block.rootComponent` 供移动端菜单定位。
- **多触发键 tuple 类型**：zod `z.tuple([z.string()]).rest(z.string())`（`view.ts:14`）在类型与运行时都约束"至少一个主键 + 任意别名"。
- **`choose` 指令分派形态**：render 用 Lit `choose(_mode$.value, [...])`（`widget.ts:322`）按桌面/移动选模板——比三元嵌套清晰。
- **signal 或裸值归一 `resolveSignal`**：`LinkedMenuGroup` 的 `items`/`loading`/`hidden`/`overflowText` 都是 `T | Signal<T>`，`resolveSignal`（`utils.ts:3`）用 `data instanceof Signal ? data.value : data` 统一解包——让菜单项既可静态也可异步响应式。
- **`SignalWatcher(WithDisposable(LitElement))` 双 mixin**：popover/mobile 菜单叠加"自动追踪 signal 重渲"与"统一清理"两种能力。
- **`@requiredProperties({ context: PropTypes.object })`**：std 的装饰器声明必填属性，缺失即报错（`linked-doc-popover.ts:27`）。
- **`effect` 重绑定模式**：`_updateLinkedDocGroup` 每次换组后先 `_menusItemsEffectCleanup()` 再新建 `effect`（`linked-doc-popover.ts:72`）——因为被追踪的 `_linkedDocGroup` 引用变了，必须重建 effect 依赖。
- **`AbortController` 做异步搜索去抖**：每次拉菜单先 abort 上一个 controller（`:52`），传进 `getMenus` 的 signal 让慢请求可被取消——防止旧结果覆盖新结果。
- **`CSS.escape` 防选择器注入**：`scrollToFocusedItem` 用 `CSS.escape(_activatedItemKey)`（`:399`）转义 doc id 再做 `querySelector`。
- **zod `.function().args().returns()` 描述回调**：在运行时校验注入的 `getMenus`/`autoFocusedItemKey` 的参数与返回（`view.ts:18`）。

## 5. 设计 / 实现亮点

- **主键 + 别名的就地转换**：`[[`/`【【` 输入后被 `deleteText`+`insertText` 改写成 `@`，下游只认一种起点——把"多种输入习惯"收敛成"一种内部表示"，是很干净的归一。
- **输入遮罩**：把查询串用半透明矩形盖住，视觉区分"搜索词 vs 正文"，且矩形随 inline range + 视口实时换算刷新——这是 slash-menu 没有、linked-doc 独有的体验细节。
- **与 slash-menu 共享范式、各自特化**：触发检测、`cleanSpecifiedTail` 清串、`getPopperPosition` 定位、`createKeydownObserver` 导航、`isFuzzyMatch` 匹配全复用 affine-shared——两个浮层 widget 共用一套"输入触发浮层"地基，只在"菜单内容"上分化。
- **菜单内容异步 + 响应式**：`LinkedMenuGroup.items` 可为 `Signal`、组可 `loading`——支持"先弹壳、搜索结果异步填充"，`resolveSignal` + `SignalWatcher` 让 UI 自动跟随。
- **链接即创建即导入**：同一个 `@` 入口统一了"引用已有文档""新建文档""导入外部文件"三件事——降低心智负担，且导入器家族让外部内容无缝进库。
- **config 可注入 + zod 运行时校验**：触发键、菜单生成、移动端行为全可被业务层覆盖，注入值经 zod 校验——扩展性与健壮性兼得。
- **异步搜索的正确性**：AbortController 取消过期请求 + effect 重绑定，解决"快速打字时慢请求乱序返回覆盖新结果"的经典竞态。

## 6. 对外 API 与注意事项

- **主要导出**：`AffineLinkedDocWidget`、`AFFINE_LINKED_DOC_WIDGET`、`linkedDocWidget`、`LinkedWidgetConfig`/`LinkedMenuItem`/`LinkedMenuGroup`/`LinkedDocContext` 类型、`LinkedWidgetConfigExtension`、`LinkedWidgetUtils`（`createNewDocMenuGroup`/`insertLinkedNode`）、全部 `transformers`（Markdown/Notion/Obsidian/docx/pdf/zip…）、`LinkedDocViewExtension`（`./view`）。
- **扩展方式**：传 options 给 `LinkedDocViewExtension`（经 zod 校验）或注册 `LinkedWidgetConfigExtension(partial)` 覆盖 `triggerKeys`/`ignoreBlockTypes`/`ignoreSelector`/`getMenus`/`autoFocusedItemKey`/`mobile`。自定义 `getMenus` 可返回任意分组与异步 items。
- **注意**：
  - 触发只认"光标前紧邻触发键"，且折叠光标、非 code 块、非白板标题编辑器内；别名转换依赖 `convertTriggerKey`（默认开）。
  - 执行前 `cleanSpecifiedTail` 依赖 `触发键 + 查询串`完整；查询以空格开头立即关闭（不支持空格开头的查询）。
  - 移动端菜单需 feature flag `enable_mobile_linked_doc_menu`，否则回落 desktop popover。
  - 弹层经 `blocksuite-portal` 挂到文档流外，定位靠 `getPopperPosition` + 多源重算（resize/scroll/viewport）。
  - 导入依赖较重的第三方库（`jszip`/`mammoth`/`fflate`），仅桌面端提供 Import 项（`IS_MOBILE` 时不加，`config.ts:162`）。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`ConfigExtensionFactory`）、`@blocksuite/std/inline`（inline range 与 DOM range 互转）、`@blocksuite/affine-inline-reference`（`insertLinkedNode` 内联引用节点）。
- 共享工具：`@blocksuite/affine-shared`（`getRangeRects`/`getPopperPosition`/`createKeydownObserver`/`isFuzzyMatch`/`createDefaultDoc`/`FeatureFlagService`/`VirtualKeyboardProvider`）、`@blocksuite/affine-rich-text`（`cleanSpecifiedTail`/`getTextContentFromInlineRange`）。
- 导入链：`transformers/*` + `import-doc/` + `@blocksuite/affine-ext-loader`（`StoreExtensionManagerIdentifier` 取 store 扩展做快照落库）。
- 对照阅读：`blocksuite-affine-widget-slash-menu.md`（同范式的 `/` 浮层，强烈建议对比"触发/清串/导航/定位"的共用与分化）、`blocksuite-affine-widget-keyboard-toolbar.md`（移动端另一套贴键盘工具）、`toeverything-infra.md`（signal/DI 基础）。
