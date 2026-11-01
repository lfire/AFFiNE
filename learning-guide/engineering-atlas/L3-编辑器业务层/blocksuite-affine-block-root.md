# `@blocksuite/affine-block-root`

> 一句话定位：AFFiNE 编辑器的**根块**——文档树的顶点 `affine:page`，整个编辑器的宿主根。它独有的核心是：**同一个 `RootBlockModel` 在页面/白板两种模式下由两套截然不同的根组件呈现**（`PageRootBlockComponent` 的纵向文档流 vs `EdgelessRootBlockComponent` 的无限画布 + `gfx-viewport`）、**作为所有顶层 widget（拖拽柄、斜杠菜单、工具栏、远程光标…）的挂载宿主**、**承载视口（页面滚动 / 白板平移缩放）与全局键盘**、以及**根级的选区/点击空白聚焦/全选等编辑器级交互**。它是把 note、surface、各 widget 组装成"一个可用编辑器"的那块地基。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/root`                                                                                                                                                                                                                                                                                                                                                           |
| 所属层    | L3 · 编辑器业务层（根块 / 编辑器宿主）                                                                                                                                                                                                                                                                                                                                                    |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                     |
| 关键依赖  | `@blocksuite/std`（`BlockComponent`/`BlockService`/`LifeCycleWatcher`/选区）、`@blocksuite/std/gfx`（`GfxController`/`gfx-viewport`/`LayerManager`）、`@blocksuite/affine-block-surface`（`SurfaceBlockModel`/`DefaultTool`/CRUD）、`@blocksuite/affine-block-note`、`@blocksuite/affine-block-paragraph`、几乎所有 `gfx-*` 图元包、`@blocksuite/affine-model`（`RootBlockModel`）、`lit` |
| 被谁依赖  | 编辑器预设（editor preset）、`@affine/core`——它是编辑器装配的入口块                                                                                                                                                                                                                                                                                                                       |
| 对外入口  | `.`、`./effects`、`./store`、`./view`                                                                                                                                                                                                                                                                                                                                                     |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | root 实现                                                                                                                              | 独有之处                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| schema/model                      | `RootBlockSchema`（`flavour:'affine:page'`，`role:'root'`，props 只有 `title: Text`）；`RootBlockModel`                                | `role:'root'` 是唯一的树顶点；构造函数里同步 doc 标题到 workspace meta |
| `*-block.ts`                      | **四个**组件：`PageRootBlockComponent`、`EdgelessRootBlockComponent`、`PreviewRootBlockComponent`、`EdgelessRootPreviewBlockComponent` | ★一 flavour 四视图（页面/白板 × 可编辑/预览）                          |
| service                           | `edgeless/edgeless-root-service.ts`→`EdgelessRootService`（白板专属，实现 `SurfaceContext`）                                           | 只有白板有 service                                                     |
| keymap                            | `keyboard/`：`fallbackKeymap` + `PageKeyboardManager` + `EdgelessPageKeyboardManager`                                                  | 编辑器级键盘（删块/撤销/转链接…）                                      |
| widgets                           | **挂载宿主**：`renderBlock` 里 `repeat(this.widgets)`，各 widget 包以 `WidgetViewExtension('affine:page', …)` 注入                     | ★root 是所有顶层 widget 的宿主                                         |
| toolbar                           | `configs/toolbar.ts`→`builtinToolbarConfig`（注册到 note flavour）                                                                     | —                                                                      |
| clipboard                         | `clipboard/`：`PageClipboard` / `ReadOnlyClipboard`                                                                                    | 编辑器级复制粘贴                                                       |
| adapters                          | `adapters/`：html/markdown/notion-html（根节点↔文档根）                                                                                | —                                                                      |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define`（4 根组件）+ `RootViewExtension`/`RootStoreExtension`（按 scope 四分）                                         | ★装配按 scope 分四条线                                                 |

### 根块的独有问题

