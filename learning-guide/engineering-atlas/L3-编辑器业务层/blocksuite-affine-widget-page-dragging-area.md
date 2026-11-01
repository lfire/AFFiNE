# `@blocksuite/affine-widget-page-dragging-area`

> 一句话定位：页面（文档）模式下，在空白处或便签上**按住拖出一个矩形框**时，负责画出那块半透明选区、并实时把框住的块设为块选区的 widget。它是页面模式的"框选"控件——与白板的 `edgeless-dragging-area`（只画框、选中逻辑在 `DefaultTool`）不同，本包**自己包办了框选矩形的渲染 + 命中算法 + 选区写入 + 自动滚动**。

| 项        | 值                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/widgets/page-dragging-area`                                                                                                                                                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                     |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                             |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`BlockComponent`/`BlockSelection`/`PointerEventState`/`BLOCK_ID_ATTR`）、`@blocksuite/affine-shared`（`ViewportElementProvider`/`autoScroll`/`getScrollContainer`）、`@blocksuite/affine-model`（`RootBlockModel`/`NoteBlockModel`）、`lit` |
| 被谁依赖  | 编辑器预设（通过 `PageDraggingAreaViewExtension` 注册，仅页面 scope）                                                                                                                                                                                                                                  |
| 对外入口  | `.`、`./view`（`PageDraggingAreaViewExtension`）                                                                                                                                                                                                                                                       |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

标准 widget：`AffinePageDraggingAreaWidget extends WidgetComponent<RootBlockModel>`（`index.ts:29`），Shadow DOM 里一个绝对定位的 `.affine-page-dragging-area` div；`pageDraggingAreaWidget = WidgetViewExtension('affine:page', …)`（`index.ts:321`）注册到 root；`PageDraggingAreaViewExtension`（`view.ts`）**白板 scope 直接 return、仅页面 scope 注册**（`view.ts:19-22`）。它监听的 host 事件是 `dragStart`/`dragMove`/`dragEnd`/`pointerMove`（全部 `{ global: true }`），即 UIEventDispatcher 的全局拖拽事件流。

### page-dragging-area 独有的问题 —— 与白板同类 widget 的分工对照

和白板的 `edgeless-dragging-area`（见 `blocksuite-affine-widget-edgeless-dragging-area.md`）形成鲜明对照：那个包**只画框**，框选命中与选区更新全在 `DefaultTool`；本包则**自给自足**——因为页面模式没有 gfx 的 `ToolController`/`DefaultTool` 那套工具框架，框选的全部逻辑只能落在 widget 自己身上。于是本包独有：

- **拖拽状态机**（独有之一）：`dragStart` 时记录起点、初始滚动偏移、容器偏移；`dragMove` 时按帧（rAF）重算矩形；`dragEnd` 复位。还要在 `dragMove`/`pointerMove` 里 `preventDefault` 防止拖拽时触发原生文本选择。
- **滚动补偿的矩形几何**（独有之二）：框选过程中文档可能滚动（含自动滚动），矩形的起点是"按下那一刻的文档坐标"，终点是"当前文档坐标"，两者都要用**初始滚动量**与**当前滚动量**换算到同一坐标系，矩形才不会在滚动时漂移。
- **块命中算法**（独有之三）：`getSelectingBlockPaths` 要从所有候选块里，按"矩形是否完整包住某块的上下沿"决定是"选该块的若干子块"还是"选所有相交块"，并过滤掉"父块已入选"的子块，避免父子重复选中。
- **自动滚动**（独有之四）：拖到视口边缘时调 `autoScroll` 持续滚动，并在滚动事件里用"上一次指针状态"重算矩形——让框选能延伸到视口外的块。

## 2. 目录与关键文件

```text
src/
├── index.ts     # ★AffinePageDraggingAreaWidget：拖拽状态机、矩形几何、选区写入、render；末尾导出 WidgetViewExtension
├── utils.ts     # ★getSelectingBlockPaths 命中算法 + isDragArea 判定 + Rect/BlockInfo 类型
├── view.ts      # PageDraggingAreaViewExtension：仅页面 scope 注册
└── effects.ts   # customElements.define('affine-page-dragging-area-widget', …)
```

## 3. 实现细节

### 3.1 拖拽状态机：四个事件

`connectedCallback`（`index.ts:191`）注册四个全局事件：

- **`dragStart`**（`:194`）：仅左键（`button === 0`）、且 `isDragArea(state)` 为真（起点落在 root 或 note 上，见 3.4）、且视口存在时才启动——置 `_dragging = true`，记录 `_initialScrollOffset`（当前 `scrollLeft/Top`）与 `_initialContainerOffset`（`state.containerOffset`）。返回 `true` 表示"吃掉"该事件。
- **`dragMove`**（`:219`）：`_clearRaf()` 取消上一帧；非拖拽态直接返回；触摸设备暂不支持（`pointerType === 'touch'` 返回，`:229`）；`preventDefault` 阻止原生选择；`requestAnimationFrame(() => _updateDraggingArea(state, true))` 按帧重算矩形（第二参 `true` 表示允许自动滚动）。
- **`dragEnd`**（`:242`）：复位全部状态——`_dragging=false`、`rect=null`（框消失）、清零初始偏移、`_lastPointerState=null`。
- **`pointerMove`**（`:263`）：拖拽中额外 `preventDefault`，进一步压制原生选择。

`firstUpdated`（`:283`）还监听滚动容器的 `scroll`：拖拽中滚动时用 `_lastPointerState`（上次指针状态）重算矩形，但第二参传 `false`（滚动触发的重算不再触发自动滚动，避免递归）。

### 3.2 ★滚动补偿的矩形几何：`_updateDraggingArea`

这是全包几何核心（`:54`）。矩形由"起点"和"当前点"两个角决定，但两点可能发生在不同滚动位置，必须统一坐标系：

```ts
let left = Math.min(
  startX + initScrollX + initConX - viewportLeft, // 起点：起点 x + 按下时滚动量 + 按下时容器偏移
  x + scrollLeft + conX - viewportLeft // 当前：当前 x + 当前滚动量 + 当前容器偏移
);
let right = Math.max(/* 同上取 max */);
// top/bottom 同理用 startY/initScrollY 与 y/scrollTop
```

思路：把两个角都换算成**相对滚动内容**的坐标（各自加上"那一刻的滚动量"），`min/max` 得到无向矩形（支持任意方向拖）。再用 `Math.max(left, conX - viewportLeft)` / `Math.min(right, scrollWidth)` 等把矩形**夹在内容边界内**（`:88-91`），不越过文档范围。算出的 `userRect` 写入 `@state() rect`（触发渲染），并立即调 `_selectBlocksByRect`（加回 `viewportLeft/Top` 换成命中算法所需坐标）。末尾若允许自动滚动且在滚动容器内，调 `autoScroll(scrollContainer, state.raw.y - rect.top)`——返回 falsy（无需滚动）时 `_clearRaf` 停止（`:108-115`）。

### 3.3 ★块命中算法：`getSelectingBlockPaths`

`utils.ts:78` 是选区命中的算法核心。输入是所有候选块（`_allBlocksWithRect`，见 3.5）与用户矩形：

1. **粗筛**：`filterBlockInfos`（`:34`）遍历（候选块已按文档序即纵向位置排列），一旦某块顶部超过矩形底部就 `break`——因为后面的块都在矩形下方，不可能相交。
2. **找"单一父块"**：遍历筛选结果，若某块**既与矩形相交、又在纵向上完整包住矩形的上下沿**（`rectIncludesTopAndBottom`，`:30`），它就是 `singleTargetParentBlock`（`:90-99`）——意味着矩形完全落在这一个块的垂直范围内。
3. **分两种命中**：
   - 有单一父块 → `filterBlockInfosByParent`（`:46`）：在该父块的**子块**里，找第一个"相交且顶部在矩形上沿之上"的（firstIndex）和最后一个"相交且底部在矩形下沿之下"的（lastIndex），`slice(firstIndex, lastIndex+1)` 取这段连续子块（`:61-72`）——即"矩形在某块内部纵向划过，选中被划过的那几个兄弟子块"。
   - 无单一父块 → 退化为"所有与矩形相交的块"（`:110-114`）。
4. **去父留子/去重**：最后遍历命中块，只有当"该块的父块**不在**命中集合里"时才把它的 `blockId` 收入结果（`:119-131`）——避免"既选了父块又选了它的子块"的重复，保证选区是一组互不包含的块。

返回的 `blockPaths`（块 id 列表）由 `_selectBlocksByRect`（`index.ts:178`）逐个 `host.selection.create(BlockSelection, { blockId })`，再 `host.selection.setGroup('note', selections)`（`:188`）一次性写入块选区组。

### 3.4 `isDragArea`：哪里能起框

`isDragArea`（`utils.ts:136`）决定"按下哪里算框选起点"：取 `e.raw.target` 向上 `closest([BLOCK_ID_ATTR])` 找到最近的块组件，仅当它是 `RootBlockModel` 或 `NoteBlockModel` 时返回 `true`——即只能从**页面根的空白区或便签空白区**起框；按在具体内容块上则视为点击/文本选择，不启动框选。

### 3.5 候选块收集：`_allBlocksWithRect`

`_allBlocksWithRect`（`index.ts:118`）用 `host.view.walkThrough` 遍历视图树，收集所有 `BlockComponent`，排除 `role === 'root'` 与 `excludeFlavours`（`affine:note`、`affine:surface`，`:30`）——因为 root 和 note 是容器、不作为可选目标。每块记录其 `getBoundingClientRect` 并**加上当前滚动量**（`:151`）换算成文档坐标，与矩形同系。因块随文档序排列，天然满足命中算法 3.3 中"按纵向有序、可提前 break"的前提。

## 4. 语法特色

- **`handleEvent(name, handler, { global: true })`**：四个拖拽事件都注册为全局（`index.ts:216`/`:239`/`:258`/`:271`）——框选过程中指针可能移出起始块，全局监听才能持续收到事件；返回 `true` 表示消费该事件、阻止冒泡到默认处理。
- **`@state() accessor rect`**：唯一的响应式字段（`:317`），矩形变化即重渲；其余 `_dragging`/`_initialScrollOffset` 等是普通私有字段（非 UI 直接依赖，无需触发渲染）——响应式与非响应式状态的分界清晰。
- **`requestAnimationFrame` + `_clearRaf` 手动合批**：`dragMove` 每次先 `cancelAnimationFrame` 上一帧再排新帧（`:222`/`:233`），保证一帧最多算一次矩形——高频 pointer 事件下的标准降频手法。
- **纯函数命中算法**：`utils.ts` 全部是无副作用纯函数（`rectIntersects`/`rectIncludesTopAndBottom`/`getSelectingBlockPaths`），输入块信息与矩形、输出 id 列表——几何算法与 widget 状态解耦，可独立测试。
- **`matchModels(model, [RootBlockModel, NoteBlockModel])`**：`isDragArea`（`:145`）用模型类数组做运行时类型匹配，判定起框区域。
- **`walkThrough(node => boolean | void)`**：`_allBlocksWithRect`（`:126`）用视图树遍历回调，返回 `true` 跳过子树——收集块的标准遍历 API。
- **computed getter 封装依赖**：`_viewport`（`std.get(ViewportElementProvider).viewport`）、`scrollContainer`（`getScrollContainer(this.block)`）用 getter 惰性取（`:160`/`:164`），每次用时解析、避免缓存失效。

## 5. 设计 / 实现亮点

- **与白板同类 widget 的职责差异**：白板框选把智能放在 `DefaultTool`、widget 只画框；页面模式缺少那层工具框架，于是本包"渲染 + 命中 + 选区 + 滚动"一把抓。对照两个包能清楚看到"有无底层工具框架"如何决定 widget 的厚薄——同样叫 dragging-area，一个 68 行、一个三百余行。
- **滚动不漂移的坐标补偿**：框选起点锁定在"按下时的文档坐标"，之后无论怎么滚动，矩形两角各自用"那一刻的滚动量"换算到统一内容坐标系——这是框选能跨滚动、跨自动滚动稳定延伸的关键。
- **命中算法的"单一父块"分支**：区分"矩形完全落在某块内部纵向划过"（选该块的连续子块）与"跨多块"（选所有相交块），再做去父留子——用几何关系精确表达了"用户框选时期望选中什么"的直觉。
- **自动滚动与重算解耦**：拖到边缘 `autoScroll`，滚动事件再用 `_lastPointerState` 重算矩形，但滚动触发的重算不再触发滚动（第二参 `false`）——避免了"滚动→重算→再滚动"的递归，同时让框选能延伸到视口外。
- **触摸设备优雅降级**：`dragMove` 对 `pointerType === 'touch'` 直接返回（`:229`），并以 TODO 标注——明确边界而非强行支持。

## 6. 对外 API 与注意事项

- **主要导出**：`AffinePageDraggingAreaWidget`、`AFFINE_PAGE_DRAGGING_AREA_WIDGET`（标签名 `affine-page-dragging-area-widget`）、`pageDraggingAreaWidget`、`PageDraggingAreaViewExtension`（`./view`）；`utils.ts` 的 `getSelectingBlockPaths`/`isDragArea`/`Rect`/`BlockInfo`。
- **装配**：通过 `PageDraggingAreaViewExtension` 接入，**仅页面 scope** 注册（`view.ts:19` 白板直接 return）；白板框选是 `@blocksuite/affine-widget-edgeless-dragging-area` 的事。
- **注意**：
  - 只能从 **root/note 的空白区**起框（`isDragArea`，`utils.ts:145`）；按在具体内容块上不启动框选。
  - 候选块排除 `affine:note`/`affine:surface` 与 root（`excludeFlavours`，`:30`）——它们是容器不可被框选。
  - **触摸设备暂不支持**框选（`index.ts:229`，有 TODO）。
  - 命中结果经"去父留子"过滤（`utils.ts:119`），框住父块时不会重复选中其子块；选区写入 `'note'` 组。
  - 矩形几何依赖滚动量补偿，起点在 `dragStart` 锁定——拖拽中切勿假设坐标相对视口固定，它是相对滚动内容的。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`handleEvent`/`BlockSelection`/`PointerEventState`/`host.view.walkThrough`/`host.selection`）。
- 依赖服务：`@blocksuite/affine-shared` 的 `ViewportElementProvider`（滚动视口）、`autoScroll`（边缘自动滚动）、`getScrollContainer`。
- 对照阅读：`blocksuite-affine-widget-edgeless-dragging-area.md`（白板同类框选，职责切分相反——强烈建议对比）、`blocksuite-affine-widget-drag-handle.md`（页面 autoScroll、块命中几何）、`toeverything-infra.md`（响应式基础）。
