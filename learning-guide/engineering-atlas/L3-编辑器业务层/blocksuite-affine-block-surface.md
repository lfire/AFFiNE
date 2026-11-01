# `@blocksuite/affine-block-surface`

> 本包是重点包，运行机制、关键流程和易错点见 [重点包精讲](../重点包精讲/08-blocksuite-affine-block-surface.md)。

> 一句话定位：AFFiNE **白板（edgeless）的画布层**——它是承载所有图形元素（shape/connector/text/brush/group/mindmap…）的宿主块 `affine:surface`。它独有的核心是：把一批**非块结构的图元（ElementModel）装进一个 `Y.Map` 容器**（而非块树）、提供一条**基于 Canvas 2D 的高性能渲染管线**（分层 canvas、脏区刷新、视口裁剪、占位降级）、一套**元素渲染器注册机制**（按 `type` 分发绘制函数）、以及围绕视口的**坐标系与 CRUD / 序列化**。一句话：note/image 等块是"浮在画布上的 DOM 块"，而 shape/connector 等图元是"画在 surface canvas 上的像素"——surface 就是这块 canvas 及其数据容器。

| 项        | 值                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/surface`                                                                                                                                                                                                                                                                                        |
| 所属层    | L3 · 编辑器业务层（画布宿主块）                                                                                                                                                                                                                                                                                           |
| 语言/形态 | TypeScript / Lit 块包 + Canvas 渲染引擎                                                                                                                                                                                                                                                                                   |
| 关键依赖  | `@blocksuite/std`（`BlockComponent`）、`@blocksuite/std/gfx`（`SurfaceBlockModel` 基类/`GfxController`/`Viewport`/`LayerManager`/`GridManager`）、`@blocksuite/affine-model`（各 `*ElementModel`）、`@blocksuite/global/gfx`（`Bound`/`intersects`）、`yjs`、`fractional-indexing`、`rxjs`、`@preact/signals-core`、`lit` |
| 被谁依赖  | `@blocksuite/affine-block-root`（白板根块挂 surface）、`@blocksuite/affine-block-note`（note 作为 GFX 块浮在 surface 上）、`surface-ref`、所有 `gfx-*` 图元包                                                                                                                                                             |
| 对外入口  | `.`、`./store`、`./view`                                                                                                                                                                                                                                                                                                  |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | surface 实现                                                                                                                                                                                | 独有之处                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| schema/model                      | `SurfaceBlockSchema`（`flavour:'affine:surface'`，`role:'hub'`，`parent:['@root']`，props 只有一个 `elements: Boxed(Y.Map)`）；`SurfaceBlockModel extends BaseSurfaceModel`（来自 std/gfx） | props 不是普通字段，而是一整个装图元的 `Y.Map` |
| `*-block.ts`                      | `surface-block.ts`→`SurfaceBlockComponent`（页面）；`surface-block-void.ts`→`SurfaceBlockVoidComponent`（非白板下渲染 `nothing`）                                                           | 视图本身几乎不渲染 DOM，只挂 canvas            |
| 渲染                              | `renderer/`：`CanvasRenderer`（默认）、`DomRenderer`（flag 切换）、`overlay`、`elements`                                                                                                    | ★整条 canvas 渲染管线                          |
| 元素模型                          | `element-model/`：重导出 std/gfx 的 `GfxPrimitiveElementModel`/`GfxGroupLikeElementModel` + `elementsCtorMap`（type→构造器）                                                                | ★图元不是块                                    |
| CRUD                              | `extensions/crud-extension.ts`→`EdgelessCRUDExtension`（addElement/updateElement/deleteElement/getElementById）                                                                             | 图元的增删改入口                               |
| transformer                       | `surface-transformer.ts`→`SurfaceBlockTransformer`（Y.Map↔JSON 序列化）                                                                                                                     | ★序列化 Y.Text/Y.Map 图元                      |
| tool                              | `tool/default-tool.ts`                                                                                                                                                                      | 默认指针工具                                   |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define` + `SurfaceViewExtension`/`SurfaceStoreExtension`（按 scope 分 surface/void）                                                                                        | 装配按 scope 二分                              |

### 画布层的独有问题

