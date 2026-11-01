# `@blocksuite/affine-inline-latex`

> 一句话定位：AFFiNE 的**行内 LaTeX 公式层**——它把一段 LaTeX 源码作为 `latex` delta 属性嵌入富文本，渲染成一个用 KaTeX 排版的原子节点 `<affine-latex-node>`；点击弹出一个**内嵌 `<rich-text>` 的公式编辑器**（带 Shiki 语法高亮），实时把编辑内容 render 回公式；提供 `$$...$$` 的 Markdown 行内触发、`insertInlineLatex` 命令，以及 inlineMath 的 Markdown/纯文本双向适配。区别于块级的 `@blocksuite/affine-block-latex`——本包是**嵌在一行文字里**的公式，不是独占一行的块。

| 项        | 值                                                                                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/inlines/latex`                                                                                                                                                                                                                                                              |
| 所属层    | L3 · 编辑器业务层（行内元素）                                                                                                                                                                                                                                                                  |
| 语言/形态 | TypeScript 库（Lit 组件 + InlineSpec + Command + Markdown Adapter）                                                                                                                                                                                                                            |
| 关键依赖  | `katex`（公式排版）、`shiki`（LaTeX 源码高亮）、`@blocksuite/affine-rich-text`（编辑器内再套 `<rich-text>`）、`@blocksuite/std`（`InlineSpecExtension`/`InlineManagerExtension`/`InlineMarkdownExtension`）、`@blocksuite/affine-components`（`createLitPortal`）、`yjs`、`zod`、`remark-math` |
| 被谁依赖  | 编辑器预设、公式功能装配方；块级 `affine:latex` 复用其触发逻辑                                                                                                                                                                                                                                 |
| 对外入口  | `.`（inline-spec + command + markdown + adapters）、`./view`（`LatexViewExtension`）、`./store`（`LatexStoreExtension`）                                                                                                                                                                       |

## 1. 设计逻辑

### 它在 inline 范式里的位置

行内 LaTeX 与脚注（见 `blocksuite-affine-inline-footnote.md`）同属 **embed** 行内元素：一个 `insert: ' '` + `attributes: { latex }` 的 delta，被 `InlineSpecExtension` 的 `embed: true` 渲染成一个不可逐字编辑的原子节点。差别在于——脚注是"引用标记 + 悬停看来源"，而行内公式是**有内容、需要被编辑**的：用户要能改公式源码并实时看到排版结果。

这带来一个 inline 范式里相对独特的设计：**行内元素内部再嵌一个富文本编辑器**。点开公式时弹出的编辑面板，其输入框本身就是一个 `<rich-text>`（本仓库的行内编辑基座），绑定一个独立的 `Y.Text`，还套上 Shiki 的 LaTeX 语法高亮。于是出现了"行内元素里套 InlineEditor"的套娃结构——这也是本包同时依赖 `affine-rich-text` 的原因。

### 与块级 latex 的区别（关键）

AFFiNE 有两种公式：

- **块级** `affine:latex`（`@blocksuite/affine-block-latex`）：独占一行、居中显示的公式块，适合大型推导。
- **行内** `latex`（本包）：嵌在文字中间的小公式，如"当 $E=mc^2$ 时……"。它不是块、没有 BlockModel，只是 delta 属性。

二者在 Markdown 触发上统一：`markdown.ts` 的一条正则同时处理 `$$content$$ `（行内，直接生成 latex 属性）和 `$$$$ `（四个美元号，升级为块级 `affine:latex`）——即在同一处理器里按匹配分组决定走行内还是块级路径。

### 为什么单独成包

把行内公式独立成包，是为了把"KaTeX 渲染 + 可编辑弹层 + Shiki 高亮 + Markdown/命令触发"这一套较重且自洽的逻辑与通用行内编辑基座解耦。它既被普通编辑器用，其触发逻辑也被块级 latex 复用（`$$$$` 分支直接 `addBlock('affine:latex')`）。

## 2. 目录与关键文件

```text
latex/src/
├── index.ts                         # 导出 adapters / command / inline-spec / markdown
├── inline-spec.ts                   # ★ Latex(/EditorUnit)InlineSpecExtension：latex schema + embed 渲染
├── command.ts                       # insertInlineLatex 命令：选区转公式 / 空选插入并打开编辑器
├── markdown.ts                      # LatexExtension：$$...$$ / $$$$ 的行内 markdown 触发（含升级块级）
├── latex-node/
│   ├── latex-node.ts                # ★ <affine-latex-node>：KaTeX 渲染 + 点击开编辑弹层 + 同步回 delta
│   ├── latex-editor-menu.ts         # <latex-editor-menu>：编辑弹层，内嵌 <rich-text> + Shiki 高亮 + 独立 InlineManager
│   └── latex-editor-unit.ts         # <latex-editor-unit>：编辑器内每行的高亮渲染单元
├── adapters/
│   ├── markdown/inline-delta.ts     # delta.latex → mdast inlineMath
│   ├── markdown/markdown-inline.ts  # mdast inlineMath → delta.latex
│   └── plain-text/inline-delta.ts   # delta.latex → 纯文本（直接输出源码）
├── view.ts                          # LatexViewExtension：注册 spec + editor-unit spec + InlineManager + effects
├── store.ts                         # LatexStoreExtension：注册三个 adapter
└── effects.ts                       # define affine-latex-node / latex-editor-unit / latex-editor-menu
```

## 3. 实现细节

### 3.1 两个 InlineSpec：公式节点 + 编辑器高亮单元

`inline-spec.ts` 导出**两个** spec，对应两个不同层面的行内渲染：

**① `LatexInlineSpecExtension`**（`:7-28`，工厂形态）——正文里的公式节点：

```ts
schema: z.object({ latex: z.string().optional().nullable().catch(undefined) }),
match: delta => typeof delta.attributes?.latex === 'string',
renderer: ({ delta, selected, editor, startOffset, endOffset }) =>
  html`<affine-latex-node .std=${std} .delta=${delta} .selected=${selected}
    .editor=${editor} .startOffset=${startOffset} .endOffset=${endOffset}></affine-latex-node>`,
