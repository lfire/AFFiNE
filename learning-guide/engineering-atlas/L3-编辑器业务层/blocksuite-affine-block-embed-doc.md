# `@blocksuite/affine-block-embed-doc`

> 一句话定位：AFFiNE 的**内嵌文档块**——把一篇文档以"卡片"或"活编辑器"两种形态嵌到另一篇文档里。它提供两个 flavour：`affine:embed-linked-doc`（**链接文档卡片**，只读预览 + 标题/描述别名）与 `affine:embed-synced-doc`（**同步文档块**，内嵌一个真正可编辑的子编辑器）。独有核心是**引用信息 `ReferenceInfo` 与别名 `AliasInfo` 的建模**、**卡片的异步懒加载与内容预览渲染**、**同步块内嵌套编辑器实例与防环检测**、以及 **linked ↔ synced ↔ inline 三形态互转**。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/embed-doc`                                                                                                                                                                                                                                                                                                                                                                           |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                                                                                                                                                    |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                                          |
| 关键依赖  | `@blocksuite/affine-block-embed`（`EmbedBlockComponent`/`insertEmbedCard`）、`@blocksuite/affine-block-surface`、`@blocksuite/affine-inline-reference`（`RefNodeSlotsProvider`）、`@blocksuite/affine-model`、`@blocksuite/affine-shared`（`DocModeProvider`/`DocDisplayMetaProvider`/`ThemeProvider`）、`@blocksuite/std`（`BlockStdScope`/`LifeCycleWatcher`/`GfxExtension`）、`@preact/signals-core`、`yjs` |
| 被谁依赖  | 编辑器预设、`@affine/core`（双链/反向链接、引用等功能）                                                                                                                                                                                                                                                                                                                                                        |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                                                                                       |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | embed-doc 实现                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| schema                            | 复用 `affine-model` 的 `EmbedLinkedDocBlockSchema`/`EmbedSyncedDocBlockSchema`（在 `store.ts` 注册两个 `*SchemaExtension`）                                      |
| model                             | `EmbedLinkedDocModel`/`EmbedSyncedDocModel`，props 以 `ReferenceInfo`（`pageId`/`params`/`title`/`description`）+ `style`/`caption` 为核心                       |
| `*-block.ts`                      | `embed-linked-doc-block.ts` → `EmbedLinkedDocBlockComponent`；`embed-synced-doc-block.ts` → `EmbedSyncedDocBlockComponent`；各自还有 `embed-edgeless-*` 白板变体 |
| spec                              | `embed-linked-doc-spec.ts`/`embed-synced-doc-spec.ts` → `BlockViewExtension`（按 `parent.flavour` 在 page/surface 标签间切换）                                   |
| commands                          | `insert-embed-linked-doc.ts`/`insert-embed-synced-doc.ts` → `insertEmbedLinkedDocCommand` 等                                                                     |
| adapters                          | `adapters/`（markdown/html/plain-text/notion-html，脚注定义 ↔ citation 卡片、卡片 → 链接）                                                                       |
| configs                           | `slash-menu.ts`/`toolbar.ts`/`tooltips.ts`（斜杠插入、工具栏 Open/Style/Caption、别名编辑）                                                                      |
| clipboard                         | `edgeless-clipboard-config.ts`（白板粘贴重建卡片）                                                                                                               |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define` 五个自定义元素 + `EmbedDocViewExtension`/`EmbedDocStoreExtension`                                                                        |

它不像段落/代码那样直接继承 `CaptionedBlockComponent`，而是继承 `affine-block-embed` 的 **`EmbedBlockComponent`**——所有"卡片形态"的嵌入块（bookmark/github/figma/linked-doc…）共享同一套卡片容器、缩放、caption 基建；embed-doc 只负责"文档"这一特化。

### 内嵌文档块的独有问题

