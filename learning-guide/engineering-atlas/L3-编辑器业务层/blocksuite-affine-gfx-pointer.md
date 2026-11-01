# `@blocksuite/affine-gfx-pointer`

> 一句话定位：白板的**"指针/选择"工具族与对齐吸附系统**——它提供"抓手平移"（`PanTool`）、"空操作占位"（`EmptyTool`）两个基础工具，以及工具栏里切换"选择↔抓手"的按钮；而真正的框选/拖拽默认工具 `DefaultTool` 在 surface 包里。本包最有分量的独有部分是**拖拽/缩放时的智能对齐吸附**（`SnapExtension` + `SnapOverlay`）：移动图元时自动吸附到其它图元的边/中心、并识别"等间距分布"，还带**自适应降频**以保证大场景下不卡。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/pointer`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 关键依赖  | `@blocksuite/std`（`BaseTool`/`InteractivityExtension`/`createRafCoalescer`/`MouseButton`）、`@blocksuite/affine-block-surface`（`DefaultTool`/`Overlay`/`OverlayIdentifier`/`EdgelessLegacySlotIdentifier`）、`@blocksuite/affine-model`（`ConnectorElementModel`/`MindmapElementModel`）、`@blocksuite/global`（`Bound`/`Point`/`almostEqual`）、`@blocksuite/affine-widget-edgeless-toolbar`（`QuickToolExtension`/`QuickToolMixin`）、`@preact/signals-core`、`lit` |
| 被谁依赖  | edgeless 编辑器预设（通过 `PointerViewExtension` 注册）；`affine-gfx-mindmap` 等包把它列为依赖以复用默认交互                                                                                                                                                                                                                                                                                                                                                            |
| 对外入口  | `.`（`PanTool`/`EmptyTool` 等工具）、`./view`（`PointerViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                 |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置：只出"工具"与"交互扩展"，不出图元

gfx 范式的五件套是"模型 + 工具 + element-renderer + 交互扩展 + view 注册"。本包**没有自己的 `ElementModel`、没有 element-renderer**——因为"指针"不是一种画布图元，而是**操作其它图元的手**。它在五件套里只占两格：

- **Tool（工具）**：`PanTool`（抓手平移视口）、`EmptyTool`（什么都不做的占位工具）。
- **交互扩展 / Overlay**：`SnapExtension`（`InteractivityExtension`，介入拖拽/缩放）+ `SnapOverlay`（`Overlay`，画对齐参考线）。

加上一个工具栏按钮（`defaultQuickTool` + `EdgelessDefaultToolButton`）用于在"选择工具"和"抓手工具"间切换。`PointerViewExtension`（`view.ts:12`）负责把这些注册进去，且 `SnapExtension`/`SnapOverlay`/工具栏按钮**仅在 edgeless scope** 注册（`:24`）。

### 1.2 分工：`DefaultTool` 在 surface，本包补齐"手"与"吸附"

容易误解的一点：**框选、拖动内容、进入 note 原生编辑这些"默认选择工具"的逻辑，实现在 `@blocksuite/affine-block-surface` 的 `DefaultTool`**（`surface/.../tool/default-tool.ts:26`，含 `DefaultModeDragType` 的 `ContentMoving`/`NativeEditing`/`Selecting`/`None` 四态）。本包只是**引用**它（工具栏按钮里 `type = [DefaultTool, PanTool]`），并补齐两件 surface 没做的事：

1. **抓手平移**（`PanTool`）——按住中键或切到抓手时拖动画布。
2. **对齐吸附**（`SnapExtension`/`SnapOverlay`）——`DefaultTool` 负责"移动哪些元素"，本包的 `SnapExtension` 挂到移动流程上，负责"移动时吸附到哪"。

这种分工的意义：surface 提供最核心、不可缺的默认交互；pointer 作为可插拔的 gfx 包提供"锦上添花但计算量大"的吸附，edgeless 才装、文档内嵌小画布可不装。

## 2. 目录与关键文件