1. **图元不是块**：一张白板可能有成千上万个 shape/connector，若每个都做成 BlockSuite 块（有 DOM、有生命周期），性能不可接受。所以 surface 把图元存成**一个 `Y.Map`**（key=元素 id，value=该元素的属性 `Y.Map`），由 `ElementModel` 做轻量包装，渲染时直接画到 canvas——没有 per-element 的 DOM。
2. **渲染要快**：几千个元素 + 实时平移缩放，必须有视口裁剪（只画可见的）、分层 canvas（按 z-index 分层，只重画脏层）、脏区/脏层刷新、低缩放占位降级、DPR 适配、手势期间降级等一整套性能策略。
3. **坐标系**：模型坐标（白板无限平面）↔ 视口坐标（屏幕像素）的换算贯穿渲染与交互，由 `Viewport` 统一；canvas 的实际像素尺寸要按 `zoom*dpr` 精确设置。
4. **可扩展的元素类型**：shape、connector、mindmap 等由各自的 `gfx-*` 包提供，surface 只定义"如何注册一个元素渲染器"（`ElementRendererIdentifier(type)`）与"如何注册元素模型构造器"（`elementsCtorMap`），不写死具体元素。
5. **序列化**：图元属性里混有 `Y.Text`（如文字）、`Y.Map`（如嵌套结构），快照时要特殊处理。

## 2. 目录与关键文件

```text
src/
├── surface-model.ts          # ★SurfaceBlockModel：Y.Map 图元容器 + connector 端点索引
├── surface-block.ts          # ★SurfaceBlockComponent：挂 canvas、初始化 renderer/overlay
├── surface-block-void.ts     # 非白板 scope 的空渲染视图
├── surface-transformer.ts    # ★Y.Map↔JSON 序列化（处理 Y.Text/Y.Map）
├── element-model/            # 图元模型基类重导出 + elementsCtorMap（type→构造器）
├── renderer/
│   ├── canvas-renderer.ts    # ★CanvasRenderer：分层/脏区/裁剪/占位/DPR 的渲染引擎
│   ├── dom-renderer.ts       # DomRenderer：实验性 DOM 渲染（feature flag）
│   ├── elements/             # ElementRenderer 类型定义（(model,ctx,matrix,...)=>void）
│   ├── dom-elements/         # DOM 渲染器对应
│   └── overlay.ts            # Overlay 抽象（非 CRDT 的临时绘制层，如选框/辅助线）
├── extensions/
│   ├── crud-extension.ts     # ★EdgelessCRUD：图元增删改查
│   ├── element-renderer.ts   # ★ElementRendererIdentifier/Extension：按 type 注册绘制器
│   ├── surface-middleware.ts legacy-slot-extension.ts edit-props-middleware-builder.ts query.ts
│   └── export-manager/       # 导出为图片/PDF
├── tool/default-tool.ts      # 默认指针工具
├── commands/ adapters/ utils/（a-star 寻路、rough 手绘、字体、排序…）
├── consts.ts                 # ZOOM_MIN/MAX、GRID_SIZE 等画布常量
├── view.ts store.ts effects.ts index.ts
```

## 3. 实现细节

### 3.1 ★模型：一个 Y.Map 装下所有图元

`SurfaceBlockSchema`（`surface-model.ts:15-36`）的 props 只有一个字段，但它是整张白板图元的根：

```ts
export const SurfaceBlockSchema = defineBlockSchema({
  flavour: 'affine:surface',
  props: (internalPrimitives): SurfaceBlockProps => ({
    elements: internalPrimitives.Boxed(new Y.Map()), // ← 所有图元装这里
  }),
  metadata: {
    version: 5,
    role: 'hub',
    parent: ['@root'],
    children: [
      'affine:frame',
      'affine:image',
      'affine:bookmark',
      'affine:attachment',
      'affine:embed-*',
      'affine:edgeless-text',
    ],
  },
  transformer: cfg => new SurfaceBlockTransformer(cfg),
  toModel: () => new SurfaceBlockModel(),
});
```