1. **一 flavour 四视图**：`affine:page` 这一个 flavour、一份 `RootBlockModel`，要能在"页面可编辑""白板可编辑""页面预览""白板预览"四种场景下各用一套根组件渲染。这由 `view.ts` 按 `context.scope` 注册不同自定义元素解决——是"块包统一范式"里 scope 差异化装配的集大成者。
2. **它是宿主，不是内容**：root 自己几乎没有"内容"，它的职责是**组装**——把 note（页面内容容器）、surface（白板画布）、以及一大批 widget（拖拽柄、斜杠菜单、工具栏、选框、远程光标）装进一个可交互的编辑器外壳。
3. **两套完全不同的视口**：页面模式是纵向滚动的文档（`.affine-page-viewport` + `ResizeObserver`），白板模式是可平移/缩放/捏合的无限画布（`gfx-viewport` + `Viewport` + wheel/pan/pinch 事件）。
4. **编辑器级交互**：点击空白区聚焦/建段落、Mod-a 全选、ArrowUp 到标题、根级删除块（含折叠标题连带删除）——这些跨越单个块的"整篇文档级"操作归根块管。
5. **白板的宿主服务**：白板需要一个贯穿生命周期的 `EdgelessRootService` 提供图层、视口、CRUD、frame 管理等——它实现 `SurfaceContext`，把 surface 与根绑定。

## 2. 目录与关键文件

```text
src/
├── page/page-root-block.ts              # ★PageRootBlockComponent：纵向文档流根
├── edgeless/
│   ├── edgeless-root-block.ts           # ★EdgelessRootBlockComponent：白板根（gfx-viewport/wheel/pan/pinch）
│   ├── edgeless-root-service.ts         # ★EdgelessRootService：白板宿主服务（SurfaceContext）
│   ├── edgeless-root-spec.ts            # EdgelessLocker（预览锁视口）
│   ├── edgeless-keyboard.ts             # 白板键盘管理
│   ├── clipboard/ configs/ interact-extensions/ utils/
├── preview/
│   ├── preview-root-block.ts            # PreviewRootBlockComponent：只读页面根
│   └── edgeless-root-preview-block.ts   # 只读白板根
├── keyboard/
│   ├── keyboard-manager.ts              # ★PageKeyboardManager：删块/撤销/转链接等编辑器键
│   └── keymap.ts                        # fallbackKeymap（Tab/Shift-Tab 兜底）
├── clipboard/                           # PageClipboard / ReadOnlyClipboard
├── configs/toolbar.ts                   # builtinToolbarConfig
├── adapters/                            # html/markdown/notion 根节点序列化
├── view.ts store.ts effects.ts types.ts index.ts
```

## 3. 实现细节

### 3.1 model：最简 schema，却是树的顶点

`RootBlockModel`（`model/src/blocks/root/root-block-model.ts`）props 只有一个 `title: Text`，但 `role:'root'` 让它成为文档树的唯一顶点：

```ts
export class RootBlockModel extends BlockModel<RootBlockProps> {
  constructor() {
    super();
    const sub = this.created.subscribe(() => {
      sub.unsubscribe();
      this.store.slots.rootAdded.subscribe(id => {
        /* 把 title 同步进 workspace.meta.docMeta */
      });
    });
  }
  override isEmpty() {
    /* 只含一个空 note 且画布为空 → 空 */
  }
}
// RootBlockSchema: flavour 'affine:page', version 2, role 'root'
```

- **标题即文档标题**：root 的 `title` 同时是整个 doc 的标题——构造函数订阅 `rootAdded`，把 `title` 写回 `workspace.meta` 的 docMeta，使侧边栏/标签页标题与文档内标题一致。
- **`role:'root'`**：schema 角色，表示它是树顶、无父（页面/白板都挂在它下面：note、surface 都是它的 children）。
- **`isEmpty`**：判断"只有一个空 note + 空画布"——用于"新建文档是否需要保存"等判断。

### 3.2 ★一 flavour 四视图：view.ts 按 scope 四分装配

`RootViewExtension.setup`（`view.ts:34-55`）是本包最能体现范式的地方——它先注册所有根通用的东西（`FlavourExtension('affine:page')`、`fallbackKeymap`、note 的工具栏配置），再按 `context.scope` 分流：