1. **引用而非拷贝**：卡片里不存文档内容，只存一个 `pageId` 指针（`ReferenceInfo`）。真实内容要**按需从 workspace 加载另一个 `Store`**，可能尚未加载、可能已删除、可能加载失败——需完整的 loading/error/deleted/empty 状态机。
2. **两种形态、同一引用**：**linked** 是只读卡片（横/竖/cube/list 几种样式 + 内容预览 + 标题/描述**别名**）；**synced** 是把目标文档当"活编辑器"整篇嵌入（可编辑、随源文档实时同步）。二者可互转，也可退回**内联引用**（`@` 提及）。
3. **嵌套编辑器**：synced 块内部 `new BlockStdScope({ store, extensions })` 跑一个完整子编辑器。这带来**递归深度控制**（`depth`）与**引用成环**（A 嵌 B、B 又嵌 A）检测。
4. **卡片内容预览**：linked 卡片要把目标文档的首图作 banner、取前几段正文作摘要——用**只读 `Query` 投影 + preview spec** 渲染一小段"真实块"，而非截图。
5. **别名（alias）**：用户可给卡片起**自定义标题/描述**而不改源文档；转换/复制时要按目标形态决定是否保留别名。

## 2. 目录与关键文件

```text
src/
├── index.ts view.ts store.ts effects.ts   # 装配：导出 / ViewExtension / StoreExtension / 注册自定义元素
├── common/
│   └── render-linked-doc.ts        # ★卡片内容预览：banner 取首图、note 取前几块，用 preview spec 渲染
├── embed-linked-doc-block/
│   ├── embed-linked-doc-block.ts   # ★EmbedLinkedDocBlockComponent：卡片、懒加载、状态机、互转
│   ├── embed-edgeless-linked-doc-block.ts  # 白板变体 + EmbedLinkedDocInteraction
│   ├── embed-linked-doc-spec.ts    # BlockViewExtension + 工具栏 + 斜杠菜单
│   ├── commands/insert-embed-linked-doc.ts # insertEmbedLinkedDocCommand
│   ├── configs/ (slash-menu/toolbar/tooltips)
│   └── adapters/ (markdown/html/plain-text/...)
├── embed-synced-doc-block/
│   ├── embed-synced-doc-block.ts   # ★EmbedSyncedDocBlockComponent：嵌套子编辑器、防环、depth、自适应视口
│   ├── components/embed-synced-doc-card.ts # 降级为卡片时的渲染（deep/loading/error）
│   ├── embed-edgeless-synced-doc-block.ts init-height-extension.ts
│   ├── configs/ (toolbar/edgeless-interaction) commands/ adapters/
└── ...
```

## 3. 实现细节

### 3.1 ★引用信息与别名的建模

卡片不拷内容，只持有一个"引用"。模型 props 由 `affine-model` 的 `ReferenceInfo` 驱动（`model/src/consts/doc.ts:52-59`）：

```ts
export const ReferenceInfoSchema = z
  .object({
    pageId: z.string(),
    params: ReferenceParamsSchema.optional(), // mode/blockIds/elementIds/xywh...
  })
  .merge(AliasInfoSchema); // title?/description? —— 别名
```

- `pageId` 指向目标文档；`params` 可进一步指向文档内某个 block/element（`referenceToNode` 判定"链接到节点"）。
- `AliasInfo`（`doc.ts:21-28`）是 `{ title?, description? }` 的 partial——**用户自定义的显示名/摘要，不改源文档**。linked 卡片两者都支持，synced 块只用 title，内联引用只用 title（见 `doc.ts:12-20` 注释）。

组件里用 `computed` 把它收敛成一个响应式引用源，再派生图标/标题（`embed-linked-doc-block.ts:194-240`）：

```ts
referenceInfo$ = computed(() => {
  const { pageId, params, title$, description$ } = this.model.props;
  return cloneReferenceInfo({
    pageId,
    params,
    title: title$.value,
    description: description$.value,
  });
});
title$ = computed(() => {
  const { pageId, params, title } = this.referenceInfo$.value;
  return (
    this.std
      .get(DocDisplayMetaProvider)
      .title(pageId, { params, title, referenced: true }) || title
  );
});
```

**关键取舍**：`title$` 优先走 `DocDisplayMetaProvider`——别名存在时显示别名，否则实时取源文档标题。于是源文档改名，没设别名的卡片自动跟着变。

