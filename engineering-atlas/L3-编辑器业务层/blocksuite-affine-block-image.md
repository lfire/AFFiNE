# `@blocksuite/affine-block-image`

> 一句话定位：AFFiNE 的**图片块**——把图片以 blob 的形式存入工作区、块里只持有一个 `sourceId` 引用，负责**上传/读取 blob 并解析为可渲染 URL**、**图片缩放（页面内拖拽 + 白板交互）**、**与查看器/下载/复制/转附件的互操作**。它独有的核心是**基于 `sourceId` 的 blob 引用模型（内容与块解耦）**、**`ResourceController` 驱动的加载/上传/错误状态机**、**保持宽高比的交互式 resize**、以及 **page / edgeless 双渲染 + turbo 离屏占位**。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/image`                                                                                                                                                                                                                                                                                                                                                                                             |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                                                                                                                                                                  |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                                                        |
| 关键依赖  | `@blocksuite/affine-components`（`CaptionedBlockComponent`/`ResourceController`/`peek`/`hover`/`toast`）、`@blocksuite/affine-model`（`ImageBlockModel`）、`@blocksuite/affine-shared`（`ImageSelection`/`FileSizeLimitProvider`/`NativeClipboardProvider`/`blobSync`）、`@blocksuite/affine-block-surface`、`@blocksuite/affine-gfx-turbo-renderer`、`@blocksuite/std`（`GfxCompatible`/selection）、`@preact/signals-core` |
| 被谁依赖  | 编辑器预设、`@affine/core`、`embed-doc`（卡片 banner 取图）                                                                                                                                                                                                                                                                                                                                                                  |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                                                                                                     |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | image 实现                                                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| schema                            | 复用 `affine-model` 的 `ImageBlockSchema`/`ImageBlockModel`（`sourceId`/`width`/`height`/`size`/`rotate`/`caption`/`textAlign`，`store.ts` 注册 `ImageBlockSchemaExtension` + `ImageSelectionExtension`） |
| model                             | `ImageBlockModel extends GfxCompatible(BlockModel)`——页面块，同时具备 GFX 几何能力（可放白板）                                                                                                            |
| `*-block.ts`                      | `image-block.ts` → `ImageBlockComponent`（page）、`image-edgeless-block.ts` → 白板变体                                                                                                                    |
| service                           | `image-service.ts`（`ImageDropOption` 文件拖拽落位）；无重型单例                                                                                                                                          |
| commands                          | `commands/insert-images.ts` → `insertImagesCommand`                                                                                                                                                       |
| adapters                          | `adapters/`（markdown/html/notion-html：图片节点 ↔ 块 + 资产 blob 读写）                                                                                                                                  |
| widgets                           | `configs/toolbar.ts`（下载/复制/转附件/缩放/对齐）、`configs/slash-menu.ts`                                                                                                                               |
| turbo                             | `turbo/image-layout-handler.ts` + `image-painter.worker.ts`（白板离屏占位绘制）                                                                                                                           |
| clipboard                         | `edgeless-clipboard-config.ts`                                                                                                                                                                            |
| `effects.ts`/`view.ts`/`store.ts` | 注册 `affine-image`/`affine-edgeless-image`/`affine-page-image`/fallback 等元素 + `ImageViewExtension`/`ImageStoreExtension`                                                                              |

它继承 `CaptionedBlockComponent`、用 `@Peekable`（非移动端可点开查看器）、按 `parent.flavour` 在 `affine-image`/`affine-edgeless-image` 间切换渲染——是统一范式的标准实例。

### 图片块的独有问题

1. **内容与块解耦**：图片二进制不存进 YDoc，而是进**工作区 blob 存储**，块里只存一个 `sourceId`。好处是协同文档轻量、同图可复用；代价是渲染前必须**异步取 blob → `URL.createObjectURL`**，且要处理"正在上传/下载/失败/超限/找不到"等多态。
2. **加载状态机**：blob 可能本地已有、可能需从远端下载、可能超过体积上限需用户手动上传——需统一的 loading/error/needUpload/oversize 状态与重试/上传入口。
3. **交互式缩放**：页面内拖拽左右手柄按宽高比缩放，白板里还要换算 viewport zoom；缩放结果写回 `width/height`。
4. **跨能力互操作**：下载、复制到系统剪贴板（Electron 原生 / Web `ClipboardItem`，非 PNG 要转码）、转成附件卡片、重置为原始尺寸。
5. **白板性能**：edgeless 下大量图片要能走 turbo 离屏渲染，先画占位矩形，避免主线程卡顿。

## 2. 目录与关键文件

```text
src/
├── image-block.ts            # ★ImageBlockComponent（page）：ResourceController 接线、渲染分流、hover 工具栏
├── image-edgeless-block.ts   # 白板变体 + ImageEdgelessBlockInteraction
├── image-service.ts          # ImageDropOption：文件拖拽落位（page 插兄弟块 / edgeless 落画布）
├── utils.ts                  # ★上传/下载/复制/转附件/addImages/addImageBlocks（blob 全流程）
├── image-resize-manager.ts   # ★ImageResizeManager：拖拽缩放、宽高比、zoom 换算
├── components/
│   ├── page-image-block.ts   # ★<affine-page-image>：<img> 渲染、键盘、选区、resize 观察
│   ├── image-block-fallback.ts # 无 blobUrl 时的占位卡片
│   └── image-selected-rect.ts  # 选中时的缩放手柄
├── commands/insert-images.ts # insertImagesCommand
├── adapters/                 # markdown/html/notion-html + utils（资产 blob 读写）
├── preview-image/            # page/edgeless 预览占位（preview spec 用）
├── turbo/                    # image-layout-handler + image-painter.worker（离屏占位）
├── configs/ (toolbar/slash-menu/tooltips)
└── image-spec.ts index.ts view.ts store.ts effects.ts
```

## 3. 实现细节

### 3.1 ★blob 引用模型：块里只有 sourceId

`ImageBlockModel`（`model/src/blocks/image/image-model.ts`）的 props 核心是 `sourceId?: string`——一个指向工作区 blob 存储的键，而非图片本身。`width/height/size` 是元数据，`rotate`/`xywh` 来自 `GfxCompatible`（于是图片能被放到白板上按几何操作）。上传流程 `buildPropsWith`（`utils.ts:230-243`）把"写 blob"与"读尺寸"并行：

```ts
const [imageSize, sourceId] = await Promise.all([
  readImageSize(file), // 解析宽高
  std.store.blobSync.set(file), // 写入 blob 存储，返回 sourceId
]);
return { size, sourceId, ...imageSize } satisfies Partial<ImageBlockProps>;
```

于是块只记 `sourceId` 与尺寸，二进制完全托管给 `blobSync`。`addImageBlocks`/`addSiblingImageBlocks`/`addImages`（`utils.ts:245-376`）分别对应"插入文档某处""插在某块前后""落到白板坐标"，统一先 `hasExceeded` 做体积校验（`FileSizeLimitProvider.maxFileSize`），只接受 `image/*`。

### 3.2 ★ResourceController：加载/上传/错误状态机

组件不直接碰 blob，而是委托 `ResourceController`（`affine-components/resource/resource.ts:36+`）。`image-block.ts:42-45` 把 `sourceId$` 作为响应式输入创建控制器，`connectedCallback`（`:114-129`）接线 blob 引擎并订阅：

```ts
resourceController = new ResourceController(
  computed(() => this.model.props.sourceId$.value),
  'Image'
);
// connectedCallback:
this.resourceController.setEngine(this.std.store.blobSync);
this.disposables.add(this.resourceController.subscribe());
this.disposables.add(
  this.model.props.sourceId$.subscribe(() => this.refreshData())
);
```

控制器内部用 signal 持有 `blobUrl$` 与 `state$`，并派生 `resolvedState$`（`resource.ts:42-69`）把 `uploading/downloading/overSize/errorMessage` 归约成单一 `StateKind`（`none`/`loading`/`uploading`/`error`/`error:oversize`）与 `loading` 布尔。`subscribe()`（`:133-155`）用 `effect` 订阅引擎的 `blobState$(blobId)`，把远端上传/下载进度同步进本地状态。组件 `renderBlock`（`image-block.ts:137-185`）据 `blobUrl` 是否就绪，在 `<affine-page-image>` 与 `<affine-image-fallback-card>` 间二选一，并把 `resolveStateWith(...)` 产出的图标/文案（Loading/BrokenImage/Image + `formatSize`）传下去。

这套设计把"异步资源 + 多态状态"从块组件里剥离成**可复用控制器**（附件块也用它），块只管渲染分流。

### 3.3 ★交互式缩放：宽高比 + zoom 换算

页面内缩放由 `ImageResizeManager`（`image-resize-manager.ts`）+ `page-image-block.ts` 的 `_observeDrag`（`:292-329`）协作。`onStart`（`:72-100`）记录拖拽手柄方向（left/right）、图片中心 X，并**判断是否在 edgeless**——是则取 `viewport.zoom` 作换算因子。`onMove`（`:34-70`）按鼠标到中心的距离算新宽（左右对称 `*2`），夹在 `MIN_WIDTH=50` 与容器宽之间，按 `naturalHeight/naturalWidth` 保持比例，用 `requestAnimationFrame` 更新样式宽度（除以 zoom）。`onEnd`（`:20-32`）`captureSync` 后把最终 `width/height`（除 zoom）写回模型——拖拽过程只改样式、松手才落库，合并成一次 undo。`resetImageSize`（`utils.ts:92-113`）则读原始 blob 的 `readImageSize` 把尺寸还原。

### 3.4 ★查看器 / 下载 / 复制 / 转附件

- **查看器**：`@Peekable({ enableOn: () => !IS_MOBILE })`（`image-block.ts:31-33`）——非移动端可点开大图查看（peek view）。
- **下载**：`downloadImageBlob`（`utils.ts:63-90`）用一个临时 `<a download>` 触发，期间置 `downloading` 状态防重复。
- **复制**：`copyImageBlob`（`utils.ts:115-167`）优先走 Electron 的 `NativeClipboardProvider.copyAsPNG`；否则走 Web `navigator.clipboard.write([new ClipboardItem(...)])`，而浏览器剪贴板**只支持 PNG**，非 PNG 先 `convertToPng` 转码，且要求 `isSecureContext`。
- **转附件**：`turnImageIntoCardView`（`utils.ts:172-204`）用 `withTempBlobData` 暂存图片尺寸，`transformModel(model, 'affine:attachment', ...)` **原地换 flavour**——图片与附件共享同一 `sourceId`，互转不复制 blob。

### 3.5 选区与键盘（page）

图片有自己的 `ImageSelection`（区别于 `BlockSelection`）：点图进入 image 选区（显示缩放手柄），`_handleSelection`（`page-image-block.ts:231-269`）处理。键盘（`_bindKeyMap`，`:102-223`）：Esc 从 image 选区退回 block 选区；Delete/Backspace 删图并在原位插入空段落聚焦；Enter 在下方插段落；↑/↓ 用命令链 `getPrevBlockCommand`/`getNextBlockCommand` + `focusBlockEnd`/`focusBlockStart` 把焦点移到相邻块——让图片在纯文本流里也能顺畅导航。

### 3.6 落位：拖拽与双渲染

`ImageDropOption`（`image-service.ts`）用 `FileDropConfigExtension` 处理文件拖入：目标是普通块则 `addSiblingImageBlocks` 插入兄弟位；在 edgeless 内则 `toViewCoordFromClientCoord` 换算坐标后 `addImages` 落到画布（限 `MAX_IMAGE_WIDTH`）并埋点。`image-spec.ts:16-24` 的 `BlockViewExtension` 按 `parent.flavour === 'affine:surface'` 决定渲染 `affine-edgeless-image` 还是 `affine-image`。

### 3.7 turbo 离屏占位

白板大量图片时走 turbo renderer：`turbo/image-painter.worker.ts` 定义 `ImageLayoutPainter`，在 `OffscreenCanvasRenderingContext2D` 上先画一个白底带边框的矩形占位（`:42-49`）——真实图片异步就绪前用占位撑住布局，避免主线程阻塞。经 `BlockLayoutPainterExtension('affine:image', ImageLayoutPainter)` 注册到 worker。

## 4. 语法特色

- **混入 + 几何能力**：`class ImageBlockModel extends GfxCompatible<ImageBlockProps>(BlockModel) implements GfxElementGeometry`——`GfxCompatible` 混入让页面图片块同时能当白板元素（`xywh`/`rotate`）。
- **signal 驱动的资源控制器**：`blobUrl$`/`state$` 是 `signal`，`resolvedState$` 是 `computed`，`subscribe()` 用 `effect` 桥接引擎流——整条资源状态链全响应式，组件只读 `.value`。
- **`computed` 派生选中态**：`resizeable$ = computed(() => selection.value.some(sel => sel.is(ImageSelection) && sel.blockId === blockId))`——选区变化自动驱动手柄显隐。
- **`satisfies Partial<ImageBlockProps>`**：`buildPropsWith` 返回值用 `satisfies` 校验形状又不丢字面量类型，是 TS 4.9+ 的精确约束用法。
- **`Promise.all` 并行 IO**：读尺寸与写 blob 并行，缩短上传延迟。
- **命令链 `std.command.chain().pipe(...).run()`**：↑/↓ 跨块聚焦用管道式命令组合，中间 `pipe` 可注入自定义上下文（`{ focusBlock }`）。
- **Lit 指令**：`when`（blobUrl 有无分流、loading/error 状态渲染）、`classMap`/`styleMap`、`@query` 取 `<affine-page-image>`/`.resizable-img`。
- **`literal` 动态标签**：`BlockViewExtension` 按 parent 返回 `literal`affine-edgeless-image`` 或 `literal`affine-image``。

## 5. 设计 / 实现亮点

- **内容-块解耦的 blob 引用**：图片二进制托管 `blobSync`、块只存 `sourceId`，协同文档轻量、同图复用、与附件块共享同一 blob（转换零拷贝）——是"大二进制 + CRDT 文档"矛盾的标准解法。
- **可复用的资源状态机**：`ResourceController` 把 loading/uploading/downloading/oversize/error/needUpload 这组多态从组件抽离成 signal 驱动的独立单元，图片与附件共用，组件只做渲染分流。
- **保持比例 + zoom 感知的缩放**：按 `naturalHeight/naturalWidth` 锁比例、edgeless 下除以 `viewport.zoom`、拖拽改样式松手才落库合并 undo——交互细节完整。
- **剪贴板跨端兼容**：Electron 原生 PNG 优先、Web 端非 PNG 自动转码、安全上下文校验——把浏览器剪贴板的限制逐一兜住。
- **page/edgeless 双渲染 + turbo 占位**：同一 flavour 两套组件，白板海量图片走离屏占位先行，性能可控。
- **图片作为文本流中的一等公民**：独立 `ImageSelection` + 完整键盘导航，让它在段落流里删除/换行/上下聚焦都顺手。

## 6. 对外 API 与注意事项

- 主要导出：`ImageBlockComponent`、`ImageBlockPageComponent`、`ImageResizeManager`、`ImageDropOption`、`addImages`/`addImageBlocks`/`addSiblingImageBlocks`、`copyImageBlob`/`downloadImageBlob`/`turnImageIntoCardView`/`resetImageSize`、`insertImagesCommand`、`ImageBlockSpec`；装配入口 `ImageViewExtension`（`./view`）、`ImageStoreExtension`（`./store`）。
- **约定**：插图统一经 `addImages*` 系列（内部做体积校验与 blob 写入）；取 blob URL 用 `block.blobUrl`（来自 `ResourceController`）。
- **注意**：
  - 图片渲染是异步的——首次要等 blob 下载/解析，期间显示 Loading/占位卡片属正常；超限需用户手动上传。
  - 块里只有 `sourceId`，删块不会自动回收 blob；转附件与图片共享 blob。
  - 复制到剪贴板受浏览器限制（仅 PNG、需安全上下文），非 Electron 下非 PNG 会转码。
  - 缩放只在选中（`ImageSelection`）时可用；edgeless 下尺寸换算依赖 `viewport.zoom`。
  - 白板变体是 `affine-edgeless-image`，与 page 的 `affine-image`/`affine-page-image` 不同元素。
  - turbo 占位当前只画白底矩形，不是真实图像预览。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`ImageBlockModel`/`ImageBlockSchema`/`MAX_IMAGE_WIDTH`）、`@blocksuite/std`（`GfxCompatible`/selection/命令）、`@blocksuite/store`（`blobSync`/资产）、`@blocksuite/affine-gfx-turbo-renderer`（离屏渲染）。
- 同层协作：`@blocksuite/affine-components`（`CaptionedBlockComponent`/`ResourceController`/`peek`/`hover`/`toast`）、`@blocksuite/affine-block-surface`（白板落位/剪贴板）、`@blocksuite/affine-shared`（`ImageSelection`/`FileSizeLimitProvider`/`NativeClipboardProvider`/`readImageSize`/`convertToPng`/`transformModel`）、`embed-doc`（卡片 banner 复用图片 blob）。
- 相关文档：`blocksuite-affine-block-embed-doc.md`（banner 取首图）、`blocksuite-affine-components.md`（ResourceController/caption/peek）、`blocksuite-affine-model.md`（GfxCompatible/schema）、`blocksuite-std.md`（selection/命令/GFX）。
</content>
