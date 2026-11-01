# `@blocksuite/affine-widget-edgeless-selected-rect`

> 一句话定位：白板上**选中元素后围住它的那个蓝色选中框 + 八个缩放/旋转手柄**的浮层 widget——它把选中图元的模型包围盒换算成屏幕矩形并叠一层带 8 个手柄的边框，拖手柄触发缩放、拖手柄外圈触发旋转、多选时画整体包围盒与各子元素描边；它只负责"框与手柄 UI + 光标 + 把拖拽委派给交互层"，真正的几何变换由 std/gfx 的 `InteractivityManager` 执行。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/edgeless-selected-rect`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`）、`@blocksuite/std/gfx`（`GfxController`/`InteractivityIdentifier`/`ResizeHandle`/`CursorType`）、`@blocksuite/affine-block-surface`（`OverlayIdentifier`/`EdgelessLegacySlotIdentifier`）、`@blocksuite/affine-block-frame`（`FrameOverlay`）、`@blocksuite/affine-gfx-connector`/`-shape`/`-text`、`@blocksuite/affine-model`（`ConnectorElementModel`/`ShapeElementModel`…）、`@blocksuite/affine-shared`（`getSelectedRect`/`requestThrottledConnectedFrame`）、`lit`、`yjs` |
| 被谁依赖  | 编辑器预设（通过 `EdgelessSelectedRectViewExtension` 注册，仅白板 scope）                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 对外入口  | `.`、`./view`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

标准白板 widget：`EdgelessSelectedRectWidget extends WidgetComponent<RootBlockModel>`（`src/edgeless-selected-rect.ts:37`），Shadow DOM 承载约 300 行手柄样式；`edgelessSelectedRectWidget = WidgetViewExtension('affine:page', …)`（`src/spec.ts`）注册到 root；`EdgelessSelectedRectViewExtension`（`src/view.ts`）仅 edgeless scope 注册。它监听的 host 状态是 `gfx.selection`（选中变化）与 `gfx.viewport`（视口变换）+ surface 元素增删改。

### 独有的问题：选中态的几何与变换 UI

选中框看似简单，实则要处理一组几何与交互难题：

1. **坐标换算**：图元的位置是**模型坐标**（无限画布的逻辑坐标），选中框是叠在 DOM 上的浮层，需按视口 zoom/平移、再补偿外层 CSS scale（嵌入式白板）换算成屏幕像素。
2. **手柄类型因元素而异**：note 只能拖边（`edge`）、shape 可拖角可拖边（`all`）、connector 不能缩放（`none`）、text 可拖左右边与角（`edgeAndCorner`）、默认只拖角（`corner`）——由 `ResizeMode` 表达。
3. **旋转后的光标**：元素可旋转任意角度，手柄的 resize 光标（↔/↕/⤡）必须跟着旋转角重新映射，否则光标方向与实际拖拽方向不符。
4. **缩放 vs 旋转的交互区分**：每个角手柄内层是 resize 圆点、外层是透明 rotate 区——同一个手柄，点内圈缩放、点外圈旋转。
5. **多选包围盒**：选多个元素时画一个整体框，再给每个子元素描边（各自按自身 rotate 旋转），让用户看清整体与个体。
6. **约束反馈**：缩放到达宽/高下限时画红线、等比缩放时显示百分比与方向角标。

widget 本身**不实现变换数学**——`handleElementResize`/`handleElementRotate`/`getResizeHandlers`/`getRotateConfig` 全在 std/gfx 的 `InteractivityManager`（`InteractivityIdentifier`）里。widget 负责"渲染框与手柄、算光标、把 pointerdown 委派给交互层、用回调驱动 UI 反馈"。这又是"逻辑在交互层、视图在 widget"的切分。

## 2. 目录与关键文件

```text
src/
├── edgeless-selected-rect.ts   # ★EdgelessSelectedRectWidget：框 + 手柄 + 光标 + 坐标换算 + 委派（849 行）
├── resize-handles.ts           # ★手柄渲染：HandleDirection / ResizeMode / RenderResizeHandles
├── utils.ts                    # ★光标几何（generateCursorUrl/getRotatedResizeCursor）+ 自动补全辅助
├── edgeless-auto-complete.ts   # 选中框旁的“自动补全箭头”（拖出生成相连 shape/note）
├── auto-complete-panel.ts      # 自动补全目标选择面板
├── spec.ts                     # WidgetViewExtension 片段
├── view.ts / effects.ts / index.ts
```

## 3. 实现细节

### 3.1 ★选中框几何：模型坐标 → 屏幕像素 + CSS scale 补偿

