# `@blocksuite/affine-fragment-doc-title`

> 一句话定位：编辑器文档顶部的**可编辑大标题** fragment——一个绑定文档根节点 `title` 的独立 Lit 组件（`<doc-title>`），负责标题的富文本编辑、空占位、与下方正文的键盘衔接，以及把标题同步写回工作区文档元数据。

| 项        | 值                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/fragments/doc-title`                                                                                                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（fragment UI）                                                                                                                                                                                                                |
| 语言/形态 | TypeScript / Lit 组件库                                                                                                                                                                                                                         |
| 关键依赖  | `@blocksuite/affine-model`（各 BlockModel）、`@blocksuite/affine-rich-text`（`rich-text` 组件 / `focusTextModel`）、`@blocksuite/affine-shared/utils`（`matchModels`）、`@blocksuite/std`（`ShadowlessElement`）、`@preact/signals-core`、`lit` |
| 被谁依赖  | `@blocksuite/affine-fragment-outline`（用 `getDocTitleByEditorHost` 滚动定位）、聚合包 `@blocksuite/affine`、宿主/编辑器根组件                                                                                                                  |
| 对外入口  | `.`（`DocTitle` + `getDocTitleByEditorHost`）、`./view`（`DocTitleViewExtension`）                                                                                                                                                              |

## 1. 设计逻辑

**先定位 fragment 的角色**：文档标题在 AFFiNE 里不是一个普通的 `affine:*` 块——它不进入块树的正文流，而是渲染在正文**之上**、绑定在根节点 `RootBlockModel.props.title` 上的一段特殊富文本。把它单独做成 fragment（而非 widget、也非块）的原因：它是宿主/编辑器根视图直接挂载的、较大的常驻 UI，数据来源是"当前文档的根模型"，需要独立于正文块系统的键盘与光标行为。

它要解决的独有问题集中在三处：

1. **标题 ↔ 正文的光标衔接**：在标题里按 `Enter` 应把光标后半段文字切出去、落到正文首段；按 `ArrowDown` 应跳进正文第一个文本块；`Tab` 要被吞掉（标题无缩进语义）。
2. **空标题占位**：没内容时显示灰色 "Title" 占位，但正在输入法合成（composition）时不能误判为空。
3. **标题同步到 docMeta**：标题是文档的"名字"，要实时写回 `workspace.meta`，以便文件列表、面包屑等处显示。

标题文本本身的富文本编辑能力复用 `@blocksuite/affine-rich-text` 的 `<rich-text>`（且 `enableFormat=false`——标题不允许加粗等行内格式）。本包只写"标题特有的那层壳与行为"。

## 2. 目录与关键文件

```text
src/
├── doc-title.ts   # ★ DocTitle 组件：标题富文本 + 键盘衔接 + 占位 + meta 同步
├── utils.ts       # getDocTitleByEditorHost(host)：从 editor-host 反查页面里的 <doc-title>
├── view.ts        # DocTitleViewExtension：仅注册 effect（define 'doc-title'）
├── effects.ts     # customElements.define('doc-title', DocTitle)
└── index.ts       # 导出 DocTitle、getDocTitleByEditorHost
```

## 3. 实现细节

### 3.1 绑定根节点 title 的富文本

`render` 把根模型的 `title.yText` 直接喂给 `<rich-text>`（`doc-title.ts:211-231`）：

```ts
html`<rich-text
  .yText=${this._rootModel?.props.title.yText}
  .undoManager=${this.doc.history.undoManager}
  .verticalScrollContainerGetter=${() => this._viewport}
  .readonly=${this.doc.readonly}
  .enableFormat=${false}
  .wrapText=${this.wrapText}
></rich-text>`;
```

`title` 是一个 `Y.Text`，`<rich-text>` 直接操作它——于是标题编辑天然接入 Yjs 的协同与 undo/redo（共用 `doc.history.undoManager`）。`enableFormat=false` 关掉行内格式菜单，`verticalScrollContainerGetter` 指向外层 viewport 以便滚动定位。

### 3.2 标题 → 正文的键盘衔接

`_onTitleKeyDown`（`doc-title.ts:89-137`）是本组件最具"业务"的部分，分三种键处理：

- **Enter**：取当前 inline 光标位置，用 `title.split(index)` 切出右半段文字，在"首个页面可见 note"的 0 号位新建一个段落块承接这段文字，再把焦点移过去（`doc-title.ts:93-108`）。即"回车把标题光标后的内容变成正文第一段"。
- **ArrowDown**：找正文第一个文本型块（`ParagraphBlockModel` / `ListBlockModel` / `CodeBlockModel`）聚焦；没有就新建一个空段落（`doc-title.ts:109-132`）。
- **Tab**：`preventDefault + stopPropagation` 直接吞掉（`doc-title.ts:133-136`）。

这里 `_getOrCreateFirstPageVisibleNote`（`doc-title.ts:77-87`）封装了"拿到第一个非 edgeless-only 的 note，没有就建一个"——保证正文一定有容器可落笔。焦点移动统一走 rich-text 的 `focusTextModel(std, id)`。

### 3.3 空占位与输入法合成

空标题判定：`const isEmpty = !this._rootModel?.props.title.length && !this._isComposing`（`doc-title.ts:212`）。关键是 `&& !this._isComposing`——中文/日文输入法在合成拼音阶段 `title.length` 可能仍为 0，但此刻**不能**显示占位否则会闪烁。于是组件监听 `compositionstart/compositionend` 维护 `_isComposing`（`doc-title.ts:184-195`），合成期间一律不算空。占位本身是纯 CSS 伪元素 `.doc-title-container-empty::before { content: 'Title' }`（`doc-title.ts:64-70`）。

### 3.4 标题同步到 docMeta

`connectedCallback` 里给根模型的 `title.yText` 挂 Yjs `observe`，变化时调 `_updateTitleInMeta` 写回 `workspace.meta.setDocMeta`（`doc-title.ts:197-208`、`139-144`）：

```ts
rootModel.props.title.yText.observe(updateMetaTitle);
this._disposables.add(() => {
  rootModel.props.title.yText.unobserve(updateMetaTitle);
});
```

注意它用的是 **Yjs 原生 `observe/unobserve`**（不是 signal），因为要监听的是 `Y.Text` 这一底层 CRDT 结构的变更；解绑函数被塞进 `_disposables` 由 `WithDisposable` 统一清理，避免组件销毁后回调悬挂。

### 3.5 只读态的响应式切换

`doc.readonly` 可能在运行时变化（如进入预览）。组件用 signals 的 `effect` 监听，发现与缓存的 `_isReadonly` 不一致时 `requestUpdate` 触发重渲（`doc-title.ts:172-180`）——因为 `readonly` 不是 Lit property，不会自动触发更新，需手动桥接。

### 3.6 跨组件反查：getDocTitleByEditorHost

`utils.ts` 提供一个纯函数，从 `EditorHost` 沿 DOM 找到页面视口再 `querySelector('doc-title')`：

```ts
// utils.ts:5-11
export function getDocTitleByEditorHost(
  editorHost: EditorHost
): DocTitle | null {
  const docViewport = editorHost.closest('.affine-page-viewport');
  if (!docViewport) return null;
  return docViewport.querySelector('doc-title');
}
```

这被 `outline` 的滚动逻辑复用（点目录的文档标题项时滚动到标题）——fragment 之间通过"DOM 反查 + 公开组件引用"协作，而非直接依赖对方的内部状态。

## 4. 语法特色

- **`ShadowlessElement` 而非 `LitElement`**：`class DocTitle extends WithDisposable(ShadowlessElement)`（`doc-title.ts:20`）。标题需要继承编辑器页面的全局 CSS 变量与排版（`--affine-editor-width` 等），因此用 `@blocksuite/std` 的 ShadowlessElement **不建 Shadow DOM**、渲染进 light DOM，样式才能穿透。
- **类型守卫回调 + `matchModels`**：`.find((child): child is NoteBlockModel => matchModels(child, [NoteBlockModel]) && ...)`（`doc-title.ts:78-82`）。箭头函数返回 `child is NoteBlockModel` 使 `find` 结果被 TS 收窄为具体模型类型，`matchModels` 是运行时 flavour 匹配。
- **`@state` vs `@property`**：`@state() _isComposing` / `_isReadonly` 是**内部**响应式状态（`doc-title.ts:233-237`），`@property({ attribute: false }) doc` / `wrapText` 是**外部**输入（`doc-title.ts:242-246`）——Lit 用两种装饰器区分数据流向。
- **`@query` 取子元素**：`@query('rich-text') private accessor _richTextElement!: RichText`（`doc-title.ts:239-240`）声明式绑定渲染后的子组件引用，供 `inlineEditor` getter 使用。
- **可选链贯穿**：`this._rootModel?.props.title.split(...)`、`this._std`（`doc-title.ts:146-148`，经 `querySelector('editor-host')?.std` 取得）大量用 `?.`——因为标题组件可能在 host/root 尚未就绪时渲染，必须容忍空值。
- **CSS 容器查询**：样式里 `@container viewport (width <= 640px)`（`doc-title.ts:55-62`）用容器查询而非媒体查询做窄屏适配——标题宽度随编辑器容器而非视口变化。

## 5. 设计 / 实现亮点

- **标题即根模型 title 的视图**：不引入独立数据，直接把 `RootBlockModel.props.title`（一个 `Y.Text`）绑到 `<rich-text>`，天然获得协同、历史、只读，复用而非重造富文本能力。
- **光标衔接的细腻处理**：Enter 切分、ArrowDown 下钻、Tab 吞键，三种键盘行为把"标题"与"正文块系统"这两个本不连续的编辑域缝合成连贯的编辑体验。
- **输入法合成感知的占位**：`&& !this._isComposing` 一处细节解决了 CJK 输入时占位闪烁的经典 bug。
- **Shadowless + 容器查询**：为融入编辑器排版放弃 Shadow DOM，再用容器查询做响应式，是"嵌入宿主排版的大号文本组件"的务实选择。
- **DOM 反查式协作**：`getDocTitleByEditorHost` 让 outline 等 fragment 无需耦合内部状态即可定位标题，fragment 间低耦合。

## 6. 对外 API 与注意事项

- 主要导出（`.`）：`DocTitle`（组件类，标签 `doc-title`）、`getDocTitleByEditorHost`；`./view` 导出 `DocTitleViewExtension`。
- **用法**：装载 `DocTitleViewExtension`（经 `effect()` 定义 `doc-title` 标签）后，在页面视口里挂 `<doc-title .doc=${store} .wrapText=${true}></doc-title>`；`doc` 必传（是文档的 `Store`）。
- **注意**：
  - 组件靠 `this.closest('.affine-page-viewport') ?? '.affine-edgeless-viewport'` 定位外层（`doc-title.ts:154-159`），`_std` 靠 `querySelector('editor-host')?.std` 取得——因此 `<doc-title>` **必须挂在编辑器视口容器内部**，否则 `_std` 为空、键盘衔接静默失效。
  - 它操作的是**根节点 title**，一个文档只应有一个 `<doc-title>`。
  - `view.ts` 的 extension 只做 `customElements.define('doc-title', ...)`，不注册 scope 扩展；标题的挂载位置由编辑器根组件决定，不由 fragment 自己插入。
  - `title` 变化经 Yjs `observe` 同步到 docMeta，解绑随组件销毁，勿在外部重复 `observe` 同一 yText。

## 7. 延伸

- 机制依赖：`@blocksuite/affine-ext-loader`（`ViewExtensionProvider` / effect 一次性，见 `blocksuite-affine-ext-loader.md`）。
- 富文本底座：`@blocksuite/affine-rich-text`（`<rich-text>`、`focusTextModel`）、`@blocksuite/affine-model`（`RootBlockModel`/`NoteBlockModel` 等）。
- 协作方：`@blocksuite/affine-fragment-outline` 经 `getDocTitleByEditorHost` 滚动定位标题（见 `blocksuite-affine-fragment-outline.md`）。
- 上层聚合：`@blocksuite/affine` 把 `DocTitleViewExtension` 收进 `getInternalViewExtensions()`（见 `blocksuite-affine.md`）。
