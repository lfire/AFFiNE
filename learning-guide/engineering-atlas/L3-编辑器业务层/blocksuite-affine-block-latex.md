# `@blocksuite/affine-block-latex`

> 一句话定位：AFFiNE 的 **LaTeX 公式块**——一个用 katex 把 LaTeX 源串渲染成数学公式（`displayMode` 展示式）的内容块，点击即在块下方弹出一个**带语法高亮的浮层编辑器**实时改公式。它独有的核心是**用 `katex.render` 直接把 DOM 渲染进容器（绕开 Lit 模板）**、**`createLitPortal` + `AbortController` 的浮层编辑器生命周期**、**编辑器内嵌一个独立 `Y.Text` 富文本 + shiki 对 LaTeX 源码着色**、以及 **markdown `$$`/`$` 公式的预处理与 `math` 节点序列化**。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/latex`                                                                                                                                                                                                                                                                                                                                          |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                                                                                                               |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                     |
| 关键依赖  | `katex`、`@blocksuite/affine-inline-latex`（`LatexEditorMenu`/`insertInlineLatex`）、`@blocksuite/affine-components`（`CaptionedBlockComponent`/`createLitPortal`）、`@blocksuite/affine-block-note`（`selectBlock`）、`@blocksuite/affine-model`（`LatexBlockModel`）、`@blocksuite/affine-widget-slash-menu`、`@floating-ui/dom`、`@preact/signals-core`、`remark-math` |
| 被谁依赖  | 编辑器预设、`@affine/core`                                                                                                                                                                                                                                                                                                                                                |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                                                  |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | latex 实现                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| schema                            | 复用 `affine-model` 的 `LatexBlockSchema`/`LatexBlockModel`（props 仅 `latex: string` + GFX 几何；`store.ts` 注册 `LatexBlockSchemaExtension`） |
| model                             | `LatexBlockModel extends GfxCompatible(BlockModel)`——可嵌在 note/paragraph/list/edgeless-text 内                                                |
| `*-block.ts`                      | `latex-block.ts` → `LatexBlockComponent`（katex 渲染 + 浮层编辑器触发）                                                                         |
| commands                          | `commands.ts` → `insertLatexBlockCommand`（插入并自动打开编辑器 + 埋点）                                                                        |
| adapters                          | `adapters/`（markdown `math` 节点 ↔ 块、notion-html、plain-text）+ **markdown 预处理器**                                                        |
| widgets                           | `configs/slash-menu.ts`（"Equation" 块 + "Inline equation" 内联）、`tooltips.ts`                                                                |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define('affine-latex', ...)` + `LatexViewExtension`/`LatexStoreExtension`                                                       |

它继承 `CaptionedBlockComponent`、用 `BlockViewExtension('affine:latex', literal`affine-latex`)` 注册——是统一范式的实例。但它有两个"反范式"之处：**渲染不走 Lit 模板而是 `katex.render` 直接操作 DOM**；**编辑器 UI 不在本包，而是复用内联 LaTeX 包的 `LatexEditorMenu`**（块与内联公式共享同一套编辑弹层）。

### LaTeX 块的独有问题

1. **公式渲染是第三方 DOM 操作**：katex 把 LaTeX 串渲染成一大坨 MathML/HTML DOM，Lit 的声明式模板不适合托管这种外部渲染结果——需**手动管理容器 DOM** 并与 Lit 的渲染标记共存。
2. **渲染可能失败**：非法 LaTeX 要捕获异常、降级显示"Error equation"，空串显示占位"Equation"。
3. **即点即改**：公式本身不可直接编辑（它是渲染结果），需点击块弹出一个**浮层编辑器**改源串、实时预览。编辑器要能定位到块下方、点击别处关闭、Enter 确认。
4. **源码编辑体验**：编辑器里的 LaTeX 源要有**语法高亮**（用 shiki 的 `latex` 语法），且本身也是一个可协同的富文本（内嵌 `Y.Text`）。
5. **markdown 互通**：`$$...$$`（块级）、`$...$`/`\(...\)`/`\[...\]`（各种定界符）要能被正确识别、保护（不被 markdown 其它规则破坏）并转成 `math` 节点。

## 2. 目录与关键文件

```text
src/
├── latex-block.ts            # ★LatexBlockComponent：katex.render、effect 重渲、浮层编辑器 toggle
├── commands.ts               # insertLatexBlockCommand（插入即打开编辑器 + 埋点）
├── adapters/
│   ├── markdown/markdown.ts  # math 节点 ↔ affine:latex 块
│   ├── markdown/preprocessor.ts # ★LaTeX 定界符保护与归一（$$/$/\(\)/\[\]）
│   ├── notion-html.ts plain-text.ts extension.ts
├── configs/slash-menu.ts     # "Inline equation" + "Equation" 两个斜杠项
├── configs/tooltips.ts styles.ts
└── index.ts view.ts store.ts effects.ts
```