- **两类白板对象的分野**：`children`（frame/image/bookmark/embed…）是**真正的块**，作为 GFX 块浮在画布上（有 DOM）；而 shape/connector/text/brush/group/mindmap 等**图元**存在 `elements` 这个 `Y.Map` 里，由 canvas 绘制，不是块。这是理解整个白板架构的关键二分。
- **`Boxed(Y.Map)`**：`elements` 是一个"盒装"的 `Y.Map`，key 是元素 id，value 是该元素属性的 `Y.Map`——可协同、可增量同步。
- **`SurfaceBlockModel extends BaseSurfaceModel`**（std/gfx）：基类提供 `getElementById`/`getElementsByType`/`elementAdded`/`elementUpdated`/`elementRemoved` 等信号与方法；本包子类在 `_init`（`:145-188`）里 `_extendElement(elementsCtorMap)` 把 `type` 映射到具体 `ElementModel` 构造器（shape→`ShapeElementModel`…）。
- **connector 端点索引**：model 维护 `_connectorIdsByEndpoint`/`_connectorEndpoints` 两张 Map，订阅 `elementAdded/Updated/Removed` 实时维护"某元素被哪些 connector 连接"的反向索引（`:50-216`）——移动一个 shape 时能 O(1) 找到要重算的连线，是性能关键。

### 3.2 ★元素模型：轻量包装 Y.Map

图元模型（`element-model/index.ts`）本质是对 `elements` 里某个属性 `Y.Map` 的**响应式包装**：`elementsCtorMap` 把 `type` 字符串映射到 `GfxPrimitiveElementModel` 的子类（`ShapeElementModel`/`ConnectorElementModel`/`TextElementModel`/`BrushElementModel`/`GroupElementModel`/`MindmapElementModel`/`HighlighterElementModel`，均来自 `affine-model`）。`SurfaceElementModel` 就是 std/gfx 的 `GfxPrimitiveElementModel`、`SurfaceGroupLikeModel` 是 `GfxGroupLikeElementModel`（base.ts 只是重导出）。这些模型提供 `x/y/w/h`、`rotate`、`opacity`、`display`、`xywh` 等几何/样式访问器，读写背后的 `Y.Map` 字段——于是"改一个图元的位置"就是写它的 `Y.Map`，自动协同、自动触发 `elementUpdated`。

### 3.3 ★视图：几乎不渲染 DOM，只挂 canvas

`SurfaceBlockComponent.render()`（`surface-block.ts:239-245`）只返回一个空容器 `<div class="affine-edgeless-surface-block-container">`——真正的画面是后续 attach 进去的 `<canvas>`。初始化在生命周期里：

- `connectedCallback`（`:220-228`）：设 `RANGE_SYNC_EXCLUDE_ATTR`（画布不参与文本 range 同步）、`_initThemeObserver`（主题变 → `requestUpdate`）、`_initRenderer`、`_initOverlays`。
- `_initRenderer`（`:146-218`）：按 feature flag `enable_dom_renderer` 选 `DomRenderer` 或 `CanvasRenderer`；给 renderer 注入 viewport、`LayerManager`（分层）、`GridManager`（空间索引）、主题取色 provider、`surfaceModel`。CanvasRenderer 开启 `enableStackingCanvas`（分层 canvas），并订阅 `stackingCanvasUpdated` 把新建/移除的 canvas 挂到容器；还订阅 `gfx.selection.slots.updated` 在选区变化时 `refresh`。
- `firstUpdated`（`:230-237`）：`renderer.attach(container)`，首次渲染并把分层 canvas 追加进 DOM。
- **`fitToViewport`**（`:109-120`）：带节流缓存（200ms）的"把某 bound 纳入视口"工具，用 `viewport.setViewportByBound`。

CSS 里 `.affine-block-children-container.edgeless` 用 `touch-action:none`（修手势中途停止 firing）、radial-gradient 画网格背景；canvas `pointer-events:none`（overlay 也画在主 canvas 上，同样不接收指针事件；图元交互由 `ToolController` 全局事件加 `GridManager` 命中测试完成）。

### 3.4 ★Canvas 渲染管线：分层 + 脏区 + 裁剪

`CanvasRenderer`（`renderer/canvas-renderer.ts`，近 1400 行）是本包技术含量最高处。核心思想：**把元素按 z-index 分到多张 canvas（stacking canvas），每帧只重画脏层、只画视口内可见元素**。

