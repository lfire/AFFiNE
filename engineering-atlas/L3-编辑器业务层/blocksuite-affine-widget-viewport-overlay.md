# `@blocksuite/affine-widget-viewport-overlay`

> 一句话定位：一个平时"隐身"、可被编程式 `lock()` 的全屏透明遮罩 widget——当某个浮层 UI（如弹出的链接菜单、slash 菜单、对话框）需要"模态"效果时，调用它的 `lock()`，它就铺满整个视口并吞掉 `dragStart`/`pointerDown`/`click` 事件，把用户交互**拦在编辑器内容之外**；`unlock()` 后又恢复隐身、对指针完全透明。它是编辑器里实现"轻量模态/聚焦"的交互拦截层。

| 项        | 值                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/viewport-overlay`                                                                                      |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                |
| 语言/形态 | TypeScript / Lit widget 包（核心仅 ~90 行）                                                                                       |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`handleEvent`）、`@blocksuite/affine-model`（`RootBlockModel`）、`lit` |
| 被谁依赖  | 编辑器预设（通过 `ViewportOverlayViewExtension` 注册）、需要模态遮罩的浮层/菜单（经 `host.view.getWidget` 取用并 `lock/unlock`）  |
| 对外入口  | `.`（widget 类 + 标签常量 + ViewExtension 片段）、`./view`（`ViewportOverlayViewExtension`）                                      |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

极简标准 widget：`AffineViewportOverlayWidget extends WidgetComponent<RootBlockModel>`（`index.ts:11`），Shadow DOM 里一个绝对定位的 `.affine-viewport-overlay-widget` div；`viewportOverlayWidget = WidgetViewExtension('affine:page', …)`（`index.ts:80`）注册到 root；`ViewportOverlayViewExtension`（`view.ts`）在任意 scope 都注册。它监听的 host 事件是 `dragStart`/`pointerDown`/`click`（全部 `{ global: true }`），但**监听的目的不是响应、而是拦截**——锁定态下这些 handler 返回 `true` 把事件吞掉。

### viewport-overlay 独有的问题

它和前几个"渲染型"widget 根本不同——不画任何可见内容，解决的是**交互隔离**：

- **命令式开关**（独有之一）：它不随某个 signal/选区自动出现，而是提供 `lock()`/`unlock()`/`toggleLock()` 三个方法供外部**编程式调用**。谁想要模态效果，谁就拿到这个 widget 实例去锁。
- **双层拦截**（独有之二）：仅靠 CSS `pointer-events` 挡不住所有情况——它既用 CSS（锁定态 `pointer-events: auto` 让遮罩本身接管指针），又用 `handleEvent` 在事件分发层让 `dragStart`/`pointerDown`/`click` 的 handler 返回 `true`**消费事件**，双保险地把交互挡在内容之外。
- **隐身与现身的尺寸切换**（独有之三）：未锁定时宽高为 `0`、`pointer-events: none`（彻底隐身、不干扰任何操作）；锁定时宽 `100vw`、高 `100%`、`pointer-events: auto`（铺满并接管）——用尺寸 + 指针事件的切换实现"存在但无感"到"全屏模态"的转换。

## 2. 目录与关键文件

```text
src/
├── index.ts     # ★AffineViewportOverlayWidget：lock/unlock/toggleLock + 三个拦截 handler + render；末尾导出 WidgetViewExtension
├── view.ts      # ViewportOverlayViewExtension：任意 scope 注册
└── effects.ts   # customElements.define('affine-viewport-overlay-widget', …)
```

## 3. 实现细节

### 3.1 唯一状态：`_lockViewport`

整个 widget 的状态只有一个布尔 signal（`index.ts:76`）：

```ts
@state()
private accessor _lockViewport = false;
```

三个公开方法只是它的语义化封装（`:52`-`:73`）：

```ts
lock()       { this._lockViewport = true; }
unlock()     { this._lockViewport = false; }
toggleLock() { this._lockViewport = !this._lockViewport; }
```

因为是 `@state() accessor`，任一变化自动触发 `render` 重渲、切换遮罩尺寸与 class。

### 3.2 ★事件层拦截：handler 返回锁定态

`connectedCallback`（`:27`）注册三个全局事件，handler 的返回值**就是**当前锁定态：

```ts
this.handleEvent('dragStart', () => this._lockViewport, { global: true });
this.handleEvent('pointerDown', () => this._lockViewport, { global: true });
this.handleEvent('click', () => this._lockViewport, { global: true });
```

在 BlockSuite 的 UIEventDispatcher 约定里，事件 handler 返回 `true` 表示"已消费、阻止后续默认处理"。于是：锁定时三个 handler 返回 `true`，用户的点击/按下/拖拽起手被**在事件分发层拦截**，不会传到下面的块去触发选区变化、编辑、拖拽等；解锁时返回 `false`，事件照常流过——widget 对编辑器透明。这是比 CSS 更可靠的一道拦截（有些交互并非纯指针命中，走的是编辑器语义事件）。

### 3.3 ★样式层拦截：尺寸 + pointer-events 切换

`render()`（`:56`）据 `_lockViewport` 切换 class 与尺寸：

```ts
const classes = classMap({
  'affine-viewport-overlay-widget': true,
  lock: this._lockViewport,
});
const style = styleMap({
  width: this._lockViewport ? '100vw' : '0',
  height: this._lockViewport ? '100%' : '0',
});
return html`<div class=${classes} style=${style}></div>`;
```

配合静态样式（`:12`）：

```css
.affine-viewport-overlay-widget {
  position: absolute;
  top: 0;
  left: 0;
  background: transparent;
  pointer-events: none; /* 默认：对指针透明 */
  z-index: calc(var(--affine-z-index-popover) - 1); /* 恰在 popover 之下 */
}
.affine-viewport-overlay-widget.lock {
  pointer-events: auto;
} /* 锁定：接管指针 */
```

两个关键设计：① **z-index 是 `popover - 1`**——遮罩盖在编辑器内容之上、但在弹出层（popover/菜单）**之下**，这样"模态菜单可点、菜单之外被挡"的层级关系天然成立；② 遮罩 `background: transparent`——它只拦截、不变暗（非传统深色模态），是"轻量聚焦"而非"强调性模态"。CSS 的 `pointer-events` 切换与 3.2 的事件 handler 拦截**双层叠加**，确保各种交互路径都被挡住。

## 4. 语法特色

- **`@state() accessor` 单布尔驱动**：整个 widget 的行为由一个响应式布尔字段驱动（`:76`），公开方法只是它的语义包装——最小状态面的 widget 范例。
- **handler 返回值即拦截信号**：`() => this._lockViewport`（`:32`/`:38`/`:45`）把"是否拦截"直接等同于"是否锁定"，无分支、无副作用——用返回值表达"消费与否"是 UIEventDispatcher 的核心约定。
- **`{ global: true }` 全局事件**：三个拦截 handler 都注册为全局（`:34`/`:42`/`:49`），因为被拦截的交互可能发生在视口任意位置，须在全局事件流上拦截而非限定某元素。
- **`classMap` + `styleMap` 双指令切换**：class 控制 `pointer-events`（CSS 层）、style 控制尺寸（内联）——两个 Lit 指令分别管"能否接收指针"与"覆盖多大"，各司其职。
- **`calc(var(--affine-z-index-popover) - 1)`**：直接在 CSS 里用 `calc` 对主题 z-index 变量做减一（`:19`），把遮罩精确钉在"内容之上、popover 之下"的层级——用一行 CSS 表达层级契约。
- **命令式 API + 响应式渲染结合**：`lock/unlock/toggleLock` 是命令式入口，但内部改的是 `@state` 字段，渲染仍走 Lit 响应式——命令式与声明式在此优雅衔接。

## 5. 设计 / 实现亮点

- **双层拦截的稳健性**：只靠 CSS `pointer-events` 会漏掉走编辑器语义事件的交互，只靠事件 handler 又挡不住某些原生指针行为——本包两者叠加，用最小代码换来可靠的"模态隔离"。
- **z-index 契约即层级语义**：遮罩钉在 `popover - 1`，让"弹出层可交互、其余被挡"无需任何额外逻辑，纯靠层级关系成立——把交互意图编码进 z-index 的典范。
- **"存在但无感"的隐身态**：未锁定时宽高归零 + `pointer-events: none`，遮罩虽始终在 DOM 里却对编辑器零干扰；需要时瞬间铺满——避免了"用时创建、用完销毁"的挂载开销，也让 `lock()` 调用即时生效。
- **命令式开关契合浮层生命周期**：弹出菜单/对话框 `open` 时 `lock()`、`close` 时 `unlock()`，与浮层生命周期一一对应——比"监听某状态自动开关"更直接可控，适合多种互不相关的浮层共用同一个遮罩。
- **极简即正确**：~90 行、一个布尔、三个拦截、一个 render，把"交互隔离"这件事压缩到最小表面积——与 `edgeless-dragging-area` 同属"极致单一职责"的 widget 样板，只是职责从"渲染"换成了"拦截"。

## 6. 对外 API 与注意事项

- **主要导出**：`AffineViewportOverlayWidget`（含 `lock()`/`unlock()`/`toggleLock()` 公开方法）、`AFFINE_VIEWPORT_OVERLAY_WIDGET`（标签名 `affine-viewport-overlay-widget`）、`viewportOverlayWidget`、`ViewportOverlayViewExtension`（`./view`）。
- **装配与取用**：通过 `ViewportOverlayViewExtension` 接入（任意 scope）；使用方通过 `host.view.getWidget(AFFINE_VIEWPORT_OVERLAY_WIDGET, host.id)` 拿到实例，在浮层打开/关闭时 `lock()`/`unlock()`。
- **注意**：
  - 遮罩是**命令式**的，不会自己出现/消失——谁 `lock()` 谁负责 `unlock()`；忘记解锁会导致编辑器一直无法交互（常见坑）。
  - z-index 固定为 `popover - 1`（`:19`）：它只挡得住 z-index **低于** popover 的内容；层级比它更高的浮层不受其拦截（这正是"菜单可点"的保证，但也意味着不能用它挡住更高层 UI）。
  - 遮罩 `background: transparent`，锁定时视觉上**无变化**（不变暗）——它是交互拦截层，不是视觉强调层；需要变暗背景应另加样式或别的层。
  - 多个浮层共用同一实例时需自行协调：后一个 `unlock()` 会解除前一个的锁（只有一个布尔态），嵌套模态场景要注意引用计数由调用方维护。
  - 双层拦截中事件 handler 走 `{ global: true }`，返回 `true` 消费 `dragStart`/`pointerDown`/`click`——其它事件（如键盘、wheel）**不在拦截范围**，锁定态下仍可能透传。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`handleEvent` 的 UIEventDispatcher 约定——handler 返回 `true` 即消费事件）。
- 使用方：各类需要模态/聚焦效果的浮层 UI（链接编辑气泡、slash 菜单、确认对话框等），经 `getWidget` 取用并控制锁定。
- 对照阅读：`blocksuite-affine-widget-edgeless-dragging-area.md`（同为"极致单一职责"widget，职责为渲染）、`blocksuite-affine-widget-note-slicer.md`（widget 间 `getWidget` 协作）、`blocksuite-affine-widget-drag-handle.md`（`handleEvent` 全局事件与返回值消费语义、`pointer-events` 分层）。
</content>