```ts
if (scope === 'preview-page' || scope === 'preview-edgeless')
  context.register(ReadOnlyClipboard);
if (this.isEdgeless(scope)) {
  this._setupEdgeless(context);
  return;
}
this._setupPage(context);
```

- **`_setupPage`**（`:57-69`）：注册 `ViewportElementExtension('.affine-page-viewport')`；`preview-page` scope → `<affine-preview-root>`（只读）；否则 → `<affine-page-root>` + `PageClipboard`。
- **`_setupEdgeless`**（`:71-92`）：注册 `EdgelessRootService` + `ViewportElementExtension('.affine-edgeless-viewport')`；`preview-edgeless` → `<affine-edgeless-root-preview>` + `EdgelessLocker`（锁视口）；否则 → `<affine-edgeless-root>` + `EdgelessClipboardController` + `AltCloneExtension` + `EdgelessElementToolbarExtension`。
- 于是同一 `affine:page` 被绑定到四个自定义元素之一，`effects.ts` 把这四个组件 `customElements.define`。**一份数据、四种宿主**——这正是 surface-ref 预览能"开一个只读 edgeless 子编辑器"（用 `preview-edgeless` scope）的根基。

### 3.3 ★页面根：纵向文档流 + 空白聚焦

`PageRootBlockComponent`（`page/page-root-block.ts`）渲染一个纵向 flex 容器，`renderBlock`（`:400-425`）里 `renderChildren` + `repeat(this.widgets)`：

- **过滤 EdgelessOnly note**：`renderChildren(model, child => !(isNote && displayMode===EdgelessOnly))`——只在页面模式下隐藏"仅白板可见"的 note（与 note 文档的 `displayMode` 呼应）。
- **默认 note 懒创建**：`_getDefaultNoteBlock`/`_createDefaultNoteBlock`——页面至少要有一个 note 承载正文，没有就建。`focusFirstParagraph`/`prependParagraphWithText` 是对外的"聚焦/插入首段"API。
- **★点击空白聚焦**（`connectedCallback` 的 `handleEvent('click')`，`:292-375`）：这是文档编辑的关键体验——点在文档空白处时，用 `testClickOnBlankArea` 判断点在左右留白还是正文列：若正文为空就 `appendParagraphCommand` 建段落；若点在留白，用 `getClosestBlockComponentByPoint` 找最近块，按点击在左/右把光标落到该块文本的行首/行尾（有文本）或整块选中（无文本）。
- **Mod-a 全选**（`:206-227`）：收集所有非 EdgelessOnly note 的子块，批量 `BlockSelection` 放进 `'note'` 选区组。
- **ArrowUp 到标题**（`:228-276`）：光标在首个 note 的首行按上，`focusTitle`/把光标移到文档标题的 inline editor——打通"正文↔标题"的导航。
- **视口**：`_initViewportResizeEffect` 用 `ResizeObserver` 观察 `.affine-page-viewport`，变化时经 `PageViewportService` 广播；`contentEditable` 在非只读且非 Android 时为 true（Android IME 会把合成文本留在外层可编辑根，故单独处理）。

### 3.4 ★白板根：gfx-viewport + 平移缩放捏合

`EdgelessRootBlockComponent`（`edgeless/edgeless-root-block.ts`）是四视图里最重的。它的 `renderBlock`（`:477-515`）结构清晰地表达了白板的三层：

```ts
<div class="edgeless-background edgeless-container">
  <gfx-viewport .viewport=${gfx.viewport} .getModelsInViewport=${() => grid.search(...)} .host=${host}>
    ${this.renderChildren(this.model)}            <!-- 顶层 GFX 块：note/frame/image… -->
    ${this.renderChildren(this.surfaceBlockModel)} <!-- surface 的 children -->
  </gfx-viewport>
</div>
<div class="edgeless-mount-point"></div>          <!-- 挂画布文本编辑器等 -->
<div class="widgets-container">${widgets}</div>    <!-- 顶层 widget（绝对定位覆盖层）-->
```

