# `@blocksuite/affine-gfx-turbo-renderer`

> 一句话定位：白板视口的**高性能"位图替身"渲染器**——当块内容很多、用户在缩放/平移时，与其让浏览器重排/重绘成百上千个 DOM 块，不如把它们一次性"拍扁"成一张 `ImageBitmap`（在 Worker 的离屏 canvas 上绘制），交互期间只画这张位图或灰色占位块，交互结束再切回真实 DOM。核心难点是**何时用位图、何时用 DOM 的状态机**，以及"把 DOM 块转成可在 Worker 里重放的布局树"。

| 项        | 值                                                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/turbo-renderer`                                                                                                                                                                                                                                        |
| 所属层    | L3 · 编辑器业务层（gfx 图形层 / 渲染基础设施）                                                                                                                                                                                                                                |
| 语言/形态 | TypeScript 库（含 Web Worker 入口）                                                                                                                                                                                                                                           |
| 关键依赖  | `@blocksuite/std`（`GfxExtension`/`GfxController`/`Viewport`/`getEffectiveDpr`/`viewportRuntimeConfig`）、`@blocksuite/global`（`di`/`DisposableGroup`/`IS_IOS`）、`@blocksuite/affine-shared`（placeholder 主题色）、`@blocksuite/store`（`Extension`/`BlockModel`）、`rxjs` |
| 被谁依赖  | edgeless 编辑器预设（通过 `TurboRendererConfigFactory` 配置注入 worker 入口）；各具体块包（如 `block-paragraph`）提供 `BlockLayoutHandlerExtension` + `BlockLayoutPainterExtension` 把自己接入渲染管线                                                                        |
| 对外入口  | `.`（渲染器 + provider + 工具）、`./painter`（`painter.worker` Worker 入口）                                                                                                                                                                                                  |

## 1. 设计逻辑

### 1.1 它不是一种"图元"，而是一层"渲染加速基础设施"

和本目录其它 gfx 包（connector/shape/mindmap…）不同，turbo-renderer **不定义任何 `ElementModel`、不注册 Tool、不参与命中测试**，所以它不走 gfx 的"模型 + 工具 + element-renderer + 交互扩展 + view 注册"五件套。它注册的是一个 `GfxExtension`（`ViewportTurboRendererExtension`），挂在 `GfxController` 上、监听视口事件，职责只有一个：**在合适的时机，用一张离屏绘制的位图替换掉视口里的 DOM 块，以换取缩放/平移时的流畅度**。

可以把它理解为 edgeless 视口的"截图加速层"：平时（静止、放大到看得清文字时）用真实 DOM 保证清晰与可交互；一旦用户开始缩放这种会触发大量 DOM 重排的操作，就切到"位图/占位块"这种 GPU 友好的廉价绘制。

### 1.2 为什么要上 Worker 与离屏 canvas

把几百个块画成位图本身是 CPU 密集的（测量、排版、填色）。若在主线程做，正好和"要保证流畅"的目标矛盾。于是本包把绘制搬进 **Web Worker + `OffscreenCanvas`**：主线程只负责**采集布局树**（`ViewportLayoutTree`，纯数据）并 `postMessage` 给 worker，worker 在离屏 canvas 上画完后用 `canvas.transferToImageBitmap()` 生成 `ImageBitmap`、零拷贝 `transfer` 回主线程，主线程一句 `ctx.drawImage` 贴上去。主线程全程不碰排版。

### 1.3 两个独有子系统

1. **状态机 + 调度（`ViewportTurboRendererExtension`，主线程）**：在 `inactive/pending/zooming/rendering/ready` 五态间切换，决定"此刻画 DOM、画缓存位图、还是画占位块"。
2. **布局采集 + 离屏绘制（`getViewportLayoutTree` + `painter.worker` + 两个 provider 抽象）**：把 DOM 块归一化成可序列化的布局树，再在 worker 里按块类型分派给对应 painter 重放。本包只提供"框架 + 文本工具"，**具体块怎么画由各块包自己实现** painter（见 1.4）。

### 1.4 可扩展的"双扩展"协议：Handler（主线程）+ Painter（worker）

一个块类型要接入 turbo 渲染，必须成对提供两个扩展（`turbo-renderer.ts:76-97` 的类注释即是官方接入指南）：

- **`BlockLayoutHandlerExtension`（主线程）**：`queryLayout(model, host, viewportRecord)` 从真实 DOM/模型里**量**出该块的布局数据（文字矩形、字号等），`calculateBound(layout)` 算出它的包围盒。
- **`BlockLayoutPainterExtension` / `BlockLayoutPainter`（worker）**：`paint(ctx, blockLayout, baseX, baseY)` 在离屏 ctx 上按布局数据**画**出来。

二者通过字符串 `type`（块 flavour）配对。`block-paragraph` 的 `ParagraphLayoutHandlerExtension` / `ParagraphLayoutPainterExtension` 是参考实现。

## 2. 目录与关键文件

```text
turbo-renderer/src/
├── index.ts                        # 聚合导出
├── turbo-renderer.ts               # ★主线程：ViewportTurboRendererExtension（状态机 + 调度 + 位图缓存）
├── types.ts                        # 全部类型：RenderingState / BlockLayout / ViewportLayoutTree / 消息协议
├── renderer-utils.ts               # getViewportLayoutTree（采集布局树）/ paintPlaceholder（占位块）/ syncCanvasSize
├── layout/
│   └── block-layout-provider.ts    # BlockLayoutHandlerExtension（主线程量布局）+ ViewportLayoutPainter（worker 侧分派器）+ BlockLayoutPainterExtension
├── painter/
│   └── painter.worker.ts           # ★Worker 入口：ViewportLayoutPainter.paintTree → transferToImageBitmap；getBaseline 基线算法
└── text-utils.ts                   # 文本分段/测量：Intl.Segmenter 分句/分词/分字，getSentenceRects 量每句矩形
```

## 3. 实现细节

### 3.1 五态状态机：何时 DOM、何时位图、何时占位

`RenderingState`（`types.ts:40`）五个状态的语义（注释 `:32-39`）：`inactive`（未激活）、`pending`（位图无效/未就绪，回退 DOM）、`zooming`（缩放中，用快速 canvas 占位块）、`rendering`（正在异步画位图）、`ready`（位图就绪，DOM 可安全移除）。

调度核心是 `refresh()`（`turbo-renderer.ts:295`），每次视口更新后按**优先级**决定下一个状态与画法：

1. **`zoom > zoomThreshold`（默认 1）**：放得足够大、看得清文字时，**直接回退 DOM**（`nextState='pending'`，清除优化块）——位图在高倍下会糊，不值得用。
2. **正在缩放 `isZooming()`**：进 `zooming`。此时再分叉——iOS 低 zoom（`≤0.5`）且已有位图则复用缓存位图（`shouldPreferBitmapCacheDuringLowZoomGesture`，`:42`，规避 iOS Safari 在极小缩放下的渲染问题）；否则画**占位块** `paintPlaceholder` 并把视口内的 DOM 块设为 idle（`updateOptimizedBlocks`）。
3. **`canUseBitmapCache()`**：有现成位图且非缩放，直接 `drawCachedBitmap()` 贴图，进 `ready`。
4. **否则**：进 `rendering`，`await paintLayout()` 让 worker 画一张新位图，画完 `drawCachedBitmap()`、转 `ready`。

`state$` 是 `BehaviorSubject<RenderingState>`，用 `distinctUntilChanged` 去重后可供外部（如视口组件决定是否隐藏 DOM）订阅。

### 3.2 失效与去抖：`invalidate` + `refresh$`

任何会改变画面内容的事件都要让位图失效。`mounted()`（`:165`）把 `selection.slots.updated` 与 `store.slots.blockUpdated` 两路 `merge` 起来，统一调 `invalidate()`（`:341`）：`layoutVersion++`、清空布局缓存、`clearBitmap()`、清 canvas、清优化块、回到 `pending`。

`layoutVersion` 是**乱序保护的关键**：worker 是异步的，画完回传时携带请求时的 `version`（`paintLayout` 的 `:390`），主线程只接受 `version === this.layoutVersion` 的位图，否则 `bitmap.close()` 丢弃——防止"旧请求的位图覆盖了新内容"。

去抖用 RxJS：`refresh$.pipe(debounceTime(1000))`（`:137`，默认 `debounceTime`）——resize 等高频事件合并成一次刷新。

### 3.3 手势期的两种策略：SKIP 模式 vs 占位块模式

视口有个开关 `SKIP_REFRESH_DURING_GESTURE`（`:183`）。开启时，平移/缩放手势**全程不刷新**（`viewportUpdated` 里直接 return），仅在手势结束后用 `setTimeout(..., POST_GESTURE_REFRESH_DELAY)` 调度一次刷新（`:218-255`，且 panning/zooming 任一恢复才真正刷新）——适合"手势中保持上一帧、松手才重画"。

未开启时走 `zooming$` 信号（`:192`）：进入缩放即 `state='zooming'`；结束时 `clearOptimizedBlocks()`、置 `isRecentlyZoomed$=true` 并用 `timer(postZoomDelay=100)` 在短暂延迟后复位，再转 `pending` 刷新——`isRecentlyZoomed$` 用来在刚缩放完的瞬间**抑制再次优化**（`canOptimize` 里 `:467` 返回 false），避免闪烁。

### 3.4 布局采集：`getViewportLayoutTree` 把 DOM 归一化成可序列化树

worker 里没有 DOM，所以必须先在主线程把"要画什么"抽成纯数据。`getViewportLayoutTree`（`renderer-utils.ts:35`）从 `store.root` 递归 `buildLayoutTreeNode`：

- 对每个 `model`，按 `model.flavour` 找匹配的 `BlockLayoutHandlerExtension`（`:68`）。**找到 handler** 则 `queryLayout` 出布局数据、`calculateBound` 出 `rect`；
- **没 handler 但有 DOM 组件**（`:105`）则退而用 `getBoundingClientRect` + `toModelCoordFromClientCoord` 反算出模型坐标系下的矩形——保证未接入 turbo 的块至少有正确包围盒（占位块能画对位置）；
- 过程中用 `layoutMinX/Y/MaxX/Y` 累积出 `overallRect`（整棵树的联合包围盒，所有坐标以它为基准，`:166`）。

handler 的 `viewportRecord` 处理很讲究（`:74-89`）：从组件 `dataset.viewportState` 反序列化，支持嵌套视口（如 edgeless 里的 note 内部又是一套坐标），拿不到就用默认 `zoom=1` 的记录。

### 3.5 离屏绘制：`painter.worker` 的树重放

worker 侧的 `ViewportLayoutPainter`（`block-layout-provider.ts:31`）在**自己的 DI 容器**里装一组 `BlockLayoutPainterExtension`——注意 worker 是独立线程，有独立的 `Container`，painter 扩展在 worker 入口单独注册，与主线程的 handler 对称但物理隔离。

收到 `paintLayout` 消息后（`:101`）：

1. `setSize(w, h, dpr, zoom)`（`:53`）：离屏 canvas 尺寸 = `逻辑尺寸 × dpr × zoom`，`ctx.scale(dpr, dpr)` 处理高清屏。
2. `paintTree`（`:77`）：再 `ctx.scale(zoom, zoom)`，DFS 遍历树，对每个节点按 `node.type` 取 painter（`getPainter`，`:37`）调 `paint(ctx, layout, overallRect.x, overallRect.y)`——`overallRect.x/y` 作为基准原点传入，painter 据此把模型坐标换算成画布坐标。
3. `canvas.transferToImageBitmap()` 生成位图，`postMessage(msg, { transfer: [bitmap] })` **零拷贝**传回。

### 3.6 贴图：`drawCachedBitmap` 的坐标换算

主线程 `drawCachedBitmap`（`turbo-renderer.ts:433`）把位图贴回 2D canvas：用 `viewport.toViewCoord(overallRect.x, y)` 把布局原点转成屏幕坐标，再 `ctx.drawImage(bitmap, vx*dpr, vy*dpr, w*dpr*zoom, h*dpr*zoom)`。位图是按某个 zoom 画的，贴图时按当前 zoom 缩放——所以缩放手势期间复用旧位图会略糊，但够快，手势结束再重画清晰版。

### 3.7 占位块：`paintPlaceholder` 的廉价画法

缩放中最廉价的画法是不画内容、只画**灰色色块**。`paintPlaceholder`（`renderer-utils.ts:190`）遍历布局树，每个节点按主题色（`getAffinePlaceholderFillColor`，随明暗主题）`fillRect` 一个矩形，够大的块（`w>10 && h>5`）再描边。它只需要坐标、不需要内容，所以极快——用户缩放时看到的是"灰块骨架在平滑缩放"，松手后才浮现真内容。

### 3.8 DOM 块的 idle/active 切换

位图/占位块画上后，视口里的真实 DOM 块就多余了（还会抢绘制资源）。`updateOptimizedBlocks`（`:474`）在 `requestAnimationFrame` 里拿 `getModelsInViewport()`，把这些块 id 传给 `viewportElement.setBlocksIdle(ids)`（隐藏/停更），并先把上一批 `setBlocksActive` 恢复。`clearOptimizedBlocks`（`:503`）在退出优化态时把所有块恢复 active。这套"idle 期间用位图替身、active 期间用真 DOM"的切换，是 turbo 渲染省下重排开销的落点。

### 3.9 文本工具：`text-utils` 的分段与测量

`text-utils.ts` 供 handler 量文字用。它用 `Intl.Segmenter` 做**国际化感知的分段**：`segmentSentences` 分句、`getWordSegments` 分词——且对 CJK（中日韩，`CJK_REGEX` 判定，`:9`）改用 `grapheme`（按字）粒度，因为中文没有空格、词级分段不适用。`getSentenceRects`（`:110`）用 `Range.getClientRects()` 量出一句话在换行后的多个矩形，再按估算字宽把文字分摊到各行矩形（`getRangeRects`，`:34`）——这样 painter 能逐行重绘文字而非整段。`getBaseline`（`painter.worker.ts:120`）据字体 em/ascent/descent 元数据算文字基线 y，保证 worker 里 `fillText` 的垂直位置与 DOM 一致。

## 4. 语法特色

- **`OffscreenCanvas` + `transferToImageBitmap` + 可转移对象**：worker 用 `OffscreenCanvas` 离屏绘制，`transferToImageBitmap()` 生成 `ImageBitmap`，`postMessage(msg, { transfer: [bitmap] })` 把底层内存**所有权转移**给主线程（零拷贝），主线程用完 `bitmap.close()` 显式释放——这是浏览器里跨线程传大图最高效的手法。
- **判别联合（discriminated union）做消息协议**：`WorkerToHostMessage = MessageBitmapPainted | MessagePaintError`、`HostToWorkerMessage = MessagePaint`（`types.ts:47-93`），用 `type` 字段判别，`switch (e.data.type)` 时 TS 自动收窄 payload 类型——类型安全的 postMessage。
- **`BehaviorSubject` + `distinctUntilChanged` 状态机**：状态用 RxJS 主题承载，既能读当前值（`state$.value`）又能订阅变化，`distinctUntilChanged` 自动去重。
- **`debounceTime` / `timer` 调度**：高频事件去抖、延迟复位标志位，全用 RxJS 操作符声明式表达，避免手写 setTimeout 管理（SKIP 模式除外，那里确实手写了可取消的 timer）。
- **抽象类做扩展协议**：`BlockLayoutHandlerExtension<T extends BlockLayout>` 用 `abstract blockType`/`queryLayout`/`calculateBound` 强制子类实现，泛型 `T` 让具体块的布局类型可携带额外字段（`BlockLayout extends Record<string, unknown>` 允许扩展）。
- **双 DI 容器对称注册**：主线程用 `host.std.provider` 装 handler，worker 用自建 `new Container()` 装 painter（`block-layout-provider.ts:42`）——同一套扩展思想跨线程复用，但容器物理隔离。
- **`ConfigExtensionFactory`**：`TurboRendererConfigFactory`（`turbo-renderer.ts:68`）用工厂生成配置标识符，应用层注入 `painterWorkerEntry: () => Worker`（worker 的构造必须由应用层提供，因为 worker 打包路径与构建工具相关）。
- **平台分支做防御**：`IS_IOS` + zoom 阈值的两个纯函数（`shouldPreferBitmapCacheDuringLowZoomGesture` / `shouldIdleTurboBlocksDuringZooming`）把"iOS Safari 极小缩放的渲染怪癖"隔离成可测试的判定函数。

## 5. 设计 / 实现亮点

- **"位图替身"的清晰/流畅权衡**：静止看 DOM（清晰可交互）、缩放看位图或灰块（流畅），`zoomThreshold` 一刀切——用最简单的规则覆盖了"看内容"与"调布局"两种核心场景。
- **主线程只采集、worker 只绘制**：把 CPU 密集的排版绘制彻底移出主线程，`ViewportLayoutTree` 作为唯一跨线程数据契约，职责切得干净。
- **`layoutVersion` 乱序防护**：异步 worker 必然面对"结果回来时需求已变"，用单调版本号一句话解决旧位图覆盖新内容的竞态。
- **可插拔的 Handler/Painter 双扩展**：新块接入只需成对实现"量"和"画"，核心渲染器零改动——把"渲染什么"开放给各块包，"何时/如何调度渲染"收在本包。
- **零拷贝位图传输**：`transferToImageBitmap` + transferable，大图跨线程无内存复制，配合 `close()` 显式回收，兼顾性能与内存。
- **国际化文本测量**：`Intl.Segmenter` 对 CJK 改字级分段，避免"按空格分词"在中文上失效，体现对多语言的认真。
- **平台怪癖隔离**：iOS 低缩放的特殊处理封装成纯函数，既修了问题又不污染主流程。

## 6. 对外 API 与注意事项

- 主要导出：`ViewportTurboRendererExtension` / `ViewportTurboRendererIdentifier`、`TurboRendererConfigFactory`、`BlockLayoutHandlerExtension` / `BlockLayoutHandlersIdentifier`、`ViewportLayoutPainter` / `BlockLayoutPainterExtension` / `BlockPainterProvider`、`getViewportLayoutTree` / `paintPlaceholder` / `syncCanvasSize`、文本工具、全部类型；`./painter` 为 worker 入口。
- **`enableBitmapRendering` 默认关闭**（`options` 默认 `:61`）：不开则 `paintLayout`/`drawCachedBitmap` 直接跳过，只剩占位块与 DOM 回退。真正启用位图需应用层在配置里打开。
- **必须由应用层提供 `painterWorkerEntry`**：本包不打包 worker，`TurboRendererConfig.painterWorkerEntry` 返回的 `Worker` 实例由宿主按构建工具约定创建；worker 入口里要自行注册各块的 `PainterExtension`。
- **接入新块需成对扩展**：只加 handler 不加 painter（或反之）会导致该块有包围盒却画不出内容（走占位块）。接入步骤见 `turbo-renderer.ts:76-97` 注释，并需 `yarn affine init` 更新 `workspace.gen.ts`。
- **主线程与 worker 的 painter 注册是两套**：handler 装在 `host.std`，painter 装在 worker 自己的 `Container`，别混。
- **位图在高 zoom 会糊**：这是设计取舍（`zoomThreshold` 之上回退 DOM），不要期望位图在放大时保持清晰。
- **它不处理命中测试/选择**：turbo 只管"画得快"，所有交互仍走真实 DOM 与 gfx 选择系统，故位图期必须能随时切回 DOM。

## 7. 延伸

- 基础设施：`@blocksuite/std/gfx` 的 `GfxExtension`/`GfxController`/`Viewport`（`toViewCoord`/`toModelCoordFromClientCoord`/`zooming$`/`panning$`）、`getEffectiveDpr`、`viewportRuntimeConfig`。
- 参考实现：`@blocksuite/affine-block-paragraph` 的 `ParagraphLayoutHandlerExtension`（主线程量）+ `ParagraphLayoutPainterExtension`（worker 画），是接入 turbo 的范本。
- 共享层：`@blocksuite/affine-shared/theme` 的 placeholder 配色；`@blocksuite/global` 的 `IS_IOS`/`DisposableGroup`。
- 对比：本目录其它 gfx 包渲染的是"画布原生图元"（canvas element-renderer），turbo 渲染的是"DOM 块的位图替身"——两条不同的渲染路径，服务不同对象。
