# `@blocksuite/affine-inline-footnote`

> 一句话定位：AFFiNE 的**脚注/引用行内元素层**——它把一个 `footnote` 对象作为 delta 属性嵌入富文本，渲染成一个上标小圆圈 `<affine-footnote-node>`（嵌入式 embed 节点，吞掉占位文本），悬停时用 `@floating-ui/dom` 弹出带图标/标题/描述的来源卡片，点击跳转到被引用的文档/附件/网页；并提供 Markdown `[^label]` 脚注引用的双向适配。

| 项        | 值                                                                                                                                                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/inlines/footnote`                                                                                                                                                                                                                                                                                                    |
| 所属层    | L3 · 编辑器业务层（行内元素）                                                                                                                                                                                                                                                                                                           |
| 语言/形态 | TypeScript 库（Lit 组件 + InlineSpec + Markdown Adapter）                                                                                                                                                                                                                                                                               |
| 关键依赖  | `@blocksuite/std`（`InlineSpecExtension`/`INLINE_ROOT_ATTR`/`ZERO_WIDTH_*`）、`@blocksuite/affine-model`（`FootNoteSchema`）、`@blocksuite/affine-components`（`HoverController`/`PeekViewProvider`/icons）、`@blocksuite/affine-shared`（`CitationProvider`/`LinkPreviewService`/`DocDisplayMetaProvider`）、`@floating-ui/dom`、`zod` |
| 被谁依赖  | 编辑器预设、引用/脚注功能（如 AI 生成带来源的内容）装配方                                                                                                                                                                                                                                                                               |
| 对外入口  | `.`（inline-spec + footnote-node + config + adapters）、`./view`（`FootnoteViewExtension`）、`./store`（`FootnoteStoreExtension`）                                                                                                                                                                                                      |

## 1. 设计逻辑

### 它在 inline 范式里的位置

脚注与评论（见 `blocksuite-affine-inline-comment.md`）都是 delta 属性，但渲染语义相反：

- 评论是 **wrapper**：包裹原文、原文字符仍存在、可编辑；
- 脚注是 **embed**：它本身**替换**一段占位文本，渲染成一个不可编辑的原子节点（上标小圆圈）。你看到正文里的 `¹`，它背后是一个 `insert: ' '` + `attributes: { footnote }` 的 delta——那个空格就是被 embed 节点吞掉的占位符。

这正是 inline 范式里"把一个富结构塞进一行文字"的标准做法：不新建块，而是让一个字符位承载一个对象属性，由 `InlineSpecExtension` 的 `embed: true` 把它渲染成独立的 Web Component。

### 为什么单独成包，核心抽象是什么

脚注的"富"体现在三层，每层都不平凡：

1. **数据模型 `FootNote`**：一个脚注有 `label`（显示的编号/文字）和 `reference`（被引对象），`reference.type` 可以是 `doc`（文档）/`url`（网页）/`attachment`（附件），不同类型要显示不同图标、点击有不同跳转行为。模型由 `@blocksuite/affine-model` 的 `FootNoteSchema` 定义，本包只引用。
2. **交互 UI**：上标节点（`AffineFootnoteNode`）+ 悬停弹层（`FootNotePopup`）+ 弹层内的信息条（`FootNotePopupChip`）。url 类脚注还要**异步抓取网页预览**（favicon/标题/描述）并回填进属性。
3. **序列化**：脚注引用在 Markdown 里是 `[^label]`（引用）+ `[^label]: {...}`（定义）两部分，导入导出要正确配对，还要处理"URL 后紧跟脚注会被 markdown 误解析成链接"的边界。

本包把这三层组织为：`inline-spec.ts`（渲染入口）→ `footnote-node/*`（UI 三件套 + 可配置的渲染策略）→ `adapters/*`（Markdown 双向）。可配置性由 `FootNoteNodeConfigProvider` 承担，允许宿主用自定义 renderer 替换默认 UI。

### 与同层边界

footnote 与 latex 同走 embed 路线、同用 `ZERO_WIDTH_FOR_EMBED_NODE` 占位，但 footnote 的重点在**"引用关系 + 异步来源预览 + 弹层"**，而非内容编辑——脚注本身不可编辑文本，只能点开来源或由上层更新其 reference。

## 2. 目录与关键文件

```text
footnote/src/
├── index.ts                         # 导出 adapters / config / AffineFootnoteNode / inline-spec
├── inline-spec.ts                   # ★ FootNoteInlineSpecExtension：footnote schema + embed 渲染器
├── footnote-node/
│   ├── footnote-node.ts             # ★ <affine-footnote-node>：上标小圆圈 + 悬停弹层 + 点击跳转
│   ├── footnote-popup.ts            # <footnote-popup>：来源卡片，url 类异步拉 link preview
│   ├── footnote-popup-chip.ts       # <footnote-popup-chip>：图标 + 标题的信息条（纯展示）
│   └── footnote-config.ts           # FootNoteNodeConfig(Provider)：可替换的 renderer/交互策略 + DI
├── adapters/
│   ├── markdown/inline-delta.ts     # delta → mdast footnoteReference(+ 收集 definition)
│   ├── markdown/markdown-inline.ts  # mdast footnoteReference → delta（配对 definition 解析）
│   └── markdown/preprocessor.ts     # 预处理：URL 后紧跟 [^label] 时插空格，避免被当链接
├── view.ts                          # FootnoteViewExtension：注册 spec + effects
├── store.ts                         # FootnoteStoreExtension：注册三个 markdown adapter
└── effects.ts                       # define affine-footnote-node / footnote-popup / -chip
```

## 3. 实现细节

### 3.1 工厂形态的 InlineSpec：embed 渲染

`FootNoteInlineSpecExtension`（`inline-spec.ts:10-32`）用 `InlineSpecExtension` 的**工厂重载**（第一个参数是 name 字符串，第二个是 `provider => spec`），因为它要从 DI 取 `std` 和可选的 `FootNoteNodeConfig`：

```ts
export const FootNoteInlineSpecExtension =
  InlineSpecExtension<AffineTextAttributes>('footnote', provider => {
    const std = provider.get(StdIdentifier);
    const config =
      provider.getOptional(FootNoteNodeConfigIdentifier) ?? undefined;
    return {
      name: 'footnote',
      schema: z.object({
        footnote: FootNoteSchema.optional().nullable().catch(undefined),
      }),
      match: delta => !!delta.attributes?.footnote,
      renderer: ({ delta }) =>
        html`<affine-footnote-node
          .delta=${delta}
          .std=${std}
          .config=${config}
        ></affine-footnote-node>`,
      embed: true,
    };
  });
```

与 comment 的 `dynamicSchema` 不同，脚注是**固定单键** `footnote`，所以用普通 `z.object({ footnote: FootNoteSchema... })`。`embed: true` 是关键——它告诉 `InlineEditor` 把这段 delta 当作**原子嵌入节点**：光标不能进入其内部、整体作为一个字符位处理。`config` 从 DI 取（可选），注入组件后决定渲染/交互细节。

### 3.2 上标节点：render 与 embed 占位

`AffineFootnoteNode extends WithDisposable(ShadowlessElement)`（`footnote-node.ts:36`）。`render()`（`:250-271`）的要点：

```ts
const node = this.customNodeRenderer
  ? this.customNodeRenderer(footnote, this.std)
  : this._FootNoteDefaultContent(footnote);
return html`<span
  ${this.hidePopup ? '' : ref(this._whenHover.setReference)}
  class=${nodeClasses}
  >${node}<v-text .str=${ZERO_WIDTH_FOR_EMBED_NODE}></v-text
></span>`;
```

- 默认内容 `_FootNoteDefaultContent`（`:175-183`）是一个圆形小标签，显示 `label`。它有段小正则 `/^(?:doc|attachment)-(\d+)$/` 把形如 `doc-3` 的内部 label 提取出数字 `3` 来显示——内部用结构化 label，展示只给用户看编号。
- 末尾那个 `<v-text .str=${ZERO_WIDTH_FOR_EMBED_NODE}>` 是 embed 节点的**铁律**：embed 节点必须包含一个零宽字符占位文本节点，`InlineEditor` 才能正确计算光标位置、把它当成一个可被选中的整体。这是 std inline 对 embed 节点的约定。
- `ref(this._whenHover.setReference)` 把整个 span 注册为悬停触发的参考元素（非 hidePopup 时）。

### 3.3 悬停弹层：HoverController + floating-ui

`_whenHover`（`:200-248`）是一个 `HoverController`（来自 `@blocksuite/affine-components/hover`），`enterDelay: 300` 毫秒。它的回调在悬停时构造弹层模板，但先做一连串**否决条件**：无 footnote、config.hidePopup、无 selfInlineRange/inlineEditor、存在非折叠文字选区、存在块选区——任一满足就 `return null` 不弹（避免在用户正在选择文本时弹层干扰）。通过后用 floating-ui 定位：

```ts
computePosition: {
  referenceElement: this,
  placement: 'top',
  autoUpdate: true,
  middleware: [shift({ padding: POPUP_SHIFT_PADDING }), flip(), offset(POPUP_OFFSET)],
},
```

`shift`/`flip`/`offset` 是 floating-ui 的标准三件套：空间不够时平移、翻转到另一侧、保持与参考元素 4px 间距。弹出前还会 `citationService.trackEvent('Hover', ...)` 埋点。

### 3.4 点击跳转：按 reference.type 分派

`onFootnoteClick`（`:126-144`）按引用类型分流：

```ts
switch (type) {
  case 'doc':
    if (docId) this._handleDocReference(docId);
    break;
  case 'url':
    if (url) this._handleUrlReference(url);
    break;
}
```

- `doc`（`:146-153`）：用 `PeekViewProvider.peek({ docId })` 以浮层预览方式打开被引文档（而非整页跳转）；
- `url`（`:155-159`）：`normalizeUrl` + `isValidUrl` 校验后 `window.open(..., 'noopener,noreferrer')` 新开标签页，带安全 rel。

### 3.5 弹层组件：url 类的异步来源预览

`FootNotePopup extends SignalWatcher(WithDisposable(LitElement))`（`footnote-popup.ts:22`）。它用一组 `computed` signal 按 `reference.type` 计算图标、标题、tooltip：

- `_prefixIcon$`（`:63-89`）：`doc` 取 `DocDisplayMetaProvider.icon(docId)`、`attachment` 取 `getAttachmentFileIcon(fileType)`、`url` 则优先显示 favicon（经 `ImageProxyService.buildUrl` 代理，规避跨域/混合内容），加载中显示 `LoadingIcon`。
- `_popupLabel$`（`:91-116`）/`_tooltip$`（`:118-126`）：类似地按类型取标题。

最有意思的是 `connectedCallback`（`:141-186`）的**惰性抓取 + 回填**：若脚注是 url 且本地还没有 title/description，就通过 `LinkPreviewServiceIdentifier.query(url)` 异步拉取网页预览，拿到后不仅更新本地 signal，还**把数据写回脚注属性**：

```ts
const footnote: FootNote = {
  ...this.footnote,
  reference: {
    ...this.footnote.reference,
    ...(data.icon && { favicon: data.icon }),
    ...(data.title && { title: data.title }),
    ...(data.description && { description: data.description }),
  },
};
this.updateFootnoteAttributes(footnote);
```

`updateFootnoteAttributes`（由 node 传入，`footnote-node.ts:161-173`）调用 `inlineEditor.formatText(selfInlineRange, { footnote })` 把预览数据持久化进 delta——**抓一次、存下来，下次打开直接用**，避免每次悬停都打网络请求。这是"行内元素把异步副作用结果固化回数据"的典型模式。

`FootNotePopupChip`（`footnote-popup-chip.ts`）是纯展示子组件：图标 + 可省略号截断的标题，无逻辑，便于复用与测试。

### 3.6 可配置渲染：FootNoteNodeConfigProvider

`footnote-config.ts` 定义一套可插拔策略：`FootNoteNodeConfig` 接口允许宿主传 `customNodeRenderer`（替换上标样式）、`customPopupRenderer`（替换弹层）、`hidePopup`/`interactive`/`disableHoverEffect` 开关、`onPopupClick` 回调。`FootNoteNodeConfigProvider`（`:32-103`）把这些包成带 getter/setter 的可变对象，并通过 `FootNoteNodeConfigExtension(config)`（`:108-120`）注册进 DI（`FootNoteNodeConfigIdentifier`）。于是不同场景（如 AI 引用 vs 普通脚注）可注入不同配置而复用同一套节点实现。

### 3.7 Markdown 双向适配与配对收集

脚注在 Markdown 里是**引用 + 定义分离**的结构，适配器要解决配对问题。

**导出**（delta → markdown，`adapters/markdown/inline-delta.ts`）：每个脚注 delta 产出一个 `footnoteReference`（带 label/identifier）AST 节点，同时把其 `reference` 对象 JSON 序列化后存进 `context.configs` 的 `` `${FOOTNOTE_DEFINITION_PREFIX}${label}` `` 键下（`:20-43`）——因为定义节点要等所有引用处理完后统一追加到文档树尾部。url/favicon 会先 `encodeURIComponent` 编码，避免 JSON 里的特殊字符破坏 markdown。

**导入**（markdown → delta，`adapters/markdown/markdown-inline.ts`）：遇到 `footnoteReference` 时，从 `configs` 取出对应 definition，`JSON.parse` + `decodeURIComponent` 还原，再用 `FootNoteReferenceParamsSchema.parse` 校验（`:34-36`）。attachment 类若缺 `fileType` 还会从 `fileName` 后缀推断（`:40-46`）。最终产出 `[{ insert: ' ', attributes: { footnote } }]`——注意 insert 是单空格占位，正是 embed 节点的载体。解析失败则 `catch` 返回 `[]` 丢弃，不让坏数据中断整篇导入。

**预处理**（`adapters/markdown/preprocessor.ts`）：一个易被忽视的坑——`https://example.com[^1]` 会被 markdown 解析器误当成链接的一部分。`preprocessFootnoteReference`（`:31-43`）用正则 `/([^\s]+?)(\[\^[^\]]+\])(?!:)/g` 匹配"脚注引用紧跟非空白"，且仅当**前面是 URL** 时插入一个空格隔开（`isUrl` 用 `new URL()` 判定），其余情况原样保留。`levels: ['block','slice','doc']` 表示在块/切片/整文三种粒度都生效。

## 4. 语法特色

- **工厂形态 InlineSpecExtension**：`InlineSpecExtension('footnote', provider => {...})`（`inline-spec.ts:11`）用到了函数重载里"name + 工厂"的那支（`std/inline/extensions/inline-spec.ts:13-18`），因为渲染需要从 `provider` 解析 `std` 与可选 config——对比 comment 用的纯对象形态。
- **embed 节点的零宽占位约定**：`<v-text .str=${ZERO_WIDTH_FOR_EMBED_NODE}>`（`footnote-node.ts:269`）是 `embed: true` 的硬性配套，少了它 `InlineEditor` 无法正确处理该原子节点的光标与选择。
- **`computed` 派生 signal**：弹层用 `computed(() => ...)`（`footnote-popup.ts:63/91/118`）把"图标/标题/tooltip 由 reference.type 派生"写成声明式，配合 `SignalWatcher` mixin 自动重渲染；`signal` 持有 loading/preview 的异步状态。
- **对象展开条件合并**：`...(data.icon && { favicon: data.icon })`（`:174-176`）用短路 + 展开实现"字段存在才覆盖"，避免 undefined 污染 reference——比逐字段 if 赋值简洁。
- **`@floating-ui/dom` middleware 组合**：`middleware: [shift, flip, offset]`（`footnote-node.ts:239-243`）是函数式定位中间件管道，每个中间件修正一次坐标。
- **`ref` 指令注册悬停参考**：`ref(this._whenHover.setReference)`（`:267`）用 lit-html 的 `ref` 把 DOM 元素句柄交给 `HoverController`。
- **getter 代理 config**：node 用一组 `get customNodeRenderer() { return this.config?.customNodeRenderer; }`（`:78-100`）把可选 config 的字段透明代理成自身属性，读处不必反复判空 config。
- **zod `.parse` 做导入边界校验**：`FootNoteReferenceParamsSchema.parse(json)`（`markdown-inline.ts:34`）在"外部 markdown → 内部模型"的信任边界上做运行时校验，坏数据被 `try/catch` 吞掉降级为丢弃。

## 5. 设计 / 实现亮点

- **embed 节点 + 零宽占位**：用一个空格 delta 承载整个脚注对象，渲染成原子上标，既塞进了富结构又不破坏行内文本流，是 inline 范式表达"引用标记"的范本。
- **异步来源预览回填数据**：url 脚注首次悬停拉取网页 favicon/标题/描述后写回 delta 属性，把"一次网络副作用"固化为持久数据，后续零请求——性能与体验兼顾。
- **PeekView 预览而非跳转**：doc 引用用浮层预览打开，用户不离开当前上下文即可查看来源，符合知识工具的阅读流。
- **可插拔渲染策略**：`FootNoteNodeConfigProvider` 让节点/弹层/交互全部可被宿主替换，同一实现服务普通脚注与 AI 引用等多种场景。
- **Markdown 引用/定义配对 + 延迟收集**：用 `context.configs` 暂存 definition、待引用全部处理后再追加，正确还原 markdown 脚注的两段式结构；URL 预处理器则化解了"URL 粘连脚注被误判为链接"的隐蔽 bug。
- **防御式弹层否决**：悬停弹层在存在选区/块选择时主动不弹，避免干扰用户的选择操作——交互细节的克制。

## 6. 对外 API 与注意事项

- 主要导出：`AffineFootnoteNode`；`FootNoteInlineSpecExtension`；`FootNoteNodeConfig` / `FootNoteNodeConfigProvider` / `FootNoteNodeConfigExtension` / `FootNoteNodeConfigIdentifier`；markdown adapters（`footnoteReferenceDeltaToMarkdownAdapterMatcher` / `markdownFootnoteReferenceToDeltaMatcher` / `FootnoteReferenceMarkdownPreprocessorExtension`）；`./view` 的 `FootnoteViewExtension`、`./store` 的 `FootnoteStoreExtension`。
- **约定**：
  - 渲染能力经 `FootnoteViewExtension` 注册（含 `effects()` 定义自定义元素）；Markdown 双向能力经 `FootnoteStoreExtension` 注册三个 adapter，二者缺一会分别导致"不显示"或"导入导出丢脚注"。
  - 脚注 delta 的 `insert` 恒为单空格占位，真实信息全在 `attributes.footnote`（`FootNoteSchema`）。
- **注意**：
  - url 类脚注会在悬停时发起 `LinkPreviewService` 网络请求并把结果写回属性——只读文档或无该服务时降级为仅显示原始 url。
  - 点击行为依赖 `PeekViewProvider`（doc）等服务，未注册时相应跳转静默失效。
  - 导入 markdown 时若 definition 缺失或 schema 校验失败，该脚注引用会被**丢弃**（返回 `[]`）而非报错。
  - embed 节点不可编辑其内部文本，更新脚注须通过 `formatText(range, { footnote })`。

## 7. 延伸

- 模型：`@blocksuite/affine-model` 的 `FootNoteSchema` / `FootNoteReferenceParamsSchema`（脚注数据契约）。
- 服务：`@blocksuite/affine-shared/services` 的 `CitationProvider`（埋点）、`LinkPreviewServiceIdentifier`（网页预览）、`DocDisplayMetaProvider`（文档图标/标题）；`@blocksuite/affine-components` 的 `HoverController`/`PeekViewProvider`/icons。
- 底层：`@blocksuite/std/inline` 的 `InlineSpecExtension`（embed 语义）、`INLINE_ROOT_ATTR`/`ZERO_WIDTH_FOR_EMBED_NODE`（embed 占位约定）。
- 同层对照：`blocksuite-affine-inline-comment.md`（wrapper vs embed 的对比）、`blocksuite-affine-inline-latex.md`（同为 embed 但带内嵌编辑器）、`blocksuite-affine-rich-text.md`（inline 范式总述）。