- **`refresh(target)`**（`:1367-1379`）：外部唯一入口。它 `_invalidate(target)` 标脏，再用 `requestConnectedFrame` 把真正的 `_render` 合并到下一帧（`_refreshRafId` 去重，多次 refresh 只渲一次）——rAF 节流是流畅平移缩放的基础。
- **`_watchSurface`**（`:1223-1254`）：订阅 model 的 `elementAdded/Removed/Updated`、`localElement*`，据变化类型调 `refresh({type:'all'|'element'})`——元素加删触发全量、单元素更新只标记该元素脏。注意它**忽略 `externalXYWH` 更新**（那是 renderer 自己写回的，避免回环）。
- **`_render`**（`:966-1124`）：一帧的主体。
  - 算 `dpr = getEffectiveDpr(zoom)`、`scale = zoom*dpr`，建 `DOMMatrix().scaleSelf(scale)` 作为变换矩阵——模型坐标经此矩阵映射到 canvas 像素。
  - `getStackingCanvasBypassState`：iOS 低缩放/手势期间可**绕过分层 canvas**降级渲染（省内存）。
  - 对每个**脏的** stacking canvas（`_dirtyStackingCanvasIndexes`，全量时为所有层）：算该层渲染 bound、`clearRect` + `setTransform(matrix)` + `_renderByBound(...)` 只画该层元素。
  - 主 canvas 画"没有对应 stacking canvas 的回退元素"（含最上层，stacking canvas 只分配给其余层）与 overlay。
- **`_renderByBound`**（`:1147-1211`）：真正遍历元素绘制。元素来源是调用方传入的 `layer.elements` 或回退元素数组；只有未传元素时（如 `getCanvasByBound`）才用 `grid.search(cullBound, {filter:['canvas','local']})` 取与裁剪框相交的元素；逐个判断 `display && !hidden && intersects(getBoundWithRotation(element), cullBound)`；可见则：
  - 若 `usePlaceholder`（iOS 低缩放手势，或开启 turbo renderer 且正在缩放）且非 `forceFullRender`，只画一个灰色占位矩形（`fillRect`）——元素太小时不值得精细绘制。
  - 否则按 `element.type` 取 `ElementRendererIdentifier(type)` 对应的 `renderFn`，`ctx.globalAlpha=opacity`、平移到元素位置、调 `renderFn(element, ctx, matrix.translate(dx,dy), this, rc, bound)` 绘制。
  - 最后画 overlay（选框、辅助线等非 CRDT 层）。
- **canvas 尺寸**：`_canvasSizeUpdater`（`:426-450`）按 `zoom*dpr` 计算 canvas 的实际 `width/height` 与 CSS `transform`——"指定真实像素尺寸而非 100%，跨浏览器更一致"（源码注释）。
- 大量调试指标（`CanvasRendererDebugMetrics`：内存、层数、渲染耗时…）内建，便于性能分析。

### 3.5 ★元素渲染器：按 type 分发绘制函数

surface 自己不知道怎么画一个 shape——它只定义**契约**。`ElementRenderer`（`renderer/elements/index.ts`）是一个函数类型：

```ts
export type ElementRenderer<T = GfxPrimitiveElementModel> = (
  model: T,
  ctx: CanvasRenderingContext2D,
  matrix: DOMMatrix,
  renderer: CanvasRenderer,
  rc: RoughCanvas,
  viewportBound: IBound
) => void;
```

`ElementRendererExtension(id, renderer)`（`extensions/element-renderer.ts`）用 `ElementRendererIdentifier(type)` 把某 type 的绘制函数注册进 DI；`_renderByBound` 里 `this.std.getOptional(ElementRendererIdentifier(element.type))` 取出调用。于是各 `gfx-*` 包（gfx-shape、gfx-connector、gfx-mindmap…）各自注册自己的绘制器，surface 保持对具体元素无知——**开放扩展、封闭修改**。`rc: RoughCanvas`（`utils/rough`）提供手绘风格描边，是白板"手绘感"图形的底层。

### 3.6 ★序列化：Y.Map/Y.Text 的特殊处理

`SurfaceBlockTransformer`（`surface-transformer.ts`）负责 `elements` 这个 Y.Map 与快照 JSON 的互转。普通块的 props 是平凡 JSON，但图元属性里嵌着 `Y.Text`（文字）和 `Y.Map`（结构）：