```text
pointer/src/
├── index.ts                         # 导出 tools
├── view.ts                          # PointerViewExtension：注册 EmptyTool/PanTool（+edgeless 下的默认按钮/Snap）
├── effects.ts                       # 注册自定义元素 edgeless-default-tool-button
├── tools/
│   ├── pan-tool.ts                  # ★PanTool：抓手平移 + 中键临时平移 + rAF 合批
│   ├── empty-tool.ts                # EmptyTool：空操作工具（占位/禁用态）
│   └── index.ts
├── quick-tool/
│   ├── quick-tool.ts                # defaultQuickTool：工具栏项（priority 100）
│   └── default-tool-button.ts       # EdgelessDefaultToolButton：选择↔抓手切换按钮
├── snap/
│   ├── snap-manager.ts              # ★SnapExtension：介入 onDragInitialize/onElementResize
│   ├── snap-overlay.ts              # ★SnapOverlay：对齐算法（边/中心对齐 + 等距分布）+ 参考线渲染
│   └── adaptive-load-controller.ts  # AdaptiveStrideController/CooldownController：自适应降频
└── __tests__/                       # pan-tool / adaptive-load-controller 单测

# 默认选择工具在别处：
#   blocksuite/affine/blocks/surface/src/tool/default-tool.ts —— DefaultTool（框选/拖拽/原生编辑）
```

## 3. 实现细节

### 3.1 `PanTool`：抓手平移与中键临时平移

`PanTool extends BaseTool<PanToolOption>`（`pan-tool.ts:24`）把"拖动=移动视口"实现为 `BaseTool` 的生命周期回调：`dragStart` 记起点、`panning$=true`；`dragMove`（`:57`）算 `delta = lastPoint - 当前点`，除以 `zoom` 换成模型坐标增量，累加到 `_pendingDelta`；`dragEnd` 复位。

性能关键是 **`createRafCoalescer`（rAF 合批）**：`dragMove` 可能每帧触发多次，但不直接改视口，而是 `_deltaFlushCoalescer.schedule()`，在下一帧 `_flushPendingDelta()` 里一次性 `viewport.applyDeltaCenter(dx, dy)`（`:37-45`）——把高频指针事件合并成每帧一次视口更新，避免抖动与过度重绘。

**中键临时平移**（`mounted`，`:79`）很巧：通过 `addHook('pointerDown')` 监听，若按下的是中键（`MouseButton.MIDDLE`）就临时切到 `PanTool`，并在 `document` 上挂 `pointerup` 监听，松开中键时 `restoreToPrevious()` **恢复到之前的工具与选区**。它还特判了两个工具：若原来是 `copilot` 工具则恢复成 `DefaultTool`；若原来是演示工具 `frameNavigator`，恢复时带 `restoredAfterPan: true` 让演示模式不要重置视口（`:110-121`）——细节上照顾了各特殊工具的状态。

### 3.2 `EmptyTool`：一个"什么都不做"的工具

`EmptyTool`（`empty-tool.ts:6`）只有一行 `toolName = 'empty'`。它的价值在于给工具系统一个**显式的空态**：当需要"当前没有任何激活工具/禁用所有画布交互"时切到它，而不是用 `null` 去处处判空——用对象代替空值的经典做法。

### 3.3 对齐吸附的接入：`SnapExtension`

`SnapExtension extends InteractivityExtension`（`snap-manager.ts:14`）不自己处理指针事件，而是**挂到交互系统的两个生命周期钩子**上：

- **`onDragInitialize`**（`:30`）：拖拽开始时，`snapOverlay.setMovingElements(elements, ...)` 记录"正在移动的元素"（这些要从吸附参考里排除），并返回 `onDragStart/onDragMove/clear` 回调。`onDragMove`（`:59`）里把"原始包围盒按 dx/dy 平移"得到 `currentBound`，调 `snapOverlay.align(currentBound)` 求吸附修正量 `alignRst`，**把修正叠加回 `context.dx/dy`**——于是元素被"吸"到对齐位置。
- **`onElementResize`**（`:91`）：缩放时同理调 `snapOverlay.alignResize(currentHandlePos, alignDirection)`，并处理了**旋转元素**的缩放方向换算（`rotate % 90 === 0` 时用旋转矩阵把 handle 方向转到世界系，`:120-137`），再 `context.suggest` 修正后的 `scaleX/scaleY`。

### 3.4 对齐算法核心：`SnapOverlay.align`

`align(bound)`（`snap-overlay.ts:654`）是吸附的心脏，分两步：

