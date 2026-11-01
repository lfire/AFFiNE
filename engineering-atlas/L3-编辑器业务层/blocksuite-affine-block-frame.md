# `@blocksuite/affine-block-frame`

> 一句话定位：AFFiNE 白板（edgeless）的**画框块**——一个把画布上一片区域框起来、对其中元素做**空间分组**、并作为**演示（presentation）单元**与**导出单元**的 GFX 块。它独有的核心是**基于包围盒的"归属判定"把自由散落的画布元素归入画框**、**`childElementIds` 记录分组成员**、**`presentationIndex` 用分数索引排演示顺序**、以及**全屏演示导航器**（逐帧播放、黑底遮罩、`fill`/`fit` 视口适配）。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/frame`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 所属层    | L3 · 编辑器业务层（内容块 · 白板专属）                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 语言/形态 | TypeScript / Lit 块包（GFX）                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 关键依赖  | `@blocksuite/affine-block-surface`（`Overlay`/`EdgelessClipboardConfig`/`DefaultTool`）、`@blocksuite/std/gfx`（`GfxBlockComponent`/`GfxExtension`/`BaseTool`/`GfxViewInteractionExtension`）、`@blocksuite/affine-model`（`FrameBlockModel`）、`@blocksuite/affine-widget-edgeless-toolbar`、`@blocksuite/affine-widget-frame-title`、`@blocksuite/affine-gfx-pointer`（`PanTool`）、`@blocksuite/global/gfx`（`Bound`/`Vec`）、`@preact/signals-core` |
| 被谁依赖  | 编辑器 edgeless 预设、`@affine/core`（白板/演示功能）                                                                                                                                                                                                                                                                                                                                                                                                   |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | frame 实现                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| schema                            | 复用 `affine-model` 的 `FrameBlockSchema`（`store.ts` 注册 `FrameBlockSchemaExtension`）；`parent: ['affine:surface']`、无 children（成员靠 `childElementIds` 弱引用） |
| model                             | `FrameBlockModel extends GfxCompatible(BlockModel)`，实现 `GfxGroupCompatibleInterface`（它是一种"组容器"）                                                            |
| `*-block.ts`                      | `frame-block.ts` → `FrameBlockComponent extends GfxBlockComponent` + `FrameBlockInteraction`（resize/rotate/select 交互）                                              |
| service/manager                   | `frame-manager.ts` → `EdgelessFrameManager`（`GfxExtension`）+ `FrameOverlay`（高亮层）                                                                                |
| tool                              | `frame-tool.ts` → `FrameTool`（拖拽画框）、`present-tool.ts` → `PresentTool`（演示导航器）                                                                             |
| widgets                           | `edgeless-toolbar/`（快捷工具、画框尺寸菜单、`presentation-toolbar`）、`present/`（黑底 widget、顺序菜单、设置按钮）                                                   |
| clipboard                         | `edgeless-clipboard-config.ts`（粘贴时重建画框并重映射成员 id）                                                                                                        |
| `effects.ts`/`view.ts`/`store.ts` | 注册 `affine-frame` 等元素 + `FrameViewExtension`/`FrameStoreExtension`                                                                                                |

与其它内容块最大的不同：**frame 只存在于 edgeless scope**。`view.ts` 的 `setup` 里除 `FrameBlockSpec` 外的一切（manager/tool/toolbar/present）都包在 `if (this.isEdgeless(context.scope))` 内——page 模式根本不装配。它也**不含 adapters**（画框是画布空间概念，无 markdown/纯文本对应物）。

### 画框块的独有问题

1. **空间分组而非树形分组**：普通块靠父子树归属；画框的"成员"是画布上**几何落在它范围内**的自由元素。要在元素新增/移动/画框缩放时**自动判定归属**，并把结果持久化到 `childElementIds`。
2. **弱引用成员**：成员元素的"真父"仍是 surface，画框只用 `childElementIds: Record<id, boolean>` 记录一层弱引用（删画框不删元素）。需兼容"旧版画框"（无 `childElementIds`，靠实时包围盒计算成员）。
3. **演示顺序**：画框是幻灯片，要可排序。用**分数索引 `presentationIndex`**（`generateKeyBetweenV2`）在任意两帧间插入新帧而不重排全体。
4. **全屏演示**：逐帧导航（←/→/Esc）、视口按 `fill`/`fit` 适配每帧、帧外黑色遮罩、全屏切换——一套"播放器"。
5. **GFX 渲染特化**：画框可能极大，CSS scale 会让 iOS Safari 崩溃——须**禁用 CSS transform**、把缩放并入渲染矩形计算。

## 2. 目录与关键文件

```text
src/
├── frame-block.ts            # ★FrameBlockComponent（GFX 渲染、禁用 CSS transform）+ FrameBlockInteraction（resize 时重算成员）
├── frame-manager.ts          # ★EdgelessFrameManager（归属判定/增删成员/演示排序）+ FrameOverlay（蓝色高亮层）
├── frame-tool.ts             # FrameTool：拖拽绘制画框
├── present-tool.ts           # PresentTool：'frameNavigator' 演示工具（仅 toolName）
├── frame-spec.ts             # BlockViewExtension(literal`affine-frame`) + Overlay + Manager + Interaction
├── frame-highlight-manager.ts# 拖拽元素到画框上时的高亮与归属（InteractivityExtension）
├── frame-toolbar.ts          # 选中画框时的工具栏
├── edgeless-toolbar/
│   ├── config.ts             # 画框预设尺寸（1:1 / 4:3 / 16:9 / 2:1）
│   ├── frame-menu.ts frame-tool-button.ts quick-tool.ts frame-dense-menu.ts
│   └── presentation-toolbar.ts # ★演示播放器：逐帧/全屏/fill-fit/快捷键
├── present/
│   ├── navigator-bg-widget.ts  # ★帧外黑色遮罩 widget
│   ├── frame-order-button.ts frame-order-menu.ts navigator-setting-button.ts present-button.ts
├── edgeless-clipboard-config.ts
└── index.ts view.ts store.ts effects.ts
```

## 3. 实现细节

### 3.1 ★模型：画框是"组容器"，成员是弱引用

`FrameBlockModel`（`model/src/blocks/frame/frame-model.ts:69-176`）通过 `GfxCompatible(BlockModel)` 混入并实现 `GfxGroupCompatibleInterface`，带上 `[gfxGroupCompatibleSymbol] = true`——系统因此把它当"组"对待。成员不是 BlockSuite 树的 children，而是：

```ts
export type FrameBlockProps = {
  title: Text;                               // 画框标题（富文本）
  background: Color;
  childElementIds?: Record<string, boolean>; // ★成员弱引用：id → true
  presentationIndex?: string;                // ★演示分数索引
  ...
} & GfxCompatibleProps;

