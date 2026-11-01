# `@blocksuite/affine-gfx-brush`

> 一句话定位：白板（edgeless）上的**自由画笔**图形层——把用户在画布上拖动的一串指针轨迹，经 `perfect-freehand` 采样/平滑/压感算法转成一条"有粗细变化的实心笔迹多边形"，存成 `BrushElementModel` 并用 canvas `Path2D` 填充绘制；同包还含荧光笔（highlighter）与橡皮擦（eraser）两个相关工具。

| 项        | 值                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/gfx/brush`                                                                                                                                                                                                                          |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                        |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                          |
| 关键依赖  | `@blocksuite/std`（`BaseTool`/`std/gfx`）、`@blocksuite/affine-block-surface`（surface/CRUD/渲染扩展）、`@blocksuite/affine-model`（`BrushElementModel`）、`@blocksuite/global`（`perfect-freehand` 向量几何）、`@blocksuite/affine-ext-loader`、`lit` |
| 被谁依赖  | edgeless 编辑器预设（通过 `BrushViewExtension` 注册进 `BlockStdScope`）                                                                                                                                                                                |
| 对外入口  | `.`（工具/渲染/工具栏配置）、`./store`（adapter 扩展）、`./view`（`BrushViewExtension`）                                                                                                                                                               |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置：它是"画布原生图元"，不是"块"

L2 的 `@blocksuite/std` 已经把编辑器做成"一套运行时，两种布局"：文档流用 `BlockModel` 树 + `BlockComponent`，白板则换成 **画布图元 + 分层（`LayerManager`）**。gfx 包就是在这条白板支线上，为**某一类具体图元**补齐"数据模型 + 工具 + 渲染 + 交互 + 注册"五件套。

与"块范式"（如 `affine-block-paragraph`：`FlavourExtension` + `BlockSchema` + `BlockViewExtension` 渲染成 Lit 组件）相比，画笔走的是另一条链路：

| 维度     | 块范式（block-\*）           | gfx 画布图元范式（本包）                              |
| -------- | ---------------------------- | ----------------------------------------------------- |
| 数据模型 | `BlockModel`（Yjs 块树节点） | `GfxPrimitiveElementModel` 子类（注册进 `surface`）   |
| 渲染     | Lit 组件 → DOM               | canvas 2D `ctx.fill(Path2D)`（也有 DOM fallback）     |
| 创建交互 | 命令 / 回车分裂              | `BaseTool.dragStart/dragMove/dragEnd` 跟手绘制        |
| 注册     | `BlockViewExtension`         | `context.register(Tool)` + `ElementRendererExtension` |

画笔是**纯画布原生图元**（canvas element，`type === 'brush'`），它不进入块树、不渲染 DOM 组件，而是被 `SurfaceBlockComponent` 统一画在一张 canvas 上。所以本包的核心不是"写个 Lit 组件"，而是**三件事**：① 工具层把指针轨迹采集成点序列；② 模型层把点序列转成可填充的 SVG 路径；③ 渲染层把路径 `fill` 到 canvas。

### 1.2 独有难点：为什么"画一条线"这么复杂

朴素做法——把采样点用 `lineTo` 连起来再 `stroke`——会得到三个糟糕结果：**抖动明显**（指针采样有噪声）、**粗细死板**（画笔应有压感/速度带来的粗细变化）、**转角生硬**（尖角处会"穿模"）。本包的全部复杂度都在解决这三点，核心算法 `perfect-freehand`（移植自开源同名库，落在 `@blocksuite/global` 的 `gfx/perfect-freehand/`）把一串 `[x,y,pressure?]` 输入点转成**一圈描边轮廓多边形**——于是"一条线"变成"一块实心形状"，再用 `fill` 而非 `stroke` 绘制。这是整篇文档的主线。

## 2. 目录与关键文件

```text
brush/src/
├── index.ts                 # 导出：工具 / 渲染扩展 / 工具栏配置
├── view.ts                  # BrushViewExtension：注册 3 个工具 + 4 个渲染扩展 + 工具栏
├── store.ts                 # BrushStoreExtension：注册 markdown / plain-text adapter
├── effects.ts               # 注册自定义元素（工具栏 Lit 组件）的 side-effect 入口
├── brush-tool.ts            # BrushTool：画笔工具，核心是 dragStart/dragMove/dragEnd 采点
├── highlighter-tool.ts      # HighlighterTool：荧光笔，与 BrushTool 几乎同构（半透明叠加）
├── eraser-tool.ts           # EraserTool：橡皮擦，命中相交检测 + overlay 轨迹反馈
├── renderer/
│   ├── element/
│   │   ├── brush.ts         # canvas 渲染：ctx.fill(new Path2D(model.commands))
│   │   └── highlighter.ts   # 荧光笔 canvas 渲染（含混合模式/透明度）
│   └── dom/
│       ├── shared.ts        # renderBrushLikeDom：SVG <path> 复用式 DOM 渲染
│       ├── brush.ts         # BrushDomRendererExtension
│       └── highlighter.ts   # HighlighterDomRendererExtension
├── toolbar/                 # edgeless 工具栏里的"笔 / 荧光笔 / 橡皮擦"按钮与菜单
└── adapter/                 # 导出为 markdown / 纯文本时的降级表示（"Brush Stroke"）

