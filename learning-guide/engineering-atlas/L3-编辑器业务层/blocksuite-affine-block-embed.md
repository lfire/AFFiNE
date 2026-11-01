# `@blocksuite/affine-block-embed`

> 一句话定位：AFFiNE 的**内嵌卡片块集合**——它不是单个块，而是一个"**一个共享基类 `EmbedBlockComponent` + 多个外链/内嵌提供方**"的包：GitHub、Figma、Loom、YouTube、HTML、以及**通用 iframe**，每个提供方都把一个 URL 渲染成一张带标题/描述/封面的卡片。它的看点是**卡片基类如何抽象共性**（选中/拖拽/缩放/异步抓数据/doc 态↔白板态双组件），以及如何用"工厂 + 混入 + 配置驱动"把六种差异巨大的外链统一进同一范式。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/blocks/embed`                                                                                                                                                                                                                                                                                                                                                                                                     |
| 所属层    | L3 · 编辑器业务层（内容块 · 卡片）                                                                                                                                                                                                                                                                                                                                                                                                   |
| 语言/形态 | TypeScript / Lit 块包（含多子块）                                                                                                                                                                                                                                                                                                                                                                                                    |
| 关键依赖  | `@blocksuite/affine-block-surface`（白板转换/剪贴板基类）、`@blocksuite/affine-components`（caption/portal/icons）、`@blocksuite/std` + `@blocksuite/std/gfx`（`GfxViewInteractionExtension`/`toGfxBlockComponent`）、`@blocksuite/affine-model`（各 embed schema）、`@blocksuite/affine-shared`（`EmbedIframeService`/`LinkPreviewService` 等）、`@blocksuite/affine-widget-slash-menu`、`@floating-ui/dom`、`@preact/signals-core` |
| 被谁依赖  | 编辑器预设、`@affine/core`                                                                                                                                                                                                                                                                                                                                                                                                           |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                                                                                                             |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

与其它块"一个包一个块"不同，embed 是**一个包多个块**。每个提供方（以 github 为例）在范式里都齐备，而本包额外提供一层**跨提供方的公共基座**（`common/`）。对照表按"公共基座 / 每个提供方"两栏看：

| 范式部件                          | 公共基座（`common/`）                                                          | 单个提供方（如 github）                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| schema/model                      | —                                                                              | `affine-model` 的 `EmbedGithubBlockSchema`/`EmbedGithubModel`（共享 `EmbedProps`：url/style/caption/xywh…） |
| `*-block.ts`                      | ★`EmbedBlockComponent`（卡片基类，继承 `CaptionedBlockComponent`）             | `embed-github-block.ts` → `EmbedGithubBlockComponent extends EmbedBlockComponent`                           |
| 白板变体                          | ★`toEdgelessEmbedBlock(block)`（工厂：把 doc 组件转成 GFX 组件）               | `EmbedEdgelessGithubBlockComponent = toEdgelessEmbedBlock(EmbedGithubBlockComponent)`                       |
| service                           | —                                                                              | `EmbedGithubBlockService`（抓取 url 数据）                                                                  |
| 交互                              | ★`createEmbedEdgelessBlockInteraction(flavour)`（统一缩放锁比例/禁旋转）       | `EmbedGithubBlockInteraction`                                                                               |
| clipboard                         | `EdgelessClipboardConfig` 子类（粘贴到 surface）                               | `EdgelessClipboardEmbedGithubConfig`                                                                        |
| widgets/toolbar                   | `configs/toolbar.ts`（`createBuiltinToolbarConfigExtension`）                  | 每提供方注入自己的组件引用                                                                                  |
| `adapters`                        | ★`createEmbedBlock{Markdown,Html,PlainText}AdapterMatcher`（默认序列化成链接） | `EmbedGithubBlockAdapterExtensions`                                                                         |
| slash-menu                        | —                                                                              | `embedGithubSlashMenuConfig`                                                                                |
| spec                              | —                                                                              | `EmbedGithubViewExtensions`（把以上 FlavourExtension/service/view/toolbar/slash/interaction 打包）          |
| `effects.ts`/`view.ts`/`store.ts` | `EmbedViewExtension`/`EmbedStoreExtension`（汇总全部提供方）                   | 被汇总                                                                                                      |

**核心命题——用"基座 + 工厂 + 配置"消除 N 个提供方的重复**：六种外链在"卡片外观、抓数据方式、校验规则"上千差万别，但在"是一张可选中/可拖拽/可缩放、doc 里一种样子白板里另一种样子、能序列化成链接"这些**块级行为**上完全一致。本包把一致的部分沉到 `common/`：

1. **卡片基类 `EmbedBlockComponent`**：统一选中样式、拖拽 overlay、卡片尺寸、`AbortController` 管理异步抓取、caption 编辑。
2. **doc→白板工厂 `toEdgelessEmbedBlock`**：把任意 doc 态卡片组件"升级"成带 `xywh` 的 GFX 组件，无需每个提供方各写一遍白板版本。
3. **统一交互工厂 `createEmbedEdgelessBlockInteraction`**：所有卡片在白板上都是"锁比例缩放、不可旋转"。
4. **通用 adapter 工厂**：默认把卡片序列化成一个 markdown 链接。

于是每个提供方只需关心自己独有的"**卡片长什么样 + 怎么从 URL 抓数据**"，其余全部复用。

### 内嵌卡片块的独有问题

1. **异步抓取 + 可取消**：卡片内容来自网络（GitHub API、oEmbed、link preview），要有加载/成功/失败态，组件卸载/URL 变化时要 `abort` 旧请求。
2. **doc 态 vs 白板态**：同一 flavour 在文档里是块流中的卡片、在白板里是带坐标可缩放的 GFX 元素，需要两套组件但共享渲染。
3. **iframe 安全**：真正嵌 iframe 时要按提供方信任级别设 `sandbox`，并用 overlay 挡住 iframe 抢指针事件。
4. **URL 解析与提供方识别**：从一个粘贴的 URL 判断该用哪种卡片（GitHub/Figma/…/通用 iframe），并解析出 owner/repo/id 等。
5. **序列化回退**：外链卡片导出 markdown 时没有等价语法，统一回退成 `[title](url)` 链接。

## 2. 目录与关键文件

```text
src/
├── common/                         # ★跨提供方公共基座
│   ├── embed-block-element.ts      # ★EmbedBlockComponent 卡片基类 + createEmbedEdgelessBlockInteraction
│   ├── to-edgeless-embed-block.ts  # ★toEdgelessEmbedBlock：doc 组件 → GFX 组件工厂
│   ├── insert-embed-card.ts        # insertEmbedcard：doc 插入块 / 白板插入到画布中心
│   ├── render-linked-doc.ts        # 内链文档卡片渲染辅助
│   ├── adapters/                   # createEmbedBlock{Markdown,Html,PlainText,NotionHtml}AdapterMatcher 工厂
│   └── utils.ts / embed-note-content-styles.ts
├── embed-github-block/             # GitHub 提供方（block/edgeless/service/spec/adapters/configs/styles/utils）
├── embed-figma-block/              # Figma
├── embed-loom-block/               # Loom
├── embed-youtube-block/            # YouTube
├── embed-html-block/               # 内嵌 HTML
├── embed-iframe-block/             # ★通用 iframe（配置驱动，支持任意可嵌站点）
├── configs/toolbar.ts              # createBuiltinToolbarConfigExtension（卡片通用工具栏）
├── types.ts                        # ExternalEmbedBlockComponent 联合 + 类型守卫
└── view.ts / store.ts / effects.ts / index.ts  # 汇总装配
```

> 注意：`EmbedProps` 公共模型、以及各提供方的 model/schema 都在 `@blocksuite/affine-model` 的 `blocks/embed/*`；`linked-doc`/`synced-doc` 的 **schema 在本包 store 注册**，但其组件实现不在本包（index.ts 不导出它们）。

## 3. 实现细节

### 3.1 ★卡片基类 EmbedBlockComponent

`EmbedBlockComponent`（`common/embed-block-element.ts:30-179`）是所有卡片的父类，用三个泛型参数适配不同提供方：

```ts
export class EmbedBlockComponent<
  Model extends BlockModel<EmbedProps> = BlockModel<EmbedProps>,
  Service extends BlockService = BlockService,
  WidgetName extends string = string,
> extends CaptionedBlockComponent<Model, Service, WidgetName> {
```

它统一了卡片的块级行为：

- **选中/拖拽/缩放 overlay**：`isDraggingOnHost$`/`isResizing$` 两个 signal，合成 `showOverlay$ = computed(() => dragging || resizing || !selected)`——拖拽/缩放/未选中时盖一层透明 overlay，**防止 iframe 抢走指针事件**（embed 卡片的经典坑）。`connectedCallback` 订阅全局 `dragStart`/`dragEnd` 事件维护拖拽态。
- **卡片尺寸由样式枚举决定**：`_cardStyle: EmbedCardStyle`（horizontal/vertical/list…），`_cardHeight`/`_cardWidth` 从常量表 `EMBED_CARD_HEIGHT[style]`/`EMBED_CARD_WIDTH[style]` 取值。
- **`renderEmbed(content)`**：卡片渲染模板方法——子类把自己的内部内容作为回调传入，基类负责外层容器（draggable、尺寸、选中/评论高亮边框）。水平卡片在白板且不在 note 内时补 `minWidth`。
- **异步抓取可取消**：`_fetchAbortController`，`disconnectedCallback` 里 `abort()`；重新连接时若已 abort 则新建——所有网络请求都带这个 signal，卸载即取消。
- **`contentEditable='false'` + `useZeroWidth` + `useCaptionEditor`**：卡片不可编辑、零宽、带 caption 编辑器——与 divider 同属"不可落光标的原子块"范式，但多了 caption。

### 3.2 ★doc→白板：toEdgelessEmbedBlock 工厂

白板上的卡片需要 `xywh`、随画布缩放、响应 resize——但外观和 doc 态一模一样。与其每个提供方写两遍，本包用一个**高阶类工厂**把 doc 组件"升级"为 GFX 组件（`common/to-edgeless-embed-block.ts:16-78`）：

```ts
export function toEdgelessEmbedBlock<...B extends typeof EmbedBlockComponent<...>>(block: B) {
  return class extends toGfxBlockComponent(block) {
    override blockDraggable = false;
    override [GfxElementSymbol] = true;
    get bound() { return Bound.deserialize(this.model.xywh); }
    override connectedCallback() {
      super.connectedCallback();
      this._disposables.add(this.edgelessSlots.elementResizeStart.subscribe(() => this.isResizing$.value = true));
      this._disposables.add(this.edgelessSlots.elementResizeEnd.subscribe(() => this.isResizing$.value = false));
    }
    override renderGfxBlock() {
      const bound = Bound.deserialize(this.model.xywh);
      this.embedContainerStyle.width = `${bound.w}px`;
      this.embedContainerStyle.height = `${bound.h}px`;
      this.blockContainerStyles = { width: `${bound.w}px` };
      return this.renderPageContent();   // 复用 doc 态渲染
    }
  } as B & { new (...args: any[]): GfxBlockComponent };
}
```

于是 github 的白板版只有一行：

```ts
// embed-github-block/embed-edgeless-github-block.ts
export class EmbedEdgelessGithubBlockComponent extends toEdgelessEmbedBlock(
  EmbedGithubBlockComponent
) {}
export const EmbedGithubBlockInteraction = createEmbedEdgelessBlockInteraction(
  EmbedGithubBlockSchema.model.flavour
);
```

`toGfxBlockComponent(block)` 是 std 提供的混入（把 `BlockComponent` 变成 `GfxBlockComponent`），本工厂在其上接管 `renderGfxBlock`（把 `xywh` 的宽高写进容器后复用 `renderPageContent`）、订阅 resize slots。**哪个组件被渲染由 flavour→标签映射按 `parent` 决定**（`embed-github-spec.ts:21-25`）：

```ts
BlockViewExtension(flavour, model =>
  model.parent?.flavour === 'affine:surface'
    ? literal`affine-embed-edgeless-github-block` // 白板
    : literal`affine-embed-github-block`
); // 文档
```

### 3.3 ★统一交互：缩放锁比例、禁旋转

所有白板卡片共享同一交互策略，由工厂 `createEmbedEdgelessBlockInteraction`（`common/embed-block-element.ts:181-207`）产出：

```ts
export const createEmbedEdgelessBlockInteraction = (flavour, config?) => {
  const resizeConstraint = Object.assign(
    { lockRatio: true },
    config?.resizeConstraint ?? {}
  );
  return GfxViewInteractionExtension(flavour, {
    resizeConstraint,
    handleRotate() {
      return {
        beforeRotate(context) {
          context.set({ rotatable: false });
        },
      };
    },
  });
};
```

默认**锁比例缩放 + 禁止旋转**——卡片不像自由文本那样可任意变形。各提供方直接调用它、必要时传 `resizeConstraint` 覆盖（如最小尺寸）。这与 edgeless-text 的交互扩展同源（都用 `GfxViewInteractionExtension`），但策略相反：文本可旋转、改 scale，卡片锁比例、禁旋转。

### 3.4 提供方样例：github 的"抓数据"

`EmbedGithubBlockComponent`（`embed-github-block/embed-github-block.ts`）只写两件独有的事——**从 URL 解析/抓取数据**与**卡片长相**：

- `connectedCallback` 里：若 `owner/repo/githubId` 缺失，用 `githubUrlRegex` 从 `url` 里解析出来并 `withoutTransact` 写回（解析元数据不该进协同历史）；若标题/描述为空则 `refreshData()`（调 GitHub API 抓标题/描述/封面/状态），否则只 `refreshStatus()`；并订阅 `propsUpdated`，`url` 变化时重新抓。
- `renderBlock` 用 `this.renderEmbed(() => html`…`)` 把 github 专属卡片（标题图标、issue/PR 状态、assignees、仓库名、日期、封面图）塞进基类容器。图片经 `ImageProxyService.buildUrl` 代理（防跨域/隐私），加载态显示 `LoadingIcon`。
- 点击 `_selectBlock()` 进块选区，双击 `open()` 打开原链接。

其它外部提供方（figma/loom/youtube）结构完全相同——换一套正则和一套卡片模板而已。这正是基座抽象的价值。

### 3.5 ★通用 iframe：配置驱动的"万能嵌入"

`embed-iframe-block` 是最特殊的提供方——它不针对某一个站点，而是**由 `EmbedIframeService` 的配置决定能嵌什么、怎么嵌**（`embed-iframe-block/embed-iframe-block.ts`）：

- **状态机**：`status$: 'idle' | 'loading' | 'success' | 'error'`，派生 `isIdle$`/`isLoading$`/`hasError$`/`isSuccess$`，`_renderContent` 按状态渲染 idle/loading/error 卡片或真正的 `<iframe>`。
- **抓取流程** `refreshData`：并发 `embedIframeService.getEmbedIframeData(url)` 与 `linkPreviewService.query(url)`，得到 iframe 地址与标题/描述；`_validateIframeUrl` 用该 URL 对应的 config 校验 iframe 地址合法性，不合法报错。
- **安全沙箱**：`sandbox` 取值按提供方信任级——`currentConfigName === 'generic'` 用 `UNTRUSTED_SANDBOX='allow-scripts'`，否则 `TRUSTED_SANDBOX='allow-same-origin allow-scripts allow-forms allow-presentation'`；iframe 还加 `credentialless`、`loading="lazy"`。
- **空态输入 URL**：idle 且无 url 时点击弹出 `embed-iframe-link-input-popup`（`createLitPortal` + `@floating-ui/dom` 定位，适配虚拟键盘），让用户粘贴链接。
- **doc/白板差异**：`inSurface`（parent 是 `SurfaceBlockModel`）决定卡片布局（vertical/horizontal）、高度、选中处理——同一组件内按位置分流，而非靠 `toEdgelessEmbedBlock`。

### 3.6 adapter：统一回退成链接

外链卡片没有 markdown 等价语法，所以公共工厂 `createEmbedBlockMarkdownAdapterMatcher`（`common/adapters/markdown.ts`）默认把卡片**导出成一个链接**：

```ts
fromBlockSnapshot = {
  enter: (o, context) => {
    if (
      typeof o.node.props.title !== 'string' ||
      typeof o.node.props.url !== 'string'
    )
      return;
    walkerContext
      .openNode({ type: 'paragraph', children: [] }, 'children')
      .openNode(
        {
          type: 'link',
          url: o.node.props.url,
          children: [{ type: 'text', value: o.node.props.title }],
        },
        'children'
      )
      .closeNode()
      .closeNode();
  },
};
```

`toMatch` 默认 `() => false`（markdown 里没有能反解析成卡片的语法），`fromMatch` 按 flavour。每个提供方用这个工厂传入自己的 flavour 生成 adapter，plain-text/html 同理。

### 3.7 插入与装配

- **`insertEmbedCard`**（`common/insert-embed-card.ts`）按当前选区智能落位：有文本/块/surface 选区 → 在该块后插入（doc 流）；否则 → 用 `EdgelessCRUDIdentifier` 在**画布中心**（`Bound.fromCenter(viewport.center, …)`）新建并选中。一个函数覆盖 doc/白板两种插入。
- **`view.ts`（`EmbedViewExtension`）**：`setup` 注册全部提供方的 `Embed*ViewExtensions`；再判断 `isEdgeless(scope)`，是白板才额外注册六个 `EdgelessClipboard*Config` 与六个 `*BlockInteraction`——**白板专属能力按 scope 装配**。
- **`store.ts`（`EmbedStoreExtension`）**：注册全部 embed schema（含 linked-doc/synced-doc）、各提供方 adapters、`EmbedIframeConfigExtensions` 与 `EmbedIframeService`。
- 每提供方的 `Embed*ViewExtensions`（如 `embed-github-spec.ts`）用 `.flat()` 把 `FlavourExtension` + service + `BlockViewExtension`(按 parent 选标签) + option config + interaction + toolbar + slash-menu 打成一个数组——一个提供方的完整装配清单。

## 4. 语法特色

- **三参数泛型基类**：`EmbedBlockComponent<Model, Service, WidgetName>` 用泛型默认值让子类只需传差异类型，是"可被特化的抽象组件"的写法。
- **高阶类工厂（mixin 组合）**：`toEdgelessEmbedBlock(block)` 接收类、返回 `class extends toGfxBlockComponent(block)`，并用 `as B & { new(...): GfxBlockComponent }` 断言保留原类型信息——把"doc 组件→GFX 组件"做成一行可复用变换。
- **符号属性做运行时标记**：`[GfxElementSymbol] = true`、`[blockComponentSymbol] = true` 用 Symbol 键给实例打标，供框架 `isGfxBlockComponent` 等守卫识别。
- **`computed` 派生 UI 状态**：`showOverlay$`、iframe 的 `isSuccess$`/`selectedBorderRadius$` 等全用 `@preact/signals-core` 派生，状态变化自动重渲。
- **`effect()` 响应式副作用**：iframe 组件用 `effect` 在 doc 态按 `status` 切换 `selectedStyle`（idle=背景高亮、否则边框）。
- **工厂函数生成 adapter/interaction/toolbar**：`createEmbedBlock*AdapterMatcher`/`createEmbedEdgelessBlockInteraction`/`createBuiltinToolbarConfigExtension` 把"每提供方重复一遍"的扩展统一成传 flavour 的工厂。
- **`BlockViewExtension` 的函数式标签**：第二参可传 `` model => literal`...` ``，运行期按 `model.parent` 决定渲染 doc 还是白板标签。
- **联合类型 + 类型守卫**：`ExternalEmbedBlockComponent` 联合 + `isExternalEmbedBlockComponent`（`instanceof` 链）、model 侧 `ExternalEmbedModels as const` + `isExternalEmbedModel`——用 `as const` 元组推出联合类型。
- **`withoutTransact`**：解析/抓取得到的元数据写回模型时跳过协同事务，不污染 undo 历史与协同流。

## 5. 设计 / 实现亮点

- **"基座 + 工厂 + 配置"消除多提供方重复**：卡片基类抽象块级共性、`toEdgelessEmbedBlock`/`createEmbedEdgelessBlockInteraction`/adapter 工厂把 doc↔白板、交互、序列化全部参数化——新增一个外链提供方几乎只需写"正则 + 卡片模板 + service"，是本包最值得学的工程结构。
- **doc 态与白板态同源渲染**：白板组件 `renderGfxBlock` 直接复用 doc 的 `renderPageContent`，只注入尺寸——避免两套 UI 漂移。
- **iframe 安全与指针事件治理**：按信任级设 `sandbox`、`credentialless`、`showOverlay$` 在拖拽/缩放/失焦时挡住 iframe——把"嵌第三方页面"的安全与交互坑一次性处理。
- **异步抓取的生命周期管理**：`AbortController` 随组件卸载/URL 变化取消请求，状态机清晰表达 idle/loading/success/error。
- **通用 iframe 的配置驱动**：一套组件靠 `EmbedIframeService` 配置支持任意可嵌站点，并提供链接输入/校验/回退——把"万能嵌入"做成可扩展服务而非写死。
- **一个插入函数覆盖两种容器**：`insertEmbedCard` 按选区在 doc 流或画布中心落位，调用方无需关心编辑器模式。

## 6. 对外 API 与注意事项

- 主要导出（`index.ts`）：`EmbedBlockComponent`、`createEmbedEdgelessBlockInteraction`、`toEdgelessEmbedBlock`、`insertEmbedCard`、`render-linked-doc`/`utils` 辅助、`createEmbedBlock{Markdown,Html,PlainText}AdapterMatcher`，以及六个提供方子模块与 `types`（`ExternalEmbedBlockComponent` 联合/守卫）。装配：`EmbedViewExtension`（`./view`）、`EmbedStoreExtension`（`./store`）。
- **约定**：新增外部链接提供方 = 建 `embed-xxx-block/`（model 放 `affine-model`）→ 继承 `EmbedBlockComponent` 写卡片与 service → `toEdgelessEmbedBlock` 生白板版、`createEmbedEdgelessBlockInteraction` 生交互 → 用 adapter 工厂 → 组 `EmbedXxxViewExtensions` → 在 `view.ts`/`store.ts` 注册。
- **注意**：
  - 卡片内容异步抓取：首次渲染可能是 loading/占位，`url` 变化会重抓；改动要保持 `AbortController` 的取消语义。
  - doc 态与白板态是两个自定义元素，由 `BlockViewExtension` 按 `model.parent` 选择；白板态经 `toEdgelessEmbedBlock` 生成，别重复实现渲染。
  - iframe 的 `sandbox` 按提供方信任级设定，通用源用最严格沙箱；嵌第三方页面务必保留 overlay 与 sandbox。
  - 外链卡片导出 markdown/plain-text 会**回退成链接**（无等价语法），且一般不支持从 markdown 反解析成卡片（`toMatch` 为 false）。
  - `linked-doc`/`synced-doc` 的 schema 在本包 store 注册，但组件实现不在本包——不要在此找它们的 UI。
  - 白板专属的 clipboard/interaction 仅在 edgeless scope 注册。

## 7. 延伸

- 核心依赖：`@blocksuite/std/gfx`（`toGfxBlockComponent`/`GfxViewInteractionExtension`）、`@blocksuite/affine-block-surface`（`EdgelessClipboardConfig`/`EdgelessCRUDIdentifier`/`SurfaceBlockComponent`）、`@blocksuite/affine-model`（`EmbedProps` 与各 embed schema）、`@blocksuite/affine-shared`（`EmbedIframeService`/`LinkPreviewService`/`ImageProxyService`/常量）。
- 同层协作：`@blocksuite/affine-components`（`CaptionedBlockComponent`/portal/icons）、`@blocksuite/affine-widget-slash-menu`、`@blocksuite/affine-block-edgeless-text`（同样用 `GfxViewInteractionExtension` 的白板块，交互策略相反）。
- 对照阅读：`blocksuite-affine-block-divider.md`（不可编辑原子块的最小形态）、`blocksuite-affine-block-edgeless-text.md`（白板 GFX 块的另一种交互），并读可看清"原子/卡片/白板块"三类非文本块的范式分化。