get childIds() {
  return this.props.childElementIds ? Object.keys(this.props.childElementIds) : [];
}
addChildren(elements) {                      // transact 内合并写入 childElementIds
  ...
  this.store.transact(() => { this.props.childElementIds = { ...old, ...newChildren }; });
}
```

用 `Record<id, boolean>`（而非数组）存成员，**增删是幂等的键操作**，天然去重、协同友好。`childElements` getter 按 id 从 surface 实时取模型——成员的生命周期独立于画框。

### 3.2 ★归属判定：元素如何"落进"画框

`EdgelessFrameManager`（`frame-manager.ts:134-493`）是分组的大脑。构造时 `_watchElementAdded`（`:233-304`）订阅 surface 的 `elementAdded` 与 doc 的 `blockUpdated`，**在 `queueMicrotask` 里**判定归属——注释（`:244-259`）详解了为何必须延到微任务：连接线刚加入时包围盒还是 `[0,0,0,0]`（路径在另一个微任务里算），立即判定会落空。判定核心 `getFrameFromPoint`（`:440-448`）按演示顺序**从上往下**找第一个包含该点的画框：

```ts
getFrameFromPoint([x, y], ignoreFrames = []) {
  for (let i = this.frames.length - 1; i >= 0; i--) {
    const frame = this.frames[i];
    if (frame.includesPoint(x, y, {}) && !ignoreFrames.includes(frame)) return frame;
  }
  return null;
}
```

`getElementsInFrameBound`（`:428-435`）用 `gfx.grid.search(bound, { strict })` 做**空间索引查询**（而非遍历全部元素）取包围盒内元素。`getChildElementsInFrame`（`:410-422`）兼容两种画框：有 `childElementIds` 的按记录取；旧版画框（`undefined`）则实时用包围盒 + `getParentFrame` 推断——这是向后兼容的关键分叉。

### 3.3 ★缩放画框时实时重算成员

`FrameBlockInteraction`（`frame-block.ts:126-208`）用 `GfxViewInteractionExtension` 定制 resize/rotate/select：

- `onResizeMove`（`:139-168`）：画框一边缩放，一边 `removeAllChildrenFromFrame` + 重新 `addElementsToFrame`——新成员 = 新包围盒内的顶层元素 ∪ 仍与新框相交的旧成员。配合 overlay 实时高亮。`onResizeStart`/`End` 用 `model.stash('childElementIds')` / `pop` 把整段缩放**合并成一次 undo**。
- `handleRotate`：`rotatable: false`——画框**不可旋转**（旋转的画框作为幻灯片无意义）。
- `selectable`（`:186-201`）：透明背景的画框**只有点在标题或边框上才可选中**（否则点击穿透到画框内元素），非透明则整体可选——符合"画框是背景容器"的直觉。

### 3.4 ★演示顺序：分数索引

画框作为幻灯片需要稳定可插入的顺序。`presentationIndex` 默认 `generateKeyBetweenV2(null, null)`，新建帧时 `generatePresentationIndex`（`:398-403`）取当前最后一帧的索引、在其后生成新 key。`framePresentationComparator`（`:156-197`）是排序比较器，还**兼容旧版帧**（无 `presentationIndex`、靠 `index`）——有分数索引的排前、按字符串比较，旧帧 fallback 到 `index`。`refreshLegacyFrameOrder`（`:459-476`）把旧帧批量补齐分数索引、保持原顺序。

> 分数索引（fractional index）让"在 A、B 两帧间插入 C"只需生成一个介于二者之间的字符串，无需移动其它帧——协同场景下避免大范围写冲突。

### 3.5 ★全屏演示播放器

`PresentTool`（`present-tool.ts`）只是一个 `toolName = 'frameNavigator'` 的标记工具，真正的播放逻辑在 `PresentationToolbar`（`edgeless-toolbar/presentation-toolbar.ts`）：

- **逐帧导航**：`_nextFrame`/`_previousFrame`（`:244-264`）用 `clamp` 夹住索引、到头 toast 提示；`_bindHotKey`（`:157-174`）把 ←/→/Esc 绑成全局热键（仅当 `toolType === PresentTool` 时生效）。
- **视口适配**：`_moveToCurrentFrame`（`:195-242`）按 `_navigatorMode` 决定 `fill`（裁剪填满视口）或 `fit`（完整显示），`viewport.setViewportByBound` 平移缩放到当前帧，并 `navigatorFrameChanged.next` 通知其它 widget。
- **全屏**：`_toggleFullScreen`（`:271-282`）进出浏览器全屏；进入演示时自动全屏（`:300-304`），Esc 退出时 `_exitPresentation`（`:176-193`）恢复 DefaultTool/PanTool 并退全屏。
- **无帧守卫**：进入演示时若 `_frames.length === 0`，toast 提示"至少需要 1 个画框"，并用 `EditPropsStore` 存 `presentNoFrameToastShown` 防重复打扰。

**帧外黑底**：`EdgelessNavigatorBlackBackgroundWidget`（`present/navigator-bg-widget.ts`）用一个 `box-shadow: 0 0 0 5000px black` 的 div 把当前帧以外全部压黑（`:16-26`）；`effect` 监听 `currentToolName$`，仅演示态且开关开启时显示，`navigatorFrameChanged` 来时按当前帧视口坐标重新定位。

### 3.6 ★高亮 overlay 与拖拽归属

`FrameOverlay`（`frame-manager.ts:31-129`）是画在 canvas 上的高亮层（`Overlay` 子类），`render`（`:108-128`）用 `#1E96EB` 描边画框轮廓与内部元素（线宽按 `1/zoom` 保持视觉恒定）。`highlight` 做了 `areSetsEqual` 脏检查，成员集未变就不 refresh，省重绘。`FrameHighlightManager`（`frame-highlight-manager.ts`）接入 `onDragInitialize`：拖元素悬停到某画框上就高亮该框，`onDragEnd` 时若悬停在画框上则 `addElementsToFrame`，否则 `removeFromParentFrame`——拖入拖出即改变分组。

