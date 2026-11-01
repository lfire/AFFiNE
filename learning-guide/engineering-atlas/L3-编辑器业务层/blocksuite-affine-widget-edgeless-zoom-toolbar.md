# `@blocksuite/affine-widget-edgeless-zoom-toolbar`

> 一句话定位：白板**左下角那条缩放控制条**——显示当前缩放百分比，提供"适应屏幕 / 缩小 / 重置到 100% / 放大"四个操作；按视口宽度自适应（宽屏直接展开横条、窄屏折叠成一个"更多"按钮弹出竖条、移动端换成紧凑药丸式滑尺），并在放映模式按设置隐藏。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/edgeless-zoom-toolbar`                                                                                                                                                                                                                                                                                                                                 |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                        |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`）、`@blocksuite/std/gfx`（`GfxController`/`viewport`/`ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP`）、`@blocksuite/affine-block-surface`（`EdgelessLegacySlotIdentifier`）、`@blocksuite/affine-components`（`edgeless-tool-icon-button`/`createLitPortal`）、`@blocksuite/global/env`（`IS_MOBILE`）、`@floating-ui/dom`、`lodash-es`（`clamp`）、`lit` |
| 被谁依赖  | 编辑器预设（通过 `EdgelessZoomToolbarViewExtension` 注册，仅白板 scope）                                                                                                                                                                                                                                                                                                          |
| 对外入口  | `.`、`./view`                                                                                                                                                                                                                                                                                                                                                                     |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

标准白板 widget：`AffineEdgelessZoomToolbarWidget extends WidgetComponent<RootBlockModel>`（`src/index.ts:14`），Shadow DOM 承载定位样式，`:host` 绝对定位左下角（`bottom:20px; left:12px`）、`pointer-events:none`（内部控件再 auto）；`edgelessZoomToolbarWidget = WidgetViewExtension('affine:page', …)`（`:100`）注册到 root；`EdgelessZoomToolbarViewExtension`（`src/view.ts`）仅 edgeless scope。它监听的 host 状态是 `gfx.viewport`（缩放变化）与 `gfx.tool`（放映模式）。

### 独有的问题：缩放语义 + 多形态自适应

这是最简单的白板 widget 之一，核心是把 `viewport` 的缩放能力包成几个按钮。但它仍要处理两件事：

1. **缩放操作语义**：fit（适应屏幕）、step out/in（按 `ZOOM_STEP` 增减并 `clamp` 到 `[ZOOM_MIN, ZOOM_MAX]`）、reset（平滑回到 100%），全部委派给 `viewport` 的 `fitToScreen`/`smoothZoom`——widget 不碰缩放数学。
2. **三形态自适应**：宽屏显示完整横条（`edgeless-zoom-toolbar`）、窄屏（≤1200px）折叠成一个"更多"按钮（`zoom-bar-toggle-button`，点开弹出竖条）、移动端（`IS_MOBILE`）换成紧凑药丸滑尺（`mobile-zoom-ruler`）。靠 CSS **容器查询** + 运行时 `IS_MOBILE` 判断在三者间切换。

是"widget 作为 viewport 能力的薄 UI 外壳"的典型。

## 2. 目录与关键文件

```text
src/
├── index.ts                   # ★AffineEdgelessZoomToolbarWidget：外壳、三形态切换、放映隐藏
├── zoom-toolbar.ts            # ★EdgelessZoomToolbar：横/竖缩放条本体（fit/out/reset/in）
├── zoom-bar-toggle-button.ts  # 窄屏“更多”按钮，弹出竖向缩放条（createLitPortal）
├── mobile-zoom-ruler.ts       # 移动端紧凑药丸：缩放百分比 + fit 按钮
├── view.ts / effects.ts
```

## 3. 实现细节

### 3.1 外壳：三形态切换

`AffineEdgelessZoomToolbarWidget.render`（`index.ts:81`）是个分发器：

```ts
if (this._hide) return nothing; // 放映设置隐藏
if (IS_MOBILE)
  return html`<mobile-zoom-ruler .std=${this.std}></mobile-zoom-ruler>`;
return html` <edgeless-zoom-toolbar .std=${this.std}></edgeless-zoom-toolbar>
  <zoom-bar-toggle-button .std=${this.std}></zoom-bar-toggle-button>`;
```

桌面端**同时渲染**完整横条与折叠按钮两者，由 `static styles` 里的 **CSS 容器查询**决定谁可见（`index.ts:32`）：

```css
@container viewport (width <= 1200px) {
  edgeless-zoom-toolbar {
    display: none;
  }
}
@container viewport (width > 1200px) {
  zoom-bar-toggle-button {
    display: none;
  }
}
```