embed: true,
```

注意它的 renderer 比脚注多拿了 `selected` / `editor` / `startOffset` / `endOffset`——因为公式节点需要**反向操作宿主编辑器**（把编辑结果 `formatText` 写回 `[startOffset, endOffset]`），所以 `InlineEditor` 把节点在文档中的位置和编辑器实例一并传进渲染回调。

**② `LatexEditorUnitSpecExtension`**（`:30-40`，对象形态）——这是给**编辑弹层内部那个 `<rich-text>`** 用的。它的 `match: () => true`（匹配一切）、schema 是 `{ 'latex-editor-unit': z.undefined() }`，renderer 渲染成 `<latex-editor-unit>`。它存在的意义：让公式编辑器里的纯 LaTeX 源码也能被逐行套上 Shiki 高亮（见 3.4）。

### 3.2 公式节点：KaTeX 渲染与双 signal 同步

`AffineLatexNode extends SignalWatcher(WithDisposable(ShadowlessElement))`（`latex-node.ts:21-23`）。它持有两个 signal：

- `latex$`：权威公式值；
- `latexEditorSignal`：编辑器里正在编辑的临时值。

`connectedCallback`（`:102-177`）建立两条订阅链：

1. **`latex$` → 回写 delta + 同步编辑值**（`:108-123`）：当 `latex$` 变化且不等于 delta 里的值，就 `editor.formatText([startOffset, endOffset], { latex })` 把新公式写回宿主文档的 delta。
2. **`latexEditorSignal` → KaTeX 重排**（`:125-159`）：每当编辑值变，等 `updateComplete` 后清空 `.latex-container` 并重新 `katex.render(latex, container, { displayMode: false })`（`displayMode: false` 即行内模式）。空串显示 `Equation` 占位、渲染抛错则显示红色 `Error equation`：

```ts
try {
  katex.render(latex, latexContainer, { displayMode: false });
} catch {
  latexContainer.replaceChildren();
  delete latexContainer['_$litPart$']; // 清掉 lit 的渲染标记后手动 render 错误占位
  render(
    html`<span class="error-placeholder">Error equation</span>`,
    latexContainer
  );
}
```

那句 `delete latexContainer['_$litPart$']` 是个被注释为"lit hack won't fix"的细节——因为 KaTeX 直接操作了 DOM，lit 原先挂在该容器上的渲染缓存标记必须手动抹掉，否则 lit 的 `render` 会以为容器还是自己上次渲染的状态而出错。KaTeX 与 lit 争用同一容器的典型摩擦。

`updated`（`:179-193`）处理外部 delta 变化：仅当 delta 变了且编辑器没开着时，把 delta 的新值灌回两个 signal——编辑器开着时不覆盖，避免打断用户输入。

### 3.3 点击编辑：Portal 弹出编辑菜单

`toggleEditor`（`:202-260`）用 `createLitPortal`（来自 `affine-components/portal`）把 `<latex-editor-menu>` 弹在节点下方：

```ts
const { portal } = createLitPortal({
  template: html`<latex-editor-menu
    .std=${this.std}
    .latexSignal=${this.latexEditorSignal}
    .abortController=${this._editorAbortController}
  ></latex-editor-menu>`,
  container: blockComponent.host,
  computePosition: {
    referenceElement: this,
    placement: 'bottom-start',
    autoUpdate: { animationFrame: true },
  },
  closeOnClickAway: true,
  abortController: this._editorAbortController,
  shadowDom: false,
});
```

关键在 abort 回调（`:234-259`）——**关闭编辑器时才最终提交**：读 `latexEditorSignal` 的终值，若与 delta 不同则 `formatText` 写回并把光标 `setInlineRange({ index: endOffset, length: 0 })` 定位到公式后面。编辑器以 `AbortController` 管理生命周期，`closeOnClickAway` 点击外部即关闭。`_isEditorOpen` 标志位则防止编辑期间外部 delta 回灌打断输入。

### 3.4 编辑弹层：行内元素里再套一个 InlineEditor

`LatexEditorMenu`（`latex-editor-menu.ts:26`）是本包最能体现"套娃"的部分。它 `render()`（`:178-200`）里放了一个 `<rich-text>`：

```ts
html`<rich-text
  .yText=${this.yText}
  .attributesSchema=${this.inlineManager.getSchema()}
  .attributeRenderer=${this.inlineManager.getRenderer()}
  .verticalScrollContainerGetter=${this._getVerticalScrollContainer}
></rich-text>`;
```

- `yText`（`:124-125`）是一个**新建的独立 `Y.Doc` 的 text**，与宿主文档无关——公式源码在编辑期间活在这个临时 yText 里，`observe` 它的变化同步到 `latexSignal`（`:128-137`）。
- `attributesSchema`/`attributeRenderer` 来自 `LatexEditorInlineManagerExtension`（`:19-24`）——一个用 `InlineManagerExtension` 定义、`enableMarkdown: false`、只含 `LatexEditorUnitSpecExtension` 的**独立 inline 管理器**。即：这个内嵌编辑器的"行内渲染规则表"只有一条——把每行文本交给 `<latex-editor-unit>` 做高亮，且关掉 markdown 快捷转换（公式编辑里 `$$` 不该再触发公式）。

**Shiki 高亮**：`_updateHighlightTokens`（`:107-119`）用 `codeToTokensBase(text, { lang: 'latex', theme })` 把源码分词着色，结果存进 `highlightTokens$`。一个 `effect`（`:139-144`）监听该 signal，变化时调 `richText?.inlineEditor?.render()` 触发内嵌编辑器重渲染。主题随 `ThemeProvider.theme$` 切换（`:146-150`）。

`<latex-editor-unit>`（`latex-editor-unit.ts`）则是落地渲染：`render()`（`:18-49`）从所在 `latex-editor-menu` 的 `highlightTokens$` 按行取出 token，用 `styleMap({ color: token.color })` 给每个 token 的 `<v-text>` 上色；若 token 拼起来和本行文本对不上（高亮还没算完）就退回无色纯文本——保证不乱色。

交互：`keydown` 时 Enter（非 Shift）关闭编辑器提交（`:152-158`），Shift+Enter 换行（提示语"Shift Enter to line break"）；`connectedCallback` 末尾 `focusEnd()` 自动聚焦到公式末尾（`:167-175`）。

### 3.5 Markdown 触发：一条正则，行内与块级分流

`LatexExtension = InlineMarkdownExtension(...)`（`markdown.ts:9`）的 pattern 用了三个命名分组（`:12-13`）：

```
/(?:\$\$)(?<content>[^$]+)(?:\$\$)\s$|(?<blockPrefix>\$\$\$\$)\s$|(?<inlinePrefix>\$\$)\s$/g
```

- `content`（`$$...$$ `）：输入完整公式后空格——删掉原始文本、在原位 `formatText` 成一个 `latex` 属性节点（`:136-165`），用 `String.raw` 保留反斜杠。
- `inlinePrefix`（`$$ `）：只打了两个美元号加空格——插入空占位公式并打开编辑器让用户输入（`:78-134`）。
- `blockPrefix`（`$$$$ `）：四个美元号——**升级为块级** `doc.addBlock('affine:latex', { latex: '' }, parent, index+1)`（`:35-76`），然后打开块级编辑器。这就是行内包里"长出块级公式"的入口。

每条分支都先 `undoManager.stopCapturing()`（让这步成为独立的撤销单元），并通过 `TelemetryProvider` 埋点，埋点里按 `DocModeProvider.getEditorMode()` + 是否在 `affine-edgeless-text` 内区分 `doc`/`edgeless text`/`edgeless note` 来源。

### 3.6 命令：insertInlineLatex

`insertInlineLatex`（`command.ts:41-93`）供工具栏/快捷键调用。它从 `TextSelection` 定位到块的 `<rich-text>` 取 `inlineEditor`，然后：

- 选区非空：把选中的文本作为公式初始内容（`yTextString.slice(index, index+length)`，`:60-65`）——"选中一段文字转成公式"；
- 选区折叠（空）：插入空公式并 `openInlineLatexEditor`（`:9-26`）等编辑器渲染完后 `latexNode.toggleEditor()` 打开编辑。

`getSingleBlockInlineRange`（`:28-39`）要求选区不跨块（`textSelection.to` 存在则返回 null）——行内公式只在单块内插入。同样带 `TelemetryProvider` 埋点。

### 3.7 序列化：inlineMath 双向 + 纯文本

`store.ts` 注册三个 adapter：

- **delta → markdown**（`adapters/markdown/inline-delta.ts`）：有 `latex` 属性的 delta 产出 `{ type: 'inlineMath', value: latex }`（`:13-18`），配合 `remark-math` 即输出标准 `$...$`。
- **markdown → delta**（`adapters/markdown/markdown-inline.ts`）：`inlineMath` AST 转 `[{ insert: ' ', attributes: { latex: ast.value } }]`（`:10`）——又是单空格占位。
- **delta → 纯文本**（`adapters/plain-text/inline-delta.ts`）：导出为纯文本时直接输出 LaTeX 源码（`content: delta.attributes.latex`，`:17-19`），而非占位空格。

`index.ts`（`:1-9`）顶部那句 `declare type _GLOBAL_ = typeof RichTextEffects | typeof RemarkMath;` 是一个**纯类型层面的依赖声明**——借 `import type` 把 `affine-rich-text/effects`（需确保 `<rich-text>` 已注册）和 `remark-math`（markdown 解析需要）标记为本包的隐式依赖，提醒装配方这两者缺一不可，但不产生运行时导入。

## 4. 语法特色

- **双 InlineSpec 分层**：`LatexInlineSpecExtension`（embed 公式节点）与 `LatexEditorUnitSpecExtension`（编辑器内高亮单元）分别用工厂/对象两种重载（`inline-spec.ts:7` / `:30`），一个管正文、一个管编辑器内部，同一 `InlineSpecExtension` API 服务两个嵌套层级。
- **双 signal + 订阅链**：`latex$` 与 `latexEditorSignal` 通过 `.subscribe` 互相驱动并各自触发"回写 delta"与"KaTeX 重排"（`latex-node.ts:108-159`），用 `SignalWatcher` mixin 把 signal 变化接进 Lit 渲染。
- **lit 渲染缓存的手动失效**：`delete latexContainer['_$litPart$']`（`:134/149`）在把容器交给 KaTeX 前抹掉 lit 的内部渲染标记——第三方库直接操作 DOM 后与声明式框架共存的务实 hack。
- **`String.raw` 保原义**：`{ latex: String.raw`${content}` }`（`markdown.ts:158`）确保用户输入的 `\frac` 等反斜杠序列不被当转义。
- **命名捕获组 + 交替分流**：一条正则用 `(?<content>)`/`(?<blockPrefix>)`/`(?<inlinePrefix>)` 三组 + `|` 交替，在 `action` 里按哪个组命中分派行内/块级逻辑（`markdown.ts:12-19`）。
- **`import type` 声明隐式依赖**：`declare type _GLOBAL_ = typeof RichTextEffects | typeof RemarkMath`（`index.ts:1-9`）用纯类型联合把运行期必需但非直接 import 的依赖"记在类型里"，零运行时成本地表达装配契约。
- **独立 Y.Doc 做编辑缓冲**：`new Y.Doc().getText('latex')`（`latex-editor-menu.ts:124-125`）为编辑器建一个与主文档隔离的协同文本，编辑中不污染主文档，提交时才一次性 `formatText` 回写。
- **InlineManagerExtension 定制子编辑器**：`InlineManagerExtension({ id, enableMarkdown: false, specs: [...] })`（`latex-editor-menu.ts:19-24`）声明一个"规则极简"的内嵌行内编辑器，关掉 markdown、只留高亮单元——展示了 inline 体系可按场景裁剪规则集。

## 5. 设计 / 实现亮点

- **行内元素里套 InlineEditor**：公式编辑面板复用 `<rich-text>` 基座 + 独立 yText + 定制 InlineManager，既得到成熟的光标/IME/撤销能力，又隔离出纯净的编辑缓冲——"套娃"式复用是本包最漂亮的架构决策。
- **编辑缓冲与提交分离**：编辑期活在临时 signal/yText，关闭时才回写宿主 delta，天然实现"取消不留痕、确认才生效"，且不打断正文的撤销栈。
- **Shiki 高亮 + KaTeX 渲染双引擎**：源码编辑态用 Shiki 着色、展示态用 KaTeX 排版，各司其职；通过 signal/effect 把两套异步结果接入同一 Lit 组件。
- **一条正则统一行内/块级入口**：`$$ `/`$$...$$ `/`$$$$ ` 三种 markdown 手势在同一处理器分流，行内包里直接"孵化"块级公式，复用触发与埋点逻辑。
- **与 lit 共存的务实 DOM hack**：清 `_$litPart$` 标记解决第三方库接管容器后的渲染冲突，是声明式框架集成命令式库的实战经验。
- **信任边界的类型化声明**：`_GLOBAL_` 类型联合把"必须先注册 rich-text effects、必须有 remark-math"的隐式契约显式写进类型，降低装配踩坑。

## 6. 对外 API 与注意事项

- 主要导出：`LatexInlineSpecExtension` / `LatexEditorUnitSpecExtension`；`insertInlineLatex` 命令；`LatexExtension`（markdown 触发）；markdown/plain-text adapters；`AffineLatexNode` / `LatexEditorMenu` / `LatexEditorUnit`（经 effects 注册）；`./view` 的 `LatexViewExtension`、`./store` 的 `LatexStoreExtension`。
- **约定**：
  - 渲染/交互经 `LatexViewExtension` 注册（spec + editor-unit spec + `LatexEditorInlineManagerExtension` + `effects()`）；序列化经 `LatexStoreExtension`。
  - 使用前必须已注册 `@blocksuite/affine-rich-text` 的 `effects()`（编辑弹层内要用 `<rich-text>`），markdown 解析侧需 `remark-math`——见 `index.ts` 的 `_GLOBAL_` 声明。
  - 公式 delta 的 `insert` 恒为单空格，公式源码在 `attributes.latex`。
- **注意**：
  - 区分块级 `affine:latex`（`@blocksuite/affine-block-latex`）与本包的行内 `latex`；`$$$$ ` 手势会从行内升级为块级。
  - KaTeX 渲染失败显示红色 `Error equation` 占位而非抛错中断。
  - 编辑器打开期间（`_isEditorOpen`）外部 delta 变化不会回灌，避免打断输入；最终值在编辑器关闭（abort）时提交。
  - `insertInlineLatex` 仅支持单块内选区（跨块返回）。
  - 内嵌编辑器用独立 `Y.Doc`，其内容不进主文档撤销栈，公式的增删/修改以主文档上的一次 `formatText` 为撤销粒度。

## 7. 延伸

- 基座：`@blocksuite/affine-rich-text`（`<rich-text>`/`RichText`，编辑弹层复用；`blocksuite-affine-rich-text.md` 讲 inline 范式与 InlineEditor 绑定）。
- 底层：`@blocksuite/std/inline` 的 `InlineSpecExtension`（embed）、`InlineManagerExtension`（定制子编辑器）、`InlineMarkdownExtension`（`$$` 触发）、`ZERO_WIDTH_FOR_EMBED_NODE`。
- 外部库：`katex`（行内公式排版）、`shiki`（LaTeX 源码高亮）、`remark-math`（markdown inlineMath 解析）。
- 服务：`@blocksuite/affine-shared/services` 的 `DocModeProvider`/`TelemetryProvider`/`ThemeProvider`；`@blocksuite/affine-components` 的 `createLitPortal`。
- 同层对照：`blocksuite-affine-inline-footnote.md`（同为 embed、但无内嵌编辑器）、`blocksuite-affine-inline-comment.md`（wrapper 装饰路线）；块级对照 `@blocksuite/affine-block-latex`。
