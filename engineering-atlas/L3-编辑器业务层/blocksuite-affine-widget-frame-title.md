# `@blocksuite/affine-widget-frame-title`

> 一句话定位：白板（edgeless）上**每个画框（frame）左上/内部那个显示框名的小标签**——它把 frame 模型的标题渲染成一个浮在画布上的浮层标签，位置随画框几何与视口缩放实时换算、文字颜色按画框背景自动反色、双击进入内联编辑直接改名、嵌套画框时贴到框内而非框上。它是**唯一挂在 `affine:frame`（而非 root）block scope** 上、仅白板启用的 widget。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/frame-title`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`stdContext`/`ShadowlessElement`/`requiredProperties`）、`@blocksuite/std/gfx`（`GfxControllerIdentifier`：viewport/grid/selection/tool）、`@blocksuite/std/inline`（`RANGE_SYNC_EXCLUDE_ATTR`）、`@blocksuite/affine-model`（`FrameBlockModel`/`ColorScheme`/`isTransparent`）、`@blocksuite/affine-block-surface`（`DefaultTool`）、`@blocksuite/affine-rich-text`（`rich-text`/`RichText`）、`@blocksuite/affine-components/color-picker`（`parseStringToRgba`）、`@blocksuite/affine-shared/services`（`ThemeProvider`）、`@lit/context`（`consume`）、`@toeverything/theme`、`lit` |
| 被谁依赖  | 白板编辑器预设（通过 `FrameTitleViewExtension` 注册，仅 edgeless scope）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 对外入口  | `.`（widget + editor + mount 函数 + styles）、`./view`（`FrameTitleViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

frame-title 遵循 `widgets/*` 范式（见 `blocksuite-affine-widget-drag-handle.md` §1），但有一处**关键不同**：它注册到的 block scope 不是 root，而是 `affine:frame`——`frameTitleWidget = WidgetViewExtension('affine:frame', AFFINE_FRAME_TITLE_WIDGET, literal\`…\`)`（`src/affine-frame-title-widget.ts:17`）。这意味着**每个画框块都有自己的一个 frame-title widget 实例**（挂在该 frame 组件的 `this.widgets` 里），而不是整个编辑器一个。`AffineFrameTitleWidget extends WidgetComponent<FrameBlockModel>`（`:8`）泛型是 `FrameBlockModel`，`this.model` 就是它所属的那个画框。`FrameTitleViewExtension`（`src/view.ts`）只在 `context.scope === 'edgeless'` 注册（`view.ts:19`）。

另一个结构特点：widget 本体 `AffineFrameTitleWidget` 极薄（`render` 只吐一个 `<affine-frame-title .model>`），真正的逻辑在独立的 `AffineFrameTitle`（`frame-title.ts`，标签渲染与定位）与 `EdgelessFrameTitleEditor`（`edgeless-frame-title-editor.ts`，双击后的内联编辑器）两个元素里。

### frame-title 独有的问题

它要解决白板上"一个标题标签"的全部几何与交互：

1. **坐标换算 + 缩放补偿（独有之一）**：画框在模型坐标（无限画布），标题是叠在 DOM 上的浮层，要按视口 `zoom` 换算位置，且尺寸要 `/zoom` 反缩放——让标签在任何缩放级别下视觉大小恒定。
2. **嵌套画框定位（独有之二）**：画框可嵌套。顶层画框标题贴在框**上沿外侧**；被别的画框包住的嵌套画框标题则贴在框**内部左上角**（否则会和外框重叠）。
3. **背景自适应反色（独有之三）**：标题背景取画框背景色（透明则用默认白），再按亮度公式算出文字该用黑还是白——保证任意画框色上文字都清晰。
4. **内联编辑改名（独有之四）**：双击标签挂载一个 `EdgelessFrameTitleEditor`（基于 `rich-text` 绑定 frame 标题的 `Y.Text`），全选、回车/失焦提交、编辑期间拦截画布事件。
5. **显隐时机（独有之五）**：空标题、正在编辑、处于 frameNavigator（演示）工具、标题高度超过画框本身、画框不在视口内——这些情况都要隐藏标签，避免干扰。

## 2. 目录与关键文件