### 3.7 绘制工具与导出/粘贴

`FrameTool`（`frame-tool.ts`）在 `dragMove` 里首次拖拽超过 8px 阈值时 `addBlock('affine:frame', ...)`，标题默认 `Frame N`（`:76`），`stash('xywh')` 让拖拽过程合并为一次 undo；`dragEnd`（`:41-60`）`pop('xywh')` 并把框内顶层元素收编。`EdgelessClipboardFrameConfig`（`edgeless-clipboard-config.ts`）在复制粘贴画框时，用 `oldToNewIdMap` **重映射成员 id**、`newPresentationIndexes` 分配新演示序，保证粘贴出的画框仍正确持有（新的）成员并排进演示序列。预设尺寸见 `config.ts`（1:1 / 4:3 / 16:9 / 2:1，用于"按比例新建画框"及导出图片的目标画幅）。

## 4. 语法特色

- **混入 + 接口实现**：`class FrameBlockModel extends GfxCompatible<FrameBlockProps>(BlockModel) implements GfxElementGeometry, GfxGroupCompatibleInterface`——`GfxCompatible(Base)` 是**混入工厂**，给普通 `BlockModel` 叠加 GFX 几何能力；再 `implements` 声明它是"组"，并用 `[gfxGroupCompatibleSymbol] = true as const` 这个**唯一 symbol 字段**做运行时品牌标记。
- **`GfxExtension` / `BaseTool` / `InteractivityExtension` 子类化**：manager、tool、highlight 分别继承 std/gfx 的不同扩展基类，经 `static key`/`static toolName` 注册——扩展即类。
- **`GfxViewInteractionExtension(flavour, { handleResize, handleRotate, handleSelection })`**：以**回调工厂**定制一个 flavour 的交互，`context.default(context)` 调用默认行为再叠加自定义——装饰器式的交互扩展。
- **`model.stash(key)` / `model.pop(key)`**：把一段连续修改（拖拽/缩放）暂存，结束时一次性提交，合并 undo 粒度。
- **`queueMicrotask` 时序控制**：归属判定延到微任务，等连接线包围盒算完——注释明确记录了"为什么"（`:244-259`）。
- **`Record<id, boolean>` 做集合**：成员用对象键存储，增删幂等、协同无冲突；`childIds` 用 `Object.keys` 导出。
- **`effect()` 响应式 widget**：黑底/演示工具栏用 `@preact/signals-core` 的 `effect` 跟踪 `currentToolName$`/`currentToolOption$`。
- **`literal` / `unsafeStatic`**：`BlockViewExtension(flavour, literal`affine-frame`)`、`WidgetViewExtension(..., literal`${unsafeStatic(TAG)}`)` 运行期注入标签名。