### 3.2 ★linked 卡片：异步懒加载与状态机

`_load`（`embed-linked-doc-block.ts:61-120`）是卡片的核心。它要处理"目标文档可能根本没加载"：

```ts
const linkedDoc = this.linkedDoc; // std.workspace.getDoc(pageId)?.getStore(...)
if (!linkedDoc.loaded) linkedDoc.load(); // 触发按需加载
if (!this.isError && !linkedDoc.root) {
  await new Promise<void>(resolve => {
    // 等 root block 到位
    const subscription = linkedDoc.slots.rootAdded.subscribe(() => {
      subscription.unsubscribe();
      resolve();
    });
  });
}
this._loading = false;
if (this._referenceToNode) return; // 链接到某个块/元素则不渲染内容预览
const cardStyle = this.model.props.style;
if (cardStyle === 'horizontal' || cardStyle === 'vertical')
  renderLinkedDocInCard(this);
```

状态由 `@state` 字段 `_loading`/`isError`/`isBannerEmpty`/`isNoteContentEmpty` + getter 组合（deleted = `meta.trash || !linkedDoc`，empty = 内容与 banner 皆空），`_renderEmbedView`（`:324-464`）据此选图标/文案/banner。`connectedCallback`（`:491-565`）还订阅了：

- 目标文档的 `blockUpdated`——用 `throttle(..., RENDER_CARD_THROTTLE_MS)` 节流重载，并**忽略 caption/xywh/init 这类无关变更**，避免高频重渲；
- 本模型 `propsUpdated`（`pageId`/`style` 变化重载）；
- workspace 的 `docListUpdated`（目标被删/恢复时刷新）。

### 3.3 ★卡片内容预览：不是截图，是"真实块投影"

`render-linked-doc.ts` 把源文档的一小段真正渲染进卡片。精华在 `renderNoteContent`（`:109-206`）：先从 note 里挑出有文字的段落/列表与图片，按卡片高度估算**最多渲染几块**（`maxBlockCount = floor(cardHeight / 20)`，horizontal 只渲 1 块），然后用一个**只读 `Query` 投影**把这些块（及其祖先链）单独切出来：

```ts
const query: Query = {
  mode: 'strict',
  match: ids.map(id => ({ id, viewType: 'display' })),
};
const previewDoc = doc.doc.getStore({ query });
const previewSpec = std.get(ViewExtensionManagerIdentifier).get('preview-page');
const previewStd = new BlockStdScope({
  store: previewDoc,
  extensions: previewSpec,
});
render(previewStd.render(), fragment);
// 把预览里的 contenteditable=true 全改成 false
```

banner 则从 note 里找首个 `ImageBlockModel`，经 `blobSync.get(sourceId)` 取 blob、`URL.createObjectURL` 作封面（`renderImageAsBanner`，`:71-90`）。这套做法的好处：预览与真实渲染**同一套块组件**，样式天然一致，且随协同数据实时变化。

### 3.4 ★synced 块：内嵌一个活编辑器

synced 块不是卡片，而是把目标文档当**完整子编辑器**渲染（`embed-synced-doc-block.ts:171-276`）。核心是为子文档新建一个 `BlockStdScope`：

```ts
new BlockStdScope({
  store: syncedDoc,
  extensions: this._buildPreviewSpec('preview-page'), // 或 'preview-edgeless'
}).render();
```

`_buildPreviewSpec`（`:119-169`）在 preview spec 基础上**动态拼接**三个扩展：`EmbedSyncedDocWatcher`（给内层 synced 子块标 `depth = nextDepth`，实现递归层级）、`GfxViewportInitializer`（白板模式 `fitToScreen`）、`EditorSettingExtension`（透传编辑器设置）。`syncedDoc` getter（`:415-420`）用 `GetStoreOptions { readonly: true, query: _pageFilter }` 取只读投影——`_pageFilter` 把 `EdgelessOnly` 的 note 隐藏，使 page 模式只显示 page 内容。

