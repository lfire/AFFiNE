# `@blocksuite/affine-block-edgeless-text`

> 一句话定位：AFFiNE 白板（edgeless/surface）上的**自由文本块**（flavour `affine:edgeless-text`）——可在画布任意位置放置、拖拽缩放、旋转的文本容器。它和文档流里的段落块最大的不同是：**它是一个 GFX 块**（`GfxBlockComponent`，带 `xywh`/`scale`/`rotate` 画布坐标），内部再承载标准的段落/列表等子块。本块是观察"块范式如何从文档流迁移到白板坐标系"的典型——模型换成 GFX 兼容、组件换成 GFX 渲染、交互换成 GFX 的缩放/选中扩展。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/edgeless-text`                                                                                                                                                                                                                                                                                                                                                 |
| 所属层    | L3 · 编辑器业务层（内容块 · 白板）                                                                                                                                                                                                                                                                                                                                                       |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                    |
| 关键依赖  | `@blocksuite/affine-block-surface`（`EdgelessClipboardConfig`/`TextUtils`）、`@blocksuite/affine-gfx-text`（文本工具栏动作）、`@blocksuite/std` + `@blocksuite/std/gfx`（`GfxBlockComponent`/`GfxViewInteractionExtension`）、`@blocksuite/affine-model`（`EdgelessTextBlockSchema`）、`@blocksuite/affine-rich-text`、`@blocksuite/affine-inline-preset`、`@preact/signals-core`、`lit` |
| 被谁依赖  | 白板编辑器预设、`@affine/core`                                                                                                                                                                                                                                                                                                                                                           |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                                                                 |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | edgeless-text 实现                                                                                                                                                             | 对比文档流块（如 code/divider）      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| schema/model                      | `affine-model` 的 `EdgelessTextBlockSchema`/`EdgelessTextBlockModel`（`role: 'hub'`，`parent: ['affine:surface']`，props 含 `xywh`/`scale`/`rotate`/`hasMaxWidth` + 文本样式） | 文档块无画布坐标，parent 多为 note   |
| `*-block.ts`                      | `edgeless-text-block.ts` → `EdgelessTextBlockComponent extends **GfxBlockComponent**`                                                                                          | 文档块继承 `CaptionedBlockComponent` |
| 渲染钩子                          | ★`renderGfxBlock()` / `getRenderingRect()` / `getCSSTransform()`（画布变换）                                                                                                   | 文档块用 `renderBlock()`             |
| 交互                              | ★`GfxViewInteractionExtension`：resize（锁比例缩放=改 scale）/ select（进入编辑）                                                                                              | 文档块用 keymap/click                |
| clipboard                         | `EdgelessClipboardEdgelessTextConfig`（粘贴到 surface 上、保留 xywh）                                                                                                          | 文档块 clipboard 面向块流            |
| widgets/toolbar                   | `edgeless-toolbar`（浮动文本工具栏，复用 `affine-gfx-text` 的 `createTextActions`）                                                                                            | 文档块多用 widget 或 toolbar config  |
| adapters                          | **无**（白板文本随 surface 整体序列化）                                                                                                                                        | 文档块多有 markdown/html adapters    |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define` + `EdgelessTextViewExtension`（**仅 edgeless scope 注册**）/`EdgelessTextStoreExtension`                                                               | 文档块不分 scope                     |

**核心命题——"同一套块范式在白板坐标系下的变体"**：文档流里的块只需回答"渲染成什么 HTML"，由文档布局决定位置；白板块还要自己回答"我在画布的哪里、多大、转了多少度、缩放多少"。于是范式里的几个关键部件被整体替换：

- **模型**：用 `GfxCompatible(BlockModel)` 混入，得到 `xywh`/`index`/`rotate`/`scale`/`lockedBySelf` 等 GFX 公共属性，并实现 `GfxElementGeometry`。
- **组件**：`GfxBlockComponent` 代替 `BlockComponent`，提供 `renderGfxBlock`、`getRenderingRect`、`getCSSTransform`、`.gfx`（viewport/selection）等画布能力。
- **交互**：缩放/选中/拖拽不再靠 keymap，而靠 `GfxViewInteractionExtension` 注册的 `handleResize`/`handleSelection`。

