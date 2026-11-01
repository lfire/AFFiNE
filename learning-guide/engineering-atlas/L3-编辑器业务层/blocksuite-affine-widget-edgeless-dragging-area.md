# `@blocksuite/affine-widget-edgeless-dragging-area`

> 一句话定位：白板上**框选时那个半透明蓝色矩形**（marquee）的渲染 widget——用户在空白处按住拖动时，它把 `DefaultTool` 记录的框选区域画成一个带边框的浮层矩形。它本身**只负责"画框"**，框住了哪些元素、怎么选中，由 `DefaultTool` 完成——这是一个极致单一职责的 widget。

| 项        | 值                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/edgeless-dragging-area`                                                                                                                                                                                           |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                           |
| 语言/形态 | TypeScript / Lit widget 包（核心仅 68 行）                                                                                                                                                                                                   |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`）、`@blocksuite/std/gfx`（`GfxControllerIdentifier`/`tool`）、`@blocksuite/affine-block-surface`（`DefaultTool`/`DefaultModeDragType`）、`@toeverything/theme`（CSS 变量）、`lit` |
| 被谁依赖  | 编辑器预设（通过 `EdgelessDraggingAreaViewExtension` 注册，仅白板 scope）                                                                                                                                                                    |
| 对外入口  | `.`、`./view`                                                                                                                                                                                                                                |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

标准白板 widget：`EdgelessDraggingAreaRectWidget extends WidgetComponent<RootBlockModel>`（`src/edgeless-dragging-area-rect.ts:15`），Shadow DOM 承载 `.affine-edgeless-dragging-area` 样式；`edgelessDraggingAreaWidget = WidgetViewExtension('affine:page', …)`（`:64`）注册到 root；`EdgelessDraggingAreaViewExtension`（`src/view.ts`）仅在 `this.isEdgeless(context.scope)` 时注册。它监听的 host 状态是 `gfx.tool`（当前工具 + 框选区域）。

### 独有的问题：职责边界的典范切分

"框选"这件事可以拆成两半：

1. **状态与判定**（**不在本包**）：框选区域的几何（起点、终点、宽高）、框住了哪些图元、如何更新选区——全部由白板的 `DefaultTool`（`affine/blocks/surface/src/tool/default-tool.ts`）与 `ToolController` 维护，存在 signal `gfx.tool.draggingArea$`（模型坐标）/`draggingViewportArea$`（视口坐标）里。
2. **渲染**（**本包**）：把那个矩形画出来。widget 只做一件事——读 `draggingViewportArea$`，在满足"当前是 DefaultTool 且处于 Selecting 拖拽"时，用一个绝对定位 div 画出半透明蓝框。

这种切分是 BlockSuite widget 设计的样板：**交互状态放在 gfx 工具/控制器里（可被命令、快捷键、测试直接驱动），纯视觉呈现放在 widget 里（随 signal 自动重渲）**。于是框选逻辑可无 UI 地单测，widget 可被替换皮肤而不碰逻辑。

## 2. 目录与关键文件

```text
src/
├── edgeless-dragging-area-rect.ts  # ★EdgelessDraggingAreaRectWidget：读 signal、条件渲染矩形
├── index.ts                        # re-export
├── view.ts                         # EdgelessDraggingAreaViewExtension：仅 edgeless scope
└── effects.ts                      # customElements.define('edgeless-dragging-area-rect', …)
```

## 3. 实现细节

### 3.1 widget：一个 `render` 搞定

整个 widget 的核心就是 `render()`（`edgeless-dragging-area-rect.ts:38`）：

```ts
override render() {
  const rect = this.gfx.tool.draggingViewportArea$.value;  // 视口坐标的框选矩形
  const tool = this.gfx.tool.currentTool$.value;

  if (
    rect.w === 0 || rect.h === 0 ||
    !tool || !(tool instanceof DefaultTool) ||
    tool.dragType !== DefaultModeDragType.Selecting
  )
    return nothing;                                         // 不该画就不画

  const style = { left: rect.x+'px', top: rect.y+'px', width: rect.w+'px', height: rect.h+'px' };
  return html`<div class="affine-edgeless-dragging-area" style=${styleMap(style)}></div>`;
}
```

三个关键点：

- **读 `draggingViewportArea$`（视口坐标）而非 `draggingArea$`（模型坐标）**：`draggingViewportArea$` 是 `ToolController` 里的 `computed`（`std/src/gfx/tool/tool-controller.ts:106`），它把模型坐标的框（`draggingArea$`）经 `viewport.toViewCoord(start)`/`toViewCoord(end)` 换算成屏幕像素。widget 直接拿屏幕坐标画，无需自己做坐标变换——缩放/平移时 computed 自动重算，矩形跟着视口走。
- **三重渲染门禁**：宽或高为 0（未真正拖动）、当前工具不是 `DefaultTool`（在画笔/连线等工具下框选语义不同）、或 `dragType !== Selecting`（可能是在移动内容 `ContentMoving` 或原生编辑 `NativeEditing`）——任一不满足就 `nothing`。确保矩形只在"默认工具 + 正在框选"时出现。
- **signal 驱动重渲**：`.value` 读取建立依赖，拖动中 `draggingArea$` 每帧变化 → `draggingViewportArea$` 重算 → `SignalWatcher` 触发 `render`，矩形实时跟手。

### 3.2 样式：主题化的 marquee

`static styles`（`:16`）用 `@toeverything/theme` 的 CSS 变量定义外观：

```ts
background: ${unsafeCSS(cssVarV2('edgeless/selection/selectionMarqueeBackground', '#1E96EB14'))};
border-color: ${unsafeCSS(cssVarV2('edgeless/selection/selectionMarqueeBorder', '#1E96EB'))};
/* position:absolute; z-index:1; pointer-events:none; */
```

