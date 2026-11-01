# `@blocksuite/affine-block-paragraph`

> 一句话定位：AFFiNE 最常见、最基础的**文本块**——用一个 `type` 字段统一承载正文（`text`）、六级标题（`h1`–`h6`）与引用（`quote`）。它独有的核心是**"一个块八种形态"的类型驱动渲染**、**标题折叠（collapsed）与"折叠兄弟"（collapsed siblings）的推导**、**占位符（placeholder）的时机控制**，以及作为"富文本默认落点块"所承担的最完整的键盘/markdown/缩进交互。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/paragraph`                                                                                                                                                                                                                                                                                                                                                                                                                |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 关键依赖  | `@blocksuite/std`（`BlockComponent`/`KeymapExtension`/`TextSelection`/inline）、`@blocksuite/affine-model`（`ParagraphBlockModel`）、`@blocksuite/affine-components`（caption/toggle-button/icons）、`@blocksuite/affine-rich-text`（`rich-text`/`focusTextModel`）、`@blocksuite/affine-inline-preset`（`DefaultInlineManagerExtension`/`textKeymap`）、`@blocksuite/affine-gfx-turbo-renderer`（白板文字快照渲染）、`@preact/signals-core`、`lit` |
| 被谁依赖  | 编辑器预设、`@affine/core`、几乎所有需要默认文本块的场景                                                                                                                                                                                                                                                                                                                                                                                            |
| 对外入口  | `.`、`./store`、`./view`、`./turbo-painter`                                                                                                                                                                                                                                                                                                                                                                                                         |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | paragraph 实现                                                                                                                             | 对比 code / divider                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| schema/model                      | 复用 `affine-model` 的 `ParagraphBlockSchema`/`ParagraphBlockModel`（props：`type`/`text`/`textAlign`/`collapsed`/`comments`+`BlockMeta`） | 比 divider 多 `type`/`collapsed`；`ParagraphBlockModel.isEmpty()` 有自定义实现 |
| `*-block.ts`                      | `paragraph-block.ts` → `ParagraphBlockComponent`（rich-text + 标题图标 + 折叠按钮 + 占位符）                                               | 比 divider 多可编辑文本与标题逻辑                                              |
| service                           | **无独立 service**（靠共享的 `DefaultInlineManagerExtension`）                                                                             | 不像 code 有 `CodeBlockHighlighter`                                            |
| inline                            | 复用 `DefaultInlineManagerExtension`（全功能内联：bold/italic/link/latex/reference…），**启用 markdown 快捷输入**                          | code 用自建 `affine-code-unit` 且 `enableMarkdown:false`                       |
| keymap                            | `paragraph-keymap.ts` → `ParagraphKeymapExtension`（Enter/Backspace/Tab/Mod-Enter…）+ `ParagraphTextKeymapExtension`（共享 `textKeymap`）  | code 的键盘偏代码缩进；divider 无 keymap                                       |
| commands                          | `commands/`：`addParagraph`/`splitParagraph`/`indent`/`dedent`/`append`（被 keymap 与外部复用）                                            | divider 无 commands                                                            |
| widgets                           | 无自带工具栏，`renderBlock` 里 `repeat(this.widgets)` 挂载外部注入的 widget                                                                | —                                                                              |
| markdown（快捷输入）              | `markdown.ts` → `ParagraphMarkdownExtension`（`#`×1-6 / `>` + 空格）                                                                       | divider 是 `---`                                                               |
| adapters（序列化）                | `adapters/`：markdown（paragraph/heading/blockquote）、html、plain-text、notion-html                                                       | 比 divider 复杂，要处理文本 delta                                              |
| turbo                             | `turbo/paragraph-layout-handler.ts` + `paragraph-painter.worker.ts`（白板缩小时用 canvas 画文字快照）                                      | divider/code 无需                                                              |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define` + `ParagraphViewExtension`/`ParagraphStoreExtension`                                                               | 结构一致                                                                       |

### 段落块的独有问题

1. **一块多形态**：正文、六级标题、引用共用同一个 flavour `affine:paragraph`，仅靠 `type` 字段区分——好处是类型互转只改一个字段（无需删建块、保留 `text` 与 children），代价是渲染/键盘/样式都要按 `type` 分支。
2. **标题折叠**：`h1`–`h6` 可折叠，折叠时要隐藏其"从属"的后续兄弟块（层级更低的标题及正文），这组兄弟称为 **collapsed siblings**，需实时推导、且只读态要有独立的本地折叠状态。
3. **占位符时机**：空段落聚焦时显示 `Type '/' for commands` 之类提示，但在合成输入（IME）、只读、非折叠光标、数据库内等场景要抑制——占位符的显隐是一组精细的信号联动。
4. **默认文本块的全套交互**：它是用户最常落光标的块，承担最完整的 Enter 拆分/Backspace 合并或降级/Tab 缩进/Mod-Enter 等键盘语义，并成为其它块（list、callout）转换的目标。

## 2. 目录与关键文件

```text
src/
├── paragraph-block.ts        # ★ParagraphBlockComponent：类型驱动渲染/折叠/占位符
├── paragraph-keymap.ts       # ★键盘：Enter/Backspace/Tab/Shift-Tab/Mod-Enter/Delete
├── paragraph-block-config.ts # ParagraphBlockConfigExtension：getPlaceholder 注入
├── heading-icon.ts           # <affine-paragraph-heading-icon>：标题左侧级别图标
├── markdown.ts               # ★ParagraphMarkdownExtension：# / > + 空格 → 改 type
├── styles.ts                 # 各 type 的排版样式（h1-h6/quote/text）
├── commands/                 # add / split / indent / dedent / append 段落命令
├── utils/                    # forward-delete（向后删除）/ merge-with-prev（向前合并）
├── adapters/                 # markdown/html/plain-text/notion-html 双向序列化
├── turbo/                    # 白板低缩放时的文字快照：layout-handler + painter worker
├── view.ts store.ts effects.ts index.ts
```

## 3. 实现细节

### 3.1 model：type 驱动的最小 schema

`ParagraphBlockModel`（`model/src/blocks/paragraph/paragraph-model.ts`）的 props 以 `type: ParagraphType` 为核心，默认 `'text'`，可取 `'quote'|'h1'..'h6'`：

```ts
export type ParagraphType =
  'text' | 'quote' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
