# `@blocksuite/affine-gfx-shape`

> 一句话定位：白板上的**几何形状图元**（`type === 'shape'`，`ShapeElementModel`）的图形层——矩形/圆角矩形/椭圆/菱形/三角形五种形状，支持两种画风（`General` 规整几何 与 `Scribbled` 手绘草图风，后者用 RoughJS）、形状内可写文字（自动换行、随文字增高）、虚线/阴影/填充样式；还提供工具栏拖拽新建、落笔前的"幽灵预览"overlay，以及 canvas 与 DOM/SVG 两套渲染路径。独有难点是**各形状的路径绘制**与**形状随内部文字自适应尺寸**。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/shape`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 关键依赖  | `@blocksuite/std`（`BaseTool`/`GfxElementModelView`/`GfxViewInteractionExtension`/`deltaInsertsToChunks`）、`@blocksuite/affine-block-surface`（`ElementRendererExtension`/`ToolOverlay`/`RoughCanvas`/`DomRenderer`/`EdgelessCRUDIdentifier`）、`@blocksuite/affine-gfx-text`（文字排版工具复用）、`@blocksuite/affine-model`（`ShapeElementModel`/`ShapeType`）、`@blocksuite/global`（`Bound`/`SVGShapeBuilder`）、`@blocksuite/affine-widget-edgeless-toolbar`（拖拽控制器）、`yjs`、`lit` |
| 被谁依赖  | edgeless 预设（`ShapeViewExtension`）；`affine-gfx-mindmap`（思维导图节点就是形状）                                                                                                                                                                                                                                                                                                                                                                                                            |
| 对外入口  | `.`、`./view`（`ShapeViewExtension`）、`./store`（适配器）                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置

形状是标准的画布原生图元，完整走 gfx 五件套：**模型** `ShapeElementModel`（affine-model，`type='shape'`，字段 `shapeType`/`radius`/`fillColor`/`strokeColor`/`strokeStyle`/`shapeStyle`/`text`/`padding`…）、**工具** `ShapeTool`、**element-renderer** `shape`（canvas 绘制，另有 `ShapeDomRenderer` 走 DOM/SVG）、**交互扩展** `ShapeViewInteraction`（缩放时按文字重排包围盒）、**view 注册** `ShapeViewExtension`（仅 edgeless scope，`view.ts:23`）。

### 1.2 两组独有维度：形状类型 × 画风，加"图元内文字"

形状比画笔/连接线多出几个独有维度：

1. **五种形状**：`rect`/`ellipse`/`diamond`/`triangle` 四个基础类型（`ShapeType`），外加 UI 概念上的 `roundedRect`（本质是带 `radius` 的 `rect`，`shape-tool.ts:71` 建时宽度 +40 以显出圆角）。每种形状的轮廓路径不同，需各自实现绘制与命中。
2. **两种画风 `shapeStyle`**：`General`（规整几何，用原生 canvas `arcTo`/`ellipse` 画）与非 General（草图风，用 **RoughJS** 的 `rc.path` 画出手绘抖动效果）。这是 AFFiNE 白板"手绘风"的来源。
3. **图元内文字**：形状中间可写字，文字排版**完全复用 `@blocksuite/affine-gfx-text`** 的 `wrapTextDeltas`/`measureTextInDOM`/`getFontString`/`isRTL`——形状不自己做排版，只负责"把文字摆在形状内合适的位置"并让形状随文字增高（`normalizeShapeBound`/`fitContent`）。

### 1.3 与 gfx-text 的分工

形状文字与画布文本图元共享同一套 canvas 排版底座（见依赖 `affine-gfx-text`）：`gfx-text` 提供"怎么把一段文字折行、测量、画出来"的工具；`gfx-shape` 提供"形状的几何"以及"文字在形状内如何水平/垂直对齐、形状如何随文字撑大"。

## 2. 目录与关键文件

```text
shape/src/
├── index.ts / view.ts / store.ts    # 聚合导出 / ShapeViewExtension / 适配器
├── consts.ts                        # 预览 overlay 尺寸、默认 RoughJS 选项（seed/roughness）
├── shape-tool.ts                    # ★ShapeTool：点击/拖拽新建 + shift 正方形 + space 移动 + 幽灵预览
├── element-view.ts                  # ShapeElementView（双击编辑文字）+ ShapeViewInteraction（缩放重排）
├── element-renderer/
│   ├── shape/
│   │   ├── index.ts                 # ★shape() renderer：按 shapeType 分派 + renderText 画字
│   │   ├── rect.ts/ellipse.ts/diamond.ts/triangle.ts  # 各形状的 canvas/RoughJS 绘制
│   │   └── utils.ts                 # ★drawGeneralShape + normalizeShapeBound/fitContent + 对齐偏移
│   └── shape-dom/                   # ShapeDomRenderer：用 SVG polygon/div 的 DOM 渲染路径
├── overlay/
│   ├── shape-overlay.ts             # ★ShapeOverlay(ToolOverlay)：落笔前跟随鼠标的幽灵形状
│   ├── factory.ts / shape.ts        # ShapeFactory + Shape 基类
│   └── rect/ellipse/diamond/triangle/rounded-rect.ts  # 各预览形状
├── text/edgeless-shape-text-editor.ts  # 形状内文字的浮层编辑器 mountShapeTextEditor
├── draggable/                       # 工具栏"拖出一个形状"的交互
└── toolbar/ + components/           # 形状选择面板、样式面板、工具栏配置
```

## 3. 实现细节

### 3.1 element-renderer：按类型分派 + 画字

`shape` renderer（`element-renderer/shape/index.ts:48`）先用 `renderer.getColorValue` 解析文字/填充/描边三色，再用一个 **`Record<ShapeType, fn>` 查表**（`shapeRenderers`，`:31`）把绘制分派给 `rect`/`ellipse`/`diamond`/`triangle` 四个函数；若 `model.textDisplay` 为真再调 `renderText` 画文字（`:74`）。查表分派让"加一种形状"只需往表里加一项。

### 3.2 两种画风：`General` vs RoughJS

以 `rect.ts` 为例（`:54`）：

- **`shapeStyle === 'General'`**：走 `drawGeneralShape`（`utils.ts:28`），用原生 canvas 画——矩形用 `arcTo` 画圆角（`drawRect`，`:99`）、椭圆用 `ctx.ellipse`、菱形/三角用 `moveTo`+`lineTo`。还处理**阴影**（`:67`，`enable_shape_shadow_blur` 开关决定软/硬阴影）。
- **非 General（草图风）**：用 **RoughJS** 的 `rc.path(pathString, options)` 画，`options` 带 `seed:666`（固定随机种子保证每次抖动一致）、`roughness`。圆角矩形的 path 用**贝塞尔逼近圆弧**，注释里标了"magic number" `K_RECT = 1 - 0.5522847498`（`rect.ts:15`，这是用三次贝塞尔逼近 90° 圆弧的经典常数）。

绘制前后用 `ctx.setTransform` 做**绕中心旋转**的变换，并在末尾把变换**还原**（`rect.ts:87-97`）以免影响后续图元。

### 3.3 形状内文字：对齐与 RTL

`renderText`（`index.ts:86`）复用 gfx-text 的排版：`wrapTextDeltas(text, font, w - 水平padding*2)` 折行、`deltaInsertsToChunks` 切行。水平位置由 `horizontalOffset`（按 `textAlign` 左/中/右，`utils.ts:167`）、垂直位置由 `verticalOffset`（按 `textVerticalAlign` 上/中/下，`:179`）算出，再加 `fontBoundingBoxAscent` 做基线对齐。RTL 处理同 gfx-text——必要时临时把 canvas 挂进 DOM（`:140-145`）。画完把文字包围盒写回 `model.textBound`（`:182`）供命中测试。

### 3.4 形状随文字自适应：`normalizeShapeBound` 与 `fitContent`

这是形状的独有算法。文字多了形状要变大：

- **`normalizeShapeBound(shape, bound)`**（`utils.ts:192`）：缩放时调用。先保证宽度不小于"最宽单字 + padding"（`:208-216`，避免把形状压到一个字都放不下），再按新宽度 `wrapText` 折行、算出需要的高度，若 `bound.h` 不够就撑高（`:225`）——即"拖窄形状，文字换行变多，形状自动变高"。
- **`fitContent(shape)`**（`:232`）：按文字内容反算最紧凑的 `maxWidth × height` 并写回 `xywh`——"刚好包住文字"。

`ShapeViewInteraction.onResizeMove`（`element-view.ts:38`）就是在缩放中调 `normalizeShapeBound` 保证文字始终放得下。

### 3.5 `ShapeTool`：点击、拖拽、预览三合一

`ShapeTool extends BaseTool<ShapeToolOption>`（`shape-tool.ts:36`，`activatedOption.shapeName` 记当前形状）：

- **点击 `click`**（`:188`）：直接建一个 100×100 的默认形状（`_addNewShape`），切回 `DefaultTool` 并选中。
- **拖拽画**：`dragStart` 建一个 0×0 形状并 `stash('xywh')`（`:299`）；`dragMove` 调 `_resize`（`:105`）按拖拽矩形实时改尺寸——**`shift` 锁正方形**（取宽高较大值，`:113-120`）、**`space` 平移整个绘制区**（记 `_spacePressedCtx` 起点再整体位移，`:122-145`）；`dragEnd`（`:248`）`pop('xywh')` 落定，若拖出的区域 `<20×20` 视为误操作直接删除（`:260`）。
- **幽灵预览 overlay**：`activate` 时 `createOverlay` 建一个 `ShapeOverlay`，`pointerMove` 让它跟随鼠标（`_updateOverlayPosition`，`:159`）、`pointerOut` 隐藏——落笔前先给用户看一个半透明的形状轮廓。
- `cycleShapeName`（`:352`）在五种形状间循环切换（配快捷键）。

### 3.6 `ShapeOverlay`：跟随鼠标的预览

`ShapeOverlay extends ToolOverlay`（`overlay/shape-overlay.ts:28`）用 `ShapeFactory.createShape(xywh, type, options, shapeStyle)` 造一个预览形状，`render` 里按当前 `globalAlpha` 半透明画出。它用 `effect` 订阅 `gfx.tool.currentTool$`（`:60`），当工具的 `activatedOption.shapeName` 变化时**实时换预览形状**——换选形状，鼠标旁的幽灵立刻跟着变。圆角矩形/矩形还有 `OFFSET` 微调以视觉居中。

### 3.7 两套渲染路径：canvas 与 DOM/SVG

除了 canvas 的 `ShapeElementRendererExtension`，本包还注册 `ShapeDomRendererExtension`（`view.ts:25`）。`shape-dom`（`shape-dom/index.ts`）用 **SVG `<polygon>` + `SVGShapeBuilder`** 和 `<div>` 文字来渲染形状，并用 `WeakMap` 缓存复用 DOM 节点（`retainedShapeDom`，`:22`）避免反复创建。矩形直接用 CSS `border-radius`、椭圆用 `border-radius:50%`、三角/菱形用 `clip-path`/polygon（`applyShapeSpecificStyles`，`:40`）。DOM 路径用于某些需要 DOM 能力（如无障碍、文本选择）或与 turbo-renderer 协作的场景。

### 3.8 工具栏拖拽新建

`draggable/`（`shape-draggable.ts`）用 `EdgelessDraggableElementController`（来自 edgeless-toolbar），把工具栏里的形状图标做成**可拖出到画布**的元素——预置了 `roundedRect`/`ellipse`/`triangle` 的堆叠动画位置（`:37-60`），拖出即在落点建对应形状。

## 4. 语法特色

- **`Record<ShapeType, fn>` 查表分派**：`shapeRenderers`（`index.ts:31`）用映射对象代替 switch，加形状即加键，渲染分派 O(1) 且声明式。
- **`ElementRenderer<T>` 函数式渲染器**：`shape` 是 `(model, ctx, matrix, renderer, rc) => void` 纯函数，`rc` 即 RoughJS 画布，`ElementRendererExtension('shape', shape)` 注册。
- **`DOMMatrix` 变换 + 还原**：绕中心旋转画完再逆变换回去（`rect.ts:87`），避免污染全局变换状态——canvas 变换栈管理的手动版。
- **RoughJS 固定 `seed`**：`SHAPE_OVERLAY_OPTIONS.seed=666`（`consts.ts:12`）让"手绘抖动"确定可复现，否则每帧重绘形状会"抖"得不一样。
- **贝塞尔逼近圆弧常数**：`K_RECT = 1 - 0.5522847498`（`rect.ts:15`）是用三次贝塞尔画 90° 圆角的数学常数，注释附了论文出处。
- **`effect` 响应式预览**：`ShapeOverlay` 用 `@preact/signals-core` 的 `effect` 订阅当前工具选项，自动换预览形状——signal 驱动 UI 的典型用法。
- **`WeakMap` 缓存 DOM**：DOM 渲染路径用 `WeakMap<HTMLElement, RetainedShapeDom>` 复用节点，元素回收时缓存自动释放。
- **`stash`/`pop` 原子化绘制**：拖拽画形状期间 `stash('xywh')`，`dragEnd` 时 `pop`，把一次绘制做成单个可撤销操作。
- **跨包复用排版**：直接 `import from '@blocksuite/affine-gfx-text'`，不重造文字测量/折行轮子。

## 5. 设计 / 实现亮点

- **类型 × 画风正交分解**：形状类型（4+1 种）与画风（规整/手绘）正交，渲染层用"查表选类型 + 分支选画风"组合，新增任一维度都不影响另一维度。
- **手绘风的确定性**：RoughJS + 固定 seed，让草图风既有手绘美感又在重绘间稳定不抖。
- **形状随文字自适应**：`normalizeShapeBound`/`fitContent` 让"形状包住文字"零手工维护，缩放时文字永远放得下。
- **落笔前幽灵预览**：overlay 跟随鼠标、随选型实时变形，交互反馈充分。
- **双渲染路径**：canvas（高性能批量）与 DOM/SVG（可访问性/文本能力）并存，按场景择优。
- **拖拽绘制的细节**：shift 正方形、space 挪动绘制区、过小自动丢弃——覆盖了画图工具的常见手势。
- **彻底复用 gfx-text**：文字排版不重复造轮子，形状只管几何与对齐，职责清晰。

## 6. 对外 API 与注意事项

- 主要导出：`ShapeTool`（`ShapeToolOption`）、`ShapeElementView`/`ShapeViewInteraction`、`ShapeElementRendererExtension`/`ShapeDomRendererExtension`、`ShapeOverlay`/`ShapeFactory`、`drawGeneralShape`/`normalizeShapeBound`/`fitContent`、`mountShapeTextEditor`、工具栏/面板配置；`./view` 的 `ShapeViewExtension`。
- **`roundedRect` 不是独立 `shapeType`**：它是 `rect` + `radius`，工具层当作第五种形状处理（建时宽度 +40），模型层仍是 `rect`。
- **草图风需要 RoughJS 画布 `rc`**：renderer 第五参 `rc` 由 surface 注入，自定义渲染勿忘。
- **文字排版依赖 gfx-text**：改字体测量/折行行为要去 `affine-gfx-text`，本包只做对齐与自适应。
- **缩放会按文字重排尺寸**：`ShapeViewInteraction` 在缩放中强制 `normalizeShapeBound`，不要期望把带文字的形状压到比文字还小。
- **仅在 edgeless 注册**：`ShapeViewExtension` 判 `isEdgeless(scope)`，文档内嵌场景不装。
- **预览 overlay 的 seed 固定**：若要让手绘预览每次不同需自行改 seed，默认是确定性的。

## 7. 延伸

- 基础设施：`@blocksuite/std/gfx` 的 `GfxElementModelView`/`GfxViewInteractionExtension`、`@blocksuite/std/inline` 的 `deltaInsertsToChunks`。
- 画布层：`@blocksuite/affine-block-surface` 的 `ElementRendererExtension`/`ToolOverlay`/`RoughCanvas`/`DomRenderer`/`EdgelessCRUDIdentifier`。
- 文字底座：`@blocksuite/affine-gfx-text`（`wrapTextDeltas`/`measureTextInDOM`/`getFontString`/`isRTL`）。
- 几何库：`@blocksuite/global` 的 `Bound`/`SVGShapeBuilder`。
- 同层 gfx：`@blocksuite/affine-gfx-mindmap`（节点即形状）、`connector`（形状是连接线的可连接目标）。