而块的"内部"仍是标准范式——它 `role: 'hub'`、`renderChildren` 渲染段落/列表/代码/图片等子块，复用整条富文本/内联链路。所以 edgeless-text ≈ **一个漂浮在画布上的 note 容器**。

### 白板自由文本块的独有问题

1. **坐标与变换**：位置（`xywh`）、缩放（`scale`）、旋转（`rotate`）要映射到 CSS transform，并随 viewport 的平移/缩放联动。
2. **自动尺寸**：文本内容变化时块要自动长高/变宽（除非用户手动固定了宽度 `hasMaxWidth`），用 `ResizeObserver` 回写 `xywh`。
3. **缩放语义特殊**：锁比例拖角缩放改的是 `scale`（整体放大文字），自由拖边改的是真实宽度 `w` 并进入"固定宽度自动换行"模式。
4. **编辑态切换**：白板上默认不可编辑（只能整体选中/移动），双击或在选中态再点才进入文本编辑，需要 `contentEditable` 随 `_editing` 动态切换。
5. **IME 宽度塌缩**：输入法合成期容器可能瞬间塌成极窄，要在 `compositionend` 临时锁宽防抖动。
6. **样式块级同步**：改块级字色/粗细/斜体后，要把对应内联样式从子块里"清掉"（让块级样式接管）。

## 2. 目录与关键文件

```text
src/
├── edgeless-text-block.ts        # ★EdgelessTextBlockComponent（GFX 渲染/自动尺寸/编辑态）
│                                 #   + EdgelessTextInteraction（GfxViewInteractionExtension：resize/select）
├── edgeless-clipboard-config.ts  # EdgelessClipboardEdgelessTextConfig：粘贴到 surface、保留 xywh
├── edgeless-toolbar/
│   ├── config.ts                 # 浮动文本工具栏（createTextActions，复用 affine-gfx-text）
│   └── index.ts
├── view.ts                       # EdgelessTextViewExtension：仅 edgeless scope 注册 view/toolbar/clipboard/interaction
├── store.ts                      # EdgelessTextStoreExtension：注册 schema
├── effects.ts / index.ts
```

model 在 `blocksuite/affine/model/src/blocks/edgeless-text/edgeless-text-model.ts`。

## 3. 实现细节

### 3.1 ★GFX 模型：GfxCompatible 混入 + zod 默认值

`EdgelessTextBlockModel`（`model/src/blocks/edgeless-text/edgeless-text-model.ts`）用混入拿到画布能力：

```ts
export class EdgelessTextBlockModel
  extends GfxCompatible<EdgelessTextProps>(BlockModel)
  implements GfxElementGeometry
{
  get color() {
    return this.props.color;
  }
  set color(color) {
    this.props.color = color;
  }
}
```

- `GfxCompatible(BlockModel)` 是**混入函数**（接收基类、返回带 GFX 字段的子类），一次性注入 `xywh`/`index`/`rotate`/`scale`/`lockedBySelf` 等——所有白板块共享同一套画布属性来源。
- props 用 zod 声明文本样式默认值：`EdgelessTextZodSchema = z.object({ color, fontFamily, fontStyle, fontWeight, textAlign }).default({...})`，schema `props()` 里 `...EdgelessTextZodSchema.parse(undefined)` 把默认值铺开——**用 zod 既做类型又做运行时默认值**。
- `role: 'hub'`、`parent: ['affine:surface']`（只能挂在白板表面）、`children` 列出允许内嵌的块（段落/列表/代码/图片/书签/附件/非 synced-doc 的 embed/latex）——`'affine:embed-!(synced-doc)'` 是**带否定的 glob flavour 匹配**。

### 3.2 ★画布渲染：三个 GFX 钩子

`GfxBlockComponent` 要求实现三个与坐标相关的方法（`edgeless-text-block.ts`）：