> 编辑器弹层 `LatexEditorMenu` 与内联公式单元 `LatexEditorUnit` 实际定义在**兄弟包** `@blocksuite/affine-inline-latex`（`inlines/latex`），本块通过依赖复用它——块级公式与内联公式共用同一编辑 UI。

## 3. 实现细节

### 3.1 ★katex 渲染：绕开 Lit 模板直接操作 DOM

`renderBlock`（`latex-block.ts:92-102`）只渲染一个空容器 `<div class="katex">`，真正的公式 DOM 由 `firstUpdated` 里的 `effect` 填充（`:44-75`）：

```ts
disposables.add(
  effect(() => {
    const latex = this.model.props.latex$.value; // 订阅 latex signal
    katexContainer.replaceChildren(); // 清空旧 DOM
    // @ts-expect-error lit hack won't fix
    delete katexContainer['_$litPart$']; // ★抹掉 Lit 的渲染标记
    if (latex.length === 0) {
      render(
        html`<span class="latex-block-empty-placeholder">Equation</span>`,
        katexContainer
      );
    } else {
      try {
        katex.render(latex, katexContainer, { displayMode: true });
      } catch {
        katexContainer.replaceChildren();
        delete katexContainer['_$litPart$'];
        render(
          html`<span class="latex-block-error-placeholder"
            >Error equation</span
          >`,
          katexContainer
        );
      }
    }
  })
);
```

关键细节：

- **`effect` 响应式重渲**：`latex$` 是模型属性 signal，公式串一变，effect 自动重跑、重新 `katex.render`——无需手动失效。
- **`delete katexContainer['_$litPart$']` 的 hack**：同一个容器有时被 Lit `render` 写入占位、有时被 katex 直接 `replaceChildren`。两套渲染机制争用同一节点，必须在切换前删掉 Lit 挂在 DOM 上的内部标记（`_$litPart$`），否则 Lit 下次 `render` 会基于失效的缓存 part 出错——注释直言 "lit hack won't fix"。
- **`displayMode: true`**：以独立展示式（居中、大号）而非行内式渲染。
- **三态**：空→占位、正常→公式、异常→错误提示，`try/catch` 兜住非法输入。

### 3.2 ★浮层编辑器：createLitPortal + AbortController

点击块（`_handleClick`，`:78-86`）：未选中则 `selectBlock` 选中它；已选中则 `toggleEditor` 打开编辑器——"二次点击才进入编辑"避免误触。`toggleEditor`（`:110-148`）是核心：

```ts
this._editorAbortController?.abort(); // 关掉上一个
this._editorAbortController = new AbortController();
this.selection.setGroup('note', []); // 清空块选区
const { portal } = createLitPortal({
  template: html`<latex-editor-menu
    .std=${this.std}
    .latexSignal=${this.model.props.latex$}           // ★把模型的 latex signal 直接交给编辑器
    .abortController=${this._editorAbortController}
  ></latex-editor-menu>`,
  container: this.host,
  computePosition: {
    referenceElement: this,
    placement: 'bottom',
    autoUpdate: { animationFrame: true },
  },
  closeOnClickAway: true,
  abortController: this._editorAbortController,
  shadowDom: false,
  portalStyles: { zIndex: 'var(--affine-z-index-popover)' },
});
this._editorAbortController.signal.addEventListener(
  'abort',
  () => this.removeEditor(portal),
  { once: true }
);
```

设计要点：

- **`AbortController` 统一生命周期**：打开即新建 controller，`closeOnClickAway`（点别处）、Enter 确认、组件 dispose 都触发 `abort()`，`abort` 事件 `{ once: true }` 移除 portal——开/关/清理一条信号串起来，无泄漏。
- **`@floating-ui/dom` 定位**：`computePosition` 把编辑器悬浮在块**下方**（`placement: 'bottom'`），`autoUpdate.animationFrame` 让它随滚动/布局实时跟随。
- **signal 直通**：把 `model.props.latex$` 这个 signal 直接传给编辑器，编辑器改它就等于改模型——双向绑定零样板。

### 3.3 ★编辑器内部：内嵌 Y.Text 富文本 + shiki 着色