```text
src/
├── index.ts                      # 导出 widget / editor / mount 函数 / styles
├── view.ts                       # FrameTitleViewExtension：仅 edgeless scope 注册
├── effects.ts                    # customElements.define（widget + frame-title + editor）
├── affine-frame-title-widget.ts  # ★AffineFrameTitleWidget：WidgetComponent<FrameBlockModel> 薄壳 + WidgetViewExtension('affine:frame', …)
├── frame-title.ts                # ★AffineFrameTitle：标签本体——坐标换算/缩放/嵌套定位/反色/显隐/双击挂编辑器
├── edgeless-frame-title-editor.ts# ★EdgelessFrameTitleEditor：双击后的内联改名编辑器（rich-text + Y.Text）
├── mount-frame-title-editor.ts   # mountFrameTitleEditor：切 DefaultTool、选中、挂编辑器到 edgeless mount point
└── styles.ts                     # frameTitleStyleVars（offset=4/height=22/fontSize=14）+ 标签样式
```

## 3. 实现细节

### 3.1 ★标签本体与 std 注入

`AffineFrameTitle`（`frame-title.ts:31`，`SignalWatcher(WithDisposable(LitElement))`）不走 WidgetComponent，而是独立 Lit 元素，通过 `@consume({ context: stdContext }) accessor std`（`:291`）从 Lit context 拿 `BlockStdScope`——因为它是 widget 内部渲染的子元素，用 context 注入比层层传参优雅。`@requiredProperties({ model: PropTypes.instanceOf(FrameBlockModel) })`（`:28`）强制外部传入画框模型。

它用一组 `@state accessor` 做响应式状态：`_frameTitle`（标题文本）、`_nestedFrame`（是否被嵌套）、`_xywh`（画框几何）、`_zoom`（视口缩放）、`_editing`（是否在编辑）。`render`（`:240`）极简——先 `_updateStyle()` 调整定位样式，再直接返回 `this._frameTitle` 作为文本内容（标签本身就是一个显示文字的盒子）。

### 3.2 ★定位与缩放补偿：_updateStyle

`_updateStyle`（`frame-title.ts:117`）是几何核心。先处理显隐：空标题 / 正在编辑 / 当前工具是 `frameNavigator` → `display:none`。随后：

```ts
const bound = Bound.deserialize(model.xywh);
const { nestedFrameOffset, height } = frameTitleStyleVars; // offset=4, height=22
const nestedFrame = this._nestedFrame;
const maxWidth = nestedFrame
  ? bound.w * zoom - nestedFrameOffset / zoom
  : bound.w * zoom;
const hidden = height / zoom >= bound.h; // 标题比画框还高 → 藏
const transformOperation = [
  `translate(0%, ${nestedFrame ? 0 : -100}%)`, // 顶层：上移自身高度到框外；嵌套：不上移
  `translate(${nestedFrame ? nestedFrameOffset : 0}px, ${nestedFrame ? nestedFrameOffset : -nestedFrameOffset}px)`,
];
this.style.transform = transformOperation.join(' ');
this.style.maxWidth = `${maxWidth}px`;
this.style.transformOrigin = nestedFrame ? 'top left' : 'bottom left';
```

要点：**顶层画框** `translate(0%, -100%)` 把标签上移自身高度、贴到画框上沿外侧（`transform-origin: bottom left`）；**嵌套画框**不上移、加 `nestedFrameOffset` 内缩，贴在框内左上角（`transform-origin: top left`）。`maxWidth` 限制标签宽度不超过画框。`hidden` 判断标题标签高度（`height/zoom`）是否已经比画框还高——放大到一定程度就不显示，免得标签比框还大。

`--bg-color` 与 `color` 由 `colors` getter 提供（见 §3.3）。注意标签的 CSS（`styles.ts:10`）本身 `position:absolute`，left/top 固定为 0，全靠 `transform` 定位——配合父级 widget 的坐标系。

### 3.3 ★背景自适应反色：colors getter

`colors`（`frame-title.ts:40`）决定标签配色：取画框 `background`（`ThemeProvider.getColorValue`），若透明则回落默认白；`parseStringToRgba` 解析成 `{r,g,b,a}`。然后按当前明暗主题把带透明度的色**合成到白/黑底**上（light 主题 `rPrime = 1-a + a*r`、dark 主题 `rPrime = a*r`），再用感知亮度公式 `L = 0.299*r' + 0.587*g' + 0.114*b'` 判断——`L > 0.5` 用黑字、否则白字（`:67`）。这保证无论画框什么颜色、什么主题，标题文字都有足够对比度。

### 3.4 ★尺寸写回模型：_updateFrameTitleSize + externalXYWH

标签不仅要定位，还要把自己占的空间**写回画框模型**，让白板的命中/选区知道标题区域。`_updateFrameTitleSize`（`frame-title.ts:94`）把缓存的 `clientWidth/Height` 除以 zoom 换算成模型尺寸，算出标签的模型坐标，写进 `model.externalXYWH`（顶层在框上方、嵌套在框内偏移），再 `gfx.grid.update(model)` 更新空间索引。`externalXYWH` 是"块主体之外还占用的区域"——于是框选、点击标签都能命中到画框。