## 5. 设计 / 实现亮点

- **空间分组 + 弱引用成员**：画框不改变元素的树形归属，只用 `childElementIds` 记一层弱引用，删框不删元素；归属全靠几何包围盒 + 空间索引实时判定——把"自由画布"与"结构化分组"优雅调和。
- **微任务时序处理连接线**：对"元素刚加入时包围盒未就绪"这一隐蔽时序问题，用 `queueMicrotask` 统一延后并留下详尽注释，是工程严谨性的范例。
- **分数索引排演示序**：`presentationIndex` 让任意插帧 O(1)、无全体重排，且协同友好；比较器还向后兼容旧版 `index` 帧。
- **缩放实时重算成员 + 合并 undo**：resize 过程持续重算归属并高亮，`stash`/`pop` 把整段操作收敛成一次可撤销步骤。
- **完整的演示播放器**：逐帧/全屏/fill-fit/黑底遮罩/快捷键/无帧守卫，几乎是一个独立子应用，却完全由 widget + tool + EditPropsStore 组合而成。
- **GFX 渲染防崩**：`getCSSTransform()` 返回空串、把缩放并入 `getRenderingRect`，规避 iOS Safari 大尺寸 CSS scale 崩溃——真实设备踩坑的沉淀。

## 6. 对外 API 与注意事项

- 主要导出：`FrameBlockComponent`、`FrameBlockInteraction`、`EdgelessFrameManager`/`EdgelessFrameManagerIdentifier`、`FrameOverlay`、`FrameTool`、`PresentTool`、`FrameBlockSpec`、工具栏/演示相关扩展；装配入口 `FrameViewExtension`（`./view`）、`FrameStoreExtension`（`./store`）。
- **约定**：取画框管理器用 `std.get(EdgelessFrameManagerIdentifier)`；新建画框走 `createFrameOnBound`/`createFrameOnElements`/`createFrameOnSelected`；演示顺序用 `generatePresentationIndex`。
- **注意**：
  - 画框**仅在 edgeless scope** 装配，page 模式无此块，也无 adapters（不参与 markdown/纯文本序列化）。
  - 成员是弱引用（`childElementIds`），删画框不删成员；旧版画框无此字段，成员靠实时包围盒推断。
  - 透明背景画框只有标题/边框可点选，整体点击会穿透到内部元素。
  - 画框不可旋转（`rotatable: false`）。
  - 演示依赖至少一个画框；视口 `fill` 会裁剪、`fit` 会留白。
  - 归属判定在微任务里完成，刚加入的元素（尤其连接线）不要期望同步归属。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`FrameBlockModel`/`FrameBlockSchema`）、`@blocksuite/std/gfx`（`GfxBlockComponent`/`GfxExtension`/`BaseTool`/`GfxViewInteractionExtension`/`grid`）、`@blocksuite/global/gfx`（`Bound`/`Vec`/`generateKeyBetweenV2`）。
- 同层协作：`@blocksuite/affine-block-surface`（`Overlay`/`EdgelessClipboardConfig`/`DefaultTool`）、`@blocksuite/affine-widget-edgeless-toolbar`（工具栏 mixin）、`@blocksuite/affine-widget-frame-title`（画框标题编辑）、`@blocksuite/affine-gfx-pointer`（`PanTool`）、`@blocksuite/affine-shared`（`EditPropsStore`/`ThemeProvider`/`ViewportElementProvider`）。
- 相关文档：`blocksuite-affine-block-surface.md`（画布/overlay/剪贴板）、`blocksuite-std.md`（GFX 模型/工具/交互扩展）、`blocksuite-affine-model.md`（schema/GfxCompatible）。
</content>