`_updateSelectedRect`（`edgeless-selected-rect.ts:472`）是核心坐标换算，用 `requestThrottledConnectedFrame` 节流到每帧一次：

```ts
const rect = getSelectedRect(elements); // 选中元素的模型包围盒
const { viewportX, viewportY, viewScale } = gfx.viewport;
const left = ((rect.left - viewportX) * zoom) / viewScale; // 模型 → 屏幕，并补偿外层 CSS 缩放
const top = ((rect.top - viewportY) * zoom) / viewScale;
const width = (rect.width * zoom) / viewScale;
const height = (rect.height * zoom) / viewScale;
let rotate = 0;
if (elements.length === 1 && elements[0].rotate) rotate = elements[0].rotate; // 单选才旋转整框
```

关键点：`/ viewScale` 补偿外层 CSS scale（如 embed-edgeless-synced-doc 把整个白板按 CSS 缩放嵌入别处），注释明言"matching `GfxBlockComponent.getCSSTransform`"——浮层要与被 CSS 变换的画布像素级对齐。**只有单选才给整框加 rotate**，多选框不旋转（各子元素各自旋转，见 §3.5）。结果存进 `@state _selectedRect`，render 时写成 `transform: translate(left,top) rotate(rotate)`。

框本身 `pointer-events:none`（`:58`），不拦事件；手柄 `.handle` 单独 `pointer-events:auto` + `touch-action:none`（`:75`，注释解释防止触屏手势中途被祖先滚动容器截断）。

### 3.2 ★手柄渲染与 ResizeMode

`resize-handles.ts` 定义 8 个方向 `HandleDirection`（4 角 + 4 边）与 5 种 `ResizeMode`（`:75`，注释说明每种对应什么元素：`edge`=note、`all`=shape、`none`=connector、`corner`=默认、`edgeAndCorner`=text）。`RenderResizeHandles`（`:77`）用 `repeat` 把每个 `ResizeHandle` 渲成一个 `.handle`，内含两层：

```ts
// 角手柄（handle.length > 6 且 rotatable）才渲 rotate 外圈
const rotationTpl =
  handle.length > 6 && rotatable
    ? html`<div
        class="rotate"
        style=${styleMap({ cursor: getCursor({ type: 'rotate', handle }) })}
      ></div>`
    : nothing;
return html`<div
  class="handle"
  aria-label=${handle}
  @pointerdown=${handlerPointerDown}
>
  ${rotationTpl}
  <div
    class="resize transparent-handle"
    style=${styleMap({ cursor: getCursor({ type: 'resize', handle }) })}
  ></div>
</div>`;
```

CSS 把角手柄做成 12px 圆点（`.resize` 白底蓝边圆），外圈 rotate 区偏移 6px——于是点圆点内是缩放、圆点外一圈是旋转。边手柄是贯穿整条边的细条（6px 宽/高），中点有 7px 白圆点（`:214` 的 `:after`）。

widget 侧 `_renderHandles`（`:598`）据 `_allowedHandles`（由 `_updateHandles` 调 `interaction.getResizeHandlers`/`getRotateConfig` 得到，`:432`）决定渲染哪些手柄；锁定元素（`isLocked`）不渲手柄。

### 3.3 ★缩放/旋转：委派交互层 + 回调驱动 UI

手柄 `pointerdown` 回调（`:619`）先看 `e.target` 是否含 `rotate` class 区分旋转/缩放，再分别委派：

**旋转**：`interaction.handleElementRotate({ elements, event, onRotateStart/Update/End })`。`onRotateUpdate(payload)` 里 `_updateCursor({ type:'rotate', angle: payload.currentAngle, handle })` 实时换旋转光标；start 置 `_mode='rotate'`、end 复位并 `_dragEndCleanup`。

**缩放**：`interaction.handleElementResize({ elements, handle, event, onResizeStart/Update/End })`。`onResizeUpdate({ lockRatio, scaleX, scaleY, exceed })`（`:651`）：

- `lockRatio`（等比缩放，角拖拽）→ 记 `_scaleDirection=handle`、`_scalePercent='<round(scaleX*100)>%'`、`_mode='scale'`，CSS 用 `[data-scale-percent]`/`[data-scale-direction]` 显示百分比角标与 90° 旋转的弧形提示图标（`:276-358`）；
- `exceed`（触达尺寸上/下限）→ 置 `_isWidthLimit`/`_isHeightLimit`，render 内嵌 `<style>` 把对应边 `::after` 画成红色限位线（`:776`）；
- 每次 update 调 `_updateCursor({ type:'resize', angle: 单选取元素 rotate 否则 0, handle, flipX: scaleX<0, flipY: scaleY<0 })`——缩放翻转（镜像）时光标方向也要翻。