- **`<gfx-viewport>`**：std/gfx 提供的视口容器——按 `getModelsInViewport`（用 `grid.search(overscanBlockBounds, {filter:['block']})` 做视口裁剪）只渲染可见的 GFX 块，`maxConcurrentRenders=6` 限制并发渲染。它把"白板上的块"按视口动态挂载/卸载。
- **surface 作为兄弟**：`surfaceBlockModel`（`model.children` 里 flavour 为 `affine:surface` 的那个）的 children 也渲染进同一视口——于是 canvas 图元（surface 画）与 GFX 块（note/frame…）共处一个坐标空间。
- **平移/缩放/捏合**：`_initWheelEvent`（滚轮：触控板捏合或 `edgelessScrollZoom` 则缩放、否则平移，含 Windows/无横向滚轮的 Shift+滚轮横滚模拟）、`_initPanEvent`（双指平移）、`_initPinchEvent`（双指捏合缩放，围绕捏合中心 `toModelCoord`）——全套手势，坐标都经 `viewport.toModelCoord` / `applyDeltaCenter` / `setZoom`。
- **背景网格**：`_refreshLayerViewport`（节流）把 `translateX/Y` 与按 zoom 算的 `getBgGridGap` 写进背景 `background-position/size`，网格随视口移动。
- **视口初始化**：`_initViewport`（`:288-329`）优先用 note 的 fit 动画、再用 `EditPropsStore` 存储的上次视口（`xywh` 或 `zoom+center`）、否则 `fitToScreen`；卸载时把当前视口存回 `EditPropsStore`——记住上次看的位置。
- **工具**：`firstUpdated` 里只读则 `PanTool`、否则 `DefaultTool`；`bindHotKey` 被 override（`:377-410`）——选中单个 mindmap 节点时敲字母键直接进入文字编辑（`mountShapeTextEditor`），否则走原 handler。
- 还有像素比变化、远程光标（`toModelCoord` 后 `setCursor`）、resize、图层 z-index 更新等一系列 `_init*Effect`。

### 3.5 ★EdgelessRootService：白板的宿主服务

`EdgelessRootService`（`edgeless/edgeless-root-service.ts`）是**只在白板 scope 注册**的 `BlockService`，并 `implements SurfaceContext`——它把 surface、图层、视口、CRUD、frame 管理聚合成白板的中枢：

- 构造时 `getSurfaceBlock(doc)`，无 surface 直接抛 `NoSurfaceModelError`——白板必须有画布。
- 暴露 `edgelessElements`（canvas 图元 + GFX 块按 `layer.compare` 排序）、`elements`、`blocks`、`frames`、`gfx`、`layer`、`viewport`、`selection`、`crud` 等 getter——是白板交互代码的统一入口。
- `removeElement`（递归删组内元素 + 区分 GFX 块走 `doc.deleteBlock` / 图元走 `surface.deleteElement`）、`reorderElement`（改 z-index，块要在 transact 内）、`setZoomByAction`/`setZoomByStep`（fit/reset/in/out）、`getConnectors`（代理 surface 的端点索引）。
- `mounted` 初始化只读监听与光标 effect，`unmounted` dispose viewport 与选区——与编辑器生命周期绑定。

### 3.6 ★widget 挂载：root 是所有顶层 widget 的宿主

root 自己不实现拖拽柄、斜杠菜单、工具栏等，它只提供**挂载点**：`renderBlock` 里 `repeat(Object.entries(this.widgets), …)` 把框架注入的 widget 渲染出来。各 widget 包以 `` WidgetViewExtension('affine:page', WIDGET_NAME, literal`…`) ``把自己绑定到`affine:page`flavour（即 root），框架据此填充 root 组件的`this.widgets`。例如拖拽柄（`widgets/drag-handle/src/index.ts`）：

```ts
export const dragHandleWidget = WidgetViewExtension(
  'affine:page',
  AFFINE_DRAG_HANDLE_WIDGET,
  literal`${unsafeStatic(AFFINE_DRAG_HANDLE_WIDGET)}`
);
```