`pointer-events: none` 是关键——框选矩形覆盖在画布上，但不能拦截鼠标事件（否则会干扰 `DefaultTool` 继续接收 pointerMove），所以让它对指针完全透明。`cssVarV2(token, fallback)` 第二参数是回退色，保证主题变量缺失时仍有默认蓝。

### 3.3 配套：`DefaultTool` 如何喂数据（上游，非本包）

为讲透框选，简述上游：`DefaultTool._determineDragType`（`default-tool.ts:154`）在按下时判断——若点在已选矩形内 → `ContentMoving`/`NativeEditing`；若点中某元素 → `ContentMoving`；否则 → **`Selecting`**。进入 `Selecting` 后，`ToolController` 的 dragMove 把 `draggingArea$` 更新为 `{ x:min(startX,modelX), w:abs(modelX-startX), … }`（`tool-controller.ts:435`，以起点为锚、支持任意方向拖出）。`DefaultTool._updateSelection`（`:76`）调 `interactivity.handleBoxSelection({ box: draggingArea$ })` 算出框内元素并 `selection.set(...)`。拖动中若视口变化（如边缘自动滚动 `_enableEdgeScrolling`），还会重新 `_updateSelection`。拖动结束 `draggingArea$` 归零，widget 的 `rect.w===0` 条件即令矩形消失。

**本 widget 对上述一无所知**，只被动渲染 `draggingViewportArea$`——这正是职责切分的价值。

## 4. 语法特色

- **`WidgetComponent<RootBlockModel>` + 纯渲染**：没有 `connectedCallback`/事件订阅，全靠继承自基类的 `SignalWatcher` 能力，读 signal 即自动订阅重渲——最精简的 widget 形态。
- **`computed` 跨包消费**：widget 读的 `draggingViewportArea$` 是定义在 std/gfx `ToolController` 里的 `computed`，本包只消费不定义——`@preact/signals-core` 的 computed 让"模型坐标 → 视口坐标"的派生逻辑集中在上游，下游零成本复用。
- **`instanceof DefaultTool` 运行时类型守卫 + 枚举比较**：`tool instanceof DefaultTool && tool.dragType === DefaultModeDragType.Selecting`——用类实例判定 + 字符串枚举（`DefaultModeDragType.Selecting='selecting'`）精确限定渲染条件。
- **`unsafeCSS` + `cssVarV2`**：`css` 模板里插入主题 token 需用 `unsafeCSS` 包裹（Lit 要求静态 css 片段），`cssVarV2(token, fallback)` 生成 `var(--…, fallback)`。
- **`styleMap` 直出定位**：矩形的 left/top/width/height 由运行时 rect 决定，用 `styleMap` 内联——浮层 widget 的通用定位手法。
- **`pointer-events: none`**：CSS 层面保证覆盖层不拦截事件，是"渲染层与交互层分离"在样式上的落点。

## 5. 设计 / 实现亮点

- **极致单一职责**：核心 68 行、一个 `render`、零事件订阅。框选的全部智能在 `DefaultTool`，widget 只是 `draggingViewportArea$` 的一个"视图投影"。这种"逻辑在工具、视图在 widget"的切分让两者都简单、可测、可替换。
- **坐标换算下沉到 computed**：widget 不碰 `toViewCoord`，直接读已换算好的视口坐标 signal。视口缩放/平移时 computed 自动重算、widget 自动重渲——响应式把"矩形跟随视口"这件事变成零代码。
- **三重门禁杜绝误绘**：宽高非零 + DefaultTool + Selecting 三条件叠加，精准区分"框选"与"移动内容/编辑/其他工具拖拽"，避免矩形在不该出现时闪现。
- **`pointer-events:none` 的分层意识**：覆盖层必须对指针透明，否则会打断底层工具的拖拽事件流——小细节体现对"浮层 + 持续交互"共存的理解。

## 6. 对外 API 与注意事项

- **主要导出**：`EdgelessDraggingAreaRectWidget`、`EDGELESS_DRAGGING_AREA_WIDGET`（标签名 `edgeless-dragging-area-rect`）、`edgelessDraggingAreaWidget`、`EdgelessDraggingAreaViewExtension`（`./view`）。
- **装配**：仅白板 scope 注册；页面框选是另一个包 `@blocksuite/affine-widget-page-dragging-area` 的事。
- **注意**：
  - widget **不决定选中结果**，只画框；要改"框选命中规则"应改 `DefaultTool`/`interactivity.handleBoxSelection`，不是本包。
  - 矩形只在 `DefaultTool` 的 `Selecting` 拖拽时出现；在画笔、连线、便签等其他工具下即便拖拽也不画此框（各工具有自己的拖拽语义）。
  - 它读 `draggingViewportArea$`（视口像素），改坐标基准需到 `ToolController` 的 computed，不要在 widget 里再做变换。
  - `pointer-events:none` 不可移除，否则会拦截底层工具的 pointerMove 导致框选中断。

## 7. 延伸

- 底层：`@blocksuite/std/gfx`（`ToolController.draggingArea$`/`draggingViewportArea$`/`viewport.toViewCoord`）、`@blocksuite/std`（`WidgetComponent`/`SignalWatcher`）。
- 上游逻辑：`@blocksuite/affine-block-surface` 的 `DefaultTool`/`DefaultModeDragType`（框选判定、`handleBoxSelection`、边缘自动滚动）。
- 对照阅读：`@blocksuite/affine-widget-page-dragging-area`（页面模式的同类框选）、`blocksuite-affine-widget-edgeless-selected-rect.md`（框选完成后的选中框/手柄）、`blocksuite-affine-block-root.md` §3.4（白板视口与坐标）、`toeverything-infra.md`（signal/computed）。