widget 自己不碰坐标变换，只把"拖了多少"的回调翻译成光标与视觉反馈。`activeInteraction$` 订阅（`:568`）把交互层的 resize/rotate 态同步成 `_isResizing`，并广播 `elementResizeStart/End` legacy slot（供 drag-handle 等其他 widget 感知）。

### 3.4 ★旋转光标的几何映射

`utils.ts` 两个函数解决"旋转后光标方向"：

- `generateCursorUrl(angle, handle)`（`:373`）：生成一个内嵌 SVG 的旋转光标（`cursor: url(data:image/svg+xml,...rotate(deg)...)`），角度 = `rotateCursorMap[handle] + angle`（角手柄基准角 top-right=0/bottom-right=90/…，叠加元素实际 rotate）——用于**旋转手柄**。
- `getRotatedResizeCursor({handle, angle})`（`:404`）：把 `handleToRotateMap[handle]`（角=45/135、边=0/90）加元素角度，按 45° 量化到 `{0:ew, 45:nwse, 90:ns, 135:nesw}` 四种标准 resize 光标——用于**缩放手柄**。量化公式 `(round((base+angle)/45) % 4) * 45` 把任意角度归到最近的 45° 档，保证旋转 30° 的矩形，其右边手柄显示的是接近 ns/nesw 的合理光标而非永远 ew。

这是本包几何上最精巧的一笔——光标不是固定方向，而是元素旋转角的函数。

### 3.5 ★多选：整体框 + 子元素描边

`_renderHandles` 末尾（`:710`）：当选中 >1 个元素且不含 connector，用 `repeat` 给每个元素画一个 `.element-handle` 描边 div：

```ts
const [modelX, modelY, w, h] = deserializeXYWH(element.xywh);
const x = ((modelX - viewportX) * zoom) / viewScale; // 各子元素也做同样换算
const { left, top, borderWidth } = this._selectedRect; // 相对整体框定位
const style = {
  left: `${x - left - borderWidth}px`,
  top: `${y - top - borderWidth}px`,
  width: `${(w * zoom) / viewScale}px`,
  height: `${(h * zoom) / viewScale}px`,
  transform: `rotate(${element.rotate}deg)`,
  border: '1px solid var(--affine-primary-color)',
};
```

于是多选时：外层整体框（不旋转）给出 8 个手柄做整体缩放，内层每个子元素各自描边并按自身 rotate 旋转——用户既看到整体操作范围，也看清每个元素边界。单选 connector 则特殊渲染 `<edgeless-connector-handle>`（端点拖拽），connector 的选中框 `border-style:none`（`:809`，连线不需要矩形框）。

### 3.6 响应式刷新与自动补全

`firstUpdated`（`:532`）订阅一整套信号驱动 `_updateSelectedRect`/`_updateOnSelectionChange`：`viewport.viewportUpdated`（视口变）、`surface.elementAdded/Removed/Updated`、`store.slots.blockUpdated`、`selection.slots.updated`、`readonlyUpdated`。`_updateOnElementChange`（`:422`）只在"变化的元素在选区内"时才重算，避免无关更新触发 reflow。

`_renderAutoComplete`（`:746`）在非只读、非缩放、未关闭时渲染 `<edgeless-auto-complete>`——选中框四周的箭头，拖出可**自动生成一个同型、相连的新 shape/note**（`utils.ts` 的 `nextBound` 计算新元素落位、`getPosition` 给连线端点、`createEdgelessElement`/`createShapeElement` 建元素并连线）。这是选中框附带的高阶白板交互。

## 4. 语法特色

- **`static enabledWarnings = []`**（`:39`）：关闭 Lit 的"更新中又改属性"警告——因为 render 期间会根据交互回调同步 `_scalePercent` 等状态，是刻意为之。
- **`@state() accessor` 状态机**：`_mode`（resize/scale/rotate）、`_scaleDirection`、`_scalePercent`、`_isWidthLimit/_isHeightLimit`、`_isResizing`、`_allowedHandles` 全是 `@state accessor`，共同驱动 render 与 `data-*` 属性（`:823-848`）。
- **`data-*` 属性 + CSS 选择器联动**：`data-mode`/`data-scale-percent`/`data-scale-direction`/`data-locked` 写到根 div，由大段 CSS（`[data-mode='scale']`/`[data-scale-direction='top-left']::after` 等）决定显示百分比角标、弧形缩放提示、锁定色——**状态经属性下发、样式在 CSS 表达**，逻辑与呈现解耦。
- **`requestThrottledConnectedFrame(fn, this)`**：affine-shared 的调度器，把高频的 `_updateSelectedRect` 合并到"连接态 + 每帧一次"，避免视口连续变化时每事件都重算（`:472`）。
- **内嵌 SVG data-URI 光标**：`generateCursorUrl` 用 `url("data:image/svg+xml,...rotate(...)...") 16 16, fallback`，把旋转角直接烧进 SVG transform——纯 CSS 实现任意角度旋转光标。
- **`ifDefined` 条件属性**：`data-scale-percent=${ifDefined(this._scalePercent)}`（`:814`），值为 undefined 时不渲染该属性，配合 CSS `[data-scale-percent]` 存在性选择器。
- **`getOptional(InteractivityIdentifier)`**：交互层是可选依赖（`_interaction`，`:590`），不存在时手柄不可拖——用 `getOptional` 而非 `get` 做优雅降级。
- **`instanceof` 分派渲染**：`ConnectorElementModel` 单选走端点手柄、`ShapeElementModel` 走 `isShape` 守卫——运行时类型决定手柄形态。