绑定到 `affine:page` 的 widget 还有：slash-menu（斜杠菜单）、toolbar（悬浮工具栏）、edgeless-toolbar / edgeless-zoom-toolbar / edgeless-selected-rect / edgeless-dragging-area（白板专属）、linked-doc、remote-selection（远程协作光标）、scroll-anchoring、keyboard-toolbar（移动端）、note-slicer、viewport-overlay 等——**整个编辑器的交互 UI 都挂在 root 上**。页面根与白板根的 `widgets-container` 定位不同（白板是绝对定位的覆盖层 `pointer-events:none`，内部元素再 `auto`），但机制一致。

### 3.7 编辑器级键盘与剪贴板

- **`fallbackKeymap`**（`keyboard/keymap.ts`）：最兜底的 Tab/Shift-Tab 拦截（阻止焦点逃逸），绑在根上。
- **`PageKeyboardManager`**（`keyboard/keyboard-manager.ts`）：页面根在 `connectedCallback` 里 `new PageKeyboardManager(this)`——处理删块（Delete/Backspace 删块选区，折叠标题连带删除其 collapsed siblings）、撤销重做、"选中块转链接文档"（`convertSelectedBlocksToLinkedDoc`）等编辑器级操作。白板则用 `EdgelessPageKeyboardManager`。
- **剪贴板**：`PageClipboard`（可编辑）/`ReadOnlyClipboard`（预览）/`EdgelessClipboardController`（白板）按 scope 注册——复制粘贴整块/图元的逻辑归根管。

## 4. 语法特色

- **`BlockComponent<RootBlockModel, EdgelessRootService>` 双泛型**：白板根组件把 service 类型作为第二泛型参数，使 `this.service` 被精确推断为 `EdgelessRootService`——块组件与其服务的类型绑定。
- **`literal` + `unsafeStatic` 注册四视图/widget**：`` BlockViewExtension('affine:page', literal`affine-edgeless-root`) ``与`` WidgetViewExtension('affine:page', NAME, literal`${unsafeStatic(NAME)}`) ``——运行期把动态标签名安全注入静态模板，是"一 flavour 多视图/多 widget"的语法落点。
- **`context.scope` 驱动装配**：`this.isEdgeless(scope)` / `scope === 'preview-*'` 的分支，把"同一块在不同编辑器形态下装不同扩展"表达为纯声明式注册——ViewExtensionProvider 的 scope 机制。
- **`@query accessor` 绑关键 DOM**：`@query('gfx-viewport') accessor gfxViewportElm`、`@query('affine-surface') accessor surface`、`@query('.edgeless-background') accessor backgroundElm`——根组件持有视口、画布、背景等关键元素引用。
- **`requestThrottledConnectedFrame` / `requestConnectedFrame`**：背景网格刷新、图层 z-index 更新、远程光标都用"连接态 + 节流/rAF"的调度，避免离屏或高频重算。
- **`effect()` 响应式**：光标样式 `this.style.cursor = gfx.cursor$.value`、主题变化刷新 surface、只读状态广播都用 `@preact/signals-core` 的 `effect`。
- **`implements SurfaceContext`**：`EdgelessRootService` 用结构化接口实现把自己"适配"成 surface 需要的上下文——服务与画布的契约。
- **构造函数里订阅一次性 slot**：`RootBlockModel` 在 `created` 里订阅、回调内立即 `unsubscribe`，再订阅 `rootAdded`——"只在创建时做一次初始化"的惯用法。

## 5. 设计 / 实现亮点