`LatexEditorMenu`（`inlines/latex/src/latex-node/latex-editor-menu.ts`）在 `connectedCallback`（`:121-176`）里新建一个**独立的 `Y.Doc`**，取出 `latex` 这条 `Y.Text` 并填入当前公式串，然后 `observe`：

```ts
const doc = new Y.Doc();
this.yText = doc.getText('latex');
this.yText.insert(0, this.latexSignal.value);
const yTextObserver = () => {
  const text = this.yText.toString();
  this.latexSignal.value = text; // ★编辑器的 Y.Text 变 → 写回块的 latex signal → 块 effect 重渲
  this._updateHighlightTokens(text); // shiki 重新着色
};
this.yText.observe(yTextObserver);
```

- **临时 Y.Text 作编辑缓冲**：编辑器用一个**独立于主文档**的 `Y.Text` 承载源码（通过 `<rich-text>` 编辑），每次变化同步回 `latexSignal`。于是编辑过程本身也是协同富文本（支持多光标/撤销），但不污染主 YDoc 结构。
- **shiki 着色**：`_updateHighlightTokens`（`:107-119`）用 `codeToTokensBase(text, { lang: 'latex', theme })` 把 LaTeX 源 token 化，`highlightTokens$` 驱动 `LatexEditorUnit`（自定义内联单元）着色；主题跟随 `ThemeProvider.theme$`。`effect` + `noop(highlightTokens$.value)` 建立依赖、tokens 变就 `inlineEditor.render()`——与代码块 `affine-code-unit` 同款"源码高亮缝进富文本"套路。
- **交互**：`enableMarkdown: false`（公式源码里不触发 markdown 快捷输入）；Enter（非 Shift）`abort()` 确认关闭，Shift+Enter 换行（底部提示 "Shift Enter to line break"）；`pointerdown/up` 阻止冒泡避免触发外层选区。

### 3.4 插入命令：插入即编辑

`insertLatexBlockCommand`（`commands.ts`）在选中模型的前/后 `addSiblingBlocks` 插入 `affine:latex` 块，`removeEmptyLine` 时删掉空的原段落。巧思在返回值（`:48-73`）：若插入时**没带初始 latex**，等 `host.updateComplete` 后拿到块组件、`toggleEditor()` **自动弹出编辑器**让用户马上输入，并按所处环境（doc / edgeless note / edgeless text）埋点 `Telemetry`。斜杠菜单 `latexSlashMenuConfig`（`configs/slash-menu.ts`）提供 "Equation"（块）与 "Inline equation"（内联，走 `insertInlineLatex`）两项，带 `E=mc^2` / `\frac{a}{b}...` 的预览 tooltip。

### 3.5 ★markdown：定界符预处理与 math 节点

LaTeX 的 `$`/`$$` 与 markdown 其它语法易冲突，`LatexMarkdownPreprocessorExtension`（`adapters/markdown/preprocessor.ts`）在 `block`/`slice`/`doc` 三个层级预处理：

- **先保护后归一**：用占位符 `<<CODE_BLOCK_n>>` / `<<LATEX_n>>` 把代码块与已有公式**抠出来保护**，避免被后续替换误伤，处理完再还原（`:35-74`）。
- **定界符统一**：`escapeBrackets`（`:6-22`）把 `\[...\]` → `$$...$$`、`\(...\)` → `$...$`；对紧邻数字的 `$`（如价格 `$5`）加反斜杠转义避免误判为公式（`:59-62`）；`escapeMhchem` 处理化学式 `\ce{}`/`\pu{}`。正则用了 Pandoc 的空白/数字规则与反斜杠奇偶判断，直接引用了 remark-math 的已知 issue。

`latexBlockMarkdownAdapterMatcher`（`adapters/markdown/markdown.ts`）则做双向转换：markdown `math` 节点（`type === 'math'`）→ `affine:latex` 块（取 `node.value` 作 `latex`）；反向把块的 `latex` 写成 `math` 节点。依赖 `remark-math` 解析出 `math` AST 节点。

## 4. 语法特色

