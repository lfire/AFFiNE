# `@blocksuite/affine-widget-scroll-anchoring`

> 一句话定位：当编辑器收到一个"定位到某个目标"的请求（点内链、从大纲/搜索跳转、分享链接带锚点），负责**把视口滚动/缩放到该块或图元处、并在其周围画一圈短暂高亮框**的 widget。它以 `HighlightSelection` 为输入信号，页面模式用 `scrollIntoView`、白板模式用 `fitToScreen` 把目标带入视野，再把目标的包围盒渲染成高亮边框。

| 项        | 值                                                                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/scroll-anchoring`                                                                                                                                                                                                                                                                            |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                      |
| 语言/形态 | TypeScript / Lit widget 包（单文件核心）                                                                                                                                                                                                                                                                                |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`）、`@blocksuite/std/gfx`（`GfxControllerIdentifier`/`viewport`/`GfxModel`）、`@blocksuite/affine-shared`（`HighlightSelection`）、`@blocksuite/affine-model`（`DocMode`）、`@blocksuite/global`（`Bound`/`deserializeXYWH`）、`@preact/signals-core`、`@toeverything/theme`、`lit` |
| 被谁依赖  | 编辑器预设（通过 `ScrollAnchoringViewExtension` 注册）、内链/大纲/搜索等"跳转到块"的发起方                                                                                                                                                                                                                              |
| 对外入口  | `.`、`./view`（`ScrollAnchoringViewExtension`）                                                                                                                                                                                                                                                                         |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

标准 widget：`AffineScrollAnchoringWidget extends WidgetComponent`（`scroll-anchoring.ts:20`），Shadow DOM 承载 `.highlight` 高亮框样式（页面与白板各一套边框风格）；`scrollAnchoringWidget = WidgetViewExtension('affine:page', …)`（`index.ts:8`）注册到 root；`ScrollAnchoringViewExtension`（`view.ts`）在任何 scope 都注册（页面/白板都需要跳转定位）。它监听的 host 状态是 **`HighlightSelection`**——一个 `group='scene'`、`type='highlight'` 的特殊选区（`affine/shared/src/selection/hightlight.ts`），谁想"跳转到某目标"，就往选区系统里放一个 `HighlightSelection`。

### scroll-anchoring 独有的问题

"跳到某处并高亮"涉及三个独有难点：

- **目标可能还不存在**（独有之一）：跳转请求到达时，目标块/图元可能**尚未渲染或尚未同步**（远端刚创建、懒加载未到）。widget 必须能"先挂起、监听文档更新、等目标出现后再执行"。
- **两套"带入视野"机制**（独有之二）：页面模式是纵向滚动文档——用 DOM 的 `scrollIntoView({ block: 'center' })`；白板模式是无限画布——要用 `viewport.getFitToScreenData` 算出合适的 zoom 与 center 把目标居中。几何与 API 完全不同。
- **高亮框随视口稳定**（独有之三）：高亮框是浮层，必须在滚动、缩放、resize、窗口变化时持续重算包围盒才能一直"贴"在目标上；白板下还要把模型坐标换算成视口坐标。
- **一次性消费**（独有之四）：`HighlightSelection` 是"命令式信号"，用完即焚——widget 读到后立刻 `selection.clear(['highlight'])`，避免重复触发；用户一旦 `pointerdown` 交互，高亮也应消失。

## 2. 目录与关键文件

```text
src/
├── scroll-anchoring.ts   # ★AffineScrollAnchoringWidget：anchor 信号、page/edgeless 两套定位、高亮渲染
├── index.ts              # WidgetViewExtension('affine:page', …) + re-export
├── view.ts               # ScrollAnchoringViewExtension：任意 scope 注册
└── effects.ts            # customElements.define + HTMLElementTagNameMap 声明合并
```

## 3. 实现细节

### 3.1 输入信号：`HighlightSelection` → `anchor$`

widget 内部状态用两个 signal 表达（`scroll-anchoring.ts:60`）：

```ts
anchor$ = signal<Anchor | null>(null); // 当前锚点 { id, mode, highlight }
anchorBounds$ = signal<Bound | null>(null); // 锚点的包围盒（模型/文档坐标）
highlighted$ = computed(() => this.std.selection.find(HighlightSelection)); // 从选区系统提取高亮请求
```

`connectedCallback`（`:182`）里订阅 `highlighted$`（`:217`）：一旦选区系统出现 `HighlightSelection`，就从中取出 `mode`（page/edgeless）、目标 id（页面取 `blockIds[0]`、白板取 `elementIds[0] || blockIds[0]`）、`highlight` 标志，然后**立即 `std.selection.clear(['highlight'])` 消费掉**（`:231`），再写 `anchor$.value = { mode, id, highlight }`、置 `#listened = true`。`anchor$` 的订阅者（`:202`）据 `mode` 分流到 `#moveToAnchorInPage` 或 `#moveToAnchorInEdgeless`。

