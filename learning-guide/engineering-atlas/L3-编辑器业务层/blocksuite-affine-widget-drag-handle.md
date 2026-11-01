# `@blocksuite/affine-widget-drag-handle`

> 一句话定位：AFFiNE 编辑器**块左侧那条可抓取的拖拽手柄**——悬停任一块时在其左缘浮现一个 grabber，点击可选中块、按住可拖拽，驱动"块重排序 / 拖出为白板图元 / 跨编辑器拖入"等整套拖放交互。它是挂在 root（`affine:page`）上的顶层 widget，页面模式与白板模式各有一套探测逻辑。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/drag-handle`                                                                                                                                                                                                                                                                                                                                                               |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                    |
| 语言/形态 | TypeScript / Lit widget 包                                                                                                                                                                                                                                                                                                                                                                            |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`std.dnd`/选区/事件）、`@blocksuite/std/gfx`（`GfxController`/图元模型）、`@blocksuite/affine-block-surface`（`EdgelessCRUDIdentifier`）、`@blocksuite/affine-block-note`/`-paragraph`/`-list`/`-embed`/`-callout`、`@blocksuite/affine-components`（`DropIndicator`）、`@blocksuite/store`（`Slice`/`Transformer`）、`lit`、`@preact/signals-core`、`lodash-es` |
| 被谁依赖  | 编辑器预设（通过 `DragHandleViewExtension` 注册）、`@affine/core`                                                                                                                                                                                                                                                                                                                                     |
| 对外入口  | `.`（widget + 工具函数 + `DragBlockPayload`）、`./view`（`DragHandleViewExtension`）                                                                                                                                                                                                                                                                                                                  |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

所有 `widgets/*` 包都遵循同一范式（见 `blocksuite-std.md` §3.4、`blocksuite-affine-block-root.md` §3.6）：

1. **`WidgetComponent` 子类 + Shadow DOM 浮层**：widget 不是块（不进文档树），而是挂在 `EditorHost` 上的 Lit 浮层组件，用绝对定位覆盖在内容之上。`AffineDragHandleWidget extends WidgetComponent<RootBlockModel>`（`src/drag-handle.ts:34`），泛型 `RootBlockModel` 表明它绑定在根块上。
2. **`WidgetViewExtension` 注册到某 block scope**：`src/index.ts:11` 用 `` WidgetViewExtension('affine:page', AFFINE_DRAG_HANDLE_WIDGET, literal`${unsafeStatic(...)}`) ``把自己声明为`affine:page`（即 root）的 widget，框架据此把它填进 root 组件的 `this.widgets` 并渲染。
3. **`ViewExtensionProvider` 统一装配**：`src/view.ts` 的 `DragHandleViewExtension` 在 `setup` 里 `context.register(dragHandleWidget)`、在 `effect()` 里注册自定义元素——这是 widget 包接入编辑器的标准入口。
4. **监听 host 事件/选择**：widget 通过 `this.handleEvent(name, handler)`（继承自 `WidgetComponent`）订阅 `UIEventDispatcher` 的 `pointerMove`/`click`/`dragStart` 等语义事件，并读写 `std.selection`。

### drag-handle 独有的问题

手柄本身只是条小竖线，真正的复杂度在**"该不该出现、出现在哪、抓住后怎么搬"**三件事上：

- **悬停探测**（独有之一）：鼠标在文档里连续移动，widget 必须高频、低成本地判断"现在悬停在哪个块上"，并把手柄精准贴到该块第一行的垂直中线，同时处理 note 内边距、缩放、列表 toggle 图标偏移、database 表格等特例。
- **拖拽排序算法**（独有之二）：拖动时要实时计算"松手会插到哪"——目标块的上沿/下沿（`before`/`after`）、还是作为 note 的子块（`in`）、列表右缘缩进成子项，并用一条 `DropIndicator` 蓝线指示落点。
- **拖出 / 拖入 / 跨 doc**（独有之三）：块可以从页面拖到白板（变成 GFX 块或 surface-ref）、从白板拖回页面、甚至跨文档拖动——每种组合有不同的"能不能落、落了变成什么"规则。
- **多选拖拽**（独有之四）：拖柄作用于"当前选中的一组块"，若悬停块未被选中则临时选中它；文本选区要转成块选区；折叠的标题要连带其从属块一起搬。

页面模式与白板模式差异巨大，故拆成两个 watcher（`PointerEventWatcher` 管页面悬停、`EdgelessWatcher` 管白板），拖放逻辑则统一收敛到 `DragEventWatcher`。

## 2. 目录与关键文件

```text
src/
├── index.ts                      # WidgetViewExtension('affine:page', …) 注册 + 导出
├── view.ts                       # DragHandleViewExtension：ViewExtensionProvider 装配入口
├── effects.ts                    # customElements.define（widget + add-block 子组件）
├── consts.ts                     # AFFINE_DRAG_HANDLE_WIDGET / AFFINE_ADD_BLOCK_WIDGET 标签名
├── config.ts                     # 全部几何常量（手柄宽高、偏移、note padding…）
├── drag-handle.ts                # ★AffineDragHandleWidget：WidgetComponent 本体、render、hide/reset
├── styles.ts                     # Shadow DOM 样式（grabber / hover-rect / dots）
├── watchers/
│   ├── pointer-event-watcher.ts  # ★页面模式悬停探测：pointerMove 节流→定位手柄
│   ├── edgeless-watcher.ts       # ★白板模式：按选中的单个 gfx 元素定位手柄（rAF 调度）
│   ├── drag-event-watcher.ts     # ★拖放核心：draggable/dropTarget/monitor、落点算法、拖出拖入
│   ├── handle-event-watcher.ts   # 手柄自身 hover 态（grabber 变宽、hover-rect）
│   ├── keyboard-event-watcher.ts # 拖拽中按键（Esc 取消等）
│   └── page-watcher.ts           # 页面滚动/视口变化时隐藏或重定位
├── helpers/
│   ├── rect-helper.ts            # ★getDraggingAreaRect：多选包围盒几何
│   ├── selection-helper.ts       # 块选区读写（含白板 SurfaceSelection 补充）
│   └── preview-helper.ts         # 拖拽预览图（克隆块 DOM / 白板缩略）
├── middleware/                   # 粘贴/落库时的 TransformerMiddleware
│   ├── reorder-list.ts           # 重排后修正 numbered list 序号
│   ├── new-id-cross-doc.ts       # 跨 doc 拖入时换新 id
│   ├── card-style-updater.ts     # 卡片样式适配
│   └── blocks-filter.ts          # 白板选区→快照时过滤块
├── components/
│   ├── add-block-widget.ts       # 手柄旁的 “+” 加块按钮
│   └── edgeless-preview/preview.ts
└── utils.ts                      # ★几何/命中测试工具（getClosestBlockByPoint 等）
```

## 3. 实现细节

### 3.1 widget 本体：signal 驱动的状态机

`AffineDragHandleWidget`（`drag-handle.ts:34`）几乎所有状态都是 signal / computed，让渲染与定位自动随数据刷新：

```ts
anchorBlockId = signal<string | null>(null);                 // 当前锚定块 id
anchorBlockComponent = computed(() =>                         // → 块组件
  this.anchorBlockId.value ? this.std.view.getBlock(this.anchorBlockId.value) : null);
anchorEdgelessElement = computed(() => { /* 白板下 → gfx 图元 */ });
draggingAreaRect = computed(this.rectHelper.getDraggingAreaRect); // 多选包围盒
scaleInNote = computed(() => this.scale.value * this.noteScale.value); // 视口缩放 × note 缩放
@state() accessor activeDragHandle: 'block' | 'gfx' | null = null;    // 当前手柄形态
```

`activeDragHandle` 区分**块手柄**（页面/白板里 note 内的块，一条竖线）与 **gfx 手柄**（白板里的顶层图元，渲染成六个点 `dots`，可全向拖动）。`render()`（`drag-handle.ts:241`）据此渲染三块：`affine-add-block-widget`（加块按钮）、`.affine-drag-handle-container`（grabber，gfx 下额外渲染 6 个 `.dot`）、`.affine-drag-hover-rect`（悬停高亮矩形）。

`hide(force)`（`drag-handle.ts:152`）是核心复位：清锚、清 hover-rect、隐藏容器；`force` 时连带 `_reset()` 把 dragging/hovered 全部归零。注意 `hide` 的守卫 `if (this.dragging && !force) return`——拖拽进行中不能被普通 hide 打断。

连接期（`connectedCallback`）启动 `pointerEventWatcher`/`_keyboardEventWatcher`/`_dragEventWatcher`；`firstUpdated` 里按 `isInsidePageEditor`/`isInsideEdgelessEditor` 二选一启动 `_pageWatcher` 或 `edgelessWatcher`，并监听 host 的 `pointerleave` 自动隐藏（`drag-handle.ts:227-239`）。

### 3.2 ★页面悬停探测：高频节流 + 命中缓存

`PointerEventWatcher`（`pointer-event-watcher.ts`）用 `this.widget.handleEvent('pointerMove', …)` 订阅移动事件，核心是一个 `throttle(…, 1000/60)` 的处理器（`:232`），把探测频率压到 60fps。它的判定链很克制：

1. **早退**：只读 / 正在拖拽 / 未连接 → `hide()`；gfx 手柄可见 → 直接返回。
2. **命中缓存**（`:272-282`）：pointerMove 极高频，若命中的 `blockId` 与 DOM 元素都未变、且与当前锚一致，直接 `return`，跳过昂贵的"找最近 note"查询——这是性能关键优化。
3. **找最近 note**：`getClosestNoteBlock`（页面用 `findClosestBlockComponent`，白板用 `elementsFromPoint`）；记录 `noteScale`（白板下取 note 的 `edgeless.scale`）。
4. **可编辑 + 在 note 内** → `_pointerMoveOnBlock`：用 `getClosestBlockByPoint`（`utils.ts:176`）命中具体块，写入 `anchorBlockId`，再 `showDragHandleOnHoverBlock()`。

`getClosestBlockByPoint`（`utils.ts:176`）是悬停探测的几何核心：先锁定最近 note，再用 `getClosestBlockComponentByPoint` 命中块；对段落还会向上找 `affine-callout` 容器（callout 内段落的手柄要贴 callout）；排除 surface-ref 内部。

**手柄定位**在 `showDragHandleOnHoverBlock`（`:321`）。它把 `activeDragHandle='block'`，再用 `_containerStyle`（computed，`:112`）算 padding：手柄容器覆盖整个 `draggingAreaRect`，但用 `paddingTop`/`paddingBottom` 把 grabber 挤到锚块**第一行的垂直中线**上——

```ts
const rowPaddingY =
  ((containerHeight - DRAG_HANDLE_GRABBER_HEIGHT) / 2 + 2) * scaleInNote;