```ts
override getRenderingRect() {               // 告诉画布这个块占多大
  const { xywh, scale, rotate, hasMaxWidth } = this.model.props;
  const bound = Bound.deserialize(xywh);
  const w = hasMaxWidth ? bound.w / scale : undefined;  // 未固定宽度时宽度自适应
  return { x: bound.x, y: bound.y, w, h: bound.h / scale, rotate, zIndex: this.toZIndex() };
}
override getCSSTransform() {                // 把画布坐标→CSS transform，跟随 viewport
  const { translateX, translateY, zoom } = this.gfx.viewport;
  const bound = Bound.deserialize(this.model.xywh);
  const deltaX = bound.x * zoom - bound.x, deltaY = bound.y * zoom - bound.y;
  return `translate(${translateX + deltaX}px, ${translateY + deltaY}px) scale(${zoom * this.model.props.scale})`;
}
override renderGfxBlock() {                 // 代替 renderBlock，画编辑框+内容
  this.contentEditable = String(editing && !this.store.readonly$.value);
  return html`<div class="edgeless-text-block-container" …>…${this.renderPageContent()}</div>`;
}
```

- `getRenderingRect` 把 `h` 除以 `scale`：真实高度是"内容高度"，`scale` 只在 transform 里放大，避免重复缩放。`w` 仅在 `hasMaxWidth`（用户固定了宽度）时给出，否则 `undefined` 让内容撑开。
- `getCSSTransform` 把块的画布坐标叠加 viewport 的 `translate`+`zoom`+块自身 `scale`，于是平移/缩放画布时文本块正确跟随。
- `renderGfxBlock` 动态设 `contentEditable`（仅编辑态且非只读）、编辑态加蓝色边框与投影、非编辑态 `pointerEvents: none`（只能整体选中）。内容区 `renderPageContent` 通过 CSS 变量把块级文本样式（`--edgeless-text-color` 等）下发给子段落，并 `renderChildren` 渲染子块。

### 3.3 ★自动尺寸：ResizeObserver 回写 xywh

白板文本要"内容多高块就多高"。`_resizeObserver`（`:53-63`）观察文本容器，内容变化时：

```ts
private readonly _resizeObserver = new ResizeObserver(() => {
  if (this.store.readonly) return;
  if (!this.model.props.hasMaxWidth) this._updateW();   // 未固定宽度→宽度也自适应
  this._updateH();                                       // 高度总是自适应
});
private _updateH() {
  const bound = Bound.deserialize(this.model.xywh);
  bound.h = this._textContainer.getBoundingClientRect().height / this.gfx.viewport.zoom;
  this.store.updateBlock(this.model, { xywh: bound.serialize() });
}
```

- 高度始终跟随内容；宽度仅在未固定（`!hasMaxWidth`）时跟随，`_updateW` 还用 `EDGELESS_TEXT_BLOCK_MIN_WIDTH` 兜底最小宽度。
- 关键是**都要除以 `viewport.zoom`**——`getBoundingClientRect` 返回屏幕像素，画布存的是模型坐标。
- `checkWidthOverflow(width)`（`:105-118`）临时设宽度试探 `scrollWidth > offsetWidth` 判断会不会溢出，供缩放交互用。

### 3.4 ★GfxViewInteractionExtension：缩放与选中语义

交互不写在组件里，而是独立的 `EdgelessTextInteraction`（`:386-518`），通过 `GfxViewInteractionExtension(flavour, { resizeConstraint, handleResize, handleSelection })` 注册。

**缩放（`handleResize`）区分两种语义**：

```ts
onResizeMove(context) {
  const { originalBound, newBound, constraint, lockRatio } = context;
  if (lockRatio) {                                   // 拖四角=锁比例→改 scale（整体放大文字）
    const newScale = newBound.w / (originalBound.w / initialScale);
    model.props.scale = newScale;
    model.props.xywh = newBound.serialize();
  } else {                                           // 拖边=改真实宽度→进入固定宽度换行
    if (!view.checkWidthOverflow(newBound.w)) return;
    const newRealWidth = clamp(newBound.w / initialScale, constraint.minWidth, constraint.maxWidth);
    model.props.xywh = Bound.serialize({ ...newBound, w: newRealWidth * initialScale, h: curBound.h });
    model.props.hasMaxWidth = true;                  // 标记"用户固定了宽度"
  }
}
```

- `resizeConstraint.lockRatio: ['top-left','top-right','bottom-left','bottom-right']`——四角缩放锁比例。拖角改 `scale` 让整段文字等比放大；拖边只改宽度并打开 `hasMaxWidth`，使文本在该宽度内换行。
- `onResizeStart/End` 用 `model.stash('scale')`/`model.pop('scale')` 把缩放过程做成**可整体撤销的事务暂存**——拖拽中间态不进 undo 栈，松手才落一笔。