- `_toJSON`/`_fromJSON`（`:24-55`）用唯一标识符 `SURFACE_TEXT_UNIQ_IDENTIFIER`/`SURFACE_YMAP_UNIQ_IDENTIFIER` 标记这两类特殊值：`Y.Text`→`{[TEXT]:true, delta}`、`Y.Map`→`{[YMAP]:true, json}`，反向再还原成真正的 Yjs 类型。
- `toSnapshot` 支持**按选中元素裁剪**：`transformerConfigs.get('selectedElements')` 存在时只序列化被选中的元素（`:98-107`）——复制部分白板内容的基础。
- `fromSnapshot` 把 JSON 逐个 `elementFromJSON` 还原成 `Y.Map` 再 `Boxed` 回 `elements`。

### 3.7 CRUD 与坐标系

- **`EdgelessCRUDExtension`**（`extensions/crud-extension.ts`）是图元增删改的统一门面：`addElement(type, props)`、`updateElement(id, props)`、`deleteElement(id)`、`getElementById`——内部调 `surface.addElement/updateElement/deleteElement`。`getElementById` 还会回退到 `store.getModelById`，于是"图元"和"GFX 块"用同一个查找入口（surface-ref 正是用它跨两类对象查引用）。
- **坐标系**：`consts.ts` 定义 `ZOOM_MIN=0.1`/`ZOOM_MAX=6`、`GRID_SIZE=3000` 等；模型坐标↔视口坐标的换算由 std/gfx 的 `Viewport` 提供（`setViewportByBound`、`viewportBounds`、`overscanViewportBounds`），渲染时统一用 `DOMMatrix` 把模型坐标乘 `zoom*dpr` 映射到像素。

### 3.8 一块两视图：surface 只在白板活

`view.ts` 按 scope 装配：白板 scope 注册 `<affine-surface>`（真 CanvasRenderer）+ `DefaultTool` + `EditPropsMiddlewareBuilder`；非白板 scope 注册 `<affine-surface-void>`（`render(){ return nothing }`）——页面模式下文档仍可能含 surface 数据（白板数据），但不渲染画布。无论哪种 scope 都注册 `EdgelessCRUDExtension`/`EdgelessLegacySlotExtension`/`ExportManagerExtension`（数据与导出能力与渲染解耦）。

## 4. 语法特色

- **`Boxed(Y.Map)` 作为 prop**：用 `internalPrimitives.Boxed` 把一个 Yjs 容器当作块的单一 prop——块的"数据"不再是平凡字段，而是一整个可协同的子文档结构，这是把"非块的图元集合"塞进块模型的语法手段。
- **DI 注册的渲染器契约**：`createIdentifier('element-renderer')` + `ElementRendererIdentifier(type)` 让"按 type 查绘制函数"成为类型安全的 DI 查询；`ElementRendererExtension` 返回 `{ setup, identifier }` 的扩展对象——用依赖注入实现插件式元素渲染。
- **`DOMMatrix` 变换**：`new DOMMatrix().scaleSelf(scale)` + `matrix.translate(dx,dy)` 把模型坐标映射到 canvas，避免逐点手算；`ctx.setTransform(matrix)` 一次设定整层变换。
- **`WeakMap` 存 canvas 状态**：`_stackingCanvasState = new WeakMap<HTMLCanvasElement, …>()` 用 WeakMap 挂载每张 canvas 的 bound/layerId，canvas 回收时状态自动释放。
- **rAF 合并刷新**：`refresh` 用 `_refreshRafId` 去重 + `requestConnectedFrame`，把多次失效合并成一帧渲染——响应式与性能的经典结合。
- **`satisfies` 与判别**：`{ bound:null, layerId } satisfies StackingCanvasState` 在不丢失字面量类型的前提下校验结构。
- **反向索引 Map**：connector 端点索引用 `Map<endpointId, Set<connectorId>>`，订阅元素事件增量维护——图论式的数据结构服务于"移动节点重算连线"。
- **`literal` + scope 分支**：`affine-surface` / `affine-surface-void` 同 flavour 两视图。

## 5. 设计 / 实现亮点

