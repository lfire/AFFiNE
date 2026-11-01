# `@blocksuite/affine-gfx-connector`

> 一句话定位：白板上的**连接线**图形层——把两个"可连接图元"（或任意两点）用一条线连起来，支持直线 / 折线（正交）/ 曲线三种模式、四个方向锚点吸附、A\* 自动绕障路由、贝塞尔曲线、可配置端点箭头与行内文字标签；核心难点是"端点如何吸附"（锚点算法）与"折线如何绕开两个图元"（路由算法）。

| 项        | 值                                                                                                                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/connector`                                                                                                                                                                                                                                                                                                               |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                                                                 |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                                                                   |
| 关键依赖  | `@blocksuite/std`（`BaseTool`/`GfxElementModelView`/`GfxViewInteractionExtension`）、`@blocksuite/affine-block-surface`（`Overlay`/`AStarRunner`/`SurfaceMiddleware`/CRUD）、`@blocksuite/affine-model`（`ConnectorElementModel`）、`@blocksuite/global`（向量/贝塞尔/几何）、`@blocksuite/affine-gfx-text`（标签文本排版）、`lit`、`lodash-es` |
| 被谁依赖  | edgeless 编辑器预设（通过 `ConnectorViewExtension` 注册）                                                                                                                                                                                                                                                                                       |
| 对外入口  | `.`、`./view`（`ConnectorViewExtension`）、`./store`（`ConnectorStoreExtension`，含 watcher）                                                                                                                                                                                                                                                   |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置

和画笔一样，连接线是**画布原生图元**（`type === 'connector'`），走 gfx 的"模型 + 工具 + 渲染 + 交互 + 注册"五件套而非块范式。但它比画笔多出两个**块范式根本没有的维度**：

1. **引用关系**：连接线的两端 `source`/`target` 是一个 `Connection`（`{ id?, position? }`），既可指向某个元素 id（"绑定"），也可指向一个绝对坐标（"浮空")，还可两者都有（position 作为该元素内的相对锚点）。于是连接线是白板里**唯一需要"跟着别的图元跑"的图元**——被连元素一移动，线必须重算。
2. **派生几何**：它存的是 `source`/`target`/`mode`，而真正画出来的 `path` 是**算出来的**。这意味着任何影响两端的变化都要触发一次"重新布路"。

这两点决定了本包的两个独有子系统：**`ConnectorPathGenerator`（路由计算）** 和 **`connectorWatcher`（响应式重算）**。

### 1.2 独有难点：锚点吸附与绕障路由

- **锚点（anchor）**：线要能"吸"到图形的边上。每个可连接图元有四个候选连接方位（上右下左，`ConnectorEndpointLocations = [[0.5,0],[1,0.5],[0.5,1],[0,0.5]]`，三角形另有一套）。拖动端点时要实时找到最近的锚点并高亮。
- **路由（routing）**：直线模式只需两点；曲线模式要算贝塞尔控制点让线"顺滑地从图形切向出发"；**正交（折线）模式最难**——线必须横平竖直、绕开 source 和 target 两个矩形、还要走"视觉上最短/最顺"的路径。本包为此动用了 **A\* 寻路**：先在两个图形周围撒一批候选拐点，再用 A\* 在这些点间找代价最小的折线。

## 2. 目录与关键文件

```text
connector/src/
├── index.ts                    # 聚合导出
├── view.ts                     # ConnectorViewExtension：注册工具/渲染/交互/overlay
├── store.ts                    # ConnectorStoreExtension：注册 adapter + connectorWatcher
├── connector-manager.ts        # ★核心：锚点算法 + ConnectionOverlay + PathGenerator/ConnectorPathGenerator
├── connector-tool.ts           # ConnectorTool：拖拽连线 / 快速连线两种交互
├── connector-watcher.ts        # SurfaceMiddleware：被连元素变化时微任务批量重算 path
├── element-transform/
│   └── connector-filter.ts     # ConnectorFilter：拖拽多选时过滤/排序连接线
├── renderer/
│   ├── element-renderer.ts     # canvas 渲染：路径 + 端点 + 标签
│   ├── utils.ts                # renderArrow/Triangle/Circle/Diamond 端点样式
│   └── dom-renderer.ts         # DOM 备用渲染
├── view/view.ts                # ConnectorElementView + ConnectorInteraction（拖/缩放/旋转/标签）
├── text/                       # 连接线上的文字标签编辑器
├── components/connector-handle.ts  # 端点拖拽手柄
└── toolbar/                    # 工具栏按钮与菜单（三种模式切换）

