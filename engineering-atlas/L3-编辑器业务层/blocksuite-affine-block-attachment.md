# `@blocksuite/affine-block-attachment`

> 一句话定位：AFFiNE 的**附件块**——把任意文件（PDF/视频/音频/图片以外的任意二进制）作为一张卡片嵌入文档或白板，负责上传到 blob 存储、按 MIME 类型切换"卡片视图 / 内嵌预览"、以及把图片类附件就地转换成 `affine:image` 图片块。它是"块包统一范式"的一个完整实例，独有逻辑集中在**资源上传/状态机**与**嵌入转换（embed）**。

| 项        | 值                                                                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/attachment`                                                                                                                                                                                                                                                    |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                              |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                    |
| 关键依赖  | `@blocksuite/std`、`@blocksuite/affine-model`、`@blocksuite/affine-components`（caption/peek/resource/toast）、`@blocksuite/affine-shared`、`@blocksuite/affine-block-surface`、`@blocksuite/affine-ext-loader`、`@blocksuite/affine-widget-slash-menu`、`file-type`、`@floating-ui/dom` |
| 被谁依赖  | 编辑器预设（presets）、`@affine/core` 的编辑器装配                                                                                                                                                                                                                                       |
| 对外入口  | `.`（block/service/embed/utils）、`./store`（`AttachmentStoreExtension`）、`./view`（`AttachmentViewExtension`）                                                                                                                                                                         |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

一个内容块包通常由这几部分拼成，附件块一一对应：

| 范式部件                 | 附件块的实现                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `*-model`（schema）      | 复用 `affine-model` 的 `AttachmentBlockSchema`/`AttachmentBlockModel`（不在本包）                                              |
| `*-block.ts`（Lit 视图） | `attachment-block.ts` → `AttachmentBlockComponent`；白板版 `attachment-edgeless-block.ts`                                      |
| `commands`               | 本块逻辑较轻，核心操作封装为 `utils.ts` 的 `addAttachments`/`addSiblingAttachmentBlocks` 与组件方法                            |
| `adapters`               | `adapters/markdown.ts`、`adapters/notion-html.ts`（脚注引用 ↔ 附件块）                                                         |
| widgets/configs          | `configs/toolbar.ts`（工具栏）、`configs/slash-menu.ts`（斜杠菜单）                                                            |
| `effects.ts`             | 注册 `affine-attachment` / `affine-edgeless-attachment` 自定义元素                                                             |
| `view.ts` / `store.ts`   | `AttachmentViewExtension`（视图侧）/ `AttachmentStoreExtension`（数据侧）两个 `ViewExtensionProvider`/`StoreExtensionProvider` |

这套"schema 在 model 包、视图/适配器/扩展在块包、用两个 Extension Provider 分别注册到 store 作用域与 view 作用域"的结构，是所有 `affine-block-*` 的公共骨架（参见 `blocksuite-std.md` 的扩展机制）。

### 附件块的独有问题

附件区别于段落/列表这类纯文本块，在于它承载**外部二进制资源**，于是带来三个独有命题：

1. **资源生命周期**：文件要上传到 `blobSync`，上传中/失败/超限/成功各有不同 UI，远端协作者可能先看到"加载中"。本包用 `affine-components` 的 `ResourceController` 把这套状态机标准化。
2. **多形态渲染**：同一个附件，PDF 要内嵌 `<iframe>` 预览、视频用 `<video>`、音频用 `<audio>`、图片应直接"升格"为图片块、其余只显示文件卡片。本包用**可扩展的 embed 配置表**表达这套策略。
3. **文档流 / 白板双栖**：附件模型通过 `GfxCompatible` 同时能放进 note 和 edgeless 画布，于是有 `affine-attachment` 与 `affine-edgeless-attachment` 两个视图，由 `view.ts` 按 `model.parent?.flavour` 动态选择。

## 2. 目录与关键文件

```text
src/
├── index.ts                      # 导出 block/service/embed/utils/adapters
├── attachment-block.ts           # AttachmentBlockComponent（文档流视图，@Peekable）
├── attachment-edgeless-block.ts  # 白板视图 + AttachmentBlockInteraction
├── attachment-service.ts         # AttachmentDropOption（文件拖拽落点 → 建块）
├── embed.ts                      # ★独有：AttachmentEmbedService + embed 配置表（image/pdf/video/audio）
├── utils.ts                      # ★独有：上传/下载/建块（addAttachments / buildPropsWith / getFileType）
├── store.ts                      # AttachmentStoreExtension：注册 schema + adapters
├── view.ts                       # AttachmentViewExtension：注册 flavour/view/toolbar/slash/embed
├── effects.ts                    # customElements.define 两个标签
├── edgeless-clipboard-config.ts  # 白板粘贴配置
├── adapters/                     # markdown / notion-html（脚注引用 ↔ 附件）
├── components/                   # 卡片/状态等子组件
├── configs/                      # toolbar.ts / slash-menu.ts
└── styles.ts
```

## 3. 实现细节

### 3.1 视图组件：继承 CaptionedBlockComponent + @Peekable

`AttachmentBlockComponent`（`attachment-block.ts:60`）直接继承 `affine-components` 的 `CaptionedBlockComponent<AttachmentBlockModel>`，于是免费获得 caption 编辑与选中边框——只需打开两个开关（`attachment-block.ts:524-526`）：

```ts
override accessor selectedStyle = SelectedStyle.Border;
override accessor useCaptionEditor = true;
```

类上还叠了 `@Peekable`，但**带条件**——只有 PDF 附件允许双击全屏预览（`attachment-block.ts:55-59`）：

```ts
@Peekable({ enableOn: ({ model }: AttachmentBlockComponent) => model.props.type.endsWith('pdf') })
export class AttachmentBlockComponent extends CaptionedBlockComponent<AttachmentBlockModel> { ... }
```

`renderBlock()`（`:505-522`）是渲染分发中枢，按三态择一：引用卡片（citation）→ 内嵌视图（embed）→ 普通卡片（card）：

```ts
${when(this.isCitation,
  () => this._renderCitation(),
  () => this.renderEmbedView() ?? this.renderCardView())}