# 注意：BrushElementModel 本身不在本包，而在 @blocksuite/affine-model：
#   affine/model/src/elements/brush/brush.ts   —— 数据模型 + commands 派生
# 算法在 @blocksuite/global：
#   framework/global/src/gfx/perfect-freehand/  —— getStroke / getStrokePoints / ...
```

一个关键认知：**模型和算法都不在本包**。本包是"工具 + 渲染 + 注册"的组装层，真正的几何在 `affine-model`（模型）与 `global`（算法）。这正是 gfx 范式的分工——模型下沉到共享 model 包（供复制粘贴、序列化、selection 等跨包复用），算法下沉到 global（无依赖纯函数）。

## 3. 实现细节

### 3.1 工具层：`BrushTool` 如何跟手采点

`BrushTool`（`brush-tool.ts:11`）继承 `BaseTool`（`@blocksuite/std/gfx`），实现指针三段式回调。`dragStart`（`brush-tool.ts:143`）在按下时立刻创建一个只有一个点的 `BrushElementModel`：

```ts
const [modelX, modelY] = viewport.toModelCoord(e.point.x, e.point.y); // 视口坐标→模型坐标
const points = [[modelX, modelY]];
const id = this.gfx.surface.addElement({
  type: CanvasElementType.BRUSH,
  points,
});
const element = this.gfx.getElementById(id) as BrushElementModel;
element.stash('points'); // 关键：把 points/xywh 转入"本地暂存"，绘制期间不写 Yjs
element.stash('xywh');
```

`dragMove`（`brush-tool.ts:91`）每次指针移动都把新点 push 进 `_draggingPathPoints`，再 `gfx.updateElement(el, { points })` 触发重绘。这里有三个独有设计：

1. **Shift 直线约束**（`brush-tool.ts:102-115`）：按住 Shift 时，用首段位移的 `atan2` 角度判定是画水平还是垂直线（`_getStraightLineType`，`brush-tool.ts:32`：`|angle| < π/4 || > 3π/4` 判为水平），随后锁定另一轴坐标，实现"画笔也能画直线"。
2. **压感采集**（`_tryGetPressurePoints`，`brush-tool.ts:45`）：并不信任 `e.raw.pointerType === 'pen'`（注释明说"有些数字笔报 pen 却无压感"），而是**观察 `e.pressure` 是否发生过变化**——一旦某个 `pointerId` 的压力值出现过非恒定，就把它加入 `_pressureSupportedPointerIds`，之后该设备的点才带第三维压力 `[x,y,pressure]`。这是"行为探测优于类型声明"的务实判断。
3. **`stash`/`pop` 分段提交（撤销粒度控制）**（`brush-tool.ts:128-140`）：每累积 `BRUSH_POP_GAP = 20`（`brush-tool.ts:12`）个点，就 `pop` 掉暂存、再重新 `stash` 一次。`stash` 让属性改动停留在本地（`_local`），不进 Yjs 事务也就不进撤销栈；定期 `pop` 把这一段"落定"。这样一条长笔迹不会在撤销栈里产生成百上千条记录，又不会整条不可撤销——是"绘制流畅"与"撤销合理"的折中。

`dragEnd`（`brush-tool.ts:74`）最终 `pop('points')`/`pop('xywh')` 把笔迹正式提交，`doc.captureSync()` 落一个撤销点。另有 `click`（`brush-tool.ts:173`）处理"点一下画一个点"，直接走 `EdgelessCRUDIdentifier.addElement`。

### 3.2 模型层：`points` → `commands`（SVG 路径）的派生

`BrushElementModel`（`affine/model/src/elements/brush/brush.ts:40`）存三个核心可序列化字段：`points`（`[x,y,pressure?][]`，相对坐标）、`color`、`lineWidth`。它的灵魂是 **`commands` getter**（`brush.ts:44`），把点序列转成 SVG path 字符串并缓存：

```ts
get commands() {
  if (!this._local.has('commands')) {
    const stroke = getSolidStrokePoints(this.points ?? [], this.lineWidth);
    const commands = getSvgPathFromStroke(stroke);
    this._local.set('commands', commands);      // 缓存到 _local，避免每帧重算
  }
  return this._local.get('commands') as string;
}
```

缓存失效由 `@watch` 装饰器驱动：当 `points` 或 `lineWidth` 变化时，`instance['_local'].delete('commands')`（`brush.ts:129-131`、`163-165`），下次读 `commands` 重算。这是典型的"派生值 + 脏标记"模式。

`points` 字段还挂了 `@convert` 与 `@derive`（`brush.ts:166-188`）：

- `@convert`：写入时把绝对坐标**归一化为相对包围盒左上角的相对坐标**，并据点集算出 `xywh`（含 `lineWidth` 膨胀，`inflateBound`）。于是模型内 `points` 恒为相对坐标，移动元素只改 `xywh` 不动 `points`。
- `@derive`：`points` 变 → 重算 `xywh`；`xywh` 变（缩放）→ 用 `transformPointsToNewBound` 等比映射 `points`（`brush.ts:193-214`）。这保证"拉伸笔迹包围盒，笔迹随之缩放"。

### 3.3 核心算法：`perfect-freehand` 三步把线变成实心形状

`getSolidStrokePoints`（`global/.../get-solid-stroke-points.ts`）是入口，它用一组固定参数调 `getStroke`：

```ts
getStroke(points, {
  size: lineWidth,
  thinning: 0.6,
  streamline: 0.5,
  smoothing: 0.5,
  easing: t => Math.sin((t * Math.PI) / 2),
  simulatePressure: points[0]?.length === 2, // 没有压感维度就"按速度模拟压感"
});
```

`getStroke`（`get-stroke.ts:21`）= `getStrokeOutlinePoints(getStrokePoints(...))`，两步：

**第一步 `getStrokePoints`（平滑/采样，`get-stroke-points.ts:19`）**：把原始点流式平滑成"均匀、带向量/距离信息"的 `StrokePoint[]`。核心是**流线插值**：`t = 0.15 + (1 - streamline) * 0.85`（`:29`），每个新点不是原始点，而是 `lrp(prev.point, 当前原始点, t)`——即朝原始点插值一部分，`streamline` 越大、`t` 越小、越平滑（滞后越多）。它还做：

- 单点/双点的补点（`:41-56`，避免 taper 时出现断线）；
- **起笔去噪**：`runningLength < size` 之前的点全部丢弃（`:105-109`，"画线开头总是慢的，先攒够一段距离再记录"）；
- 每个点记录 `vector`（指向上一点的单位向量）、`distance`、`runningLength`，供下一步算轮廓与压感。

**第二步 `getStrokeOutlinePoints`（生成轮廓，`get-stroke-outline-points.ts:40`）**：这是把"中线"变"两条边"的核心。对每个 `StrokePoint`：

1. **算半径**：`getStrokeRadius(size, thinning, pressure, easing)` = `size * easing(0.5 - thinning*(0.5 - pressure))`（`get-stroke-radius.ts:15`）。压力越大半径越大；`thinning=0.6` 决定压感对粗细的影响强度。
2. **模拟压感**（无真实压力时，`:161-171`）：用"点间距 / size"估速度 `sp`，速度越快压力越小（笔快则细），以 `RATE_OF_PRESSURE_CHANGE = 0.275` 平滑变化——这就是鼠标也能画出粗细变化的原因。
3. **投影出左右点**：`offset = per(lrp(nextVector, vector, nextDpr)) * radius`（`:264`，`per` 是垂直向量），在中线两侧各投一个点 `tl = point - offset`、`tr = point + offset`，距离小于 `minDistance = (size*smoothing)²` 的点被抽稀（`:268-278`，这就是 `smoothing` 的作用）。
4. **尖角处理**（`:217-242`）：当相邻向量点积 `dpr < 0`（转角超过直角），绕当前点旋转 `FIXED_PI`（`PI + 0.0001`，`:24` 注释说浏览器描边对正 PI 有偏差）画一段圆弧帽，避免尖角穿模。
5. **起止端帽**（`:300-389`）：按 `cap`/`taper` 配置画圆头、平头或锥形收尾。

最终返回 `leftPts.concat(endCap, rightPts.reverse(), startCap)`（`:397`）——**从左侧出发、绕过末端帽、沿右侧返回、再补起点帽**的闭合多边形点序列。再由 `getSvgPathFromStroke`（`global/.../svg-path.ts` 同族工具）转成 `M.../Q.../Z` 的 SVG path 字符串。

### 3.4 渲染层：canvas 主通道与 DOM 备用通道

**canvas 渲染**（`renderer/element/brush.ts:7`）极简——因为复杂度都在 `commands` 里：

```ts
export const brush: ElementRenderer<BrushElementModel> = (
  model,
  ctx,
  matrix,
  renderer
) => {
  const [, , w, h] = model.deserializedXYWH;
  const cx = w / 2,
    cy = h / 2;
  ctx.setTransform(
    matrix.translateSelf(cx, cy).rotateSelf(rotate).translateSelf(-cx, -cy)
  ); // 绕中心旋转
  const color = renderer.getColorValue(model.color, DefaultTheme.black, true);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(model.commands)); // 一次 fill 完成，无 stroke
};
export const BrushElementRendererExtension = ElementRendererExtension(
  'brush',
  brush
);
```

注意**用 `fill` 而非 `stroke`**：因为 `commands` 已经是"描边轮廓多边形"，笔迹本身是一个实心形状。旋转通过 `DOMMatrix` 的 `translate→rotate→translate` 复合实现（绕包围盒中心转）。

**DOM 渲染**（`renderer/dom/shared.ts:48`）是为非 canvas 渲染模式（如 turbo/DOM 渲染器）准备的备用通道：创建一个 `<svg><path>`，把同一份 `model.commands` 塞进 `path.d`，并用 `WeakMap`（`retainedBrushDom`，`:16`）**复用 DOM 节点**——每次重绘只改属性不重建元素，避免 GC 抖动。SVG 尺寸按 `w*zoom`、`viewBox="0 0 w h"` 做缩放，旋转用 CSS `transform: rotate(...)`。

### 3.5 荧光笔与橡皮擦

- **`HighlighterTool`**（`highlighter-tool.ts:8`）与 `BrushTool` 几乎逐行同构（同样的采点、Shift 直线、压感、stash/pop），差别在 `type` 为 `CanvasElementType.HIGHLIGHTER`，对应 `HighlighterElementModel`，渲染时叠加半透明/混合模式，表现为"荧光高亮"。这种"复制一份改类型"的做法虽有重复，但让两种笔的交互参数可独立演化。
- **`EraserTool`**（`eraser-tool.ts:28`）逻辑完全不同：它不创建图元，而是**检测橡皮轨迹与现有图元的相交**。`dragStart` 收集所有可擦对象（`gfx.layer.canvasElements` + `gfx.layer.blocks`，`:150-153`）；`dragMove` 对每个对象用 `linePolygonIntersects`（块）或 `getLineIntersections`（canvas 图元，如笔迹用 3.2 的线段求交）判断本次移动线段是否穿过它，命中则把它加入 `_eraseTargets` 并置 `opacity = 0.3` 作预览（`:113-138`）；`dragEnd` 才真正 `deleteElements`。同时用一个 `EraserOverlay`（`:17`，继承 surface 的 `Overlay`）+ `requestAnimationFrame` 循环（`_loop`，`:41`）绘制一条**会随时间衰减变短的半透明橡皮轨迹**（`:52-56` 每 32ms 削掉头部 10%），给出"橡皮擦划过"的视觉反馈。

### 3.6 注册与导出：`BrushViewExtension`

`view.ts:22` 的 `BrushViewExtension extends ViewExtensionProvider` 是本包装进编辑器的唯一入口。`setup` 里一次性 `context.register`：三个工具（`BrushTool`/`EraserTool`/`HighlighterTool`）、四个渲染扩展（brush/highlighter 各一份 element + dom）、两个工具栏配置、一个 `penSeniorTool`（`view.ts:33-45`）。`effect()` 调 `effects()` 注册工具栏用到的自定义 Lit 元素。`store.ts` 的 `BrushStoreExtension` 则在数据侧注册 adapter——导出为 markdown/纯文本时笔迹降级成 `"Brush Stroke"` 文本（`adapter/markdown/index.ts:6`），因为笔迹无法用文本表达。

## 4. 语法特色

- **ElementModel 属性装饰器组合**（`affine-model` 的 brush.ts）：`@field()` 声明可序列化到 Yjs 的字段；`@local()`（此处用 `_local` Map）存派生缓存；`@derive((v, instance) => ({...}))` 声明"本字段变化时联动更新其它字段"；`@convert` 在写入前归一化；`@watch` 在变化时执行副作用（清缓存）。多个装饰器**叠加**在同一个 `accessor` 上（如 `points` 同时有 `@watch`+`@derive`+`@convert`+`@field`，`brush.ts:163-188`），执行顺序自下而上，是声明式响应模型的精髓。
- **`accessor` 字段 + 装饰器**：`@field() accessor color: Color = DefaultTheme.black`——TS 2022 标准装饰器作用于 `accessor`，装饰器接管 getter/setter，把"读写"接到 Yjs 与派生系统。
- **纯函数几何库 + 类型别名**：`perfect-freehand` 全是无副作用函数，向量用 `IVec = [number, number]` / `IVec3 = [number, number, number]` 元组类型，配 `add/sub/mul/per/prj/lrp/rotAround/uni` 一组短名工具函数（`vec.js`），可读性靠注释与数学语义撑起。
- **`ElementRenderer<T>` 回调签名**：`(model, ctx, matrix, renderer) => void`，用 `DOMMatrix` 链式方法 `translateSelf/rotateSelf` 构造变换——`*Self` 原地修改并返回自身，便于链式。
- **`WeakMap<HTMLElement, RetainedBrushDom>`** 做 DOM 复用缓存：键是宿主元素，宿主被 GC 时缓存自动释放，无需手动清理。
- **行为探测代替类型判断**：压感检测不读 `pointerType` 而观察 `pressure` 是否变化（`brush-tool.ts:52-61`），是对"不可靠平台 API"的防御式编程。

## 5. 设计 / 实现亮点

- **"线 → 实心多边形 + fill"**：不走传统 `stroke`，而把粗细/压感/端帽统统编码进一圈轮廓点再 `fill`，让粗细连续变化、尖角不穿模、端点可锥形收尾——这是手绘质感的根本来源。
- **派生值缓存 + 脏标记**：`commands` getter 惰性计算并缓存，`@watch` 精确失效。重绘每帧读 `commands` 几乎零成本，只有点/线宽真正变了才重算。
- **`stash`/`pop` 控制撤销粒度**：绘制过程在 `_local` 暂存不污染 Yjs，每 20 点落定一段。既保证跟手流畅（不每点一次事务），又让长笔迹的撤销栈不爆炸。
- **模拟压感**：无硬件压力时按指针速度推算粗细（快则细、慢则粗），让鼠标也能画出有生命力的线条，且与真实压感走同一套半径公式。
- **三层解耦**：算法（global 纯函数）／模型（affine-model 可序列化 + 派生）／工具与渲染（本包）各司其职，算法可被测试、模型可被复制粘贴/协同复用、渲染可切 canvas 或 DOM。

## 6. 对外 API 与注意事项

- 主要导出：`BrushTool`/`EraserTool`/`HighlighterTool`、`BrushElementRendererExtension`/`BrushDomRendererExtension`（及 highlighter 对应项）、工具栏配置 `brushToolbarExtension`/`highlighterToolbarExtension`/`penSeniorTool`；`./view` 的 `BrushViewExtension`、`./store` 的 `BrushStoreExtension`。
- **模型不在本包**：`BrushElementModel`/`HighlighterElementModel` 从 `@blocksuite/affine-model` 导入；要改笔迹几何逻辑去 model 包，要改算法去 `@blocksuite/global` 的 `perfect-freehand`。
- **`points` 是相对坐标**：模型内 `points` 已归一化为相对包围盒原点，渲染/命中前别忘了加 `[x,y]` 偏移（见 `getLineIntersections`，`brush.ts:68`）。
- **压感首帧不可靠**：某设备首次绘制可能因 `pressure` 尚未变化而被判为"无压感"，这是探测机制的固有延迟，属预期行为。
- **adapter 是有损的**：导出 markdown/txt 时笔迹只剩 `"Brush Stroke"` 占位，笔迹数据不随文本格式往返。
- **`effects()` 需执行一次**：工具栏 Lit 组件依赖 `effect()` 注册自定义元素，`ViewExtensionProvider` 已在 `effect()` 中调用。

## 7. 延伸

- 基础设施：`@blocksuite/std` 第 3.8 节 gfx（`BaseTool`/`Viewport`/`LayerManager`/`GfxPrimitiveElementModel`）是本包的地基。
- 同层 gfx：`@blocksuite/affine-gfx-connector`（连接线，另一类 canvas 图元，几何更复杂）、`shape`/`text`/`mindmap` 等。
- 画布层：`@blocksuite/affine-block-surface` 提供 `SurfaceBlockComponent`、`ElementRendererExtension`、`EdgelessCRUDIdentifier`、`Overlay`。
- 算法出处：`@blocksuite/global` 的 `gfx/perfect-freehand/`（移植自同名开源库），以及 `svg-path.ts` 的 `SVGPathBuilder`。