视口 >1200px 显示横条、藏折叠钮；≤1200px 反之。用容器查询而非 JS 测宽——纯 CSS 响应式，零重渲开销。`@container viewport` 依赖祖先（白板视口元素）声明了 `container-name: viewport`。

### 3.2 ★缩放条本体：委派 viewport

`EdgelessZoomToolbar`（`zoom-toolbar.ts:18`，注意它继承 `WithDisposable(LitElement)` 而非 `WidgetComponent`——它是外壳内的子组件，`std` 由属性传入）渲染四个控件（`render`，`:147`）：

- **Fit to screen**：`@click=${() => this.gfx.fitToScreen()}`，`ViewBarIcon`；
- **Zoom out**：`setZoomByStep(-ZOOM_STEP)`，`MinusIcon`；
- **百分比按钮**：显示 `Math.round(zoom*100)%`，点击 `viewport.smoothZoom(1)` 重置到 100%；
- **Zoom in**：`setZoomByStep(ZOOM_STEP)`，`PlusIcon`。

`setZoomByStep`（`:108`）是唯一的"逻辑"：

```ts
setZoomByStep = step =>
  this.viewport.smoothZoom(clamp(this.zoom + step, ZOOM_MIN, ZOOM_MAX));
```

用 lodash `clamp` 把目标缩放夹在 `[ZOOM_MIN, ZOOM_MAX]`（常量来自 std/gfx），再调 `viewport.smoothZoom` 做带动画的缩放。**所有缩放数学都在 viewport**，widget 只决定"加减多少、夹在什么范围"。

`layout: 'horizontal' | 'vertical'` 属性（`:208`）控制横竖排布：横条用于宽屏直接显示，竖条用于折叠按钮弹出。`_isVerticalBar()` 还决定 tooltip 朝向（竖条朝右、横条朝上）。`locked`（viewport 锁定，如放映锁视口）时所有按钮禁用。

响应式刷新：`connectedCallback` 用 `effect` 订阅 `currentToolName$`（工具变→重渲）、`firstUpdated` 订阅 `viewport.viewportUpdated`（缩放变→重渲百分比）与 `readonlyUpdated`。只读时整条 `nothing`。

### 3.3 窄屏折叠：toggle 按钮 + portal 弹竖条

`ZoomBarToggleButton`（`zoom-bar-toggle-button.ts`）是窄屏下的入口——一个 `MoreHorizontalIcon` 按钮。点击 `_toggleZoomMenu`（`:40`）用 `createLitPortal` 在按钮上方弹出一个 `layout='vertical'` 的 `edgeless-zoom-toolbar`：

```ts
createLitPortal({
  template: html`<edgeless-zoom-toolbar
    .std=${this.std}
    .layout=${'vertical'}
  ></edgeless-zoom-toolbar>`,
  container: this._toggleButton,
  computePosition: {
    referenceElement: this._toggleButton,
    placement: 'top',
    middleware: [offset(4)],
    autoUpdate: true,
  },
  abortController: this._abortController,
  closeOnClickAway: true,
});
```

用 `AbortController` 管理弹层生命周期（再次点击或点外部即 `abort` 关闭），floating-ui 的 `autoUpdate` 让竖条随按钮位置跟随。于是窄屏下缩放控件收进一个按钮，需要时才展开——同一个 `EdgelessZoomToolbar` 组件复用为横/竖两种形态。

### 3.4 移动端：紧凑药丸滑尺

`MobileZoomRuler`（`mobile-zoom-ruler.ts`）是移动端专用的"缩放 HUD"——一个圆角药丸，左侧显示实时缩放百分比、右侧一个 fit-to-screen 按钮（`ViewBarIcon`）。它订阅 `viewport.viewportUpdated` 与 `zoomUpdated` 刷新百分比，`pointer-events:auto`（外壳是 none）。注释说明它是"窄/移动白板的紧凑缩放指示器"——移动端空间有限，不放完整增减按钮，只给"看当前缩放 + 一键适应屏幕"。

### 3.5 放映模式隐藏

`index.ts` 的 `connectedCallback`（`:53`）用 `effect` 订阅 `currentToolName$`：非 `frameNavigator`（放映）时 `_hide=false`。`firstUpdated`（`:68`）订阅 `navigatorSettingUpdated` slot——放映设置里 `hideToolbar` 为真时 `_hide=true`，render 返回 `nothing`。于是进入放映且用户选择隐藏工具栏时，缩放条一并消失，不挡放映画面。

## 4. 语法特色