`updated`（`:245`）里只有当画框在视口内、且 `_frameTitle`/`_nestedFrame`/`_xywh`/`_editing`/`_zoom` 等变化时才重测 `clientWidth/Height` 并 `_updateFrameTitleSize`——避免视口外画框和无关更新触发昂贵的尺寸测量。

### 3.5 ★响应式订阅

`connectedCallback`（`frame-title.ts:156`）订阅一整套白板信号：

- `doc.slots.blockUpdated`：画框增删改时重算 `_nestedFrame`（是否被别的画框包住，`_isInsideFrame` 用 `gfx.grid.has` 做空间查询，`:85`）。
- `model.propsUpdated`：画框属性变 → 更新 `_xywh` 重渲。
- `gfx.selection.slots.updated`：判断本画框是否处于 `editing`（选中且编辑态）。
- `gfx.viewport.viewportUpdated`：视口缩放变 → 更新 `_zoom` 重渲（缩放补偿的来源）。
- `model.props.title.yText.observe(updateTitle)`：**直接监听 `Y.Text`**，协同编辑下别人改了标题也能实时反映（`:228`）。
- `dblclick`（`:206`）：双击若画框未锁定则 `mountFrameTitleEditor` 进入编辑，否则只选中画框。

### 3.6 ★内联改名编辑器

双击走 `mountFrameTitleEditor`（`mount-frame-title-editor.ts:9`）：找到 edgeless 的 `.edgeless-mount-point`，`gfx.tool.setTool(DefaultTool)`（切回默认工具）、`gfx.selection.set({ elements: [frame.id], editing: true })`（选中并置编辑态），`new EdgelessFrameTitleEditor()` 挂上去。

`EdgelessFrameTitleEditor`（`edgeless-frame-title-editor.ts:20`，`WithDisposable(ShadowlessElement)`）渲染一个带边框发光的 `rich-text`，`.yText=${frameModel.props.title.yText}`（`:169`）**直接绑定画框标题的 Y.Text**——编辑即改模型、天然协同、天然可撤销，`enableFormat=false`（标题不支持富格式）。`firstUpdated`（`:71`）里 `inlineEditor.selectAll()` 全选、订阅 `renderComplete`/`viewportUpdated` 重渲跟随、监听 `keyDown`（Enter 且非合成 → `_unmount` 提交）与 `blur`（失焦 → `_unmount`），并用 `dispatcher.add('click'/'doubleClick', () => true)` **吞掉画布的点击/双击**，防止编辑时误触发白板交互。`_unmount`（`:56`）先 dispose、清选区编辑态、`remove()` 自身。定位（`render`，`:123`）用 `viewport.toViewCoord` 把画框模型坐标转视口坐标，嵌套框贴内部、顶层框贴上方，颜色复用标签的 `colors`。

### 3.7 显隐与演示模式

`_updateStyle` 的三个隐藏条件里，`frameNavigator`（`:121`）是**演示/画框导航模式**——放映画框时不该显示编辑态标签。加上 `hidden`（标题比框高）、空标题、编辑中，共同决定标签何时现身。

## 4. 语法特色

- **`WidgetComponent<FrameBlockModel>` + `affine:frame` scope**：这是全部 widget 里少见的"挂在非 root 块上"的例子——泛型宿主是画框、每个画框一个实例（`affine-frame-title-widget.ts:8`/`:17`），对比 drag-handle/toolbar 的 `RootBlockModel`。
- **`@consume({ context: stdContext })`**：用 `@lit/context` 的消费者装饰器从上下文注入 `std`（`frame-title.ts:291`），避免 widget→标签的属性透传——Lit context 的典型用法。
- **`@state accessor` 多状态驱动几何**：`_zoom`/`_xywh`/`_nestedFrame`/`_editing`/`_frameTitle` 任一变化都触发 `render`→`_updateStyle` 重新定位，是"数据变 → 几何更新"的响应式几何。
- **直接 `yText.observe` / `.yText=` 绑定**：标题标签监听 `Y.Text`（`:228`）、编辑器直接把 `rich-text` 绑到同一个 `Y.Text`（`edgeless-frame-title-editor.ts:169`）——绕过中间状态，天然协同与撤销。
- **CSS `color-mix` + 亮度公式**：hover 用 `color-mix(in srgb, var(--bg-color), #000 7%)` 加深（`styles.ts:33`）、文字色用感知亮度 `0.299/0.587/0.114` 加权判黑白（`frame-title.ts:67`）——色彩计算一半在 CSS、一半在 TS。
- **`transform` 双段组合定位**：`translate(0%,-100%)`（百分比，相对自身尺寸）叠 `translate(px,px)`（固定偏移）两段组合（`:138`），用 `transform-origin` 区分顶层/嵌套——纯 transform 实现"贴上沿外 vs 贴内部左上"。
- **`RANGE_SYNC_EXCLUDE_ATTR`**：编辑器设该属性（`edgeless-frame-title-editor.ts:68`）隔离文档选区同步；`dispatcher.add('click', () => true)` 返回 true 吞事件。
- **`ShadowlessElement`**：标题编辑器用无 Shadow DOM 元素，便于与 edgeless mount point 的样式环境融合。

