# `@blocksuite/affine-block-bookmark`

> 一句话定位：AFFiNE 的**书签 / 链接卡片块**——把一个 URL 渲染成带网站图标、标题、描述、预览大图的卡片（而非一行裸链接）。它负责异步抓取链接元数据（link preview）、按只读/可写态决定预览数据存模型还是只存本地、以及在白板与文档流中以不同视图呈现。它是"块包统一范式"的实例，独有逻辑集中在 **link-preview 抓取与缓存**。

| 项        | 值                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/bookmark`                                                                                                                                                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                                 |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                       |
| 关键依赖  | `@blocksuite/std`、`@blocksuite/affine-model`、`@blocksuite/affine-components`（caption/link-preview/citation）、`@blocksuite/affine-shared`（`LinkPreviewServiceIdentifier`/`ImageProxyService`/`EmbedOptionProvider`）、`@blocksuite/affine-block-embed`、`@blocksuite/affine-ext-loader` |
| 被谁依赖  | 编辑器预设、`@affine/core`；是"粘贴 URL 自动成卡片"的落点                                                                                                                                                                                                                                   |
| 对外入口  | `.`（block/commands/utils）、`./store`、`./view`                                                                                                                                                                                                                                            |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件             | 书签块实现                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| schema               | 复用 `affine-model` 的 `BookmarkBlockSchema`/`BookmarkBlockModel`（props 混入 `LinkPreviewData`） |
| `*-block.ts`         | `bookmark-block.ts` → `BookmarkBlockComponent`；白板版 `bookmark-edgeless-block.ts`               |
| `commands`           | `commands/insert-bookmark.ts`、`commands/insert-link-by-quick-search.ts`                          |
| `adapters`           | `adapters/`：markdown / html / notion-html / plain-text（含 markdown 预处理器）                   |
| configs              | `configs/toolbar.ts`、`configs/slash-menu.ts`                                                     |
| `effects.ts`         | 注册 `affine-bookmark` / `affine-edgeless-bookmark` 等自定义元素                                  |
| `view.ts`/`store.ts` | `BookmarkViewExtension` / `BookmarkStoreExtension`                                                |

与附件块几乎同构（同样继承 `CaptionedBlockComponent`、同样用 `BlockViewExtension(flavour, model => ...)` 按父 flavour 选视图），差异全在"数据从哪来"。

### 书签块的独有问题

书签的本质数据只有一个 `url`，其余展示字段（`title`/`description`/`icon`/`image`）都要**从网络异步抓取**。这带来三个独有命题：

1. **链接元数据抓取**：需要一个能跨块复用、带缓存、可取消、可去重的 link-preview 服务。
2. **预览数据存哪里**：可写文档把抓取结果写进模型 props（协同共享、离线可见）；**只读文档**不能改模型，于是抓取结果只存组件本地 Signal。
3. **URL → 块类型路由**：粘贴一个 URL 时，它可能该变成 YouTube/Figma 等"专用嵌入块"而非通用书签——这由 `EmbedOptionProvider` 决定，书签只是兜底 flavour。

## 2. 目录与关键文件

```text
src/
├── index.ts
├── bookmark-block.ts             # BookmarkBlockComponent（文档流视图）
├── bookmark-edgeless-block.ts    # 白板视图 + BookmarkBlockInteraction
├── commands/
│   ├── insert-bookmark.ts        # insertBookmarkCommand（URL → 书签/嵌入块）
│   └── insert-link-by-quick-search.ts
├── utils.ts                      # ★独有：refreshBookmarkUrlData（抓取并写回模型）
├── components/                   # <bookmark-card> 卡片视图
├── adapters/                     # markdown(+preprocessor)/html/notion-html/plain-text
├── configs/                      # toolbar / slash-menu
├── store.ts  view.ts  effects.ts
├── edgeless-clipboard-config.ts
└── styles.ts
```

link-preview 的具体抓取服务不在本包，而在共享层 `@blocksuite/affine-shared/services/link-preview-service`，由本块通过 DI 消费——这正是"跨块能力下沉到 shared"的范式体现。

## 3. 实现细节

### 3.1 视图组件：两套预览数据的合流

`BookmarkBlockComponent`（`bookmark-block.ts:29`）继承 `CaptionedBlockComponent<BookmarkBlockModel>`，开启 caption、边框选中、zero-width（`:282-286`）。它的核心是把"模型里的预览数据"与"本地抓取的预览数据"用 `computed` 合流成一个 `linkPreview$`（`:60-69`）：

```ts
private readonly _localLinkPreview$ = signal<LinkPreviewData>({ icon: null, title: null, description: null, image: null });