- **第三方渲染 + Lit 共存 hack**：`delete katexContainer['_$litPart$']` 手动清除 Lit 内部渲染标记，让 `katex.render`（命令式 DOM）与 `render(html...)`（声明式）能轮流写同一容器——真实工程里"框架与第三方库争用 DOM"的务实处理。
- **`effect()` 响应式副作用**：公式重渲、高亮重算都用 `@preact/signals-core` 的 `effect`，依赖（`latex$`/`highlightTokens$`）自动追踪；`noop(signal.value)` 是"仅为建立依赖而读取"的惯用法。
- **`AbortController` 作生命周期总线**：一个 controller 同时承载"关闭编辑器""清理 portal""解绑事件"，`signal.addEventListener('abort', ..., { once: true })` 收口——比手写 dispose 标志更干净。
- **signal 直通双向绑定**：`.latexSignal=${this.model.props.latex$}` 把模型 signal 当 prop 传入子组件，改 signal 即改模型，省去回调样板。
- **临时 `Y.Doc` 作编辑缓冲**：编辑器用独立 `Y.Doc().getText()` 承载可协同的源码编辑，`observe` 同步回主模型 signal——隔离主文档结构。
- **混入几何能力**：`class LatexBlockModel extends GfxCompatible<LatexProps>(BlockModel)`——公式块也能放白板（`xywh`/`scale`/`rotate`）。
- **`literal` 静态标签 + `customElements.define`**：标准块注册方式。
- **占位符保护式正则**：预处理器"抠出-替换-还原"模式避免正则互相干扰，是处理嵌套/冲突语法的通用技巧。

## 5. 设计 / 实现亮点

- **命令式渲染与声明式框架的务实调和**：katex 产出大块外部 DOM，本块不强行塞进 Lit 模板，而是手动 `replaceChildren` + 清除 Lit part 标记，并用 `effect` 保持响应式——既借力 katex 又不与 Lit 打架。
- **AbortController 统一浮层生命周期**：开/关/点击外部/确认/销毁全归一到一个 signal，portal 创建与回收无泄漏，是浮层 UI 的教科书写法。
- **块级与内联公式共享编辑器**：`LatexEditorMenu` 由内联 latex 包提供，块包仅复用，避免两套编辑 UI——跨包复用的典范。
- **编辑器即协同富文本 + 源码高亮**：用临时 `Y.Text` + shiki `latex` 着色，让公式源码编辑有代码编辑器般的体验，却不污染主文档。
- **插入即编辑 + 环境感知埋点**：无初始内容时自动弹编辑器、按 doc/edgeless 场景分别埋点，交互顺滑且可度量。
- **健壮的 markdown 定界符处理**：保护-归一-还原三步 + 奇偶反斜杠/数字边界判断，把 `$`/`$$`/`\(\)`/`\[\]`/化学式与价格符号的歧义逐一兜住。

## 6. 对外 API 与注意事项

- 主要导出：`LatexBlockComponent`、`insertLatexBlockCommand`、markdown/adapters 扩展；装配入口 `LatexViewExtension`（`./view`）、`LatexStoreExtension`（`./store`）。编辑器 `LatexEditorMenu`/`LatexEditorInlineManagerExtension` 来自 `@blocksuite/affine-inline-latex`。
- **约定**：插公式走 `insertLatexBlockCommand`（无初值会自动开编辑器）；公式串存于 `model.props.latex`，编辑器直接改其 signal。
- **注意**：
  - 公式 DOM 由 katex 命令式渲染，不要期望用 Lit 模板去操作 `.katex` 容器内部；改渲染逻辑要保留 `delete _$litPart$` 的清理。
  - 非法 LaTeX 渲染为 "Error equation"、空串为 "Equation" 占位，属正常降级。
  - 编辑器生命周期全由 `AbortController` 管，Enter 确认、点击外部关闭、Shift+Enter 换行。
  - markdown 转换强依赖 `remark-math` 的 `math` 节点与预处理器；自定义定界符需经预处理归一到 `$`/`$$`。
  - 编辑器源码着色用 shiki 的 `latex` 语法，主题跟随明暗切换。

## 7. 延伸

- 底层：`katex`（公式渲染）、`@blocksuite/affine-model`（`LatexBlockModel`/`LatexBlockSchema`）、`@blocksuite/std`（`GfxCompatible`/selection/命令）、`remark-math`（markdown 数学节点）。
- 同层协作：`@blocksuite/affine-inline-latex`（`LatexEditorMenu`/`LatexEditorUnit`/`insertInlineLatex`，块与内联公式共享编辑 UI）、`@blocksuite/affine-components`（`CaptionedBlockComponent`/`createLitPortal`）、`@blocksuite/affine-block-note`（`selectBlock`）、`@blocksuite/affine-rich-text`（编辑器内 `rich-text`）、`@blocksuite/affine-shared`（`ThemeProvider`/markdown 预处理框架）。
- 相关文档：`blocksuite-affine-block-code.md`（同款 shiki 源码高亮 + effect 响应式）、`blocksuite-affine-components.md`（createLitPortal/caption）、`blocksuite-affine-model.md`（schema/GfxCompatible）、`blocksuite-std.md`（inline/命令/selection）。