**选中（`handleSelection`）管进入编辑**：`onSelect` 里，若已选中且处于 editing 则进入文本编辑态 `gfx.selection.set({ elements:[model.id], editing:true })`；若块为空则 `addBlock('affine:paragraph')` 并 `focusTextModel`；否则用 `handleNativeRangeAtPoint(x, y)` 把光标落到点击处（坐标用 `clamp` 限制在内容区内）。

### 3.5 编辑态、IME 与样式同步

- **编辑态 `_editing`**（`@state()`）：`firstUpdated` 里订阅 `gfx.selection.slots.updated`，当本块被选中且 `editing` 时置真。编辑态决定 `contentEditable`、边框、`pointerEvents`。
- **点击空白补段落**：编辑态点击文本容器上/下半区且首/末子块不是段落/列表时，自动在对应位置 `addBlock('affine:paragraph')` 并落光标——保证点哪都能开始打字（`:183-229`）。
- **`focusout` 清选区**：编辑态失焦即 `selection.clear()`。
- **IME 防塌缩**：`compositionupdate` 记住当前宽度，`compositionend` 若未固定宽度则临时把容器宽度锁为合成期宽度、置 `hasMaxWidth=true`，`requestAnimationFrame` 后再还原——规避输入法结束瞬间容器塌成小宽度的抖动（`:237-256`）。
- **块级样式→清内联**（`:120-160`）：`connectedCallback` 订阅 `model.propsUpdated`，当块级 `fontStyle`/`color`/`fontWeight` 改变时，对所有子块执行 `formatBlockCommand` 把对应内联样式（`italic`/`color`/`bold`）置 `null`——让块级样式生效、避免内联样式覆盖块级设定。

### 3.6 装配：按 scope 条件注册 + 浮动工具栏

`view.ts` 的 `EdgelessTextViewExtension` 只在**白板 scope**注册（`this.isEdgeless(context.scope)`）——文档模式不该出现白板文本块：

```ts
override setup(context) {
  if (this.isEdgeless(context.scope)) {
    context.register([ BlockViewExtension('affine:edgeless-text', literal`affine-edgeless-text`) ]);
    context.register(edgelessTextToolbarExtension);           // 浮动文本工具栏
    context.register(EdgelessClipboardEdgelessTextConfig);    // 粘贴到画布
    context.register(EdgelessTextInteraction);                // 缩放/选中交互
  }
}
```

- **工具栏**（`edgeless-toolbar/config.ts`）用 `ToolbarModuleExtension` + `BlockFlavourIdentifier('affine:surface:edgeless-text')` 注册一个**浮动工具栏模块**，动作来自 `@blocksuite/affine-gfx-text` 的 `createTextActions(EdgelessTextBlockModel, 'edgeless-text')`——与其它白板文本元素共用一套字体/颜色/对齐动作。`when: ctx => ctx.getSurfaceModelsByType(...).length > 0` 决定何时显示。注释点明"无需调整元素尺寸，块自己用 ResizeObserver 维护"。
- **剪贴板**（`edgeless-clipboard-config.ts`）继承 `EdgelessClipboardConfig`，`createBlock` 把快照 `onBlockSnapshotPaste` 到 `surface.model.id` 下，删掉 `index`、校验必须有 `xywh`——粘贴是"落到画布某处"而非"插入文档流"。
- `store.ts` 仅注册 `EdgelessTextBlockSchemaExtension`——**没有 adapters**，白板文本随整个 surface 的序列化走，不单独导出 markdown/html。

## 4. 语法特色