linkPreview$ = computed(() => {
  const modelProps = this.model.props;
  const local = this._localLinkPreview$.value;
  return {
    icon: modelProps.icon$.value ?? local.icon ?? null,
    title: modelProps.title$.value ?? local.title ?? null,
    description: modelProps.description$.value ?? local.description ?? null,
    image: modelProps.image$.value ?? local.image ?? null,
  };
});
```

**优先用模型值，回退到本地值**——这正是为了统一只读与可写两条数据路径。渲染分引用卡片（citation）与普通卡片（`<bookmark-card>`）两态（`renderBlock`，`:254-267`）。

### 3.2 ★独有核心：预览抓取的读写双路径

`connectedCallback`（`:208-247`）在"预览字段缺失"时触发抓取，并按只读态分流：

```ts
if (
  (!this.model.props.description && !this.model.props.title) ||
  (!this.model.props.image && this.model.props.style === 'vertical')
) {
  if (this.store.readonly) {
    this._updateLocalLinkPreview(); // 只读：抓到的数据只写本地 Signal
    return;
  }
  this.refreshData(); // 可写：抓到的数据写回模型 props
}
// url 变更时重新抓
this.disposables.add(
  this.model.propsUpdated.subscribe(({ key }) => {
    if (key === 'url') this.refreshData();
  })
);
```

两条路径都用 `AbortController` 管理在途请求，`disconnectedCallback` 里 `abort`，且 `_updateLocalLinkPreview` 每次先 `abort` 掉上一个请求（`:71-96`）——避免 URL 快速变化时旧响应覆盖新结果的竞态。

可写路径 `refreshBookmarkUrlData`（`utils.ts:6-47`）抓取后 `updateBlock` 写回四个字段，若全空则标 `error`，并在 `finally` 复位 `loading`；`signal.aborted` 时静默返回，不写回也不抛错。

### 3.3 ★独有核心：link-preview 服务（缓存 + 去重 + 可取消）

真正的抓取在 `affine-shared` 的 `LinkPreviewService`（`link-preview-service.ts:50-172`），组件通过 `LinkPreviewServiceIdentifier` 注入。它是一个 `Extension`，`query(url, signal, include?)` 的实现有三层优化：

```ts
const key = include?.includes('transcript') ? `transcript:${sourceKey}` : sourceKey;
const cached = this._cache.get(key);
if (cached) return cached;                               // 1. 命中缓存直接返回
const pendingRequest = signal ? undefined : this._cache.getPendingRequest(key);
if (pendingRequest) return pendingRequest;              // 2. 同 URL 在途请求去重
const promise = (async () => { ... })();                // 3. 真正 fetch，结果入缓存
```

- **缓存**：`sourceKey = JSON.stringify([endpoint, url])` 做键，结果非空才缓存；
- **去重**：无 `signal` 的请求共享同一个 pending promise，多个书签指向同一 URL 只发一次请求；
- **端点可配**：`setEndpoint` 注入抓取后端（AFFiNE 自建的 link-preview 服务），无端点则返回空对象——优雅降级。

抓取结果 `_fetchStandardPreview` 从响应里取 `title`/`description`/`favicons[0]`(→icon)/`images[0]`(→image)，图标图片在渲染时还要过 `ImageProxyService.buildUrl` 走代理（规避第三方图床的防盗链/CORS，`bookmark-block.ts:161`）。

### 3.4 URL → 块类型路由（insert 命令）

`insertBookmarkCommand`（`commands/insert-bookmark.ts`）是标准的 `Command<{url}, {blockId, flavour}>` 中间件。它先问 `EmbedOptionProvider` 这个 URL 是否匹配某个专用嵌入块：

```ts
const embedOptions = std.get(EmbedOptionProvider).getEmbedBlockOptions(url);
let flavour = 'affine:bookmark';
let targetStyle: EmbedCardStyle = 'vertical';
if (embedOptions) {
  flavour = embedOptions.flavour;
  targetStyle = embedOptions.styles[0];
}
const blockId = insertEmbedCard(std, { flavour, targetStyle, props });
if (!blockId) return; // 不调 next = 命令失败
next({ blockId, flavour });
```

于是"粘贴一个 YouTube 链接"会命中专用的 embed 块、"粘贴普通网址"才落到 `affine:bookmark`——书签是整条链接卡片体系的**默认兜底**。注意末尾"建块失败就不调 `next`"的写法，是 std 命令链"不调 `next` 即失败"约定的体现。

### 3.5 视图/数据装配

`BookmarkViewExtension`（`view.ts`）注册 `FlavourExtension` + 动态 `BlockViewExtension`（父为 `affine:surface` 用 `affine-edgeless-bookmark`，否则 `affine-bookmark`）+ 斜杠菜单 + 工具栏；白板作用域追加剪贴板与交互扩展。adapters（`adapters/index.ts` 聚合 markdown + 预处理器等）负责书签在 Markdown/HTML/Notion/纯文本之间的序列化——例如 markdown 里一条独立链接经预处理器识别后转成书签块快照。

## 4. 语法特色

- **`computed` 做数据合流**：`linkPreview$` 用 `??` 链把"模型值优先、本地值兜底"声明成一个派生 Signal，读写两路径对渲染透明。
- **`AbortController` + `AbortSignal` 竞态控制**：抓取前 `abort` 旧请求、`disconnectedCallback` 清理、`signal.aborted` 守卫写回——网络异步的标准正确写法。
- **DI 标识符注入服务**：`std.get(LinkPreviewServiceIdentifier)` / `std.get(ImageProxyService)` / `std.get(EmbedOptionProvider)`，块只依赖接口标识符，实现由上层注入。
- **命令中间件 + 输出类型**：`Command<{url}, {blockId; flavour}>` 声明输入/输出，`next({...})` 向下传递，类型在链上累积。
- **props 类型交叉组合**：`BookmarkBlockProps = {...} & LinkPreviewData & Omit<GfxCommonBlockProps,'scale'> & BlockMeta`（model），用 `&` 把预览字段、几何、审计拼进来；`BookmarkStyles = [...] as const satisfies EmbedCardStyle[]`。
- **RxJS `filter` 精筛事件**：`store.slots.blockUpdated.pipe(filter(...))` 只在"本地删除本块且是引用模型"时上报埋点（`bookmark-block.ts:183-206`）。
- **pending promise 去重**：服务层把在途 promise 存进缓存，同键请求复用，是异步幂等的常见手法。

## 5. 设计 / 实现亮点

- **只读/可写双路径 + 合流 computed**：同一卡片在可写文档里把预览存模型（协同、离线可见），在只读文档里退化为本地抓取且不污染文档——用一个 `computed` 把两路径收敛，是"数据来源可变但渲染统一"的优雅解法。
- **link-preview 服务的三级优化**：缓存命中 → 在途去重 → 真正抓取，跨所有书签/嵌入块共享，既省请求又防竞态；端点缺失即降级为空，不阻塞渲染。
- **URL 路由分层**：`EmbedOptionProvider` 决定专用嵌入，书签兜底，粘贴/斜杠/快速搜索多入口共用 `insertBookmarkCommand`，职责清晰。
- **图片走代理**：`ImageProxyService.buildUrl` 统一处理第三方图标/预览图的防盗链与 CORS，是生产环境链接卡片的必要一环。
- **与附件块同构**：双视图选择、CaptionedBlockComponent、citation 形态、埋点订阅几乎一致，体现块包范式的高度一致性——学会一个就会一类。

## 6. 对外 API 与注意事项

- 主要导出：`BookmarkBlockComponent`、`insertBookmarkCommand` / `insertLinkByQuickSearchCommand`、`refreshBookmarkUrlData`、`BOOKMARK_MIN_WIDTH`；装配入口 `BookmarkViewExtension`（`./view`）、`BookmarkStoreExtension`（`./store`）。
- **约定**：link-preview 的实际抓取由 `affine-shared` 的 `LinkPreviewService` 提供、`@affine/core` 注入端点；本块只消费 `LinkPreviewServiceIdentifier`。
- **注意**：
  - 只读文档下抓取结果只在本地 Signal、不写模型，切换文档即丢失（符合预期）。
  - 预览字段是否重新抓取由 `connectedCallback` 的"缺字段"条件与 `url` 变更订阅决定，手动可调 `refreshData`。
  - 粘贴 URL 未必生成书签块——先经 `EmbedOptionProvider` 路由到专用嵌入块。
  - 图标/预览图务必经 `ImageProxyService`，直连第三方地址在生产会被拦。
  - 抓取失败（四字段皆空）会把组件标为 `error`，卡片显示错误态。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`BookmarkBlockSchema`/`LinkPreviewData`/`BookmarkStyles`）、`@blocksuite/std`（命令/视图扩展）。
- 同层协作：`@blocksuite/affine-components`（`CaptionedBlockComponent`/`link-preview` 详情组件/`affine-citation-card`）、`@blocksuite/affine-shared`（`LinkPreviewService`/`ImageProxyService`/`EmbedOptionProvider`）、`@blocksuite/affine-block-embed`（`insertEmbedCard` 及专用嵌入块）。
- 相关文档：`blocksuite-affine-components.md`、`blocksuite-affine-model.md`、`blocksuite-std.md`；可与 `blocksuite-affine-block-attachment.md` 对照（同构块）。