**防环**：`_checkCycle`（`:422-429`）沿 `host.parentElement.closest('editor-host')` 一路上溯，若祖先编辑器的 `store.id === pageId` 说明嵌套成环，置 `_cycle`；`renderBlock`（`:568-596`）在 loading/error/deleted/**cycle**/`depth >= 1`（`isCardOnly`）时降级渲染 `<affine-embed-synced-doc-card>` 而非活编辑器——用卡片截断无限递归。

**自适应视口**：`_initEdgelessFitEffect`（`:62-104`）用 `ResizeObserver` + `getCommonBound` 计算内容包围盒，`viewport.getFitToScreenData` 后 `setCenter`/`setZoom`，让白板子文档自动缩放到卡片大小。

### 3.5 ★三形态互转

同一个引用可在三种表示间转换，均为"加新块 + 删旧块 + 选中新块"：

- **linked → synced**：`convertToEmbed`（`embed-linked-doc-block.ts:140-162`）`addBlock('affine:embed-synced-doc', {caption, ...cloneReferenceInfoWithoutAliases(...)})`——注意用 **WithoutAliases**，因为 synced 块不展示 description 别名。
- **synced → linked（卡片）**：`convertToCard`（`embed-synced-doc-block.ts:284-309`）`addBlock('affine:embed-linked-doc', {caption, ...referenceInfo, ...aliasInfo})`——反向可带回别名。
- **任一 → inline 引用**：`convertToInline`（两处）构造一个 `Y.Text`，插入 `REFERENCE_NODE` 文本并 `format` 成 `{ reference: { type:'LinkedPage', ...referenceInfo } }`，塞进一个新 `affine:paragraph`——即退化成段落里的 `@` 提及。

### 3.6 打开与 peek

卡片点击/双击经 `RefNodeSlotsProvider.docLinkClicked` 统一派发（`open`，`:211-224`），由上层决定是跳转、新标签还是**中心 peek**（`@Peekable` 装饰器，只读态禁用，`:55-57`）。`_handleClick` 还识别 `isNewTabTrigger`/`isNewViewTrigger`（Cmd/中键）分流到不同 `openMode`。

### 3.7 装配（view/store）

`EmbedDocViewExtension`（`view.ts`）注册两套 `*ViewExtensions`，并**仅在 edgeless scope** 追加白板剪贴板配置与交互扩展（`EmbedLinkedDocInteraction`/`EmbedSyncedDocInteraction`）——同一块按 scope 差异化装配。`EmbedDocStoreExtension`（`store.ts`）注册两个 schema 与两套 adapter。`BlockViewExtension` 用 `model.parent?.flavour === 'affine:surface'` 决定渲染 `affine-embed-edgeless-*` 还是普通标签（`embed-linked-doc-spec.ts:13-17`）。

## 4. 语法特色

- **`@preact/signals-core` 的 `computed`**：`referenceInfo$`/`title$`/`icon$` 层层 `computed` 派生，任一上游（props 的 `title$`/`description$`、provider 的值）变化自动重算，Lit 模板里 `.value` 读取即建立依赖。
- **`@Peekable({ enableOn })` 类装饰器**：给块声明"可 peek"能力，`enableOn` 回调按只读态动态启停——装饰器承载横切能力的典型用法。
- **`zod` schema 组合**：`ReferenceInfoSchema = z.object({...}).merge(AliasInfoSchema)`、`AliasInfoSchema = z.object({...}).partial()`——用 `.merge`/`.partial` 组合出"引用+可选别名"，并 `z.infer` 出 TS 类型，运行时校验与编译期类型同源。
- **`BlockStdScope` 手动实例化**：synced 块与卡片预览都 `new BlockStdScope({ store, extensions })` 跑一个**内嵌的独立编辑器运行时**——std 作用域可嵌套是本块得以存在的前提。
- **只读 `Query` 投影**：`store.getStore({ query })` 用 `{ mode, match: [{id, viewType}] }` 声明式切出文档子集，预览只渲染需要的块。
- **Lit 指令**：`choose`（page/edgeless 二选一渲染）、`guard`（依赖不变则跳过重渲，`:254-257`）、`when`/`repeat`（别名多行描述）、`classMap`/`styleMap`、`ifDefined`、`keyed`。
- **`accessor` + `@state`/`@property`/`@query`**：TS 新 `accessor` 字段配 Lit 装饰器声明响应式状态与 DOM 查询（如 `@queryAsync('.affine-embed-linked-doc-content-note.render')`）。