`#listened` 是一个私有字段标志（`#` 原生私有，`:52`），表示"这是一次新发起的、允许挂起等待的跳转"——它决定目标不存在时该不该监听文档更新（见 3.4）。

### 3.2 ★页面定位：`scrollIntoView` + rAF

`#moveToAnchorInPage`（`:151`）：

```ts
const blockComponent = this.std.view.getBlock(id);
if (!blockComponent) {
  /* 挂起：监听 blockUpdated 等目标 add 后重试 */ return;
}

requestAnimationFrame(() => {
  blockComponent.scrollIntoView({ behavior: 'instant', block: 'center' });
});
this.#listened = false;
this.anchorBounds$.value = Bound.fromDOMRect(
  blockComponent.getBoundingClientRect()
);
```

两个要点：① 用 `requestAnimationFrame` 延后滚动——注释写明"有时同步调用无法滚到目标"（`:167`），等一帧让布局稳定后再滚更可靠；② 滚动用 `block: 'center'` 把目标置于视口中央；③ 包围盒直接取 DOM 矩形存入 `anchorBounds$` 供渲染。

### 3.3 ★白板定位：`getFitToScreenData` 缩放居中

`#moveToAnchorInEdgeless`（`:92`）更复杂。先从 `controller.getElementById(id)?.xywh` 取模型坐标包围盒；若目标是 **note 内的块**（`parentComponent.flavour === 'affine:note'`），则用"父便签的左边界/宽 + 子块的上边界/高"拼出一个混合包围盒并经 `toModelCoordFromClientCoord` 转回模型坐标（`:126-137`）——因为白板里要高亮的是便签内某个块，x 方向取便签、y 方向取块。

然后：

```ts
const { zoom, centerX, centerY } = viewport.getFitToScreenData(
  bounds,
  [20, 20, 100, 20]
);
viewport.setZoom(zoom);
viewport.setCenter(centerX, centerY);
this.anchorBounds$.value = bounds; // 存模型坐标包围盒
```

`getFitToScreenData(bounds, padding)` 算出"让该包围盒带指定内边距地铺满视口"所需的 zoom 与中心点，`[20,20,100,20]` 是上右下左的留白（下方多留 100 给可能的工具栏）。注意白板存的是**模型坐标**包围盒，渲染时再换算成视口坐标。

### 3.4 ★目标不存在时的挂起重试

两种模式都处理了"目标还没渲染"：页面模式监听 `store.slots.blockUpdated`，等到 `type === 'add' && id` 匹配就退订并递归重试（`:157-162`）；白板模式更周全，同时监听 `blockUpdated`（块）与 `surface.elementAdded`（图元，且 `v.local === false` 即真正同步来的）两条路（`:101-114`），任一命中就重试。守卫 `if (!this.#listened) return`（`:99`/`:154`）保证只有"新发起的跳转"才挂起等待——避免旧锚点在无关的文档更新里被反复触发。这正是"目标可能尚未同步"这一协作场景的核心兜底。

### 3.5 高亮渲染与视口跟随

`render()`（`:244`）：无锚点或 `anchor.highlight === false` 时返回 `nothing`（即只滚动不高亮的场景）。否则按 mode 算包围盒——页面走 `#getBoundsInPage`（`:78`，读实时 DOM 矩形并减去 host 的 offset）、白板走 `#getBoundsInEdgeless`（`:66`，把模型坐标 `anchorBounds$` 经 `viewport.toViewCoord` + `* zoom` 换算成视口像素）——再用 `classMap({ highlight: true, [mode]: true })` 挂上对应风格的边框：

```css
.highlight.edgeless {
  border: 1.39px solid var(cssVarV2('layer/insideBorder/primaryBorder'));
  box-shadow: var(--affine-active-shadow);
}
.highlight.page {
  border-radius: 5px;
  background-color: var(--affine-hover-color);
}
```

为让高亮框一直贴住目标，`connectedCallback` 订阅了全套视口触发器：`ResizeObserver` 观察 host（`:56`/`:185`）、`handleEvent('wheel')`、window `resize`、`viewport.viewportUpdated`（`:186-199`）全部 `requestUpdate`。而 host 的 `pointerdown`（`:190`）则**清空锚点与包围盒**——用户一旦开始交互，高亮即消失，符合"临时高亮"的语义。

## 4. 语法特色