## 5. 设计 / 实现亮点

- **挂在 frame 块而非 root**：每个画框自带一个标题 widget 实例，由 `WidgetViewExtension('affine:frame', …)` 自然实现——复用了 BlockSuite "widget 挂某 block scope"的机制表达"每框一标签"，无需 root 手动管理一堆标签。
- **缩放恒定的浮层**：位置按 `zoom` 换算、尺寸 `/zoom` 反缩放、`externalXYWH` 写回模型参与命中——标签在任意缩放下视觉大小不变且可点选，是白板浮层对齐的范本（与 edgeless-selected-rect、drag-handle 的 CSS scale 补偿同源思路）。
- **嵌套感知定位**：用 `gfx.grid.has` 空间查询判断是否被包住，顶层贴框外上沿、嵌套贴框内左上，`transform-origin` 一并切换——避免嵌套画框标题互相重叠。
- **背景自适应反色**：合成透明度到主题底色再按感知亮度判黑白字，任意画框色/主题下标题都清晰——很多编辑器只用固定色，这里做到了自适应。
- **编辑即改模型的协同改名**：`rich-text` 直接绑画框标题 `Y.Text`，全选/回车/失焦提交，编辑期吞画布事件——改名天然协同、可撤销，无需额外同步逻辑。
- **显隐时机考究**：空标题、编辑中、演示模式、标题比框高、视口外全部主动隐藏或跳过测量——既不干扰白板，又省掉无谓的 reflow。

## 6. 对外 API 与注意事项

- **主要导出**：`AffineFrameTitleWidget`、`AFFINE_FRAME_TITLE_WIDGET`、`frameTitleWidget`（ViewExtension 片段）、`AffineFrameTitle`（标签元素）、`EdgelessFrameTitleEditor`、`mountFrameTitleEditor`、`frameTitleStyleVars`/`frameTitleStyle`、`FrameTitleViewExtension`（`./view`）。
- **装配**：仅 `edgeless` scope 注册；对每个 `affine:frame` 块各生成一个实例。
- **注意**：
  - 标签位置全靠 `transform` + zoom 换算，改定位须理解"顶层贴框外上沿 / 嵌套贴框内左上"两套 `transform-origin` 与偏移。
  - 标题区域经 `externalXYWH` 写回模型并更新 grid——这是标签可被框选/点击命中的前提；若不更新会导致命中失准。
  - 以下情况标签隐藏：空标题、正在编辑、`frameNavigator`（演示）工具、标题高度 ≥ 画框高度、画框不在视口内。
  - 双击进入编辑要求画框未锁定（`isLocked`），否则只选中；编辑器会吞掉画布 click/doubleClick，回车或失焦提交。
  - 文字颜色是背景色与主题的函数（感知亮度判黑白），不是固定值。

## 7. 延伸

- 底层：`@blocksuite/std/gfx`（`GfxController` 的 `viewport`/`grid`/`selection`/`tool`——坐标换算、空间索引、选区、工具）、`@blocksuite/std`（`WidgetComponent`/`stdContext`）、`@blocksuite/std/inline` + `@blocksuite/affine-rich-text`（`rich-text` 绑 `Y.Text`）。
- 模型与主题：`@blocksuite/affine-model`（`FrameBlockModel`/`ColorScheme`/`isTransparent`）、`@blocksuite/affine-shared/services`（`ThemeProvider`）、`@blocksuite/affine-components/color-picker`（`parseStringToRgba`）。
- 协作：`@blocksuite/affine-block-surface`（`DefaultTool`，进入编辑时切工具）、`@blocksuite/affine-block-frame`（画框块本体）。
- 对照阅读：`blocksuite-affine-widget-edgeless-selected-rect.md`（同为白板浮层、同样的模型坐标→屏幕 + CSS scale 补偿）、`blocksuite-affine-widget-drag-handle.md`（白板 gfx 手柄的坐标补偿）、`toeverything-infra.md`（signal 响应式）。
