# `@blocksuite/affine-foundation`

> 一句话定位：AFFiNE 编辑器的**业务层地基装配包**——它本身几乎不含业务逻辑，而是用 `ext-loader` 的三个入口（`FoundationViewExtension` / `FoundationStoreExtension` / `effects`），把跨块共享的基础服务、预定义 selection、预定义剪贴板适配器、以及一大批底层组件的副作用**集中注册**成可装进编辑器的扩展集合。它是"编辑器开机时第一批被加载的通用能力"。

| 项        | 值                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/foundation`                                                                                                                                                   |
| 所属层    | L3 · 编辑器业务层（基座）                                                                                                                                                        |
| 语言/形态 | TypeScript 库（装配/聚合，无自有模型）                                                                                                                                           |
| 关键依赖  | `@blocksuite/affine-ext-loader`、`@blocksuite/affine-shared`、`@blocksuite/affine-rich-text`、`@blocksuite/affine-components`、`@blocksuite/data-view`、`@blocksuite/std`、`zod` |
| 被谁依赖  | 编辑器装配层（把 `FoundationViewExtension`/`FoundationStoreExtension` 注册进 Manager）                                                                                           |
| 对外入口  | `./view`（视图扩展）、`./store`（store 扩展）、`./clipboard`（剪贴板配置）；`.` 为空                                                                                             |

## 1. 设计逻辑

编辑器启动时需要一批"谁都要用"的基础能力：主题服务、文档模式服务、字体加载、拖拽 API、工具栏注册、链接预览、特性开关、预定义选区、剪贴板适配器……这些不属于任何单一块，却是所有块运转的前提。

把它们逐个在装配层手动注册会很啰嗦且易漏。`affine-foundation` 的立场是：**用 `ext-loader` 的 Provider 模式，把这批通用能力打包成"foundation"扩展**，让装配层一句 `register(FoundationViewExtension)` 就引入全部地基。

它恰好对应 `ext-loader` 的三条装载通道：

1. **view 通道**（`FoundationViewExtension`，`./view`）：注册**有 UI 语义、随视图环境变化**的服务与扩展（主题、文档模式、工具栏、拖拽、链接预览…），并按 `isEdgeless(scope)` 追加画布专属扩展。
2. **store 通道**（`FoundationStoreExtension`，`./store`）：注册**纯数据层**扩展——预定义选区、预定义序列化适配器、特性开关等。
3. **effects 通道**（`effects()`，经 view provider 的 `effect()` 调用）：批量执行"注册自定义元素"等一次性全局副作用。

因此 foundation 是 `ext-loader`（机制）之上的第一个、也是最基础的"内容提供方"。

## 2. 目录与关键文件

```text
src/
├── index.ts       # export {}（空；能力经子入口暴露，避免副作用进主包）
├── view.ts        # ★ FoundationViewExtension：view scope 的能力装配 + options schema
├── store.ts       # ★ FoundationStoreExtension：store scope 的选区/适配器/服务装配
├── clipboard.ts   # clipboardConfigs：按 MIME + priority 的剪贴板适配器配置表
└── effects.ts     # effects()：聚合调用底层所有 effects + customElements.define
```

## 3. 实现细节

### 3.1 FoundationViewExtension：视图地基装配

`view.ts:49-105` 继承 `ViewExtensionProvider`，覆写 `name`、`schema`、`effect`、`setup`：

```ts
export class FoundationViewExtension
  extends ViewExtensionProvider<FoundationViewExtensionOptions> {
  override name = 'foundation';
  override schema = optionsSchema;
  override effect() { super.effect(); effects(); }   // 一次性副作用
  override setup(context, options?) {
    super.setup(context, options);
    context.register([
      DocDisplayMetaService, EditPropsStore, DefaultOpenDocExtension,
      FontLoaderService, DocModeService, ThemeService, EmbedOptionService,
      PageViewportServiceExtension, DNDAPIExtension, FileDropExtension,
      ToolbarRegistryExtension, AutoClearSelectionService,
      FileSizeLimitService, LinkPreviewCache, LinkPreviewService,
      CitationService, BlockElementCommentManager,
    ]);
    context.register(clipboardConfigs);
    if (this.isEdgeless(context.scope)) {
      context.register([InteractivityManager, ToolController]);  // 画布专属
    }
    // 可选能力按 options 条件注册
    if (fontConfig)  context.register(FontConfigExtension(fontConfig));
    if (linkPreviewCacheConfig) context.register(LinkPreviewCacheExtension(...));
    if (telemetry)   context.register(TelemetryExtension(telemetry));
    if (peekView)    context.register(PeekViewExtension(peekView));
  }
}
```

三个层次清晰：**无条件基础服务** → **按 scope 条件**（edgeless 才需要交互管理器/工具控制器）→ **按 options 条件**（宿主传入字体/遥测/预览服务时才注册）。`effect()` 借 `ext-loader` 的类静态守护只跑一次，用来执行 `effects()`。

### 3.2 options schema：用 zod 约束宿主配置

`view.ts:40-47` 定义了可配置项并由 provider 的 `schema` 承接校验：

```ts
const optionsSchema = z.object({
  linkPreviewCacheConfig: z.optional(LinkPreviewCacheConfigSchema),
  fontConfig: z.optional(z.array(fontConfigSchema)),
  telemetry: z.optional(z.custom<TelemetryService>()),
  peekView: z.optional(z.custom<PeekViewService>()),
});
export type FoundationViewExtensionOptions = z.infer<typeof optionsSchema>;
```

`z.custom<T>()` 用于无法用 zod 结构描述的"任意符合某 TS 接口的对象"（如 `TelemetryService` 实例）。类型由 `z.infer` 反推，宿主 `manager.configure(FoundationViewExtension, {...})` 时即有类型提示、运行时有校验。

### 3.3 FoundationStoreExtension：数据层地基

`store.ts:26-54` 继承 `StoreExtensionProvider`，注册三类纯数据扩展：

```ts
context.register([
  // 预定义选区
  BlockSelectionExtension,
  TextSelectionExtension,
  SurfaceSelectionExtension,
  CursorSelectionExtension,
  HighlightSelectionExtension,
  // 预定义序列化适配器
  MarkdownAdapterFactoryExtension,
  PlainTextAdapterFactoryExtension,
  HtmlAdapterFactoryExtension,
  NotionTextAdapterFactoryExtension,
  NotionHtmlAdapterFactoryExtension,
  MixTextAdapterFactoryExtension,
  // 共享服务
  FeatureFlagService,
  BlockMetaService,
  ImageProxyService,
]);
```

这些在 store 层就绪，保证文档数据一加载就具备选区语义、导入导出能力和特性开关——不依赖任何 UI。

### 3.4 clipboardConfigs：优先级化的剪贴板适配表

`clipboard.ts` 用 `ClipboardAdapterConfigExtension` 把每种 MIME 类型映射到一个适配器并赋**优先级**（`:12-56`），最终汇成数组（`:58-65`）：

| MIME                                | 适配器            | priority |
| ----------------------------------- | ----------------- | -------- |
| `ClipboardAdapter.MIME`（内部快照） | ClipboardAdapter  | 100      |
| `text/_notion-text-production`      | NotionTextAdapter | 95       |
| `text/html`                         | HtmlAdapter       | 90       |
| `image/*`（7 种）                   | ImageAdapter      | 80       |
| `text/plain`                        | MixTextAdapter    | 70       |
| `*/*`（兜底）                       | AttachmentAdapter | 60       |

粘贴时按优先级从高到低匹配：优先用 AFFiNE 自己的快照（最高保真），其次 Notion、HTML、图片、纯文本，最后一切都当附件。图片类用 `Array.map` 批量生成同优先级配置（`:30-44`），避免重复。

### 3.5 effects：一次性全局副作用聚合

`effects.ts:34-70` 的 `effects()` 是"开机副作用总闸"：先调底层 `stdEffects()`、`dataViewEffects()`、`richTextEffects()`，再调 `@blocksuite/affine-components/*` 的二十多个组件 effects，最后用 `customElements.define` 注册 `icon-button`、`smooth-corner`、`toggle-switch`、`affine-block-selection` 等基础元素。它只被 `FoundationViewExtension.effect()` 调用一次。

### 3.6 为何 `index.ts` 是空的

`index.ts` 仅 `export {}`（`:1`）。foundation 的能力全部经 `./view`、`./store`、`./clipboard` 子入口按需引入。主入口留空意味着 `import '@blocksuite/affine-foundation'` 不会触发任何副作用或拉入整包——这是对 `sideEffects: false` 的严格贯彻，有利摇树。

## 4. 语法特色

- **Provider 覆写模式**：`override name/schema/effect/setup` 全部用 `override` 关键字（`view.ts`、`store.ts`），编译器保证确实覆写了基类成员，配合 `ext-loader` 的"先 `super.setup`"约定。
- **`z.custom<T>()` + `z.optional`**：对无法结构化的服务对象用 `z.custom` 做"是该类型即可"的逃生舱，可选项用 `z.optional` 包裹（`view.ts:40-45`）。
- **`z.infer<typeof schema>` 导出配置类型**：options 的 TS 类型直接从 zod schema 反推（`view.ts:47`），一处定义、校验与类型同源。
- **扩展工厂函数**：`FontConfigExtension(...)`/`TelemetryExtension(...)`/`PeekViewExtension(...)`/`ClipboardAdapterConfigExtension({...})` 都是"接收配置、返回 `ExtensionType`"的工厂，使"带参数的扩展"能像无参扩展一样 `register`。
- **`Array.prototype.map` 生成配置**：图片剪贴板配置用 MIME 列表 `.map` 批量产出（`clipboard.ts:30-44`），DRY。
- **空桶模块 `export {}`**：`index.ts` 用 `export {}` 把文件标记为 ES module 且无导出（`index.ts:1`），刻意保持主入口零副作用。

## 5. 设计 / 实现亮点

- **装配即内容**：foundation 把"编辑器需要哪些地基能力"用声明式 `register` 列表表达，新增/移除一项地基只改一处列表，装载机制完全交给 `ext-loader`。
- **三通道分层**：view（含 UI）/ store（纯数据）/ effects（全局副作用）严格分开，避免数据层误引 UI、也让 SSR/纯数据场景能只用 store 通道。
- **按 scope 与 options 的条件装配**：同一个 provider 在 page/edgeless 产出不同扩展，宿主能力（遥测/字体/预览）按需注入——通用骨架 + 可插配置。
- **剪贴板优先级表**：把"多来源粘贴如何择优"做成一张显式优先级表，行为可预期、可调整，胜过散落的条件判断。
- **零副作用主入口 + 子入口**：配合 `sideEffects: false` 与 exports 子路径，最大化摇树收益，`effects()` 这类重副作用严格隔离在 `./view` 的 `effect()` 内一次触发。

## 6. 对外 API 与注意事项

- 主要导出：`FoundationViewExtension`（`./view`）、`FoundationViewExtensionOptions`、`FoundationStoreExtension`（`./store`）、`clipboardConfigs`/`PlainTextClipboardConfig`（`./clipboard`）。
- **用法**：装配层把 `FoundationViewExtension` / `FoundationStoreExtension` 加入对应的 `ViewExtensionManager` / `StoreExtensionManager` 构造参数，再用 `manager.configure(FoundationViewExtension, { telemetry, fontConfig, ... })` 传入宿主能力。
- **注意**：主入口 `.` 为空，必须从 `./view`/`./store`/`./clipboard` 子路径导入；`effect()` 只会执行一次（`ext-loader` 的类静态守护），用于 `customElements.define` 等幂等要求的副作用；edgeless 专属扩展（`InteractivityManager`/`ToolController`）仅在 `isEdgeless(scope)` 为真时注册，page scope 下不可依赖它们。

## 7. 延伸

- 机制依赖：`@blocksuite/affine-ext-loader`（`ViewExtensionProvider`/`StoreExtensionProvider` 与 Manager）。
- 内容来源：`@blocksuite/affine-shared/services`（几乎所有被注册的服务）、`/adapters`（剪贴板与序列化适配器）、`/selection`（HighlightSelection）、`@blocksuite/std`（预定义选区）、`@blocksuite/affine-components/*`（组件 effects）、`@blocksuite/data-view` 与 `@blocksuite/affine-rich-text` 的 effects。
- 对照：同层各 `affine-block-*` 包也各自导出 `XxxViewExtension`，与 foundation 并列被装载，foundation 提供"地基"，块包提供"各自能力"。