```

卡片视图又按 `style` 分横排/竖排（`renderWithHorizontal`/`renderWithVertical`），用 Lit 的 `choose(state, [...])` 指令在 `error`/`error:oversize` 两种错误态下分别渲染"重试/重载"或"升级容量"按钮（`:371-374`）。

### 3.2 资源状态机：ResourceController

组件把 `sourceId` 包成一个 `ResourceController`（来自 `affine-components/resource`），交给它管理 blob 的加载、URL 解析与状态（`attachment-block.ts:65-67`）：

```ts
resourceController = new ResourceController(
  computed(() => this.model.props.sourceId$.value)
);
```

`connectedCallback`（`:226-251`）里把它接到 blob 引擎并订阅：

```ts
this.resourceController.setEngine(this.std.store.blobSync);
this.disposables.add(this.resourceController.subscribe());
this.disposables.add(
  this.model.props.sourceId$.subscribe(() => this.refreshData())
);
```

`ResourceController`（`components/src/resource/resource.ts:36-95`）内部用 `@preact/signals-core` 维护 `blobUrl$`、`state$`，并用 `computed` 派生出一个归一的 `resolvedState$`：`determineState` 按优先级把 `overSize → error:oversize`、`errorMessage → error`、`uploading → uploading`、`downloading → loading` 折叠成单个 `StateKind`。组件再用 `resolveStateWith({ loadingIcon, errorIcon, icon, title, description })` 把状态映射成图标/文案（`attachment-block.ts:420-434`）。这样"上传中转圈、失败显示重试、超限显示升级"全由一套状态机驱动，而非散落的布尔判断。

### 3.3 上传与建块（utils.ts）

上传核心是 `buildPropsWith`（`utils.ts:103-139`）：把文件写入 `blobSync` 得到 `sourceId`，再用 `getFileType` 确定 MIME，产出一份 `Partial<AttachmentBlockProps>`：

```ts
const sourceId = await std.store.blobSync.set(file);
type = await getFileType(file);
return {
  name,
  size,
  type,
  sourceId,
  embed,
} satisfies Partial<AttachmentBlockProps>;
```

`getFileType`（`:78-86`）有个务实兜底：`file.type` 为空时**动态 `import('file-type')`**，从文件头字节嗅探 MIME——避免把这个较重的库打进主包。

建块分两条路径：`addSiblingAttachmentBlocks`（文档流，`addSiblingBlocks` 插在目标块前/后）与 `addAttachments`（白板，用 `Bound.fromCenter` 在视口中心按 `gap` 偏移排布多文件，`addBlocks` 到 `gfx.surface` 并选中）。两者都先用 `hasExceeded` 校验文件大小上限（`FileSizeLimitProvider`），超限 `toast` 提示并中止。

### 3.4 ★独有核心：嵌入转换（embed.ts）

这是附件块最有设计含量的部分。"附件能否、以及如何转成内嵌预览"被建模成一张**可扩展的配置表** `AttachmentEmbedConfig`（`embed.ts:28-58`）：

```ts
export type AttachmentEmbedConfig = {
  name: string;
  check: (model, maxFileSize) => boolean; // 是否适用
  action?: (model, std) => Promise<void> | void; // 点"转为内嵌"时执行
  render?: (model, blobUrl) => TemplateResult | null; // 如何渲染内嵌
  shouldShowStatus?: boolean;
  shouldBeConverted?: boolean; // 需转成别的块（如图片）
};
```

内置 4 条（`:159-253`）：

- **image**：`check` 命中 `image/*` 且 schema 支持 `affine:image`，`action` 调 `turnIntoImageBlock` ——**把附件块整体转成图片块**（见下）；
- **pdf**：`render` 返回一个带 `#toolbar=0`、`credentialless` 的 `<iframe>`，`action` 顺带把卡片尺寸设为 `EMBED_CARD_WIDTH.pdf`；
- **video / audio**：`render` 返回 `<video controls>` / `<audio controls>`。

这些配置通过 DI 注册：每条用 `AttachmentEmbedConfigExtension` 注册成带 variant 的标识符，`AttachmentEmbedService.setup` 再用 `provider.getAll(...)` 把它们汇成一张 Map（`embed.ts:66-113`）：

```ts
static override setup(di: Container) {
  di.addImpl(AttachmentEmbedConfigMapIdentifier, provider => provider.getAll(AttachmentEmbedConfigIdentifier));
  di.addImpl(AttachmentEmbedProvider, this, [StdIdentifier]);
}
convertTo(model, maxFileSize) {
  const config = this.values.find(c => c.check(model, maxFileSize));
  if (config?.action) { config.action(model, this.std); return; }
  model.store.updateBlock(model, { embed: true });
}
```

组件的 `convertTo`/`embedded`/`getRender`/`shouldShowStatus` 全部委托给这个服务（`attachment-block.ts:104-127, 454-491`）。**扩展性**由此而来：想支持新的内嵌类型（如 Office 文档），只需再 `AttachmentEmbedConfigExtension([{ name, check, render }])` 注册一条，无需改组件。

### 3.5 ★独有核心：转图片块（block transform）

`turnIntoImageBlock`（`embed.ts:258-305`）展示了"块类型原地转换"的完整手法：先用 `withTempBlobData()` 暂存附件元数据、必要时读 blob 用 `readImageSize` 量出宽高并按 `MAX_IMAGE_WIDTH` 约束缩放，最后调 `affine-shared` 的 `transformModel(model, 'affine:image', imageProp)` **保持同一 blob `sourceId`、把块的 flavour 从 `affine:attachment` 换成 `affine:image`**，caption/尺寸一并迁移。这利用了附件与图片共享同一份 blob 的事实，转换是零拷贝的。

### 3.6 拖拽落点与扩展注册

`AttachmentDropOption`（`attachment-service.ts`）用 `FileDropConfigExtension` 声明"拖文件进来时"的行为：**过滤掉 `image/*`（那交给图片块）**，其余文件按落点在文档流里 `addSiblingAttachmentBlocks`、在白板里 `addAttachments`。

`view.ts` 的 `AttachmentViewExtension`（继承 `ViewExtensionProvider`）是视图侧装配清单：`FlavourExtension` + 动态 `BlockViewExtension`（按父 flavour 在 `affine-attachment`/`affine-edgeless-attachment` 间二选一）+ 拖拽/embed 服务/斜杠菜单/工具栏；白板作用域下再追加剪贴板与交互扩展。`store.ts` 的 `AttachmentStoreExtension` 则负责数据侧：注册 schema 与 adapters。

### 3.7 adapters：脚注引用 ↔ 附件

`adapters/markdown.ts` 把附件块与 Markdown 的**脚注定义**互转：当脚注定义的 JSON（`FootNoteReferenceParamsSchema`）`type === 'attachment'` 且含 `blobId` 时，`toBlockSnapshot` 用 `createAttachmentBlockSnapshot` 造出一个 `style: 'citation'` 的附件块。这让"引用式附件"能在 Markdown 导入导出中无损往返。

## 4. 语法特色

- **条件化类装饰器**：`@Peekable({ enableOn: ({model}) => model.props.type.endsWith('pdf') })`，装饰器参数本身是回调，运行时决定该实例是否可预览。
- **`satisfies` 校验而不拓宽**：`buildPropsWith` 返回 `{...} satisfies Partial<AttachmentBlockProps>`（`utils.ts:124`），既校验字段合法又保留字面量类型；`AttachmentBlockStyles = [...] as const satisfies EmbedCardStyle[]`（model）同理。
- **Signal 三件套 `signal`/`computed`/`batch`**：`_refreshKey$ = signal(...)`、`resolvedState$ = computed(...)`、`reload` 里用 `batch` 合并多次写入（`attachment-block.ts:140-152`）；取"快照值"用 `.peek()`（不建立依赖）、取响应值用 `.value`。
- **DI 的 `getAll` 聚合扩展**：`provider.getAll(AttachmentEmbedConfigIdentifier)` 把多处注册的同类配置收集成集合，是"配置即扩展点"的关键（`embed.ts:109-110`）。
- **Lit 指令组合**：`when`（三元渲染）、`choose`（多路分支）、`guard`（依赖不变则跳过重渲，`renderEmbedView` 用 `guard([_refreshKey$.value], ...)` 控制 iframe 重建）、`classMap`/`styleMap`。
- **动态 `import()` 懒加载**：`await import('file-type')` 按需加载嗅探库，兼顾功能与包体积。
- **`transformModel` 跨 flavour 变形**：在同一 `BlockModel` 位置替换 flavour，是块类型转换的通用算子。

## 5. 设计 / 实现亮点

- **embed 策略表驱动 + DI 聚合**：把"每种 MIME 怎么内嵌"做成可注册的配置数组、用 `getAll` 汇成 Map，新增类型零侵入组件——教科书级的开放封闭实践。
- **资源状态机下沉到共享控制器**：`ResourceController` 把 loading/uploading/error/oversize 的复杂态收口为一个 `computed` 状态，附件、图片等块共用，杜绝各块各写一套 UI 布尔。
- **零拷贝块变形**：附件→图片复用同一 blob `sourceId`，`transformModel` 只换 flavour 与 props，避免重新上传。
- **文档流/白板双视图动态选择**：`BlockViewExtension(flavour, model => ...)` 按父 flavour 运行时返回不同标签，一个模型两种呈现，复用绝大部分逻辑。
- **协同友好的占位语义**：`sourceId` 未就绪即"上传中/错误"，模型注释明确约定，远端协作者看到的是一致的加载态而非坏块。
- **性能细节**：`guard` 控制 iframe 仅在 `refreshKey` 变化时重建、`import('file-type')` 懒加载、下载大文件前检查 `downloading` 态防重入。

## 6. 对外 API 与注意事项

- 主要导出：`AttachmentBlockComponent`、`AttachmentEmbedService` / `AttachmentEmbedProvider` / `AttachmentEmbedConfig` / `AttachmentEmbedConfigExtension` / `AttachmentEmbedConfigIdentifier`、`addAttachments` / `addSiblingAttachmentBlocks`、adapters；装配入口 `AttachmentViewExtension`（`./view`）、`AttachmentStoreExtension`（`./store`）。
- **约定**：装配一个编辑器需同时注册 view 与 store 两个 Provider；新增内嵌类型通过 `AttachmentEmbedConfigExtension([...])` 追加配置，而非改组件。
- **注意**：
  - 拖入的 `image/*` 不会建附件块（被 `AttachmentDropOption` 过滤，交给图片块）；转图片走 embed 的 `image` 配置（`shouldBeConverted`）。
  - `@Peekable` 仅对 PDF 生效（`enableOn`），其它类型双击不预览。
  - 取 Signal 值区分 `.value`（建依赖）与 `.peek()`（只读快照），`replace`/`reload` 等写操作要在 `store.transact` 内并配合 `captureSync` 以正确分段 undo。
  - 文件超过 `FileSizeLimitProvider.maxFileSize` 会被拒绝并 toast；PDF/video 的内嵌还受大小校验（`check` 里的 `size <= maxFileSize`）。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`AttachmentBlockSchema`/`AttachmentBlockModel`/`AttachmentBlockStyles`）、`@blocksuite/std`（`BlockViewExtension`/`FlavourExtension`/`std.clipboard`）、`@blocksuite/sync`（`BlobEngine`）。
- 同层协作：`@blocksuite/affine-components`（`CaptionedBlockComponent`/`@Peekable`/`ResourceController`/`toast`）、`@blocksuite/affine-block-surface`（白板 `SurfaceBlockModel`）、`affine-block-image`（转换目标）。
- 相关文档：`blocksuite-affine-components.md`（caption/peek/resource）、`blocksuite-affine-model.md`（schema/GfxCompatible）、`blocksuite-std.md`（扩展/视图机制）。