# 模型在 affine-model：
#   affine/model/src/elements/connector/connector.ts       —— ConnectorElementModel
#   affine/model/src/elements/connector/local-connector.ts —— 临时/预览用
#   affine/model/src/consts/connector.ts                   —— ConnectorMode / PointStyle 枚举
```

## 3. 实现细节

### 3.1 数据模型：存"引用"，不存"坐标"

`ConnectorElementModel`（`affine/model/.../connector.ts:106`）的核心字段：`mode`（`Straight`/`Orthogonal`/`Curve`，默认 `Curve`）、`source`/`target`（`Connection`）、`stroke`/`strokeWidth`/`strokeStyle`、`frontEndpointStyle`/`rearEndpointStyle`（端点样式）、以及一组标签属性（`text`/`labelXYWH`/`labelOffset`...）。`Connection` 的语义很讲究（`:49-54`注释）：

```ts
// at least one of id and position is not null
// both exists means the position is relative to the element
export type Connection = { id?: string; position?: [number, number] };
```

- 只有 `position`：线端浮空在某个绝对点；
- 只有 `id`：线端绑定某元素，锚点由算法挑最近的；
- 两者都有：`position` 是**该元素内的相对坐标 [0..1]**（如 `[1,0.5]` = 右边中点）。

真正绘制用的 `path`（`PointLocation[]`，相对包围盒）和 `xywh` 都是**派生**出来的——`connector.connected` getter（`:118`）判断是否绑定了元素。`forceFullRender = true`（`:112`）标记"连接线在缩放时也必须全量重绘"，因为它常常横跨大半个画布。

### 3.2 锚点算法：`getAnchors` 与 `calculateNearestLocation`

`getAnchors(ele)`（`connector-manager.ts:133`）为一个图元算出"线该从哪儿连进来"的候选点。做法很巧：从图形包围盒**中心**向上/下/左/右各引一条射线（终点在盒外 `offset=10`），用 `ele.getLineIntersections(center, 方向点)` 求射线与**图形真实轮廓**（圆/菱形/三角会不同）的交点——于是锚点落在图形边界上而非外接矩形上，带旋转也正确（`getPointFromBoundsWithRotation`）。

`calculateNearestLocation(point, bounds, locations)`（`:77`）则把四个相对方位映射成绝对坐标、算到 `point` 的距离、`reduce` 出最近的那个相对方位 `[0..1]`——这就是拖动时"端点吸到哪条边"的判定。三角形用 `ConnectorEndpointLocationsOnTriangle`（`:62`，右/左方位内缩到 0.75/0.25）以贴合斜边。

### 3.3 交互：`ConnectorTool` 的两种连线

`ConnectorTool`（`connector-tool.ts:38`）有两种模式（`ConnectorToolMode`）：

- **Dragging（拖拽连线）**：`pointerDown` 用 `ConnectionOverlay.renderConnector(startPoint)` 探测起点是否落在某元素锚点上，记成 `_source`；`dragStart` → `_createConnector` 创建一条 `source=_source, target={position:起点}` 的连接线；`dragMove` 持续 `findTargetByPoint` 更新 `target`；`dragEnd` 落定并选中（`:126-136`）。
- **Quick（快速连线）**：`quickConnect(point, element)`（`:195`）从一个已有图元的锚点直接拉线——先用 `calculateNearestLocation` 定 source 锚点，再 `findTargetByPoint` 实时找目标。鼠标抬起时若没吸到目标（`_allowCancel`）则可取消。

`getNextMode`（`:225`）在 `Curve → Orthogonal → Straight` 间循环切换。注意**它并不自己算路径**——`updateElement` 改了 `source`/`target` 后，由 3.6 的 watcher 负责触发路由。

### 3.4 探测高亮：`ConnectionOverlay.renderConnector`

`ConnectionOverlay`（`connector-manager.ts:851`，继承 surface 的 `Overlay`）负责"拖线时画出候选锚点和高亮点"。`renderConnector(point, excludedIds)`（`:958`）是吸附探测的核心，按**由精确到宽松**四级判定目标（`:966-1043`）：

1. 视口内所有 `connectable` 元素里，先排除 `excludedIds`、再用膨胀 10px 的旋转包围盒粗筛；
2. **最近锚点**：把所有 `getAnchors` 的点换算到视口坐标，与指针求最近；视口距离 `< 8` 直接命中锚点并 `break`；
3. **最近边界点**：`connectable.getNearestPoint(point)` 到图形轮廓最近点，`< 8` 则吸到边上任意位置；
4. **落在内部**：`includesPoint` 命中则连到该元素（不带 position，由算法挑锚点）；
5. 都不中，则 `result = { position: point }` 浮空。

`render(ctx)`（`:911`）用 canvas 把候选锚点画成白底圆圈、高亮点画成实心圆、Group 目标画虚线框——全部按 `1/zoom`/`5/zoom` 做反缩放，保证视觉尺寸恒定。

### 3.5 路由算法：三种模式

路由在 `ConnectorPathGenerator._generateConnectorPath`（`connector-manager.ts:1264`）按 `mode` 分派：

**直线（Straight，`:1372`）**：若两端都绑定元素且无显式 position，用 `getNearestConnectableAnchor` 各取离对方最近的锚点，返回两点即可。

**曲线（Curve，`:1295`）**：核心是算每个端点的**切向控制点**，让线"垂直于图形边切出去"再平滑汇合。对绑定端，取锚点切线 `tangent` 旋转 90°作为出/入方向 `out`/`in`，长度取 `max(100, 投影距离/3)`（`:1324-1350`）——这保证曲线从图形法线方向优雅地离开/进入。渲染时用 `bezierCurveTo`（见 3.7）。

**正交 / 折线（Orthogonal，最复杂）**：`generateOrthogonalConnectorPath`（`:1114`）流程：

1. `computeOffset`（`:626`）算两个图形各边的"外扩距离"（默认 20，若两图形贴太近则取间距一半），得到 `expandStartBound`/`expandEndBound`——**线不能贴着图形走，要留呼吸空隙**。
2. 快速短路：若一个图形的扩展框已包含另一端点，直接 `getDirectPath`（`:1126-1141`）出一条 L 形或直线。
3. `computePoints`/`getConnectablePoints`（`:475`）在**两个扩展框的顶点、中点、外包框网格线交点、以及两图形之间的"间隙中线"**上撒一大批候选拐点，每个点带优先级（`pushWithPriority`），并 `removeDulicatePoints` 去重对齐（把几乎相等的坐标吸附到同一值，`:433`）。
4. 把候选点、起终点、两个图形当"障碍"喂给 **`AStarRunner`**（来自 surface，`:1158`），`run()` 在候选点构成的图上用 A\* 找代价最小路径——A\* 的代价函数天然倾向"少拐弯、绕开障碍"。
5. `mergePath`（`:590`）把连续共线的点合并，消除冗余拐点，得到最终折线。

这套"撒点 + A\* "而非解析式路由的做法，换来的是**对任意图形布局都稳健**（不用为每种相对位置写分支），代价是计算量，故用 watcher 批量化（3.6）。

### 3.6 响应式重算：`connectorWatcher`

连接线必须"跟着被连元素跑"。`connectorWatcher`（`connector-watcher.ts:11`）是一个 `SurfaceMiddleware`，订阅 surface 的三类事件：`elementAdded`（新增元素时，重算与它相关的连接线）、`elementUpdated`（某元素 `xywh`/`rotate` 变 → `surface.getConnectors(id)` 找出所有连到它的线重算；连接线自身 `mode`/`source`/`target` 变 → 重算自己）、`blockUpdated`（块级元素移动也触发，`:70`）。

关键性能设计是**微任务批处理**（`:28-41`）：所有待重算的连接线先进 `pendingList: Set`，首个进入时 `queueMicrotask` 排一次刷新，本轮同步代码里的多次变更合并成一次重算。这避免了"拖动一个连了 10 条线的图形时每帧重算 10×N 次"。

`ConnectorPathGenerator.updatePath`（`connector-manager.ts:1185`）是落盘点：算出 `points` 后，曲线模式用 `getBezierCurveBoundingBox` 否则 `getBoundFromPoints` 求包围盒，把点转成**相对包围盒**的 `PointLocation`，再按注释强调的**赋值顺序**（先 `xywh` 后 `path`，`:1203-1205`）写回，最后顺带更新标签位置。`updatingPath` 标志位防止写回再次触发 watcher 形成环。

### 3.7 渲染：路径 + 端点 + 标签

canvas 渲染 `connector`（`renderer/element-renderer.ts:39`）分三步：

- **`renderPoints`**（`:131`）：`rough=true` 走 RoughJS 手绘风格（`rc.path`/`rc.linearPath`）；否则普通 canvas——曲线模式逐段 `bezierCurveTo(last.absOut, point.absIn, point)`（`:173`，控制点就是 `PointLocation` 携带的 `absIn`/`absOut`），折线/直线用 `lineTo`，`lineJoin/lineCap='round'`，虚线 `setLineDash([12,12])`。
- **`renderEndpoint`**（`:198`）：按 `frontEndpointStyle`/`rearEndpointStyle`（`PointStyle`：`Arrow`/`Triangle`/`Circle`/`Diamond`/`None`，默认前 None 后 Arrow）调对应 `renderArrow`/`renderTriangle`/... 画箭头。
- **`renderLabel`**（`:225`）：有文字标签时，先对主路径与标签矩形做 `clip(path, 'evenodd')`**挖空标签区域**（`:74-77`，让线不穿过文字），再用 `affine-gfx-text` 的 `wrapTextDeltas` 排版、`fillText` 绘制，含 RTL 混排处理（`:281-288` 临时挂载到 DOM 以正确测量）。

### 3.8 交互扩展：`ConnectorElementView` 与 `ConnectorInteraction`

`ConnectorElementView extends GfxElementModelView`（`view/view.ts:18`）定义选中后的交互：拖动整条线时 `moveTo`、双击进入标签编辑、标签可独立拖动（沿线滑动，`labelOffset.distance` 记录标签在线上的归一化位置，`:99-117`）。`ConnectorInteraction = GfxViewInteractionExtension(...)`（`:181`）接管缩放/旋转：缩放前 `stash('source'/'target'/'labelXYWH')`，缩放中 `model.resize(initialPath, matrix)`，还约束"只有当连接线连同其 source/target 一起被选中时才显示 resize 手柄"（`beforeResize` 里清空 `allowedHandlers`，`:187-202`）——因为单独拉伸一条两端都绑定的线没有意义。

`ConnectorFilter`（`element-transform/connector-filter.ts:7`，一个 `InteractivityExtension`）在多选拖拽初始化时：若某连接线的 source/target 不在选区内则把它从拖拽集合剔除（否则会与被连元素的移动打架），并把连接线**排到拖拽列表最前**（`:36`）保证先更新线再更新元素。

## 4. 语法特色

- **`Connection` 的"可选字段语义耦合"**：用 `{ id?, position? }` 两个可选字段的**组合**表达三种连接语义（浮空/绑定/相对），靠注释约定"至少一个非空、都存在时 position 为相对坐标"——轻量但需要纪律。
- **`PointLocation`：带切向的点**：路径点不是裸 `[x,y]`，而是 `PointLocation`，额外携带 `in`/`out`（贝塞尔控制点相对偏移）、`absIn`/`absOut`（绝对控制点）、`tangent`（切向量）。曲线渲染直接读这些字段，几何与渲染解耦。
- **`@field`/`@derive`/`@local` 装饰器**：模型里 `source`/`target`/`mode` 用 `@field` 持久化，`path` 用 `@local`（派生、不入 Yjs），`@derive` 表达联动——这是 `GfxPrimitiveElementModel` 的声明式响应模型。
- **微任务批处理**：`queueMicrotask` + `Set` 去重，把一轮同步变更合并成一次重算，是响应式系统防抖的经典手法。
- **A\* 复用**：路由不自己实现图搜索，复用 surface 的 `AStarRunner`，把"几何问题"归约为"带障碍的图上最短路"。
- **`ctx.clip(path, 'evenodd')`**：用奇偶填充规则做"环形裁剪"，让主路径避开标签矩形——canvas 高级用法。
- **`satisfies IVec[]`**：`getAnchors` 里用 `satisfies` 校验字面量数组形状而不丢失具体类型（`:145`）。

## 5. 设计 / 实现亮点

- **引用式连接 + 派生路径**：模型只存两端引用，路径全算；被连元素一动，watcher 自动重算。这让"图形移动、连线跟随"零手工维护。
- **撒点 + A\* 的通用路由**：不为每种相对位置写解析分支，而是统一撒候选拐点交给 A\* ——对任意布局稳健，拐点自然最优。
- **四级吸附探测**：锚点→边界点→内部→浮空，由精确到宽松，交互手感自然；视口坐标判距保证"看起来多近就多近"而非受缩放影响。
- **微任务批量重算**：拖动密集连接的图形时性能可控，避免 O(帧×连线数) 的重算风暴。
- **标签作为"线上滑动的局部元素"**：用 `LocalShapeElementModel` 承载标签、`labelOffset.distance` 表达其在线上的归一化位置，拖动即沿线滑动，设计优雅。
- **渲染裁剪挖空标签**：`evenodd` clip 让线不穿过文字，省去手工断线。

## 6. 对外 API 与注意事项

- 主要导出：`ConnectorTool`、`ConnectionOverlay`、`ConnectorPathGenerator`/`PathGenerator`、`getAnchors`/`calculateNearestLocation`/`getNearestConnectableAnchor`、`ConnectorElementRendererExtension`/`ConnectorDomRendererExtension`、`ConnectorElementView`/`ConnectorInteraction`、`ConnectorFilter`、工具栏配置；`./view` 的 `ConnectorViewExtension`、`./store` 的 `ConnectorStoreExtension`。
- **`ConnectorStoreExtension` 必须装**：它注册的 `connectorWatcher` 是路径重算的发动机，不装则线不会跟随元素。
- **`updatePath` 的赋值顺序不可换**：必须先 `xywh` 后 `path`（`connector-manager.ts:1203` 注释明示），否则相对坐标基准错乱。
- **锚点依赖图元的 `getLineIntersections`/`getNearestPoint`**：自定义可连接图元必须正确实现这些方法，否则吸附失效。
- **`position` 是相对坐标**：`Connection.position` 为 `[0..1]` 相对元素，不是绝对坐标（仅当无 `id` 时才是绝对点）——易混淆。
- **曲线/折线/直线切换会重算路径**：`mode` 变即触发 watcher，`path` 会被覆盖，外部不要手动持有旧 `path`。

## 7. 延伸

- 基础设施：`@blocksuite/std` gfx（`BaseTool`/`GfxElementModelView`/`GfxViewInteractionExtension`/`InteractivityExtension`）。
- 画布层：`@blocksuite/affine-block-surface` 提供 `Overlay`、`AStarRunner`（A\* 寻路）、`SurfaceMiddleware`、`EdgelessCRUDIdentifier`、RoughJS 封装。
- 几何库：`@blocksuite/global` 的 `gfx`（`Bound`/`Vec`/`PointLocation`/贝塞尔 `getBezierParameters` 等）。
- 同层 gfx：`@blocksuite/affine-gfx-brush`（画笔）、`shape`/`text`（连接线标签复用 `affine-gfx-text`）。