## 5. 设计 / 实现亮点

- **引用即指针，内容靠懒加载**：卡片零拷贝，只存 `pageId`，真实内容按需 `load()` 并等 `rootAdded`，配合 throttle 的 `blockUpdated` 订阅实现"源变卡片跟变"——既省存储又实时。
- **预览是"真实块投影"而非截图**：用只读 `Query` + preview spec 复用同一套块组件渲染摘要，样式零偏差、随协同更新，比快照方案优雅得多。
- **嵌套编辑器 + 深度/成环双保险**：synced 块内跑真编辑器，`depth`（LifeCycleWatcher 打标）与 `_checkCycle`（沿 editor-host 上溯）两条机制共同阻止无限递归，超限即降级为卡片。
- **一引用三形态可逆互转**：linked 卡片 / synced 活块 / inline 提及自由转换，转换时按目标语义**精细处理别名**（`cloneReferenceInfoWithoutAliases`）。
- **别名与源数据解耦**：`DocDisplayMetaProvider` 统一"别名优先、否则取实时标题"的显示策略，自定义命名不污染源文档。
- **page/surface 双渲染**：同一 flavour 按 `parent.flavour` 切换普通/edgeless 组件，白板里还做视口自适应。

## 6. 对外 API 与注意事项

- 主要导出：`EmbedLinkedDocBlockComponent`、`EmbedSyncedDocBlockComponent`、`EmbedSyncedDocCard`、`insertEmbedLinkedDocCommand`/`insertEmbedSyncedDocCommand`、各 spec/adapter；装配入口 `EmbedDocViewExtension`（`./view`）、`EmbedDocStoreExtension`（`./store`）。
- **约定**：插入走 `insertEmbedCard`（linked 默认 `style:'vertical'`）；引用信息用 `cloneReferenceInfo` 规范化，转换 synced 时务必剥离别名。
- **注意**：
  - 卡片内容是异步的——目标文档首次使用要等 `load()`+`rootAdded`，期间显示 Loading 属正常；已删除显示 deleted banner。
  - synced 块是**真编辑器**，嵌套过深（`depth >= 1`）或成环会自动降级为卡片，不要期望无限层活编辑。
  - 别名（title/description）仅 linked 卡片全支持；synced/inline 会丢弃 description。
  - 卡片预览只截取前几块（按高度估算），不是完整文档。
  - 白板变体（`affine-embed-edgeless-*`）与 page 变体是不同自定义元素，由 `parent.flavour` 决定。

## 7. 延伸

- 底层：`@blocksuite/affine-block-embed`（`EmbedBlockComponent`/`insertEmbedCard`/`getNotesFromDoc`/`isEmptyDoc`）、`@blocksuite/affine-model`（`EmbedLinkedDocModel`/`ReferenceInfo`/`AliasInfo`）、`@blocksuite/std`（`BlockStdScope`/`LifeCycleWatcher`/`GfxExtension`）、`@blocksuite/store`（`Query`/`Text`/`Y.Text`）。
- 同层协作：`@blocksuite/affine-inline-reference`（`RefNodeSlotsProvider`，与内联 `@` 提及共享引用点击事件）、`@blocksuite/affine-block-surface`（白板）、`@blocksuite/affine-components`（peek/toast/toolbar/citation-card/embed-card-edit-modal 别名编辑）、`@blocksuite/affine-shared`（`DocDisplayMetaProvider`/`DocModeProvider`/`ThemeProvider`）。
- 相关文档：`blocksuite-affine-block-image.md`（banner 用到图片 blob）、`blocksuite-affine-model.md`（schema/ReferenceInfo）、`blocksuite-std.md`（BlockStdScope/Query/LifeCycleWatcher）。