- **ES 原生私有字段 `#`**：`#listened`、`#resizeObserver`、`#requestUpdateFn`、`#getBoundsInPage` 等（`:52`-`:91`）用 `#` 语法实现真正的运行时私有（而非 TS 的 `private` 软约束）——配合方法私有，封装边界更硬。
- **signal + computed 分工**：`anchor$`/`anchorBounds$` 是可写 `signal`，`highlighted$` 是从选区系统派生的 `computed`（`:60-64`）；`anchor$.subscribe`/`highlighted$.subscribe`（`:202`/`:217`）把响应式值接到命令式副作用（滚动/缩放）上。
- **`.peek()` 读值不建依赖**：`#getBoundsInEdgeless` 里 `anchorBounds$.peek()`（`:68`）在渲染/换算时读当前值而不建立订阅，避免循环触发。
- **解构即取值 + 默认兜底**：`const { mode, blockIds: [bid], elementIds: [eid], highlight } = highlighted`（`:220`）一行从选区对象里解构出所需字段，再 `const id = mode === 'page' ? bid : eid || bid` 做模式分流。
- **`Bound` 的多种构造**：`Bound.fromXYWH(deserializeXYWH(xywh))`（模型字符串）、`Bound.fromDOMRect(rect)`（DOM 矩形）、`new Bound(vx, vy, w*zoom, h*zoom)`（视口换算）——同一几何类型的多入口构造，对应不同坐标来源。
- **`cssVarV2` + `unsafeCSS`**：静态 `css` 里插入主题 token 需 `unsafeCSS` 包裹（`:38`），嵌套选择器 `&.edgeless`/`&.page` 用 Lit 支持的 CSS 嵌套为两种模式定义不同边框。
- **`classMap`/`styleMap` 条件渲染**：`classMap({ highlight: true, [mode]: true })`（`:254`）用计算属性名把运行时 mode 变成 class，一处模板覆盖两种模式。

## 5. 设计 / 实现亮点

- **以选区为命令总线**：跳转请求不是函数调用，而是往选区系统放一个 `HighlightSelection`——任何模块（内链、大纲、搜索、分享链接）都能用统一方式发起跳转，widget 作为唯一消费者执行并即时清除。这种"用一次性选区当命令"的设计让发起方与执行方彻底解耦。
- **挂起-重试应对异步**：目标未渲染时监听文档/图元更新再重试，`#listened` 标志精确区分"该等"与"不该等"——优雅处理了协作/懒加载下"跳转目标还没来"的时序问题。
- **页面/白板两套带入视野**：页面用 `scrollIntoView(center)`、白板用 `getFitToScreenData` 缩放居中，note 内块还做了"x 取便签、y 取块"的混合包围盒——对两种空间模型各自给了最贴合的定位方式。
- **rAF 延后滚动**：注释点明同步滚动有时失效，延后一帧待布局稳定再滚——是对浏览器布局时序的务实理解。
- **临时高亮的生命周期**：高亮随视口变化持续重贴、`highlight:false` 时只滚不亮、用户 `pointerdown` 即消失——把"短暂视觉提示"的语义处理得干净。

## 6. 对外 API 与注意事项

- **主要导出**：`AffineScrollAnchoringWidget`、`AFFINE_SCROLL_ANCHORING_WIDGET`（标签名 `affine-scroll-anchoring-widget`）、`scrollAnchoringWidget`、`ScrollAnchoringViewExtension`（`./view`）。
- **装配**：通过 `ScrollAnchoringViewExtension` 接入，页面/白板 scope 均注册；发起跳转的方式是 `std.selection.setGroup('scene', [new HighlightSelection({ mode, blockIds/elementIds, highlight })])`（经选区系统），而非直接调 widget。
- **注意**：
  - `HighlightSelection` 是**一次性**信号，被 widget 读到即 `clear`（`:231`）；要再次跳转需重新设置选区。
  - `highlight: false` 时只滚动/缩放、不画高亮框（`render` 的 `!anchor.highlight` 分支，`:246`）——适合"静默跳转"。
  - 目标尚未渲染会挂起等待文档更新再执行（`:157`/`:101`）；若目标永远不出现则不会滚动，属预期（无目标可定位）。
  - 用户在 host 上 `pointerdown` 会清掉锚点与高亮（`:190`）——高亮是临时的，交互即消失。
  - 白板包围盒以**模型坐标**存储、渲染时才经 `toViewCoord` 换算（`:66`）；改坐标基准应在此处，勿在别处重复变换。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`std.selection`/`std.view.getBlock`）、`@blocksuite/std/gfx`（`viewport.getFitToScreenData`/`toViewCoord`/`toModelCoordFromClientCoord`/`setZoom`/`setCenter`）、`@blocksuite/global`（`Bound`/`deserializeXYWH`）。
- 输入契约：`@blocksuite/affine-shared` 的 `HighlightSelection`（`affine/shared/src/selection/hightlight.ts`，`group='scene'`、含 mode/blockIds/elementIds/highlight，用 zod 校验）。
- 发起方：内链点击、大纲面板、全局搜索、分享链接锚点等"跳转到块/图元"的功能。
- 对照阅读：`blocksuite-affine-widget-edgeless-dragging-area.md`（白板坐标换算下沉）、`blocksuite-affine-widget-drag-handle.md`（视口跟随与 rAF 合批）、`toeverything-infra.md`（signal/computed、惰性订阅）。