- **图元 ≠ 块的架构抉择**：把成千上万的 shape/connector 存进一个 `Y.Map` 由 canvas 统一绘制，而非每个做成有 DOM 的块——这是白板能承载海量元素且保持流畅的根本。note/image 这类少量、需富交互的对象才是块（浮在画布上），shape 这类大量、纯图形的是图元（画在 canvas 上），二者分野清晰。
- **工业级 canvas 渲染管线**：分层 stacking canvas（只重画脏层）+ GridManager 空间索引视口裁剪（只画可见）+ rAF 合并刷新 + 低缩放占位降级 + DPR/iOS 手势适配 + 内建性能指标——把"无限画布实时渲染"这个硬问题处理得相当完整。
- **开放的元素渲染契约**：surface 对具体元素类型一无所知，靠 `ElementRendererIdentifier(type)` 让各 `gfx-*` 包注入绘制器——新增一种图元无需改 surface，是"框架层/能力层"分层的典范。
- **connector 端点反向索引**：用增量维护的 `Map<endpoint, Set<connector>>` 把"拖动节点要更新哪些连线"从 O(n) 降到 O(1)，是面向交互性能的数据结构设计。
- **序列化的 Yjs 类型桥接**：用唯一标识符标记 `Y.Text`/`Y.Map` 并双向还原，让含协同子结构的图元也能快照/复制/粘贴，且支持按选中元素裁剪导出。
- **渲染与数据解耦**：CanvasRenderer 与 DomRenderer 可 feature-flag 切换、CRUD/导出扩展与渲染独立注册——同一份图元数据可被不同渲染后端消费。

## 6. 对外 API 与注意事项

- 主要导出：`SurfaceBlockComponent`、`SurfaceBlockModel`/`SurfaceBlockSchema`、`CanvasRenderer`/`DomRenderer`、`ElementRenderer` 类型与 `ElementRendererExtension`、`Overlay`/`OverlayIdentifier`、`SurfaceBlockTransformer`、`EdgelessCRUDExtension`、各工具（`getSurfaceBlock`/`AStarRunner`/`RoughCanvas`/`sortIndex`/`updateXYWH`…）；装配入口 `SurfaceViewExtension`（`./view`）、`SurfaceStoreExtension`（`./store`）。
- **约定**：新增图元类型 = 在 `affine-model` 定义 `ElementModel` + 在对应 `gfx-*` 包用 `ElementRendererExtension(type, renderFn)` 注册绘制器；图元增删改走 `EdgelessCRUDExtension`，不要直接写 `elements` Y.Map。
- **注意**：
  - 分清两类对象：`children`（frame/image/embed…）是 GFX 块（有 DOM），`elements` 里的是图元（canvas 绘制）——它们的查找、渲染、交互路径不同。
  - renderer 的 `refresh` 已 rAF 合并，不要手动同步调 `_render`；元素更新经 `elementUpdated` 自动触发重绘，但 `externalXYWH` 更新被刻意忽略以防回环。
  - canvas 尺寸按 `zoom*dpr` 精确设置，改渲染尺寸逻辑要同时顾及 DPR 与低缩放/手势降级分支，否则高分屏模糊或 iOS 卡顿。
  - surface 排除 range 同步（`RANGE_SYNC_EXCLUDE_ATTR`）；canvas `pointer-events:none`，图元交互走 `ToolController` 全局事件加 `GridManager` 命中测试。
  - 序列化图元时 `Y.Text`/`Y.Map` 必须经 transformer 的标识符桥接，直接 JSON 化会丢失协同结构。
  - 非白板 scope 下是 `affine-surface-void`（不渲染），别期待页面模式能看到画布。

## 7. 延伸

- 底层：`@blocksuite/std/gfx`（`SurfaceBlockModel` 基类、`GfxController`/`Viewport`/`LayerManager`/`GridManager`/`GfxPrimitiveElementModel`）、`@blocksuite/affine-model`（各 `*ElementModel`）、`@blocksuite/global/gfx`（`Bound`/`intersects`/`getBoundWithRotation`）、`yjs`。
- 同层协作：`@blocksuite/affine-block-root`（白板根块 `EdgelessRootBlock` 挂 surface，见 `blocksuite-affine-block-root.md`）、`@blocksuite/affine-block-note`（note 作为 GFX 块浮在 surface 上）、`@blocksuite/affine-block-surface-ref`（在页面引用 surface 局部）、各 `gfx-*` 图元包（注册元素模型与渲染器）。
- 对照阅读：`blocksuite-affine-block-root.md`（surface 的宿主根与白板工具/widget）、`blocksuite-affine-block-surface-ref.md`（如何只读地引用 surface 的一角）、`blocksuite-affine-block-note.md`（块与图元的分野样本）。
