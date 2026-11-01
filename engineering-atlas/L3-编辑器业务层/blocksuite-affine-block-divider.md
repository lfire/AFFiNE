# `@blocksuite/affine-block-divider`

> 一句话定位：AFFiNE 的**分割线块**——在文档里渲染一条水平线（`<hr>`）的最简内容块。它没有可编辑文本、没有服务、没有工具栏，是观察"块包统一范式"**最小骨架**的最佳样本：一个块到底至少需要哪几件东西才能存在、能序列化、能被 markdown 快捷输入唤出。

| 项        | 值                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/blocks/divider`                                                                                                                                                                                                                                       |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                              |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                    |
| 关键依赖  | `@blocksuite/std`（`BlockViewExtension`/`BlockSelection`）、`@blocksuite/affine-model`（`DividerBlockSchema`）、`@blocksuite/affine-components`（`CaptionedBlockComponent`）、`@blocksuite/affine-rich-text`（`focusTextModel`）、`@blocksuite/affine-ext-loader`、`lit` |
| 被谁依赖  | 编辑器预设、`@affine/core`                                                                                                                                                                                                                                               |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                 |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | divider 实现                                                                                                                    | 对比 code 块                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| schema/model                      | 复用 `affine-model` 的 `DividerBlockSchema`/`DividerBlockModel`（`role: 'content'`，`children: []`，props 仅一个未用的 `text`） | code 有 `language`/`wrap`/`preview` 等多属性 |
| `*-block.ts`                      | `divider-block.ts` → `DividerBlockComponent`（只渲染一条 `<hr>`）                                                               | code 渲染 rich-text + 行号 + 预览            |
| service                           | **无**                                                                                                                          | code 有 `CodeBlockHighlighter`               |
| inline                            | **无**（无可编辑文本）                                                                                                          | code 有 `affine-code-unit`                   |
| keymap                            | **无**（内部无光标）                                                                                                            | code 有多行缩进/括号配对                     |
| widgets                           | **无工具栏**                                                                                                                    | code 有 `code-toolbar`                       |
| `markdown`（快捷输入）            | `markdown.ts` → `DividerMarkdownExtension`（`---`/`***`/`___` + 空格转分割线）                                                  | code 是 ` ``` ` 围栏                         |
| `adapters`（序列化）              | `adapters/`：markdown↔`thematicBreak`、html↔`<hr>`、plain-text→`---`、notion-html→块                                            | code 是围栏文本                              |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define` + `DividerViewExtension`/`DividerStoreExtension`                                                        | 结构完全相同                                 |

一句话：divider 把范式里**所有"可选"部件（service/inline/keymap/widget）全部省略**，只保留"一个块不可或缺"的四件套——**model、block 视图、view/store 注册、adapters 序列化**，外加一条 markdown 快捷输入。读懂它，就读懂了其它块"在最小骨架之上还多做了什么"。

### 分割线块的独有问题（其实是"没有问题"）

1. **无内容、不可编辑**：它不承载文本，组件要显式 `contentEditable = 'false'`，点击时整块进入**块选区**（而非落光标）。
2. **仍需参与文档结构**：虽然自己无文本，但 `role: 'content'` 且可以有 `children`（罕见但 schema 允许），所以仍要 `renderChildren`。
3. **要能被"打"出来**：用户在段落里敲 `---` 应就地转成分割线——这由内联 markdown 规则在**段落块**内触发、再在父级插入一个 divider 块完成。

## 2. 目录与关键文件

```text
src/
├── divider-block.ts      # ★DividerBlockComponent：渲染 <hr> + children；click→块选区
├── styles.ts             # dividerBlockStyles：.affine-divider-block-container + hr
├── markdown.ts           # ★DividerMarkdownExtension：段落内 ---/***/___ + 空格 → 新建 divider
├── view.ts               # DividerViewExtension：注册 BlockViewExtension + markdown + effects
├── store.ts              # DividerStoreExtension：注册 schema + adapters
├── effects.ts            # customElements.define('affine-divider', …)
├── index.ts              # 导出 adapters + divider-block
└── adapters/             # 四种格式的双向序列化
    ├── extension.ts      # DividerBlockAdapterExtensions：汇总四个 adapter
    ├── markdown.ts       # thematicBreak ↔ affine:divider
    ├── html.ts           # <hr> ↔ affine:divider
    ├── plain-text.ts     # affine:divider → "---\n"（单向导出）
    └── notion-html.ts    # Notion <hr> → affine:divider（单向导入）
