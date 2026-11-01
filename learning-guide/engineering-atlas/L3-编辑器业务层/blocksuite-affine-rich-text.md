# `@blocksuite/affine-rich-text`

> 一句话定位：AFFiNE 的**富文本/行内编辑基础层**——核心是一个名为 `<rich-text>` 的 Lit 自定义元素，它把一段 `Y.Text`（或 store 的 `Text`）绑定到底层 `InlineEditor`（来自 `@blocksuite/std/inline`），负责行内编辑器的创建、yText 双向绑定、undo/redo、剪贴板、Markdown 快捷转换与自动滚动，并提供一组操作行内编辑器的 DOM 工具函数及文本块转换配置。

| 项        | 值                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/rich-text`                                                                                                                                 |
| 所属层    | L3 · 编辑器业务层（基座）                                                                                                                                     |
| 语言/形态 | TypeScript 库（Lit 组件 + 工具）                                                                                                                              |
| 关键依赖  | `@blocksuite/std`（`ShadowlessElement`/`InlineEditor`）、`@blocksuite/affine-shared`、`@blocksuite/affine-model`、`@preact/signals-core`、`lit`、`yjs`、`zod` |
| 被谁依赖  | `@blocksuite/affine-foundation`（`richTextEffects`）、所有含文本的块（paragraph/list/code/…）                                                                 |
| 对外入口  | `.`（`RichText` 组件 + dom/utils/conversion/align 工具）、`./effects`（注册 `<rich-text>`）                                                                   |

## 1. 设计逻辑

行内富文本是编辑器最高频、最易出 bug 的地方：光标、IME 组合输入、撤销重做、剪贴板、链接自动识别、Markdown 即时转换……这些逻辑与具体块无关，但每个文本块（段落、列表、代码、标题）都要用。若每个块各写一遍，维护成本和一致性都是灾难。

`affine-rich-text` 的立场是：**把"把一段 yText 变成可编辑富文本"这件事封装成一个可复用的 Web Component**。

- 底层的光标/增量渲染/IME 由 `@blocksuite/std/inline` 的 `InlineEditor` 负责（更底层、通用）；
- 本包的 `<rich-text>` 是**面向 AFFiNE 业务的适配壳**：它接收业务约定的 `AffineTextAttributes`（bold/link/reference/latex/footnote…），接上 AFFiNE 的 Markdown 规则、链接识别 hook、属性续承 hook，并处理与 Yjs `UndoManager` 的协作。

块只需在模板里写 `<rich-text .yText=${model.text.yText}>` 并传若干配置属性，就得到一个完整的行内编辑器。其余 DOM 工具（`getInlineEditorByModel`、`focusTextModel` 等）让命令层能方便地定位和操作这些编辑器。

## 2. 目录与关键文件

```text
src/
├── index.ts         # 导出 RichText、dom 工具、conversion/align 配置、utils
├── rich-text.ts     # ★ RichText：<rich-text> Lit 组件（480 行，本包核心）
├── dom.ts           # 定位/操作行内编辑器的工具：getInlineEditorByModel / focusTextModel / selectTextModel ...
├── hooks.ts         # InlineEditor 的 beforeinput/compositionEnd 钩子：链接自动识别 + 属性续承
├── conversion.ts    # textConversionConfigs：文本块类型转换表（slash 菜单/快捷键用）
├── align.ts         # textAlignConfigs：左/中/右对齐配置
├── utils.ts         # insertContent / clearMarksOnDiscontinuousInput / getPrefixText
└── effects.ts       # effects()：customElements.define('rich-text', RichText)
```

## 3. 实现细节

### 3.1 RichText 组件：yText → InlineEditor 的绑定壳

`RichText extends WithDisposable(ShadowlessElement)`（`rich-text.ts:31`）——用 `ShadowlessElement`（无 Shadow DOM，样式可被编辑器统一控制）、`WithDisposable`（自动清理订阅）。它的属性全部用 Lit 的 `@property({ attribute: false }) accessor` 声明（`:423-479`），包括 `yText`、`attributesSchema`、`attributeRenderer`、`markdownMatches`、`readonly`、`undoManager`、`embedChecker` 等。

`yText` 可以是 `Y.Text` 或 store 的 `Text`，组件内部用 getter 归一（`:144-146`）：

```ts
private get _yText() {
  return this.yText instanceof Text ? this.yText.yText : this.yText;
}
```

`_init()`（`:157-316`）是创建行内编辑器的核心——用 `signal` 持有实例，接入 hooks / provider / renderer：

```ts
this._inlineEditor$.value = new InlineEditor<AffineTextAttributes>(
  this._yText,
  {
    isEmbed: delta => this.embedChecker(delta),
    hooks: { beforeinput: onVBeforeinput, compositionEnd: onVCompositionEnd },
    inlineRangeProvider: this.inlineRangeProvider,
    vLineRenderer: this.vLineRenderer,
  }
);
```

### 3.2 连接期编排：校验、UndoManager、剪贴板、挂载

`connectedCallback()`（`:325-386`）按序完成装配：

1. 防御式校验：`_yText` 必须存在且已绑定 `doc`，否则 `console.error` 退出（`:328-335`）——yText 必须先挂到 YDoc 才能协同与撤销。
2. 若未外部注入 `undoManager`，就自建一个，`trackedOrigins` 设为本 doc 的 `clientID`（`:337-341`），保证只撤销本客户端的操作。
3. 按 `enableUndoRedo`/`enableClipboard` 开关绑定键盘与剪贴板事件。
4. 等 `updateComplete` 后先 `_unmount()` 再 `_init()`，并把卸载登记进 disposables。

### 3.3 yText 与行内编辑器的"随数据重建"

`updated()`（`:408-418`）监听：一旦 `this._yText !== inlineEditor.yText`（yText 被换成另一段文本），就卸载重建；`readonly` 变更则调 `inlineEditor.setReadonly`。这保证组件复用时（如列表项重排）编辑器与数据始终一致，是 Lit "属性驱动"思路的典型落地。

### 3.4 Undo/Redo 与光标恢复

富文本自管撤销时还要**恢复光标位置**。组件用 UndoManager 的 stack 事件把当时的 `InlineRange` 存进 stackItem 的 meta（`:126-142`）：

```ts
private readonly _onStackItemAdded = (event) => {
  const inlineRange = this.inlineEditor?.getInlineRange();
  if (inlineRange) event.stackItem.meta.set('richtext-v-range', inlineRange);
};
private readonly _onStackItemPopped = (event) => {
  const inlineRange = event.stackItem.meta.get('richtext-v-range');
  if (inlineRange && this.inlineEditor?.isValidInlineRange(inlineRange))
    this.inlineEditor?.setInlineRange(inlineRange);
};
```

撤销/重做后光标回到操作前的位置，而非跳到文首——细节决定体验。

### 3.5 Markdown 即时转换

`_init()` 里若传了 `markdownMatches`，会订阅行内编辑器的 `inputting`（输入空格且非 IME 组合态时）与 `keydown`（回车时）两个 slot（`:229-245`），用 `getPrefixText` 取当前行光标前文本去匹配规则，命中就执行 `action`。`getPrefixText`（`utils.ts:56-70`）只取光标所在行、且限长 512 字符的前缀，避免长文档里全量扫描。

### 3.6 hooks：链接识别与属性续承

`hooks.ts` 提供两个传给 InlineEditor 的钩子：

- `autoIdentifyLink`（`:12-59`）：仅在输入空格时触发，用 `isStrictUrl` 判断光标前最后一个词是否是 URL，是则 `formatText` 加 `link` 属性；若已在链接尾部再敲空格则移除链接属性（避免链接无限延伸）。
- `handleExtendedAttributes`（`:61-103`）：解决"在加粗文本中间/末尾继续输入应继承加粗"的问题。它检查光标处的 delta，复制其 attributes 给新输入的字符；并用 `EDGE_IGNORED_ATTRIBUTES = ['code','link']`（`:9`）在"末尾续写"场景剔除 code/link——这两种格式不应随续写扩散。

### 3.7 dom 工具：命令层的抓手

`dom.ts` 是上层命令定位编辑器的入口。`getInlineEditorByModel`（`:32-46`）从 model 找到块组件里的 `<rich-text>` 再取其 `inlineEditor`，并显式排除 `DatabaseBlockModel`（数据库块含多个行内编辑器，不能这样取）。`focusTextModel`/`selectTextModel`（`:66-88`）通过 std 的 selection 机制创建 `TextSelection` 来聚焦；`asyncGetRichText`/`onModelTextUpdated` 处理"组件尚未渲染完"的异步时序。

### 3.8 conversion/align：数据化的转换表

`textConversionConfigs`（`conversion.ts:33-155`）把"文本块可转换成的类型"列成数据：每项含 `flavour`、`type`、`name`、`hotkey`、`icon`，覆盖段落/H1-H6/三种列表/代码/公式/引用/callout/分隔线。slash 菜单、格式栏、快捷键注册都读这张表，而非各自硬编码。`align.ts` 同理提供三种对齐配置。

## 4. 语法特色

- **Lit 自动访问器属性**：`@property({ attribute: false }) accessor yText!: Y.Text | Text`（`rich-text.ts:478-479`）用 Stage-3 装饰器 + `accessor`，`attribute: false` 表示该属性只能用 property 绑定（`.yText=${}`）而非 HTML 属性——因为值是对象。
- **mixin 组合基类**：`WithDisposable(ShadowlessElement)`（`:31`）把"可销毁"能力混入宿主元素，`this.disposables.addFromEvent(...)` 自动在断开时清理。
- **Signal 持有可空实例**：`_inlineEditor$ = signal<AffineInlineEditor | null>(null)`（`:63`），用 `@preact/signals-core` 让 `inlineEditor` 的变化可被 `effect` 追踪（自动滚动逻辑 `:248-309` 就跑在 `effect` 里）。
- **泛型实例化**：`new InlineEditor<AffineTextAttributes>(...)`（`:168`）把 AFFiNE 的文本属性类型注入通用编辑器，使 `formatText`/delta 全程类型安全。
- **`instanceof` 归一联合类型**：`_yText` getter 用 `this.yText instanceof Text` 区分 store `Text` 与裸 `Y.Text`（`:144-146`）。
- **全局类型声明合并**：`effects.ts:7-11` 用 `declare global { interface HTMLElementTagNameMap { 'rich-text': RichText } }` 让 `document.querySelector('rich-text')` 得到正确类型。
- **闭包式一次性订阅**：`clearMarksOnDiscontinuousInput`（`utils.ts:37-54`）在 `effect` 回调里判断条件后调用自身的 `dispose()` 退订——自解除订阅模式。

## 5. 设计 / 实现亮点

- **"一段 yText = 一个组件"的清晰契约**：把行内编辑复杂度封进 `<rich-text>`，块只管传数据和配置，彻底消除各块重复实现行内编辑器的历史包袱。
- **属性驱动的重建**：`updated()` 比较 yText 引用变化即重建编辑器，与 Lit 声明式渲染天然契合，复用组件时不会出现"编辑器指向旧数据"的脏状态。
- **撤销栈携带光标**：把 `InlineRange` 存进 UndoManager 的 stackItem meta，优雅解决协同撤销下的光标恢复，是容易被忽视却极影响体验的细节。
- **输入行为数据化**：Markdown 规则、链接识别、属性续承都做成可配置 hook/规则，`EDGE_IGNORED_ATTRIBUTES` 这类业务常识被显式表达而非埋在分支里。
- **转换/对齐表数据化**：`textConversionConfigs`/`textAlignConfigs` 让 UI（菜单/工具栏/快捷键）与行为解耦，新增一种文本类型只改表。
- **性能细节**：`getPrefixText` 限定行内 + 512 字符窗口，`clearMarksOnDiscontinuousInput` 用 signal effect 精准触发，避免长文档的全量扫描与多余计算。

## 6. 对外 API 与注意事项

- 主要导出：`RichText` 组件；dom 工具 `getInlineEditorByModel` / `getRichTextByModel` / `asyncGetRichText` / `focusTextModel` / `selectTextModel` / `asyncSetInlineRange` / `onModelTextUpdated` / `cleanSpecifiedTail` / `getTextContentFromInlineRange`；`textConversionConfigs` / `TextConversionConfig`；`textAlignConfigs` / `TextAlignConfig`；utils（`insertContent` 等）。
- **约定**：使用前应用必须调用 `./effects` 的 `effects()`（经 `affine-foundation` 的 `richTextEffects`）注册 `<rich-text>`；传入的 `yText` 必须已绑定到某个 YDoc。
- **注意**：`getInlineEditorByModel` 对 `DatabaseBlockModel` 返回 null（数据库块有多个行内编辑器）；`enableFormat=false` 时 `attributesSchema` 会被强制改成 `z.object({})`（禁用所有格式）；组件默认 `enableUndoRedo`/`enableClipboard` 为 true 并会阻止相关事件冒泡，嵌套使用时注意事件边界；若不外部传 `undoManager`，组件会自建一个只跟踪本客户端 origin 的实例。

## 7. 延伸

- 底层：`@blocksuite/std/inline` 的 `InlineEditor`/`InlineRange`/`InlineMarkdownMatch`（真正的光标与增量渲染引擎）。
- 类型来源：`@blocksuite/affine-shared/types` 的 `AffineInlineEditor`/`AffineTextAttributes`，`@blocksuite/affine-model` 的 `TextAlign`、块 flavour。
- 使用方：`@blocksuite/affine-foundation`（`effects` 装配）、各文本块包（在其组件模板中实例化 `<rich-text>`）。