**第一步 · 边/中心对齐（intra-graphic align）**：先 `_updateAlignCandidates(bound)`（`:775`）从空间网格 `gfx.grid.search` 里捞出视口附近的候选图元包围盒（排除正在移动的、以及连接线/思维导图这类不参与吸附的，`_isSkippedElement` `:768`）。然后对每个候选 `other` 调 `_calculateClosestDistances`（`:416`）——它一口气算**九种** x 方向与九种 y 方向的对齐距离：中心对中心、左对左、左对右、右对中心…（`xDistances`/`yDistances` 两个九元数组），取绝对值最小且 `≤ threshold`（`ALIGN_THRESHOLD=8` 像素，除以 zoom 换成模型距离）的那个作为吸附候选，并记下所有"并列最近"的对齐位索引用来画参考线。`_updateXAlignPoint`/`_updateYAlignPoint`（`:517`/`:563`）据此设定 `rst.dx/dy` 并生成竖/横参考线端点。

**第二步 · 等距分布对齐（distribute align）**：若边对齐没吸住（`rst.dx===0`），尝试 `_alignDistributeHorizontally`（`:105`）——在水平向"互相交叉"的候选框里两两组合，判断把当前框放到"两框正中""左侧等距""右侧等距"是否在阈值内；吸住后还会**向两侧延伸**找出所有"间距相等"的框（`almostEqual(maxX, 前一个 + spacing)`，`:218`），画出一串带端帽的分布参考线。这就是 Figma/PPT 里"拖动时自动提示等间距"的效果。

### 3.5 自适应降频：大场景不卡的关键

对齐计算在元素极多时很贵（九距离 × N 候选，分布对齐还是 O(N²)）。本包用两个小控制器做**自适应退化**：

- **`AdaptiveStrideController`**（`adaptive-load-controller.ts:1`）：`reportCost(ms)` 若单次对齐超过 `heavyCostMs=5`，就把 `stride`（跳帧步长）+1（上限 `maxStride=3`）；低于 `recoveryCostMs=2` 则逐步恢复。`shouldSkip()` 按 `ticks % stride` 决定本帧是否跳过对齐。即**越卡越少算**，拖拽始终跟手。
- **`AdaptiveCooldownController`**（`:37`）：专门给昂贵的"分布对齐"用——一旦某帧耗时超 `maxCostMs`，就冷却 `cooldownFrames` 帧不再跑分布对齐（`align` 里 `shouldTryDistribute` 还叠加了"候选数 ≤ 160"的硬上限，`:687`）。

这两个控制器是本包在"交互正确性"之外，对"大画布性能"的专门投资。

### 3.6 参考线渲染：`SnapOverlay.render`

`SnapOverlay extends Overlay`（`:44`），`render(ctx)`（`:712`）用 canvas 画两类线：边/中心对齐线用紫色 `#8B5CF6`，等距分布线用品红 `#CC4187` 且两端加短横"端帽"（`bar=10/zoom`）。所有尺寸都除以 `viewport.zoom` 做反缩放，保证线宽/端帽视觉恒定。它通过 `OverlayIdentifier('snap-manager')` 被 `SnapExtension` 用 `getOptional` 取到（`snap-manager.ts:24`）——扩展与 overlay 解耦，用标识符桥接。

### 3.7 工具栏按钮：选择↔抓手的持久化切换

`EdgelessDefaultToolButton`（`default-tool-button.ts:10`，`QuickToolMixin(LitElement)`）的 `type = [DefaultTool, PanTool]`。点击 `_changeTool`（`:24`）在二者间切换并带淡入淡出动画，且把当前选择**记进 `localStorage.defaultTool`**（`:62-72` 用 `@preact/signals-core` 的 `effect` 监听工具变化同步）——下次默认用上次选的，图标也随之显示 `SelectIcon`/`HandIcon`，快捷键 `V`（选择）/`H`（抓手）。

## 4. 语法特色