```

## 3. 实现细节

### 3.1 model：几乎为空的 schema

`DividerBlockModel`（`model/src/blocks/divider/divider-model.ts:7-24`）是全仓最朴素的 schema 之一：

```ts
export const DividerBlockSchema = defineBlockSchema({
  flavour: 'affine:divider',
  metadata: { version: 1, role: 'content', children: [] },
  toModel: () => new DividerBlockModel(),
});
type Props = { text: string };
export class DividerBlockModel extends BlockModel<Props> {}
```

- `defineBlockSchema` 声明 flavour、版本、角色与允许的子块；`toModel` 返回模型实例。
- `Props` 里虽声明了 `text`，但组件从不渲染它——这是历史遗留字段，真正有意义的只有"这个块存在于某位置"这一事实。`BlockModel` 是空类，没有任何自定义方法：**模型即纯数据**。

### 3.2 block 视图：一条 `<hr>` 与块选区

`DividerBlockComponent`（`divider-block.ts:9-44`）继承 `CaptionedBlockComponent`（与其它块同源，免费获得 caption/选中框等能力），本体极简：

```ts
override connectedCallback() {
  super.connectedCallback();
  this.contentEditable = 'false';
  this.handleEvent('click', () => {
    this.host.selection.setGroup('note', [
      this.host.selection.create(BlockSelection, { blockId: this.blockId }),
    ]);
  });
}
override renderBlock() {
  const children = html`<div class="affine-block-children-container"
    style="padding-left: ${BLOCK_CHILDREN_CONTAINER_PADDING_LEFT}px">
    ${this.renderChildren(this.model)}
  </div>`;
  return html`<div class="affine-divider-block-container"><hr />${children}</div>`;
}
override accessor useZeroWidth = true;
```

- **`contentEditable = 'false'`**：块无文本，禁止浏览器把它当可编辑区；因此没有 inline、没有 keymap。
- **click → 块选区**：因为落不了光标，点击时用 `selection.create(BlockSelection, { blockId })` 把整块选中（放进 `'note'` 选区组）。这是"原子块/嵌入块"的通用交互范式。
- **`renderChildren`**：schema 允许 children，故仍渲染子容器，左内边距用共享常量 `BLOCK_CHILDREN_CONTAINER_PADDING_LEFT`。
- **`useZeroWidth = true`**：告诉框架这是零宽（无文本光标宽度）块，影响选区/光标落点计算——这是无文本块与段落块在渲染层的关键差异。
- 样式（`styles.ts`）仅 20 行：容器 `height:1px` + 上下 `padding:18px`，`<hr>` 用 `border-top: 1px solid var(--affine-divider-color)` 跟随主题色。

### 3.3 ★markdown 快捷输入：在段落里"打"出分割线

`DividerMarkdownExtension`（`markdown.ts:13-63`）是 divider 唯一的"主动行为"。它是一个 `InlineMarkdownExtension`——注册在**内联编辑器**层面，当用户在一个段落里输入匹配 `pattern` 的文本时触发：

```ts
InlineMarkdownExtension<AffineTextAttributes>({
  name: 'divider',
  pattern: /^(-{3,}|\*{3,}|_{3,})\s$/,   // 行首 3+ 个 -/*/_ 再加空格
  action: ({ inlineEditor, inlineRange }) => { … },
});
```

`action` 的流程讲透了"块转换"的标准姿势：

1. **防误触**：若光标前文本已含 `\n`（不是行首）则放弃。
2. **定位宿主块**：从 `inlineEditor.rootElement` 向上 `closest('[data-block-id]')` 找到当前 `BlockComponent`，取出 `model/std/store`。
3. **类型校验**：只在 `ParagraphBlockModel` 且 `type !== 'quote'` 时转换——引用块里敲 `---` 不该变分割线。
4. **原子操作**：`store.captureSync()` 打一个 undo 断点后，`deleteText` 删掉刚输入的 `---`，再 `store.addBlock('affine:divider', { children }, parent, index)` 在**同一位置**插入分割线块，并把原段落的 children 迁移过去。
5. **恢复编辑焦点**：分割线自己不可编辑，于是找它后面的块（没有就新建一个空段落），`focusTextModel(std, id)` 把光标放进去——保证"打完分割线能接着打字"。

> 注意这里的层次：`markdown.ts` 是**内联快捷输入**（输入时触发），而 `adapters/markdown.ts` 是**文档序列化**（导入导出时触发）。两者都叫 markdown 却服务完全不同的场景，divider 把这组区分展示得最干净。

### 3.4 adapters：四种格式的双向序列化

divider 无内容，所以它的 adapter 是"最纯"的转换样例——没有属性、没有文本，只有"一个节点↔一个块"：

| adapter                            | toBlockSnapshot（导入）                                 | fromBlockSnapshot（导出）          |
| ---------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| markdown（`adapters/markdown.ts`） | `thematicBreak` → `affine:divider`（空 props/children） | `affine:divider` → `thematicBreak` |
| html（`html.ts`）                  | `<hr>` → `affine:divider`                               | `affine:divider` → `<hr>`          |
| plain-text（`plain-text.ts`）      | `toMatch: () => false`（不导入）                        | 往 `textBuffer` 追加 `"---\n"`     |
| notion-html（`notion-html.ts`）    | Notion `<hr>` → `affine:divider`                        | `fromMatch: () => false`（不导出） |

每个 adapter 的核心都是 `walkerContext.openNode({…}).closeNode()`——用访问者（walker）在两套树（外部 AST ↔ BlockSuite snapshot）之间开/关节点。plain-text 和 notion-html 刻意做成**单向**：纯文本只需导出一行 `---`、无法反解析（`toMatch` 恒 false）；notion 的 `<hr>` 只需导入、AFFiNE 自己导出走标准 html adapter（`fromMatch` 恒 false）。这种"按方向裁剪"的手法在所有块里通用。

### 3.5 装配：view / store 两条注册线

和范式一致，divider 分两个 `ViewExtensionProvider`/`StoreExtensionProvider`：

```ts
// view.ts —— 运行期（UI）
class DividerViewExtension extends ViewExtensionProvider {
  override effect() {
    super.effect();
    effects();
  } // customElements.define
  override setup(context) {
    context.register([
      BlockViewExtension('affine:divider', literal`affine-divider`),
      DividerMarkdownExtension,
    ]);
  }
}
// store.ts —— 数据期（序列化/schema）
class DividerStoreExtension extends StoreExtensionProvider {
  override setup(context) {
    context.register(DividerBlockSchemaExtension);
    context.register(DividerBlockAdapterExtensions);
  }
}
```

- **view 管 UI**：`effect()` 里 `effects()` 调 `customElements.define('affine-divider', DividerBlockComponent)` 注册自定义元素；`setup` 把 flavour `'affine:divider'` 绑到标签 `affine-divider`（`literal` 模板），并挂上内联 markdown 规则。
- **store 管数据**：只注册 schema 与四个 adapter。
- 这条**view/store 分离**是全块统一的：UI 与持久化可以分别加载（如纯后端做序列化时只需 store 扩展，不必引入 Lit 组件）。divider 因为没有 service/widget，`setup` 的 `register` 数组短到只有两项——正是最小块的样子。

## 4. 语法特色

- **Lit `html` 模板 + `renderBlock()` 钩子**：`CaptionedBlockComponent` 约定子类实现 `renderBlock()` 而非 `render()`，基类再在外层包裹 caption/选中框。divider 的 `renderBlock` 是教科书级的最小实现。
- **`accessor` 字段 + `override`**：`override accessor useZeroWidth = true` 用 TS 的 `accessor` 关键字声明一个由装饰器/基类接管的响应式字段（Lit 的 `@property`/reactive 体系依赖 accessor 语义），`override` 确保它确实覆盖基类同名成员。
- **`literal` 标签模板**：`BlockViewExtension('affine:divider', literal\`affine-divider\`)`用`lit/static-html`的`literal` 在运行期安全注入静态标签名——flavour 到自定义元素的映射。
- **`declare global { interface HTMLElementTagNameMap }`**：声明合并，把 `'affine-divider'` 登记进全局标签名表，使 `document.createElement('affine-divider')` 与 `querySelector` 获得精确类型。
- **正则字面量做输入规则**：`pattern: /^(-{3,}|\*{3,}|_{3,})\s$/` 直接用 RegExp 匹配三种 markdown 分割线写法，`\s` 结尾表示"输入空格时触发"。
- **adapter 的字面量对象 + 工厂包装**：`BlockMarkdownAdapterExtension(matcher)` 把一个纯对象 matcher 包成 `ExtensionType`，是整套 adapter 的统一构造模式。

## 5. 设计 / 实现亮点

- **"最小可存在块"的参照系**：divider 精确演示了一个块的不可省部件集合（model + block 视图 + view/store 注册 + adapters），任何更复杂的块都可视为"在此之上叠加 service/inline/keymap/widget"。它是理解块范式的最佳入口。
- **无文本块的交互范式**：`contentEditable=false` + `click→BlockSelection` + `useZeroWidth=true` 三件套，是所有原子/嵌入块（divider、bookmark、embed 卡片）共享的"不可落光标块"处理方式。
- **两个 "markdown" 的清晰分层**：内联快捷输入（`markdown.ts`）与文档序列化（`adapters/markdown.ts`）职责不同、触发时机不同，divider 让这组常被混淆的概念对照鲜明。
- **块转换的标准流程**：`captureSync → deleteText → addBlock → focusTextModel` 这套"就地把段落变成某块"的步骤，可直接套用到其它 markdown 触发的块。
- **按方向裁剪的 adapter**：用 `toMatch:()=>false` / `fromMatch:()=>false` 显式关闭某个方向，比写空实现更自解释。

## 6. 对外 API 与注意事项

- 主要导出：`DividerBlockComponent`（`.` 与 `./view` 间接）、`DividerViewExtension`（`./view`）、`DividerStoreExtension`（`./store`）、`DividerBlockAdapterExtensions`（`index.ts` 经 `adapters`）。
- **约定**：UI 场景装 `DividerViewExtension`，纯数据/SSR 场景只装 `DividerStoreExtension`；二者都要，缺一则"有数据无渲染"或"有渲染无法序列化"。
- **注意**：
  - divider 不可编辑、不能落光标，交互只有整块选中；不要给它绑内联/光标逻辑。
  - `model.props.text` 是遗留字段，渲染与序列化都不使用，勿依赖。
  - markdown 快捷输入只在**非 quote 的段落**里生效；它新建的是**父级的兄弟块**，并会迁移原段落 children、再把焦点转移到后继块。
  - plain-text/notion-html adapter 是单向的——复制为纯文本只得 `---`，无法从纯文本反解析出分割线。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`DividerBlockSchema`/`DividerBlockModel`）、`@blocksuite/store`（`defineBlockSchema`/`BlockSchemaExtension`/`nanoid`）、`@blocksuite/std`（`BlockViewExtension`/`BlockSelection`）。
- 同层协作：`@blocksuite/affine-components`（`CaptionedBlockComponent`）、`@blocksuite/affine-rich-text`（`focusTextModel`）、`@blocksuite/affine-shared`（adapters 基建、`matchModels`、常量）、`@blocksuite/affine-ext-loader`（`ViewExtensionProvider`/`StoreExtensionProvider`）。
- 对照阅读：`blocksuite-affine-block-code.md`（同范式的"复杂端"），两篇并读可量化"一个块从最小到复杂多付出了什么"。