- **一 flavour 四视图的宿主架构**：`affine:page` + 一份 `RootBlockModel`，经 scope 装配出页面/白板 × 可编辑/预览四种根组件。这让"同一文档在不同形态下呈现"成为框架级能力——doc↔edgeless 无缝切换、surface-ref 的只读子编辑器、预览渲染全都建立在这套根的多视图之上。它是整个"块包统一范式"里 scope 差异化装配的顶点样本。
- **根作为纯宿主/组装层**：root 几乎不含内容，职责是把 note、surface、几十个 widget 组装成可交互编辑器；widget 用 `WidgetViewExtension('affine:page', …)` 声明式挂载到 root——交互 UI 与根解耦，新增一个顶层 widget 无需改 root。
- **两套视口的统一抽象**：页面的滚动视口与白板的无限画布视口都经 `ViewportElementProvider`/`Viewport` 暴露，`gfx-viewport` 用 grid 空间索引做视口裁剪只渲染可见块——同一"视口"概念覆盖两种差异极大的交互范式。
- **白板手势的完整工程**：wheel（缩放/平移/Shift 横滚模拟）、双指 pan/pinch（围绕捏合中心的模型坐标缩放）、像素比变化、背景网格随动、视口记忆——把无限画布该有的手感做全，坐标换算统一走 `toModelCoord`。
- **编辑体验的细节**：点击空白区按左右留白/正文列智能落点、ArrowUp 跨到标题、折叠标题删除连带其从属块——这些"整篇文档级"交互恰好归宿主根处理，层次合理。
- **服务聚合白板中枢**：`EdgelessRootService` 把图层、视口、CRUD、frame、选区聚合成单一门面并实现 `SurfaceContext`，让白板交互代码有稳定入口，同时与生命周期严格绑定（mounted/unmounted）。

## 6. 对外 API 与注意事项

- 主要导出：`PageRootBlockComponent`、`EdgelessRootBlockComponent`、`PreviewRootBlockComponent`、`EdgelessRootPreviewBlockComponent`、`RootBlockComponent`（联合类型）、`EdgelessRootService`、`EdgelessLocker`、`PageClipboard`/`ReadOnlyClipboard`；装配入口 `RootViewExtension`（`./view`）、`RootStoreExtension`（`./store`）、`effects`（`./effects`）。
- **约定**：顶层 widget 通过 `WidgetViewExtension('affine:page', …)` 注册即自动挂到 root；白板交互经 `EdgelessRootService`/`GfxController` 操作，不要绕过它直接改 surface；视口状态存取走 `EditPropsStore`。
- **注意**：
  - `affine:page` 一个 flavour 对应四个根组件，由 scope 决定；改根渲染时务必分清页面/白板/预览分支，别改错视图。
  - 白板根强依赖 surface（`EdgelessRootService` 无 surface 即抛错）；白板里 note/frame 是 GFX 块、shape 等是 surface 图元，渲染路径不同（见 surface 文档）。
  - 页面根的 `contentEditable` 在 Android 上刻意关闭外层可编辑（防 IME 合成文本滞留）；点击空白聚焦依赖 `viewport` 与留白计算，视口未就绪时会提前 return。
  - widget 不在本包实现，只在此挂载；某 widget 不出现多半是它的 `WidgetViewExtension` 未注册或 scope 不匹配。
  - 预览 scope（`preview-page`/`preview-edgeless`）用只读根 + `ReadOnlyClipboard`，白板预览还会 `EdgelessLocker` 锁住视口——预览不可编辑、不可平移缩放是预期行为。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`RootBlockModel`）、`@blocksuite/std`（`BlockComponent`/`BlockService`/`WidgetViewExtension`/选区）、`@blocksuite/std/gfx`（`GfxController`/`gfx-viewport`/`LayerManager`/`Viewport`）。
- 同层协作：`@blocksuite/affine-block-note`（页面内容容器 / 白板便签，root 的主要 children）、`@blocksuite/affine-block-surface`（白板画布，白板根的兄弟块与渲染核心，见 `blocksuite-affine-block-surface.md`）、`@blocksuite/affine-block-paragraph`（默认文本块）、各 `gfx-*` 图元包与各 `widgets/*`（挂到 root 的交互 UI）。
- 对照阅读：`blocksuite-affine-block-surface.md`（白板画布与图元）、`blocksuite-affine-block-note.md`（root 下的内容容器、同样"一块两视图"）、`blocksuite-affine-block-surface-ref.md`（复用 `preview-edgeless` 根 scope 的只读子编辑器）、`toeverything-infra.md`（DI 与 scope 机制的通用基础）。