- **CSS 容器查询做响应式**：`@container viewport (width <= 1200px)` 直接在样式里按容器宽切换横条/折叠钮可见性，无需 JS 测量与重渲——现代 CSS 响应式的干净用法。
- **一个组件两种 layout**：`EdgelessZoomToolbar` 用 `@property layout` + `.horizantal/.vertical` class 复用为横/竖两形态，窄屏弹层传 `vertical`、宽屏直接用 `horizontal`。
- **`WithDisposable(LitElement)` vs `WidgetComponent`**：外壳是 `WidgetComponent<RootBlockModel>`（真 widget），内部子组件（zoom-toolbar/toggle/ruler）是 `WithDisposable(LitElement)` 并由属性接收 `std`——widget 作为"根浮层"、子组件作"纯 UI"，职责分层。
- **`clamp(zoom+step, MIN, MAX)`**：用 lodash `clamp` + std/gfx 导出的缩放边界常量约束缩放范围，语义清晰。
- **`createLitPortal` + `AbortController`**：弹层用 portal 渲染到按钮容器、用 abort 信号统一管理显隐与"点外部关闭"，是 affine 弹层的标准模式。
- **`effect` 订阅 signal**：`effect(() => { gfx.tool.currentToolName$.value; requestUpdate(); })` 用副作用把 signal 变化桥接到 Lit 重渲——signal 与 Lit 协作的常见写法。
- **`IS_MOBILE` 运行时分支**：移动端换组件靠 `@blocksuite/global/env` 的 `IS_MOBILE` 常量在 render 里分支，与 CSS 容器查询互补（一个按设备、一个按宽度）。

## 5. 设计 / 实现亮点

- **viewport 能力的薄外壳**：缩放的全部数学（平滑动画、fit 计算、坐标）在 `viewport`，widget 只提供按钮、夹范围、显示百分比。改缩放行为改 viewport，换 UI 改 widget——干净的职责分离。
- **三形态自适应**：宽屏横条（CSS 容器查询显示）、窄屏折叠按钮弹竖条（同组件换 layout + portal）、移动端药丸滑尺（IS_MOBILE 分支）——同一功能按空间与设备给三套合适的 UI，且尽量复用组件。
- **CSS 容器查询零成本响应式**：宽/窄切换完全由 CSS 承担，JS 不参与测量重渲，性能与简洁兼得。
- **放映场景的得体退场**：进入放映并设置隐藏时整条消失，与 edgeless-toolbar 的自动隐藏一致，保证放映画面纯净。
- **组件复用**：横条与窄屏弹出的竖条是同一个 `EdgelessZoomToolbar`，仅 `layout` 不同——避免为竖排再写一套。

## 6. 对外 API 与注意事项

- **主要导出**：`AffineEdgelessZoomToolbarWidget`、`AFFINE_EDGELESS_ZOOM_TOOLBAR_WIDGET`、`EdgelessZoomToolbar`、`ZoomBarToggleButton`、`MobileZoomRuler`、`edgelessZoomToolbarWidget`、`EdgelessZoomToolbarViewExtension`（`./view`）。
- **装配**：仅 edgeless scope；固定在白板左下角。
- **注意**：
  - 缩放全委派 `viewport`（`fitToScreen`/`smoothZoom`）；改缩放步长/范围应改 std/gfx 的 `ZOOM_STEP`/`ZOOM_MIN`/`ZOOM_MAX`，不是本包。
  - 宽/窄切换靠 `@container viewport` 容器查询，依赖祖先视口元素声明了 `container-name: viewport`，否则查询不生效。
  - 只读时缩放条与折叠按钮均不渲染；`viewport.locked`（如放映锁视口）时按钮禁用。
  - 放映模式下是否显示取决于 `navigatorSettingUpdated` 的 `hideToolbar` 设置。
  - 内部子组件通过 `.std` 属性接收 `BlockStdScope`，脱离 widget 单独使用需手动传入。

## 7. 延伸

- 底层：`@blocksuite/std/gfx`（`viewport.fitToScreen`/`smoothZoom`/`zoom`/`locked`、`ZOOM_MIN/MAX/STEP`）、`@blocksuite/std`（`WidgetComponent`）。
- 协作：`@blocksuite/affine-components`（`edgeless-tool-icon-button`/`createLitPortal`）、`@blocksuite/affine-block-surface`（`EdgelessLegacySlotIdentifier` 的 `readonlyUpdated`/`navigatorSettingUpdated`）、`@blocksuite/global/env`（`IS_MOBILE`）。
- 对照阅读：`blocksuite-affine-widget-edgeless-toolbar.md`（白板主工具栏，同为底部浮层、同有放映隐藏）、`blocksuite-affine-block-root.md` §3.4（白板视口缩放手势与 `Viewport`）、`toeverything-infra.md`（signal/effect）。
