# `@blocksuite/affine-inline-link`

> 一句话定位：AFFiNE 的**行内超链接元素层**——它把一个 `link` 字符串作为 delta 属性"包裹"在一段文字上（wrapper 语义），渲染成 `<affine-link>`（一个带 `color: var(--affine-link-color)` 的 `<a>`），悬停时把自己交给工具栏弹出预览/编辑/转卡片的操作条；并提供 `[text](url) ` Markdown 即时转链、`toggleLink` 命令、以及把行内链接"升格"为 bookmark / embed 卡片块的能力。

| 项        | 值                                                                                                                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/inlines/link`                                                                                                                                                                                                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（行内元素）                                                                                                                                                                                                                                                                                                            |
| 语言/形态 | TypeScript 库（Lit 组件 + InlineSpec + Markdown/HTML Adapter + Toolbar）                                                                                                                                                                                                                                                                 |
| 关键依赖  | `@blocksuite/std`（`InlineSpecExtension`/`INLINE_ROOT_ATTR`）、`@blocksuite/affine-inline-reference`（`RefNodeSlotsProvider`）、`@blocksuite/affine-components`（`whenHover`/toolbar）、`@blocksuite/affine-shared`（`ToolbarRegistryIdentifier`/`ParseDocUrlProvider`/`EmbedOptionProvider`/`normalizeUrl`）、`@floating-ui/dom`、`zod` |
| 被谁依赖  | `@blocksuite/affine-inline-preset`（装进默认 inline manager + 格式栏 `Mod-k`）、编辑器预设                                                                                                                                                                                                                                               |
| 对外入口  | `.`（inline-spec + link-node + command + markdown + toolbar + adapters）、`./view`（`LinkViewExtension`）、`./store`（`LinkStoreExtension`）                                                                                                                                                                                             |

## 1. 设计逻辑

### 它在 inline 范式里的位置

沿用 `blocksuite-affine-rich-text.md` 总述的 inline 六要素，link 的站位是：

- **attribute schema**：单键 `link: z.string()`（`inline-spec.ts:12-14`）——值是一个 URL 字符串，不是对象；
- **渲染组件**：`<affine-link>`（`link-node/affine-link.ts`），是一个 **wrapper**（非 embed）——它不吞占位字符，而是把原文字符 `delta.insert` 原样套进 `<a>` 里，文字仍然可编辑、可被选中、可继续打字；
- **markdown 匹配**：`LinkExtension`（`markdown.ts`）把 `[text](url) ` 即时转成带 link 属性的文本；
- **keymap**：link 自己不注册键盘，`Mod-k` 由 preset 的格式栏配置调用本包的 `toggleLink` 命令（`command.ts`）；
- **view/store 注册**：`LinkViewExtension`（spec + toolbar）与 `LinkStoreExtension`（6 个 adapter）。

对比 footnote/mention 这些 `embed: true` 的"原子节点"，link 是 **wrapper 的典范**：`match` 命中即把渲染结果套一层，但**不设 `embed`**，所以 `InlineEditor` 仍把它当普通文字区间处理。这正是它和 reference（embed，整体是一个不可编辑的原子 token）的根本分野——同样指向一个 URL/文档，link 保留"一段可编辑文字 + 一个链接属性"，reference 则是"一个对象占一个字符位"。

### 为什么单独成包，核心抽象是什么

超链接看似简单（加个 `<a>`），但在富文本编辑器里它牵扯出一串非平凡问题，每一个都值得独立承载：

1. **contenteditable 里的 `<a>` 点不动**：在可编辑 div 内，浏览器默认不会让 `<a>` 的 `click` 跳转。本包用 `_onMouseUp`（`affine-link.ts:35-42`）临时把 `contentEditable='false'` 再异步还原的 workaround 绕过它。
2. **内部链接 vs 外部链接**：粘进来的 URL 可能其实是本工作区某个文档的链接。`openLink` 走的是 `RefNodeSlotsProvider.docLinkClicked`（复用 reference 包的跳转总线），而非直接 `window.open`——于是"行内链接"也能无缝打开成内链预览。
3. **编辑弹层**：创建/修改链接需要一个浮层输入 URL（和可选的显示文字），还要在浮层打开时画出"模拟选区"让用户知道改的是哪段。
4. **视图升格**：一个 http 链接可以转成 bookmark 卡片或 embed iframe 块——这是 AFFiNE "链接即内容"的产品点，逻辑都在工具栏配置里。
5. **序列化**：Markdown/HTML 双向，还要处理"链接的 URL 恰好是本站文档 URL 时应还原成 reference"的边界。

本包据此分层：`inline-spec.ts`（渲染入口）→ `link-node/affine-link.ts`（`<a>` 组件 + 悬停接工具栏）+ `link-node/link-popup/*`（编辑弹层）+ `link-node/configs/toolbar.ts`（预览/复制/编辑/转卡片/删链）→ `command.ts`（`toggleLink`）→ `markdown.ts` + `adapters/*`（序列化）。

### 与同层边界

link 依赖 `affine-inline-reference` 但不反向——它借用 reference 的 `RefNodeSlotsProvider` 做"内部链接跳转"，以及在 markdown 导入时把本站 URL 还原成 `reference` 属性（`adapters/markdown/markdown-inline.ts:24-42`）。可以理解为：**reference 是"纯内链"的强类型表达，link 是"任意 URL"的弱类型表达，两者在"URL 恰好是内链"处相遇并互转**。

## 2. 目录与关键文件

```text
link/src/
├── index.ts                         # 汇总导出 adapters/command/inline-spec/link-node/markdown/toolbar
├── inline-spec.ts                   # ★ LinkInlineSpecExtension：link schema(单键 string) + wrapper 渲染器
├── command.ts                       # toggleLink：选区有链接则去链、否则弹创建浮层
├── markdown.ts                      # LinkExtension：[text](url)+空格 → 加 link 属性
├── link-node/
│   ├── affine-link.ts               # ★ <affine-link>：渲染 <a> + 悬停接工具栏 + 内链识别 + openLink
│   ├── configs/toolbar.ts           # ★ 工具栏配置：预览/复制/编辑/Inline-Card-Embed 视图切换/去链/删除
│   └── link-popup/
│       ├── link-popup.ts            # <link-popup>：create/edit 两态浮层 + floating-ui 定位 + 模拟选区
│       ├── toggle-link-popup.ts     # toggleLinkPopup：实例化并挂载浮层
│       └── styles.ts                # 浮层样式
├── adapters/
│   ├── markdown/inline-delta.ts     # delta → mdast link/text
│   ├── markdown/markdown-inline.ts  # mdast link → delta（本站 URL 还原成 reference）
│   ├── html/*.ts  notion-html/*.ts  plain-text/*.ts  # 其余格式双向
│   └── index.ts
├── view.ts / store.ts / effects.ts  # 扩展注册 + customElements.define
└── toolbar.ts                       # linkToolbar：把 toolbar 配置绑到 affine:link flavour
```

## 3. 实现细节

### 3.1 wrapper 形态的 InlineSpec：单键 string schema

`LinkInlineSpecExtension`（`inline-spec.ts:7-22`）走的是 `InlineSpecExtension` 的**工厂重载**（`'link', provider => spec`），因为渲染要从 DI 取 `std` 传给组件：

```ts
export const LinkInlineSpecExtension =
  InlineSpecExtension<AffineTextAttributes>('link', provider => {
    const std = provider.get(StdIdentifier);
    return {
      name: 'link',
      schema: z.object({
        link: z.string().optional().nullable().catch(undefined),
      }),
      match: delta => !!delta.attributes?.link,
      renderer: ({ delta }) =>
        html`<affine-link .std=${std} .delta=${delta}></affine-link>`,
    };
  });
```

注意**没有 `embed: true`**——这是 wrapper 与 embed 的唯一开关差异。schema 是 `z.string()`（URL 字面量），`.catch(undefined)` 保证脏数据不抛错。`match` 仅看 `attributes.link` 是否存在。在 `InlineManager.getRenderer`（`std/inline/extensions/inline-manager.ts:30-60`）里，normal spec（link 属此类）命中后直接替换渲染结果；link 不是 wrapper 类（`spec.wrapper` 未设），但因为它不 `embed`，`<a>` 内的 `<v-text .str=${this.delta.insert}>`（`affine-link.ts:155`）承载真实文字，光标照常进出。

### 3.2 `<affine-link>`：`<a>` 渲染与 contenteditable workaround

`AffineLink extends WithDisposable(ShadowlessElement)`（`affine-link.ts:24`）。`render()`（`:159-178`）区分三种样式：带 `code` 属性时外套 `<code>`，否则用 `affineTextStyles` 合并链接色。核心 `_renderLink`（`:146-157`）：

```ts
return html`<a
  href=${this.link}
  rel="noopener noreferrer"
  target="_blank"
  style=${styleMap(style)}
  @click=${this.openLink}
  @auxclick=${this.openLink}
  @mouseup=${this._onMouseUp}
  ><v-text .str=${this.delta.insert}></v-text
></a>`;
```

- `link` getter（`:124-126`）对原始属性做 `normalizeUrl`，保证缺协议的 `example.com` 补成合法 URL。
- `_onMouseUp`（`:35-42`）是那条著名 workaround：contenteditable 容器里的 `<a>` 无法直接点击跳转，它在 mouseup 时把 `anchorElement.contentEditable='false'`，并用 `setTimeout(…, 0)` 在下一拍 `removeAttribute('contenteditable')` 还原——短暂"脱离可编辑"让点击生效。只读模式下无此问题，注释里专门说明（`:102-108`）。

### 3.3 内链识别：link 复用 reference 的跳转总线

`openLink`（`:46-65`）不直接 `window.open`，而是：首次点击时惰性 `_identify()`（`:134-144`）——用 `ParseDocUrlProvider.parseDocUrl(link)` 试着把 URL 解析成 `{ docId, ...params }`，成功则存进 `_referenceInfo`。随后把事件推给 `RefNodeSlotsProvider.docLinkClicked`：

```ts
refNodeSlotsProvider.docLinkClicked.next({
  ...referenceInfo,
  openMode: e?.button === 1 ? 'open-in-new-tab' : undefined,
  host: this.std.host,
});
```

中键（`button === 1`）映射成"新标签页打开"。没有 `RefNodeSlotsProvider`（如独立使用）时直接 `return`——由原生 `<a target="_blank">` 兜底。**这解释了为何 link 要依赖 reference 包**：内链跳转是一套总线，link 和 reference 都往里推事件。

### 3.4 悬停接管工具栏：ToolbarRegistry 的 message$ 信号

link 自己不画弹层，而是把"我被悬停了"这件事广播给全局工具栏。`_whenHover`（`:67-85`）用 `whenHover` 以 `enterDelay: 500`：

```ts
message$.value = {
  flavour: 'affine:link',
  element: this,
  setFloating: this._whenHover.setFloating,
};
```

即把自身 element 和定位回调写进 `ToolbarRegistryIdentifier.message$` 信号；移出时清空。工具栏系统监听此信号、按 `flavour: 'affine:link'` 找到 `linkToolbar`（`toolbar.ts`）的配置来渲染操作条。这种"悬停元素只发信号、工具栏统一渲染"的解耦，让 link/reference 共用一套浮动工具栏框架而互不耦合。

### 3.5 编辑弹层：create / edit 双态 + 模拟选区

`LinkPopup`（`link-popup/link-popup.ts:29`）用 `choose(this.type, [['create', …], ['edit', …]])`（`:293-296`）在一个组件里切两套模板。要点：

- **create**（`_createTemplate :34-57`）只有一个 link 输入框；**edit**（`_editTemplate :59-105`）多一个 text 输入框，可同时改显示文字与 URL。
- `_onConfirm`（`:131-164`）：校验 `isValidUrl` 后 `normalizeUrl`；create 用 `formatText(range, { link, reference: null })`——**显式把 reference 置 null**，避免同一段同时挂 link 和 reference 两种属性冲突；edit 用 `insertText` 替换文字再设链接。
- **模拟选区**：浮层打开后原生选区会丢失视觉高亮，`updateMockSelection`（`:193-221`）据 `inlineEditor.toDomRange(range).getClientRects()` 手绘一批 `.mock-selection` div 补上选区观感。
- **定位**：`firstUpdated`（`:240-286`）用 `autoUpdate + computePosition`，middleware `[offset(10), inline(), shift({padding:6})]`——`inline()` 是 floating-ui 针对"跨行行内元素"的专用中间件，让浮层贴着被选文字的实际行盒而非外接矩形。
- 打开时 `document.body.style.overflow='hidden'`（`:230-237`）禁滚动，销毁时还原。

`toggleLinkPopup`（`toggle-link-popup.ts`）负责实例化并把浮层挂到 `editor-host` 的父元素（或 `document.body`）下。

### 3.6 `toggleLink` 命令：有链去链、无链弹层

`toggleLink`（`command.ts:10-42`）是 `Mod-k` 背后的命令：从 DOM selection 回溯到 `INLINE_ROOT_ATTR` 根、取 `targetInlineRange`，若当前 format 已有 link 就 `formatText(range, { link: null })` 去链；否则 new 一个 `AbortController` 弹出 create 浮层，并把 `abort → popup.remove()` 绑好。它要求选区非折叠（`length === 0` 直接 `return false`），这也是 preset 格式栏里 link 项 `textChecker` 要校验选区长度的原因。

### 3.7 视图升格：行内链接 → bookmark / embed 卡片

工具栏配置 `builtinInlineLinkToolbarConfig`（`configs/toolbar.ts`）的 `c.conversions` 组是本包的产品亮点——把一段 http 行内链接变成独立的卡片块：

- **Card view**（`:111-177`）：从 `EmbedOptionProvider.getEmbedBlockOptions(url)` 查有无专用卡片 flavour，没有则回退 `affine:bookmark`；在原块后 `addBlock` 插入卡片，并据"链接文字是否占满整块"决定删整块还是仅去链（`:159-165`）。
- **Embed view**（`:178-267`）：`when` 先用 `EmbedIframeService.canEmbed(url)` 或 embed 选项判断该 URL 能否内嵌 iframe，可嵌才显示；`run` 走 iframe 块或专用 embed flavour。
- 整个 group 的 `when`（`:295-327`）做了严谨的"可行性校验"：数据库/表格内不显示、非 http 不显示、还用 `schema.validateSchema(bookmarkSchema, parentSchema)` 校验 bookmark 能否作为当前父块的子块——**schema 不允许就不提供该操作**，避免产生非法文档结构。

此外 `a.preview` 渲染 `<affine-link-preview>`、`b.copy-link`、`edit`（复用 edit 浮层）、以及 More 菜单里的 `Remove link`/`Delete`。

### 3.8 Markdown / HTML 双向与"本站 URL 还原成内链"

**导出**（`adapters/markdown/inline-delta.ts`）：有 link 属性的 delta 产出 mdast `link` 节点包住文字；但做了两个边界处理（`:18-33`）——当前节点文字为空时直接输出 URL 文本；文字等于 URL 时退化成纯 text，避免 `[http://x](http://x)` 的冗余。

**导入**（`adapters/markdown/markdown-inline.ts`）：遇到 mdast `link`，先比对 `configs.get('docLinkBaseUrl')`，若 URL 以本站前缀开头就**解析出 `pageId` + `mode/blockIds/elementIds` 还原成 `reference` 属性**（`:12-43`），即"外部看是普通链接、导回来变成强类型内链"；否则才作为普通 `link` 属性附加到子节点文字上（`:45-50`）。这与 link-node 的 `_identify` 内链识别遥相呼应。

## 4. 语法特色

- **工厂形态 `InlineSpecExtension('link', provider => …)`**（`inline-spec.ts:7`）：用函数重载里"name + provider 工厂"那支（`std/inline/extensions/inline-spec.ts`），因为渲染要注入 `std`；对比 preset 的 bold 等用纯对象形态。
- **wrapper vs embed 仅差一个布尔**：link 不写 `embed`，于是 `<v-text .str=${this.delta.insert}>`（`affine-link.ts:155`）里是**真实文字**而非零宽占位——这是和 footnote/reference 的 `ZERO_WIDTH_FOR_EMBED_NODE` 最直观的代码级区别。
- **`lit/directives/choose` 多态模板**：`choose(this.type, [...])`（`link-popup.ts:293`）按 `'create'|'edit'` 选模板，比三元嵌套可读。
- **`styleMap` + `affineTextStyles` 合并样式**：`styleMap(affineTextStyles(attrs, linkStyle))`（`affine-link.ts:174`）把 bold/italic 等文字样式与链接色叠加，link 文字也能同时加粗。
- **`@floating-ui/dom` 的 `inline()` 中间件**：`middleware:[offset(10), inline(), shift(...)]`（`link-popup.ts:267-273`）专治跨行行内元素的定位。
- **信号驱动的工具栏解耦**：把 `{flavour, element, setFloating}` 写进 `message$`（`affine-link.ts:71-77`）而非自管弹层，是"关注点上移"的典型。
- **`satisfies ToolbarModuleConfig`**：`configs/toolbar.ts:365` 用 `as const satisfies` 既冻结字面量类型又校验结构，`ToolbarActionGroup<ToolbarAction>`（`:328`）保证每个 action 形状正确。
- **惰性 `_identified` 标志位**：`openLink` 首次才 `_identify()`（`:47-50`），把"URL 是否内链"的解析推迟到真正点击时，省掉未点击链接的解析开销。

## 5. 设计 / 实现亮点

- **wrapper 语义保留可编辑文字**：link 不吞字符、文字照常编辑，与 reference 的 embed 原子 token 形成互补——同样指向 URL，产品语义不同、实现正好一个带 `embed` 一个不带。
- **内链跳转复用 reference 总线**：link 借 `RefNodeSlotsProvider.docLinkClicked` 让"看似外链实为内链"的 URL 走统一的文档打开流程，并在 markdown 层把本站 URL 还原成 `reference`，双向打通两种表达。
- **悬停只发信号、工具栏统一渲染**：`ToolbarRegistry.message$` 把"谁被悬停"与"怎么渲染操作条"解耦，link/reference 共用一套浮动工具栏。
- **视图升格的 schema 守卫**：转卡片前用 `schema.validateSchema` 校验父子合法性，把"不产生非法文档"作为能力开关的前置条件，是结构化编辑器的严谨之处。
- **contenteditable `<a>` 的 workaround**：`_onMouseUp` 临时切 `contentEditable` 的小技巧，解决了一个浏览器层面的顽疾，且只读态自动免除。
- **编辑浮层的模拟选区**：浮层抢焦点后手绘 `.mock-selection` 维持选区观感，细节上尊重用户的"我在改哪段"认知。

## 6. 对外 API 与注意事项

- 主要导出：`AffineLink`、`LinkPopup`、`toggleLinkPopup`；`LinkInlineSpecExtension`；`toggleLink` 命令；`LinkExtension`（markdown）；`builtinInlineLinkToolbarConfig` / `linkToolbar`；各格式 adapter matcher；`./view` 的 `LinkViewExtension`、`./store` 的 `LinkStoreExtension`。
- **约定**：
  - 渲染经 `LinkViewExtension`（注册 spec + toolbar + `effects()` 定义 `<affine-link>`/`<link-popup>`）；序列化经 `LinkStoreExtension`（注册 markdown/html/notion-html 共 6 个 adapter）。
  - link 属性是 URL 字符串；设置 link 时应同时把 `reference` 置 `null`（见 `link-popup._onConfirm`），避免一段文字同时挂两种链接语义。
- **注意**：
  - 内链跳转与视图升格依赖 `RefNodeSlotsProvider` / `EmbedOptionProvider` / `EmbedIframeService`，未注册时相应能力静默降级（外链仍可用原生 `<a>` 打开）。
  - `toggleLink` 要求非折叠选区；折叠光标调用返回 `false`。
  - 工具栏的 Card/Embed 转换在数据库/表格内、非 http 链接、或 schema 不允许时不出现。
  - contenteditable 内点击依赖 `_onMouseUp` workaround；若自定义渲染覆盖了该事件需自行处理跳转。

## 7. 延伸

- 跳转总线：`@blocksuite/affine-inline-reference` 的 `RefNodeSlotsProvider`（`docLinkClicked`）——见 `blocksuite-affine-inline-reference.md`。
- 服务：`@blocksuite/affine-shared/services` 的 `ToolbarRegistryIdentifier`、`ParseDocUrlProvider`、`EmbedOptionProvider`、`EmbedIframeService`；`@blocksuite/affine-components` 的 `whenHover`/toolbar。
- 装配方：`@blocksuite/affine-inline-preset`（把 link spec 放进 `DefaultInlineManagerExtension`，并在格式栏绑 `Mod-k` → `toggleLink`）——见 `blocksuite-affine-inline-preset.md`。
- 底层：`@blocksuite/std/inline` 的 `InlineSpecExtension`（wrapper 语义）/`InlineMarkdownExtension`；`blocksuite-affine-rich-text.md`（inline 范式总述）、`blocksuite-affine-inline-footnote.md`（wrapper vs embed 对照）。
