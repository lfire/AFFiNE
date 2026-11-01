# `@blocksuite/affine-widget-note-slicer`

> 一句话定位：白板上选中一张便签（note）时，在其**内部相邻子块之间**浮现的那条虚线分割线 + 一把"剪刀"按钮——鼠标移到哪条缝、剪刀就吸附到哪条缝，点一下就把便签从该处"剪断"：下半部分的子块被搬进一张**新建的便签**里。它是白板专属的便签切分交互 widget。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/note-slicer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 语言/形态 | TypeScript / Lit widget 包（单文件核心）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`std.event`）、`@blocksuite/std/gfx`（`GfxControllerIdentifier`/`gfx.selection`/`viewport`）、`@blocksuite/affine-block-surface`（`isNoteBlock`/`getSurfaceComponent`/`EdgelessLegacySlotIdentifier`）、`@blocksuite/affine-block-note`（`NoteBlockComponent`）、`@blocksuite/affine-widget-edgeless-selected-rect`（联动选中框）、`@blocksuite/affine-model`（`NoteBlockModel`/`DEFAULT_NOTE_HEIGHT`）、`@blocksuite/global`（`Point`/`serializeXYWH`/`DisposableGroup`）、`@blocksuite/icons`（`ScissorsIcon`）、`lit` |
| 被谁依赖  | 编辑器预设（通过 `NoteSlicerViewExtension` 注册，仅白板 scope）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 对外入口  | `.`、`./view`（`NoteSlicerViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

标准白板 widget：`NoteSlicer extends WidgetComponent<RootBlockModel>`（`note-slicer.ts:103`）承载 Shadow DOM 样式（剪刀按钮 + 虚线容器）；`noteSlicerWidget = WidgetViewExtension('affine:page', NOTE_SLICER_WIDGET, …)`（`:447`）注册到 root；`NoteSlicerViewExtension`（`view.ts`）**仅 `this.isEdgeless(context.scope)` 时注册**（`view.ts:19`）——切分只在白板有意义。它监听的 host 状态是 `gfx.selection`（当前选中的图元）与 `std.event` 的 `pointerMove`/`click`。

### note-slicer 独有的问题

"把一张便签剪成两张"看似简单，难点全在交互与几何：

- **切缝探测**（独有之一）：便签内部每两个相邻子块之间都是一条潜在切缝，但只有**当前视口内可见**的缝才该画。widget 要为每条可见缝算出一个屏幕坐标的 `Point`，并在鼠标移动时判断"现在最接近哪条缝"从而高亮它、把剪刀吸过去。
- **切分算法**（独有之二）：点击剪刀后，要以该缝为界，把下半部分子块整体 `moveBlocks` 到一张**新建便签**里；新便签要继承原便签的背景/显示模式/edgeless 属性，并落在原便签下方一个固定间距处，且新便签在文档树里的 index 要紧跟原便签。
- **出现时机**（独有之三）：切分功能默认关闭，由工具栏的"切分"开关（`toggleNoteSlicer` slot）切换；且选区变化、视口平移缩放、滚轮、正在 resize 便签时都要**临时隐藏**，避免切缝位置过时或与变换操作冲突。
- **与选中框联动**（独有之四）：开启切分时要关掉 `edgeless-selected-rect` 的自动补全（autoComplete），避免两个浮层功能打架。

## 2. 目录与关键文件

```text
src/
├── note-slicer.ts   # ★NoteSlicer：切缝探测、剪刀吸附、_sliceNote 切分、render；末尾导出 WidgetViewExtension
├── index.ts         # re-export
├── view.ts          # NoteSlicerViewExtension：仅 edgeless scope 注册
└── effects.ts       # customElements.define('note-slicer', NoteSlicer)
```

## 3. 实现细节

### 3.1 锚定便签：选中单个 note 才激活

`_updateSlicedNote`（`note-slicer.ts:256`）定义了"对哪张便签可切分"：`gfx.selection` **非编辑态、恰好选中 1 个元素、且 `isNoteBlock`** 时，把它设为 `_anchorNote`（`@state`），否则清空（`:259-267`）。它在 `gfx.selection.slots.updated` 里被调用（`:308`），同时每次选区变化都把 `_enableNoteSlicer` 复位为 `false`——即换一张便签要重新开启切分开关。

切分开关由白板工具栏驱动：订阅 `EdgelessLegacySlotIdentifier` 的 `toggleNoteSlicer` slot（`:319`），每次翻转 `_enableNoteSlicer`；开启时把 `selectedRectEle.autoCompleteOff = true`（`:323`）关掉选中框的自动补全，避免浮层冲突。`selectedRectEle` 通过 `host.view.getWidget('edgeless-selected-rect', host.id)` 拿到同一宿主上的**兄弟 widget**（`:146`）——widget 之间通过 `view.getWidget` 互相引用的范例。

### 3.2 ★切缝几何：`_updateDivingLineAndBlockIds`

这是切缝探测的核心（`:224`）。它遍历锚定便签的子块（到倒数第二个为止，最后一块后面不该有缝），为每条缝算位置：

```ts
const noteRect = this._noteBlock.getBoundingClientRect();
for (let i = 0; i < this._anchorNote.children.length - 1; i++) {
  const child = this._anchorNote.children[i];
  const rect = this.host.view.getBlock(child.id)?.getBoundingClientRect();
  if (rect && rect.bottom > noteTop && rect.bottom < noteBottom) {
    // ① 只取落在便签可见范围内的缝
    const x = rect.x - this._viewportOffset.left;
    const y =
      rect.bottom +
      DIVIDING_LINE_OFFSET * this._zoom -
      this._viewportOffset.top; // ② 缝在子块底边略下方
    divingLinePositions.push(new Point(x, y));
    noteBlockIds.push(child.id); // ③ 记录缝对应的"上方那块"id
  }
}
```

三点要义：① 用 `rect.bottom > noteTop && < noteBottom` 过滤掉被便签裁剪掉、视口外不可见的缝；② 缝的 y 取子块底边 + `DIVIDING_LINE_OFFSET(4) * zoom`，缩放时偏移也随之缩放；③ `_noteBlockIds[i]` 与 `_divingLinePositions[i]` **一一对应**——缝 i 的含义是"从 `noteBlockIds[i]` 这块之后切开"。坐标统一减去 `_viewportOffset`（`viewport.left/top`）换算到 widget 容器系。

### 3.3 ★剪刀吸附：`_updateActiveSlicerIndex`

鼠标移动时（`std.event.add('pointerMove')`，`:291`）调 `_updateActiveSlicerIndex`（`:206`）决定高亮哪条缝。它用**相邻缝中点**作为判定边界：

```ts
const curY = pos.y + DIVIDING_LINE_OFFSET * this._zoom;
let index = -1;
for (let i = 0; i < _divingLinePositions.length; i++) {
  const currentY = _divingLinePositions[i].y;
  const previousY = i > 0 ? _divingLinePositions[i - 1].y : 0;
  const midY = (currentY + previousY) / 2;
  if (curY < midY) break; // 鼠标在"缝 i 与前一条缝的中点"之上 → 选前一条
  index++;
}
this._activeSlicerIndex = index < 0 ? 0 : index;
```

即把 y 轴按缝的中点切成区段，鼠标落在哪段就吸附哪条缝——这样剪刀会"就近跳"到最靠近鼠标的缝，而不是只在精确压线时才响应。`_activeSlicerIndex` 是 `@state`，变化即触发重渲让剪刀与高亮缝刷新。

### 3.4 ★切分算法：`_sliceNote`

点击剪刀（`std.event.add('click')` 命中 `target.closest('note-slicer')`，`:333`）触发 `_sliceNote`（`:153`）。步骤：

1. 取锚定便签的 `index/xywh/background/displayMode/edgeless` 等属性，并从 `edgeless` 里**剔除 `collapse`/`collapsedHeight`**（`:167-171`）——新便签不继承折叠态。
2. 按 `_activeSlicerIndex` 定位切缝对应的 `anchorBlockId`，在 children 里找到它的下标 `sliceIndex`，`resetBlocks = children.slice(sliceIndex + 1)`——即**该块之后的所有子块**都要搬走（`:172-175`）。
3. 计算新便签的 y：切缝的屏幕 y（`_divingLinePositions[idx].y`）经 `viewport.toModelCoord` 转回模型坐标，再加 `NEW_NOTE_GAP(40)` 间距（`:177-185`）；x/width 沿用原便签，高度用 `DEFAULT_NOTE_HEIGHT`。
4. `store.addBlock('affine:note', {…}, root.id, originalNoteIndex + 1)` 新建便签，index 为 `originalIndex + 1`、在文档树里紧跟原便签（`:180-191`）。
5. `doc.moveBlocks(resetBlocks, 新便签)` 把下半部分整体搬入新便签（`:193`）；复位 `_activeSlicerIndex = 0`，并把 `gfx.selection` 设为选中新便签（`:195-199`）。
6. `TelemetryProvider.track('SplitNote', { control: 'NoteSlicer' })` 埋点（`:201`）。

`moveBlocks` 是 store 层的原子操作，保证子块从原便签迁出、迁入新便签这一过程作为一致的文档变更（可被 undo 为一步）。

### 3.5 隐藏与重渲时机

`render()`（`:365`）的门禁很严：只读 / `_hidden` / `_isResizing` / 无锚定便签 / 未开启切分——任一命中即 `nothing`（`:366-374`）。`_hidden` 由**视口更新**（`viewport.viewportUpdated`，`:301`）和**滚轮**（`uiEventDispatcher.add('wheel')`，`:357`）置真——因为视口一动，之前算的屏幕坐标切缝就过时了，先藏起来，等下一次 `pointerMove` 再 `_hidden = false` 并重算（`:292`）。`_isResizing` 由 `EdgelessLegacySlot` 的 `elementResizeStart/End` 驱动（`:279`）——拖拽改便签大小时不画切缝。

`updated()`（`:416`）在 `_anchorNote` 变化时重建一个 `DisposableGroup`，订阅该便签的 `propsUpdated`，仅当 `children` 或 `xywh` 变化才 `requestUpdate`（`:424-428`）——便签内容增删或移动位置时切缝要重算，但其它属性（如背景色）变化无需重绘。

## 4. 语法特色

- **`@state() accessor` 私有响应式字段**：`_activeSlicerIndex`/`_anchorNote`/`_enableNoteSlicer`/`_isResizing`（`:434-444`）用标准装饰器 + `accessor` 声明，任一变化自动触发 `render`——交互状态机全建立在 Lit 响应式字段上。
- **非响应式几何缓存用普通字段**：`_divingLinePositions`/`_noteBlockIds` 是普通私有数组（`:106`/`:110`），因为它们是"渲染时现算"的派生数据（`render` 里先调 `_updateDivingLineAndBlockIds`，`:376`），不需要触发额外重渲——哪些状态进 `@state`、哪些不进，分寸清晰。
- **`std.event.add(name, handler)` 语义事件订阅**：`pointerMove`/`click` 通过 UIEventDispatcher 订阅（`:292`/`:333`），而非直接 `addEventListener`——走编辑器统一事件分发，能与选区/其它 widget 正确协同。
- **跨 widget 引用 `host.view.getWidget(tag, hostId)`**：`selectedRectEle`（`:146`）在运行时按标签取同宿主的另一个 widget 实例，用 `as EdgelessSelectedRectWidget` 收窄类型——widget 间协作的标准手法。
- **对象解构 + 剩余属性剔除**：`const { collapse: _, collapsedHeight: __, ...restOfEdgeless } = edgeless`（`:168`）用解构把两个不想要的字段"吸走"、其余收进 `restOfEdgeless`——比手动 delete 更声明式。
- **`serializeXYWH`/`deserializeXYWH`/`toModelCoord`**：白板坐标在"字符串 xywh ↔ 数组 ↔ 模型/视口坐标"间转换（`:176`/`:179`/`:185`），体现 gfx 坐标体系的标准 API。
- **`DisposableGroup` 嵌套管理**：除基类 `disposables` 外，为"随锚定便签生灭"的订阅单独开一个 `_noteDisposables`，换便签时整组 `dispose` 重建（`:419-423`）——按生命周期分组清理，防泄漏。

## 5. 设计 / 实现亮点

- **"中点吸附"的交互手感**：不要求鼠标精确压在缝上，而是把 y 轴按相邻缝中点分段，鼠标在哪段剪刀就跳到哪条缝——用极简的中点比较实现了"就近磁吸"，手感自然。
- **视口一动先藏后算**：所有屏幕坐标切缝在视口变化时即时 `_hidden`，等下次指针移动再重算——避免了"缩放后切缝还停在旧位置"的错位，用"先隐藏"这一廉价策略回避了持续重算的成本。
- **切分复用 store 原子操作**：新建便签 + `moveBlocks` 搬子块，全走 store 层 API，天然获得撤销/协作一致性；widget 只负责"算出切点、继承哪些属性、落在哪"，不碰底层数据搬运。
- **属性继承的分寸**：新便签继承背景/显示模式/edgeless 布局，但剔除折叠态、用默认高度、落在下方固定间距——对"切出来的便签应该长什么样"做了合理的产品决策。
- **widget 间显式协作**：开启切分即关闭选中框的 autoComplete，用 `getWidget` 直接拿到兄弟 widget 操作其状态——同宿主多 widget 共存时避免浮层互相干扰的务实做法。

## 6. 对外 API 与注意事项

- **主要导出**：`NoteSlicer`、`NOTE_SLICER_WIDGET`（标签名 `note-slicer`）、`noteSlicerWidget`（ViewExtension 片段）、`NoteSlicerViewExtension`（`./view`）。
- **装配**：通过 `NoteSlicerViewExtension` 接入，**仅白板 scope** 注册（`view.ts:19`）；页面模式不存在便签切分。
- **注意**：
  - 切分功能默认关闭，须由工具栏的 `toggleNoteSlicer` slot 开启；且每次选区变化都会把它复位关闭（`:310`）。
  - 只对"非编辑态、恰好选中单张 note"的情形出现（`:259`）；多选、编辑中、选中非便签元素都不显示。
  - 切缝只覆盖**视口内可见**的相邻子块缝（`:241`），便签被裁剪掉的部分不画缝；最后一个子块后面没有缝。
  - 视口平移/缩放/滚轮、正在 resize 便签时切缝会隐藏（`_hidden`/`_isResizing`），属预期——需移动鼠标重新触发。
  - 新便签落在原便签下方 `NEW_NOTE_GAP(40)` 处、高度为 `DEFAULT_NOTE_HEIGHT`，不继承折叠态——这是固定的产品行为，非可配置项。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`std.event`/`WidgetViewExtension`）、`@blocksuite/std/gfx`（`gfx.selection`/`viewport`/坐标换算）、`@blocksuite/store`（`addBlock`/`moveBlocks` 原子操作）。
- 白板宿主：`@blocksuite/affine-block-surface`（`isNoteBlock`/`getSurfaceComponent`/`EdgelessLegacySlotIdentifier` 的 `toggleNoteSlicer`/`elementResize*` slot）、`@blocksuite/affine-block-note`（`NoteBlockComponent`）。
- 协作 widget：`@blocksuite/affine-widget-edgeless-selected-rect`（切分开启时联动关闭 autoComplete）。
- 对照阅读：`blocksuite-affine-widget-edgeless-dragging-area.md`（白板纯渲染 widget 的职责切分）、`blocksuite-affine-widget-drag-handle.md`（白板坐标/视口补偿、widget 间协作）、`toeverything-infra.md`（signal 响应式）。
</content>