- **混入（mixin）类**：`GfxCompatible<Props>(BlockModel)` 是"类工厂"——接收基类返回扩展类，实现多重能力组合（TS 对 mixin 的经典支持），让所有 GFX 块共享坐标属性。
- **zod schema 兼做默认值**：`EdgelessTextZodSchema.default({...})` + `parse(undefined)` 既产出类型又产出运行时默认 props，schema 与默认值单一来源。
- **Lit `@state()` / `@query()` accessor**：`@state() accessor _editing = false` 声明触发重渲的内部响应式状态；`@query('.edgeless-text-block-container') accessor _textContainer!` 声明式绑定 DOM 引用（`!` 明确告诉 TS 它会在渲染后赋值）。
- **`computed` 聚合样式**：`_style$ = computed(() => ({ color, fontFamily, ... }))` 把多个属性 signal 合成一个样式对象，读取即自动追踪。
- **`styleMap` + CSS 自定义属性下发**：`styleMap({ '--edgeless-text-color': textColor, ... })` 把块级样式通过 CSS 变量传给子块的样式规则。
- **`model.stash()/pop()` 事务暂存**：缩放过程把 `scale`/`hasMaxWidth` 暂存，使中间态不污染撤销栈。
- **否定 glob flavour**：schema `children` 里 `'affine:embed-!(synced-doc)'` 用 glob 否定排除某子类型。
- **`satisfies` 约束工具栏配置**：`{...} as const satisfies ToolbarModuleConfig` 保字面量类型又校验结构。
- **`literal` 静态标签 + 声明合并**：同其它块。

## 5. 设计 / 实现亮点

- **块范式的"白板变体"**：把文档块的 model/组件/交互三件事整体替换为 GFX 版本（`GfxCompatible`/`GfxBlockComponent`/`GfxViewInteractionExtension`），而块内部仍复用标准段落/列表/富文本链路——清晰展示"同一套内容能力如何同时服务文档流与画布"。
- **缩放的双语义**：锁比例拖角=改 `scale`（整体放大），拖边=改真实宽度并开启固定宽度换行——用 `hasMaxWidth` 一个标志把两种意图分开，交互自然。
- **坐标与屏幕像素的严谨换算**：所有 `getBoundingClientRect` 结果都除以 `viewport.zoom` 再写回模型，`getCSSTransform` 把模型坐标叠加 viewport 变换——保证任意缩放下尺寸自适应仍正确。
- **IME 塌缩防抖**：`compositionend` 临时锁宽 + rAF 还原，是针对输入法的实战细节。
- **块级样式与内联样式的边界**：改块级样式时清掉子块对应内联样式，避免两层样式打架——容器型文本块的正确做法。
- **scope 条件装配**：仅白板 scope 注册，避免文档模式引入无意义的白板块与交互。

## 6. 对外 API 与注意事项

- 主要导出：`EdgelessTextBlockComponent`、`EdgelessTextInteraction`、`EdgelessClipboardEdgelessTextConfig`、`edgelessTextToolbarExtension`（`index.ts`）；装配 `EdgelessTextViewExtension`（`./view`）、`EdgelessTextStoreExtension`（`./store`）。
- **约定**：它只能作为 `affine:surface` 的子块存在（白板专属）；内部承载标准内容块，走通用富文本/内联体系。
- **注意**：
  - 高度始终自适应内容；宽度只有在 `hasMaxWidth=true`（用户拖边或 IME 固定）后才固定并换行。
  - 缩放拖角改 `scale`、拖边改宽度，两者语义不同；改交互逻辑要保持这一区分。
  - 所有屏幕尺寸写回模型前必须除以 `viewport.zoom`，否则缩放后尺寸错乱。
  - 块级文本样式会清掉子块同名内联样式——批量设样式时注意这层联动。
  - 无 adapters，白板文本不单独序列化为 markdown/html，复制粘贴走 `EdgelessClipboardConfig`（必须带 `xywh`）。
  - ViewExtension 仅在 edgeless scope 生效，文档模式不注册。

## 7. 延伸

- 核心依赖：`@blocksuite/std/gfx`（`GfxBlockComponent`/`GfxViewInteractionExtension`/`GfxCompatible`）、`@blocksuite/affine-block-surface`（`EdgelessClipboardConfig`/`TextUtils`）、`@blocksuite/affine-gfx-text`（`createTextActions`）、`@blocksuite/affine-model`（`EdgelessTextBlockSchema` + 字体/颜色/对齐 consts）。
- 同层协作：`@blocksuite/affine-rich-text`（`focusTextModel`）、`@blocksuite/affine-inline-preset`（`formatBlockCommand`）、`@blocksuite/affine-shared`（`ThemeProvider`/`ToolbarModuleExtension`/utils）。
- 对照阅读：`blocksuite-affine-block-divider.md`（文档流最小块）与 `blocksuite-affine-block-code.md`（文档流复杂块）——与本篇并读可看清"文档流块 vs 白板 GFX 块"的范式差异。