## 5. 设计 / 实现亮点

- **视图/变换严格分层**：widget 只画框、算光标、委派；所有缩放旋转数学在 `InteractivityManager`。于是变换逻辑可无 UI 单测、可被多种选中框 UI 复用，widget 可独立改皮肤。
- **旋转感知的光标系统**：`generateCursorUrl`/`getRotatedResizeCursor` 把光标方向建模成元素旋转角的函数并量化到 45° 档——这是"旋转后拖右边手柄光标仍指对方向"的关键，很多编辑器都忽略的细节这里做全了。
- **一个手柄两种交互**：角手柄内圈圆点缩放、外圈透明环旋转，靠 DOM 分层 + `e.target.classList` 判定——无需额外按钮即区分两种高频操作。
- **CSS 驱动的状态反馈**：缩放百分比、方向弧标、限位红线、锁定色全用 `data-*` + CSS 选择器实现，render 只改属性不改结构，重渲成本低且样式集中可维护。
- **多选的双层表达**：整体框（操作范围）+ 子元素各自旋转描边（个体边界），坐标统一走 `(model-viewport)*zoom/viewScale` 换算——整体与个体同时可读。
- **CSS scale 补偿贯穿始终**：选中框、子元素描边、手柄都 `/viewScale`，保证嵌入式白板（被外层 CSS 缩放）里浮层仍像素对齐——跨嵌套场景的鲁棒性。

## 6. 对外 API 与注意事项

- **主要导出**：`EdgelessSelectedRectWidget`、`EDGELESS_SELECTED_RECT_WIDGET`（标签 `edgeless-selected-rect`）、`HandleDirection`/`ResizeMode`、`RenderResizeHandles`、`edgelessSelectedRectWidget`、`EdgelessSelectedRectViewExtension`（`./view`）；`autoCompleteOff` 为可外部设置的开关属性。
- **装配**：仅 edgeless scope；编辑态（`selection.editing`）或无选中时不渲染。
- **注意**：
  - 手柄交互**依赖 `InteractivityManager`**（可选依赖）；它不存在时框仍画但不可缩放旋转。
  - 坐标全经 `zoom/viewScale` 换算，改定位须理解"模型坐标→屏幕像素→CSS scale 补偿"三步，否则嵌入式白板里会错位。
  - 锁定元素（`isLocked`）不渲手柄、框变灰（`data-locked`）；connector 单选是端点手柄而非矩形框；多选含 connector 时不画子元素描边。
  - `_updateSelectedRect` 节流到每帧——极端情况下框可能比元素慢一帧，属预期。
  - 本 widget 只负责"选中后"的 UI；"如何选中"（点击/框选）是 `DefaultTool` 与 dragging-area 的事。

## 7. 延伸

- 底层：`@blocksuite/std/gfx`（`InteractivityManager`=缩放/旋转数学与 `getResizeHandlers`、`viewport` 坐标、`ResizeHandle`/`CursorType`）、`@blocksuite/std`（`WidgetComponent`）。
- 协作：`@blocksuite/affine-block-surface`（`OverlayIdentifier`/legacy slots）、`@blocksuite/affine-block-frame`（`FrameOverlay`，自动补全 frame 预览）、`@blocksuite/affine-gfx-connector`（端点手柄 `edgeless-connector-handle`）、`@blocksuite/affine-gfx-shape`（`ShapeFactory`，自动补全）。
- 对照阅读：`blocksuite-affine-widget-edgeless-dragging-area.md`（选中前的框选）、`blocksuite-affine-widget-drag-handle.md`（白板 gfx 手柄同样做 CSS scale 补偿）、`blocksuite-affine-block-root.md` §3.4（白板视口/坐标）、`toeverything-infra.md`（signal 响应式）。