const paddingTop = rowPaddingY + posTop - draggingAreaRect.top;
```

`containerHeight` 按块类型查 `heightMap`（`utils.ts:44`，h1=40、quote=46、list=24…），因为不同块首行高度不同。所有尺寸都乘 `scaleInNote`，适配白板缩放与 note 自身缩放。

### 3.3 ★多选包围盒：RectHelper

`RectHelper.getDraggingAreaRect`（`rect-helper.ts:53`）决定手柄/hover-rect 的覆盖范围。它取 `_getHoveredBlocks()`：

- 若当前是**文本选区**，用 `rangeManager.getSelectedBlockComponentsByRange(range, { match: role==='content', mode:'highest' })` 把 range 覆盖的所有内容块收齐；
- 否则用块选区的组件列表；
- 若锚块不在选中集合里，退化为只含锚块。

然后对这组块求 `min(left/top)`、`max(right/bottom)` 得到包围盒，减去 offsetParent 偏移换算到 widget 坐标，再按 `scaleInNote` 四周加 padding（`DRAG_HANDLE_CONTAINER_WIDTH` 决定左侧让位、`DRAG_HOVER_RECT_PADDING` 决定视觉留白）。这就是"悬停多个选中块时手柄贴在整组垂直中线、hover-rect 框住整组"的几何来源。

### 3.4 ★白板手柄：按选中单个图元定位（rAF 调度）

白板模式差异大到单独一个 `EdgelessWatcher`（`edgeless-watcher.ts`），注释写明"**白板下手柄作用于每个块/图元，但不支持多选**"（`:30-33`）。它不靠悬停，而靠**选区**：`updateAnchorElement`（`:226`）要求 `selection.selectedElements.length === 1 && !editing`，否则 `hide()`；满足则把该图元 id 设为锚，`_showDragHandle()`。

定位用 `hoveredElemArea`（`:260`）：取图元的模型矩形 `getSelectedRect`，再按视口做坐标换算——

```ts
let left = ((rect.left - viewportX) * scale) / viewScale; // 模型坐标 → 视口像素，补偿外层 CSS scale
```

注释点明"补偿外层 CSS scale，匹配 `GfxBlockComponent.getCSSTransform`"——白板块是用 CSS transform 缩放的，手柄作为浮层必须反算回去才能对齐。

白板的刷新全走 **requestAnimationFrame 合批**（`_showDragHandle`→`_flushShowDragHandle`，`:167`/`:118`）：视口缩放/平移、图元更新、工具切换都可能触发重定位，用 `_isAreaEqual` 比较新旧区域、`_pendingHoveredElemArea` 暂存、rAF 内一次性应用，避免高频 reflow。它订阅 `viewport.viewportUpdated`、`selection.slots.updated`、`tool.currentToolOption$`（非 default 工具就隐藏手柄）、`surface.elementUpdated`、`store.slots.blockUpdated` 等一整套白板信号（`:301-386`）。

### 3.5 ★拖放核心：建立在 `std.dnd` 之上

`DragEventWatcher`（`drag-event-watcher.ts`，1742 行）是全包最重的文件，它完全架在 std 的 `DndController`（基于 `@atlaskit/pragmatic-drag-and-drop`）之上。`watch()`（`:1670`）装配四类 DnD 角色：

- **`draggable`**（`_makeDraggable`，`:1471`）：把 widget 自身设为可拖源。`canDrag` 要求有锚块；`setDragData` 调 `_getDraggedSnapshot()` 生成 `SliceSnapshot` 并提取 `modelIds`；`setDragPreview` 用 `PreviewHelper.renderDragPreview` 渲染跟手的半透明预览；`onDragStart` 置 `dragging=true`、`onDrop` 走 `_cleanup`。
- **`dropTarget`**（`_makeDropTarget`，`:1517`）：遍历每个块组件注册为潜在落点。这里编码了**落点规则**：surface 块永不可落；页面模式除 root 外都可落；白板模式只有 root/note/note 内块可落。`canDrop` 禁止落到自己或自己的子块上（同 doc 内 `modelIds` 去重）。note 作为落点时 `onDragEnter`/`Leave` 切换 `hideMask`。
- **`monitor`**（`_monitorBlockDrag`，`:1598`）：全局监听拖拽过程，`onDrag` → `_onDragMove`（更新 DropIndicator），`onDrop` → `_onDrop`；都先用 `_isDropOnCurrentEditor` 判断落点是否属于本编辑器的 `std`（多编辑器/跨 doc 共存时的隔离）。
- **`autoScroll`**（仅页面模式，`:1702`）：拖到视口边缘自动滚动。

落点与块通过 `std.view.viewUpdated` 动态增删 drop target（`:1718`），块删除时清理，避免泄漏。

### 3.6 ★落点算法：`_getDropResult`

`_getDropResult`（`:195`）把"拖到某块的某条边"翻译成插入位置 `DropResult { placement, rect, modelState }`：

- `dropPayload.edge` 由 pragmatic-dnd 给出当前靠近目标块的上沿还是下沿；
- 落在 **note** 且拖的内容首块是 note → `placement:'in'`（成为 note 子块）；否则按 edge 映射为 `'before'`（top）/`'after'`（bottom）；
- 落在**列表块右缘**（`edge==='right' && ListBlockModel`）→ 若拖的全是列表则 `'in'`（缩进成子项，indicator 画在列表左缩进处）；否则回退到"最近的 note 直接子块之后"（`_getFallbackInsertPlace` 沿父链找到挂在 note 下的那层，`:175`）；
- indicator 矩形用 `Rect.fromLWTH` 构造一条 `3*scale` 高的蓝线，`y` 取目标块顶/底。

`_updateDropIndicator`（`:294`）在每次 `onDrag` 时先判断 point 是否还在 note 内（`isOutOfNoteBlock`），出界就清掉 indicator。

### 3.7 ★拖出 / 拖入 / 跨 doc：`_onDrop` 分流

落下时 `_onDrop`（`:708`）先 `captureSync()`（把后续改动并成一个 undo 单元），再按模式分流：

- **页面落点** `_onPageDrop`（`:529`）：算出 `parent`/`index`；跳过"原地落下"；若"把 note 拖到 note 上"则 `_onDropNoteOnNote`（剥掉外层 note、把其 children 搬进目标 note）；若所有块 schema 允许落入父块（`schema.safeValidate`）则 `_dropToModel`；**若拖的是 gfx 内容落到 note**——同 doc 直接在该处建 `affine:surface-ref`（引用最大的那个图元）或 `affine:embed-linked-doc`，跨 doc 则先 `_mergeSnapshotToCurDoc` 再建引用。
- **白板落点** `_onEdgelessDrop`（`:489`）：落到 root（空白画布）→ 同 doc 的 gfx 内容禁止原地重放；页面块内容则 `_dropAsGfxBlock`（包成白板块）；跨 doc 的 gfx 内容则 `_mergeSnapshotToCurDoc`（含 `_rewriteSnapshotXYWH` 平移到落点、`buildContainerTree` 保证 group/connector 的父子依赖按序重建）。落到 note 则复用页面落点逻辑。

快照生成区分来源：块手柄走 `_getSnapshotFromHoveredBlocks`（`:421`，处理文本选区转块选区、折叠标题连带 `collapsedSiblings`、`getBlockComponentsExcludeSubtrees` 去重父子），gfx 手柄走 `_getSnapshotFromSelectedGfxElms`（`:339`，递归收集 group 子元素、区分 surface 图元与 GFX 块）。两者最终都经 `_toSnapshot`（`:1321`）用 `Slice.fromModels` + `job.sliceToSnapshot` 序列化。

### 3.8 落库中间件

`_getJob`（`:1431`）用 `std.store.getTransformer([...])` 组装一条中间件链，落库前改写快照：`newIdCrossDoc`（跨 doc 换新 id 防冲突）、`reorderList`（重排后 `correctNumberedListsOrderToPrev` 修正编号，`reorder-list.ts`）、`surfaceRefToEmbed`、`cardStyleUpdater`（卡片样式适配目标容器宽度），gfx 场景再追加 `gfxBlocksFilter`。这套"中间件改写快照"复用了 store 的 Transformer 机制，保证拖放与复制粘贴走同一条数据管道。

## 4. 语法特色

- **`WidgetComponent<RootBlockModel>` 泛型**：widget 基类以其宿主块模型为泛型参数，`this.block` 即 root 组件、`this.store`/`this.std`/`this.host` 均由基类提供——widget 与宿主块的类型绑定（`drag-handle.ts:34`）。
- **`signal`/`computed` 做响应式状态**：`anchorBlockId`（signal）→ `anchorBlockComponent`/`draggingAreaRect`（computed）形成派生链，配合 `SignalWatcher` mixin 让 `render` 自动重跑；`.peek()` 读值不建立依赖、`.value` 读值建立依赖——代码里刻意区分（如 `hide` 用 `peek`、`render` 用 `value`）。
- **Lit `@state`/`@query accessor`**：`@state() accessor activeDragHandle`、`@query('.affine-drag-handle-container') accessor dragHandleContainer` 用标准装饰器 + `accessor` 关键字声明响应式状态与 DOM 引用（`drag-handle.ts:94`/`:289`）。
- **`throttle<UIEventHandler>(fn, 1000/60)`**：用 lodash 的泛型 `throttle` 给事件处理器限频，类型标注保留 `UIEventHandler` 签名（`pointer-event-watcher.ts:232`）。
- **声明合并扩展 DnD 类型**：`declare module '@blocksuite/std' { interface DNDEntity { blocks: DragBlockPayload } }`（`drag-event-watcher.ts:103`）用 TS 模块增强，把本包的拖拽载荷类型注册进 std 的全局 DnD 实体表——跨包类型安全而不改 std 源码。
- **`WidgetViewExtension` + `literal`/`unsafeStatic`**：`` literal`${unsafeStatic(AFFINE_DRAG_HANDLE_WIDGET)}` ``（`index.ts:14`）把运行时标签名安全注入静态模板，是 widget 注册的固定语法。
- **`assertType<T>()` 收窄快照联合**：`_mergeSnapshotToCurDoc` 里对 `connector` 类型用 `assertType<{...}>(elem)`（`:828`）在不加运行时开销的前提下让 TS 把 `elem` 收窄为连接器结构。

## 5. 设计 / 实现亮点

- **悬停探测的性能三连**：pointerMove 本身极高频——用 `throttle(60fps)` 限频 + "命中缓存"短路（blockId/元素/锚三者不变即返回）+ `showDragHandleOnHoverBlock` 内对相同锚块复用 transition——把"每次移动都找最近块"降到最低成本，是交互型 widget 的典范。
- **padding 定位法**：不直接设 grabber 的 top，而是让容器铺满包围盒、用 `paddingTop/Bottom` 把 grabber 挤到首行中线。好处是容器同时承担"手柄 + 可抓取热区"，且 transition 作用在 padding 上时滑动平滑。
- **一个 widget、两套探测、一套拖放**：页面靠悬停、白板靠选区，两个 watcher 各司其职；但拖出/拖入的落库逻辑全收敛进 `DragEventWatcher`，避免页面/白板各写一遍拖放——分裂探测、统一落地。
- **拖放完全复用 std.dnd 与 store.Transformer**：拖拽基于 `@atlaskit/pragmatic-drag-and-drop`（经 std 的 `DndController` 封装），落库基于与复制粘贴同源的中间件链。widget 几乎不自造底层机制，只编排"块语义规则"。
- **白板坐标的 CSS scale 补偿**：浮层手柄要贴到用 CSS transform 缩放的白板块上，`hoveredElemArea` 显式 `/ viewScale * scale` 反算——这类"浮层对齐被变换元素"的几何细节处理得很到位。
- **跨 doc 拖入的依赖重建**：`buildContainerTree` 先分析 group/connector 的父子与端点引用，再按"容器后于子元素创建"的序合并快照，解决了"拖一个带连线的分组进别的文档"这种高阶场景。

## 6. 对外 API 与注意事项

- **主要导出**：`AffineDragHandleWidget`、`AFFINE_DRAG_HANDLE_WIDGET`、`dragHandleWidget`（ViewExtension 片段）、`DragHandleViewExtension`（`./view`）、`DragBlockPayload` 类型、以及 `utils.ts` 的一批几何工具（`getClosestBlockByPoint`/`getDropResult`/`containBlock`…）。
- **装配**：应用侧通过 `DragHandleViewExtension` 接入；它只注册到 `affine:page` scope，故只在 root 存在的编辑器里出现。
- **注意**：
  - 手柄只在**可编辑**且**非 database 表格**区域出现；只读、Android 外层可编辑关闭、surface-ref 内部等场景会主动 `hide`。
  - 白板模式**不支持多选拖柄**（选中多个图元时手柄隐藏），这是刻意设计（`edgeless-watcher.ts:30`）。
  - "同一文档内把 gfx 内容拖回白板空白处"被禁止（防原地重放，`drag-event-watcher.ts:504`）；跨 doc 才会真正搬运。
  - 拖拽进行中 `hide()` 不生效（除非 `force`），依赖 `onDrop`/`_cleanup` 收尾；若落点不属于本 `std` 会被 `_isDropOnCurrentEditor` 过滤。
  - 落库经 Transformer 中间件改写（换 id、修列表序号、改卡片样式），直接比对快照 id 可能与最终落库 id 不同。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`std.dnd`=`DndController`/选区/`UIEventDispatcher`，见 `blocksuite-std.md` §3.4/§3.6）、`@blocksuite/std/gfx`（白板图元模型与 `GfxController`）、`@blocksuite/store`（`Slice`/`Transformer`/`SliceSnapshot`）。
- 宿主：`@blocksuite/affine-block-root`（root 是本 widget 的挂载宿主，见 `blocksuite-affine-block-root.md` §3.6）、`@blocksuite/affine-block-note`（悬停探测的 note 边界）、`@blocksuite/affine-block-surface`（白板 CRUD 与 surface-ref）。
- 协作组件：`@blocksuite/affine-components` 的 `DropIndicator`（落点蓝线）。
- 对照阅读：同层其它 widget（`blocksuite-affine-widget-edgeless-selected-rect.md` 的手柄/变换几何、`blocksuite-affine-widget-edgeless-toolbar.md`）、`toeverything-infra.md`（signal/LiveData 响应式基础）。