- **`BaseTool` 生命周期回调**：`PanTool` 覆写 `dragStart/dragMove/dragEnd/mounted/unmounted` 与 getter `allowDragWithRightButton`，工具逻辑即一组钩子——gfx 工具的统一范式。
- **`InteractivityExtension` 的"返回回调对象"模式**：`SnapExtension` 的 `onDragInitialize` 返回 `{ onDragStart, onDragMove, clear }`，用闭包捕获本次拖拽的 `alignBound`/`alignStride`——每次拖拽一套独立状态，干净利落。
- **`context.dx += ...` / `context.suggest(...)`**：交互扩展不直接改模型，而是**修改/建议**变换上下文，由交互系统汇总多个扩展的意见——解耦"吸附决策"与"实际移动"。
- **getter 做惰性计算**：`_calculateClosestDistances` 返回对象里的 `alignPositionIndices` 用 `get` 定义（`:484`），只有真正读取时才遍历求并列索引——按需计算。
- **`createRafCoalescer`**：把高频事件按动画帧合批，是 gfx 交互防抖的标准件（connector watcher 用 microtask，pan 用 rAF，各取所需）。
- **用对象代替空值**：`EmptyTool` 以"空对象工具"表达"无操作态"，避免 null 判断散落各处。
- **自适应算法封装成小类**：`AdaptiveStrideController`/`AdaptiveCooldownController` 把"按耗时动态降频"抽成可单测的纯状态机（有对应 `.unit.spec.ts`）。

## 5. 设计 / 实现亮点

- **吸附=挂钩而非接管**：`SnapExtension` 用 `InteractivityExtension` 钩进既有拖拽/缩放流程，只贡献"修正量"，与 `DefaultTool` 零耦合——可插拔、可单独关闭。
- **九距离穷举对齐**：一次算齐中心/边/角的所有对齐可能，取最近者，覆盖了所有常见对齐意图，逻辑直白且无遗漏。
- **等距分布识别 + 向两侧延伸**：不只吸"两个之间居中"，还沿途找出整条等间距链并画提示，手感比许多工具更强。
- **双重自适应降频**：`stride` 跳帧 + `cooldown` 冷却 + 候选数硬上限，三管齐下让"对齐"在成百上千图元的画布里仍跟手——把"功能"与"性能"同等认真对待。
- **中键临时平移的状态保真**：临时切抓手、松手精确还原工具/选区/演示态，细节体贴。
- **切换态持久化到 localStorage**：默认指针行为记忆用户偏好，跨会话一致。

## 6. 对外 API 与注意事项

- 主要导出：`PanTool`（`PanToolOption`）、`EmptyTool`；`./view` 的 `PointerViewExtension`。`SnapExtension`/`SnapOverlay`/工具栏按钮通过 `PointerViewExtension` 内部注册，不单独作为主入口 API。
- **`DefaultTool` 不在本包**：框选/内容拖拽的默认选择工具在 `@blocksuite/affine-block-surface`，本包只引用。要改框选行为去改 surface。
- **Snap 仅在 edgeless 注册**：`PointerViewExtension` 判断 `isEdgeless(scope)` 才装 `SnapExtension`/`SnapOverlay`/默认按钮——文档内嵌小画布不会有吸附。
- **连接线与思维导图不参与吸附**：`_isSkippedElement` 把 `ConnectorElementModel` 和 `MindmapElementModel` 的子元素排除，别指望它们触发对齐线。
- **大场景吸附会自动降频**：若感觉对齐"偶尔不吸"，可能是 `AdaptiveStride`/`Cooldown` 在限流（候选 >160 时分布对齐直接跳过），属预期行为。
- **`PanTool` 用 rAF 合批**：`dragMove` 不立即移动视口，`dragEnd` 会 `flush` 残余增量——不要假设 move 的每次调用都立刻反映到视口。

## 7. 延伸

- 基础设施：`@blocksuite/std/gfx` 的 `BaseTool`/`InteractivityExtension`/`createRafCoalescer`/`MouseButton`、`gfx.grid`（空间索引）、`gfx.viewport`。
- 画布层：`@blocksuite/affine-block-surface` 的 `DefaultTool`（默认选择工具）、`Overlay`/`OverlayIdentifier`、`EdgelessLegacySlotIdentifier`（演示模式背景）。
- 工具栏：`@blocksuite/affine-widget-edgeless-toolbar` 的 `QuickToolExtension`/`QuickToolMixin`。
- 同层 gfx：吸附排除的 `connector`/`mindmap`；本包的 `PanTool`/`EmptyTool` 被几乎所有 edgeless 工具族作为默认交互基座复用。