export const ParagraphBlockSchema = defineBlockSchema({
  flavour: 'affine:paragraph',
  props: (internal): ParagraphProps => ({
    type: 'text',
    text: internal.Text(),
    textAlign: undefined,
    collapsed: false,
    comments: undefined /* …BlockMeta 时间戳… */,
  }),
  metadata: {
    version: 1,
    role: 'content',
    parent: [
      'affine:note',
      'affine:database',
      'affine:paragraph',
      'affine:list',
      'affine:edgeless-text',
      'affine:callout',
      'affine:transcription',
    ],
  },
  toModel: () => new ParagraphBlockModel(),
});
export class ParagraphBlockModel extends BlockModel<ParagraphProps> {
  override isEmpty(): boolean {
    return this.props.text$.value.length === 0 && this.children.length === 0;
  }
}
```

- `parent` 白名单直接声明了"段落能落在哪些容器里"——note、database、list、callout 等；它反向表达了文档的嵌套结构。
- 与 divider 的空类不同，这里 `override isEmpty()`：文本为空且无子块才算空——很多交互（如 Backspace 合并、占位符显示）依赖这一语义。
- `textAlign`、`collapsed`、`comments` 都是可选能力：对齐、标题折叠、评论高亮。

### 3.2 ★类型驱动渲染：一个 `renderBlock` 覆盖八种形态

`ParagraphBlockComponent.renderBlock()`（`paragraph-block.ts:253-396`）始终渲染一个 `<rich-text>`，但围绕它按 `type$` 做大量条件装配：

- **wrapper 带类名** `[type$.value]: true`（`:318-322`）——把 `h1`/`quote`/`text` 作为 CSS 类加到富文本外层，样式差异（字号、行高、引用左边线）全靠 `styles.ts` 的类选择器实现，而非 JS 计算。
- **标题图标**：`type.startsWith('h')` 时插入 `<affine-paragraph-heading-icon>`（`:324-332`），由独立自定义元素 `ParagraphHeadingIcon`（`heading-icon.ts`）按级别渲染 `Heading1Icon`..`Heading6Icon`。
- **折叠按钮**：标题且存在 collapsed siblings 时插入 `<blocksuite-toggle-button>`（`:333-360`），`updateCollapsed` 回调在可编辑态走 `store.updateBlock(model,{collapsed})`、只读态走本地 `_setReadonlyCollapsed`。
- **rich-text 配置**（`:361-375`）：绑 `model.props.text.yText`、共享 inline schema/renderer、`.enableClipboard=false`/`.enableUndoRedo=false`（统一交给块/store 管），`inlineEventSource` 指向 `topContenteditableElement`（页面模式是 root、白板模式是最近的 edgeless 可编辑容器）。
- **占位符**：非白板文字内时渲染一个 `contenteditable="false"` 的占位层（`:376-390`），`visible` 由 `_displayPlaceholder` 信号控制。

### 3.3 ★标题折叠与 collapsed siblings

折叠语义是段落块最复杂的部分，分散在多个 `effect`：

- **collapsed siblings 推导**：`get collapsedSiblings()` 调 `calculateCollapsedSiblings(this.model)`（共享 util）——从本标题往后收集所有"层级更低"的块，直到遇到同级或更高级标题。渲染时为它们注入 `display:none !important` 的 `<style>`（`:267-282`），这种"用动态样式隐藏兄弟"的做法避免了改动文档树。
- **只读双路径**：可编辑态折叠状态存 `model.props.collapsed`；只读态改存本地信号 `_readonlyCollapsed`（`:193-199`），因为只读文档不该写模型。渲染与选区清理都用 `this.store.readonly ? this._readonlyCollapsed.value : collapsed$`（`:261-263`）。
- **三条一致性 effect**：① 非标题却带 `collapsed` 时自动复位为 `false`（`:184-191`）；② 折叠标题时清掉落在被折叠兄弟里的文本选区（`:201-221`）；③ 当某块从标题变回正文（`beforeType !== type`），把它前面最近的折叠标题展开（`:227-244`）——这些都是"折叠状态不能出现逻辑矛盾"的守卫。
- **折叠态回车**：`paragraph-keymap.ts:152-170` 里，折叠标题上回车会把新块插到 `index + collapsedSiblings.length + 1`——即跳过整段被折叠内容之后，符合直觉。

### 3.4 ★占位符的时机控制

`_displayPlaceholder` 由一个 `effect`（`:154-182`）驱动，条件层层收窄：

```ts
if (composing || this.store.readonly) { …false; return; }      // IME 合成/只读时不显示
const isCollapsed = textSelection?.isCollapsed() ?? false;
if (!this.focused$.value || !isCollapsed) { …false; return; }   // 未聚焦/有选区不显示
this.updateComplete.then(() => {
  if ((this.inlineEditor?.yTextLength ?? 0) > 0 || this._isInDatabase()) { …false; return; }
  this._displayPlaceholder.value = true;                        // 空文本且非数据库内才显示
});
```

- `focused$` 是个 `computed`（`:39-45`）：在 `std.selection` 里找到本块且为 `TextSelection` 才算聚焦——比直接用 DOM focus 更贴合协同选区模型。
- 合成态单独追踪：`connectedCallback` 用 `handleEvent('compositionStart'/'compositionEnd', …, { flavour:true })` 维护 `_composing`（`:137-150`），避免中文输入过程中占位符闪烁。
- 占位文案来自 `ParagraphBlockConfigExtension` 的 `getPlaceholder`（`:66-70`），默认映射 `view.ts:18-27` 的 `placeholders`（如 `text→"Type '/' for commands"`、`h1→'Heading 1'`、`quote→''`），可被 host 覆盖。

### 3.5 ★键盘交互：Enter / Backspace / Tab 的完整语义

`ParagraphKeymapExtension`（`paragraph-keymap.ts`）是用户文本编辑手感的核心，几乎每个分支都先 `matchModels(model,[ParagraphBlockModel])` 且排除 callout 父块：

- **Enter**（`:103-179`）：
  - `quote` 类型：回车在引用内换行，仅当以两空行结尾才拆出新块（`:123-148`）——让引用能多行、又能"连敲两下回车跳出"。
  - 折叠标题：在被折叠内容之后插入同级新块（见 3.3）。
  - 光标在末尾 → `addParagraphCommand`（在后面新建空段落）；否则 → `splitParagraphCommand`（按光标拆成两块）。
- **Backspace**（`:34-73`）：行首空选区时，若 `type !== 'text'` 先**降级为正文**（标题/引用先变普通文本），再次 Backspace 才 `mergeWithPrev` 向前合并，合并不成则尝试 `dedent`（反缩进）。这套"先降级再删除"避免误删标题。
- **Tab / Shift-Tab**（`:199-222`）：走 `canIndentParagraphCommand`→`indentParagraphCommand` 链，把本块变成前一个兄弟的子块（反之 dedent）。indent 命令里额外处理折叠一致性：缩进会把相关折叠标题展开、并连带移动折叠兄弟（`indent-paragraph.ts:90-144`）。
- **Mod-Enter**（`:74-102`）：`quote` 内插入换行；否则 `addParagraphCommand`——给"在块中间强制起新段"留出口。
- **Delete / Control-d**（`:180-198`）：`forwardDelete` 向后删除（跨块合并），`Control-d` 仅 macOS。

`ParagraphTextKeymapExtension` 则直接复用 `affine-inline-preset` 的 `textKeymap`（bold/italic/link 等内联快捷键），两个 keymap 都绑定在同一 flavour 上。

### 3.6 ★markdown 快捷输入：改 type 而非新建块

`ParagraphMarkdownExtension`（`markdown.ts`）是 `InlineMarkdownExtension`，`pattern: /^((#{1,6})|(>))\s$/`——行首 1-6 个 `#` 或一个 `>` 加空格时触发。与 divider"新建一个块"不同，段落的 markdown 多数是**原地改 type**：

- 捕获组决定目标类型：`match[2]`（`#` 串）→ `h${长度}`，否则 → `quote`（`:25-27`）。
- 若当前块已是段落且 `type` 不同：`captureSync` → `deleteText` 删掉输入的 `#`/`>` → `store.updateBlock(model,{type})` → `focusTextModel`（`:61-72`）——只改字段，`text`/children 原封不动。
- 若当前块是 `list`（代码里的分支）：删块重建为对应 type 的段落、迁移 children（`:38-60`）——把列表项"打"成标题。
- 防误触：光标前已含 `\n` 则放弃（`:18-20`），保证只在行首生效。

> 注意与 `adapters/markdown.ts` 的区别：前者是**输入时**改 type；后者是**导入导出**时在 mdast 的 `heading`/`paragraph`/`blockquote` 与块之间转换。

### 3.7 adapters：heading / paragraph / blockquote 三态映射

`paragraphBlockMarkdownAdapterMatcher`（`adapters/markdown.ts:153-331`）把段落的三种形态映射到 mdast：

- **导入**（`toBlockSnapshot`）：`paragraph`→`type:'text'`、`heading`→`type:h${depth}`（并读 `data.collapsed`）、`blockquote`→`type:'quote'`。注意它**声明合并**扩展了 mdast 的 `HeadingData` 以携带 `collapsed`（`:17-21`）。
- **导出**（`fromBlockSnapshot`）：按 `type` 反向生成 mdast 节点；`quote` 会把文本与子块 `flattenQuoteSnapshotToDelta` 压平成一个 blockquote（`:291-315`）。
- 用 `IN_PARAGRAPH_NODE_CONTEXT_KEY` 和 `affine:paragraph:depth` 两个 walker 全局上下文追踪嵌套深度，供 delta↔AST 转换使用。
- `toMatch` 显式排除 callout 节点（`!isCalloutNode`），避免与 callout 块抢解析。

### 3.8 turbo：白板低缩放的文字快照

白板里缩得很小时，逐块渲染真实 DOM 代价高，paragraph 提供 turbo 渲染路径。`ParagraphLayoutHandlerExtension`（`turbo/paragraph-layout-handler.ts`）实现 `queryLayout`：从真实 DOM 的 `[data-v-text="true"]` 节点用 `segmentSentences`/`getSentenceRects` 把文本切成句子矩形，再 `clientToModelCoord` 把客户端坐标换算到模型坐标（除以 `zoom`/`viewScale`），输出 `ParagraphLayout`；`calculateBound` 求整体包围盒。配套的 `paragraph-painter.worker.ts` 在 worker 里把这些矩形画成位图——缩小时文本变成轻量快照而非活 DOM。

## 4. 语法特色

- **`accessor` + `@query`**：`@query('rich-text') private accessor _richTextElement`（`:398-399`）用 Lit 装饰器把 DOM 查询结果绑定到 accessor 字段；`override accessor blockContainerStyles`/`useZeroWidth` 等用 `accessor` 覆盖基类响应式字段。
- **`computed` / `signal` / `effect`**：`focused$` 是 `computed`、`_composing`/`_displayPlaceholder`/`_readonlyCollapsed` 是 `signal`，多个 `effect` 在 `connectedCallback` 里注册并 `disposables.add` 以便卸载时清理——细粒度响应式而非 `requestUpdate` 粗粒度重渲。
- **字面量联合类型 `ParagraphType`**：八种形态用字符串字面量联合建模，`type.startsWith('h')` + `parseInt(type.slice(1))` 在类型安全与便捷判断间取平衡。
- **`Command` 泛型管道**：`splitParagraphCommand: Command<{blockId?},{paragraphConvertedId}>` 声明输入/输出上下文，`std.command.chain().pipe(a).pipe(b).run()` 组合命令——缩进/拆分都走这套可组合管道。
- **声明合并扩展第三方类型**：`declare module 'mdast' { interface HeadingData { collapsed?: boolean } }`（adapters/markdown.ts）给上游 AST 类型打补丁，携带 AFFiNE 特有的折叠信息。
- **`KeymapExtension(fn, { flavour })`**：keymap 以 flavour 为作用域注册，返回 `true` 表示拦截默认行为——同一块可注册多个 keymap（业务键 + 共享文本键）。
- **`styleMap` / `classMap` / `repeat`**：对齐样式用 `styleMap({textAlign})`、type 类名用 `classMap`、widget 列表用 `repeat(Object.entries(this.widgets), id, …)`。

## 5. 设计 / 实现亮点

- **"一块多形态"的极简建模**：正文、六级标题、引用不各立 flavour，而靠一个 `type` 字段切换——类型互转只改字段、保留文本与结构，是整个编辑器"块类型可平滑转换"体验的基石；代价（渲染/键盘分支）被集中在一个组件里可控消化。
- **折叠的推导式实现**：collapsed siblings 不落盘、每次从文档结构实时 `calculate`，用动态 `<style>` 隐藏而非移动节点；配合三条一致性 effect，保证任何编辑后折叠状态都自洽。只读态折叠走本地信号，不污染模型。
- **占位符的信号编排**：合成态、只读、聚焦、选区、文本长度、是否在数据库——六个条件用一个 `effect` 串联收窄，解决了"占位符何时该亮"这个看似简单实则极易闪烁的问题。
- **"先降级后删除"的 Backspace**：标题行首退格先变正文再合并，避免手滑删标题——小细节体现对编辑直觉的打磨。
- **turbo 快照渲染**：把"白板缩小后文字仍要可见但不必是活 DOM"抽象成 layout-handler + painter worker，是性能与保真的折中。

## 6. 对外 API 与注意事项

- 主要导出：`ParagraphBlockComponent`、`ParagraphBlockConfigExtension`（注入 `getPlaceholder`）、各命令（`addParagraphCommand`/`splitParagraphCommand`/`indent`/`dedent`/`append`）、`ParagraphLayoutHandlerExtension`；装配入口 `ParagraphViewExtension`（`./view`）、`ParagraphStoreExtension`（`./store`）、turbo painter（`./turbo-painter`）。
- **约定**：自定义占位文案通过 `ParagraphViewExtension` 的 `options.getPlaceholder` 或 `ParagraphBlockConfigExtension` 注入；段落命令可被其它块（list→paragraph 转换等）复用。
- **注意**：
  - `type` 是段落的灵魂字段，改它即改形态；非标题块若残留 `collapsed:true` 会被 effect 自动复位。
  - collapsed siblings 是推导量，不要缓存为状态；只读态折叠不写模型（存 `_readonlyCollapsed`）。
  - rich-text 的 clipboard/undo 被关闭，复制/撤销统一走块与 store 层。
  - markdown 快捷输入在 quote 段落里敲 `#` 仍会改成标题；但分割线 `---` 在 quote 里不生效（见 divider 文档）——两者的 quote 处理方向相反，注意区分。
  - 白板模式下 `topContenteditableElement` 指向 edgeless 文字容器而非 root，占位符在白板文字块内被抑制。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`ParagraphBlockModel`/`ParagraphType`）、`@blocksuite/store`（`defineBlockSchema`/`Text`）、`@blocksuite/std`（`KeymapExtension`/`TextSelection`/`Command`/inline）。
- 同层协作：`@blocksuite/affine-rich-text`（`rich-text`/`focusTextModel`/`getInlineEditorByModel`）、`@blocksuite/affine-inline-preset`（`DefaultInlineManagerExtension`/`textKeymap`）、`@blocksuite/affine-components`（`CaptionedBlockComponent`/`toggle-button`/`icons`）、`@blocksuite/affine-shared`（`calculateCollapsedSiblings`/`getNearestHeadingBefore`/`matchModels`）、`@blocksuite/affine-gfx-turbo-renderer`（白板文字快照）。
- 对照阅读：`blocksuite-affine-block-divider.md`（最小块，无文本/无 keymap）、`blocksuite-affine-block-code.md`（同为文本块但禁用 markdown、自建高亮内联）——三篇并读可看清"文本块"从最简到最复杂的能力谱系。
