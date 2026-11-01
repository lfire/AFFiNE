# `@blocksuite/affine-gfx-note`

> 一句话定位：白板便签（`affine:note` 块）在 gfx 图形层的**工具/交互侧**——它不实现便签块本身（那在 `@blocksuite/affine-block-note`），只提供 edgeless 上"新建便签"的 `NoteTool`（点击落一个默认便签、拖拽画出指定大小的便签）、落笔前跟随鼠标的**幽灵预览 overlay**、以及工具栏里"便签要装什么首块"（文本/标题/列表/代码…）的菜单。要点是分清 **gfx-note（工具）** 与 **block-note（便签块实体）** 的边界：便签是一个 DOM 渲染的块容器，而非 canvas 图元。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/note`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 关键依赖  | `@blocksuite/std`（`BaseTool`/`GfxBlockElementModel`/`GfxControllerIdentifier`）、`@blocksuite/affine-block-surface`（`ToolOverlay`/`EdgelessCRUDIdentifier`/默认偏移常量）、`@blocksuite/affine-model`（`NoteBlockModel`/`NoteDisplayMode`/尺寸常量）、`@blocksuite/affine-rich-text`（`focusTextModel`）、`@blocksuite/affine-shared`（`EditPropsStore`/`NoteChildrenFlavour`）、`@blocksuite/affine-widget-edgeless-toolbar`、`@preact/signals-core`、`rxjs`、`lit` |
| 被谁依赖  | edgeless 预设（通过 `NoteViewExtension` 注册工具与工具栏）                                                                                                                                                                                                                                                                                                                                                                                                             |
| 对外入口  | `.`、`./view`（`NoteViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置：**只出工具，不出图元**

gfx 五件套是"模型 + 工具 + element-renderer + 交互扩展 + view 注册"。便签在这套范式里是个**特例**：它**只占"工具"一格**。本包没有 `ElementModel`、没有 element-renderer、没有 element-view、没有交互扩展——因为**便签不是画布原生图元（canvas element），而是一个 DOM 渲染的块（`affine:note`，`GfxBlockElementModel`）**。`NoteViewExtension`（`view.ts:18`）只注册了两样东西：`NoteTool`（新建工具）和 `noteSeniorTool`（工具栏按钮）。

这与同目录的 shape/text/connector 形成鲜明对比：那些包要管模型、渲染、交互全链路；而便签块的渲染、编辑、页面/白板双模式显示全部由 **`@blocksuite/affine-block-note`** 负责。gfx-note 只解决一个问题：**在白板上，怎么把一个便签块"放下去"**。

### 1.2 分工：gfx-note（放便签的手） vs block-note（便签本体）

- **`@blocksuite/affine-block-note`**：`NoteBlockModel`（含 `displayMode`、`edgeless.collapse` 折叠、背景色、阴影等 props）、便签块组件（DOM/富文本渲染）、页面模式与白板模式的显示逻辑、便签内子块的承载。
- **`@blocksuite/affine-gfx-note`（本包）**：edgeless 工具栏上的便签工具与菜单、点击/拖拽新建便签的交互、新建时"便签里默认塞哪个首块"的选择、新建后的聚焦与选中、以及落笔前的预览幽灵。

一句话：**本包负责"创建一个便签到白板"，便签长什么样、怎么编辑不归它管。**

## 2. 目录与关键文件

```text
note/src/
├── index.ts                      # 导出 note-tool / overlay / senior-tool
├── view.ts                       # NoteViewExtension：注册 NoteTool + noteSeniorTool
├── effects.ts                    # 注册自定义元素（菜单/面板/按钮）
├── note-tool.ts                  # ★NoteTool：点击/拖拽新建便签；addNote/addNoteAtPoint
├── overlay/
│   ├── overlay.ts                # ★NoteOverlay（跟随鼠标的幽灵）+ DraggingNoteOverlay（拖拽矩形预览）
│   └── consts.ts                 # 预览尺寸/圆角/配色常量
├── toolbar/
│   ├── senior-tool.ts            # noteSeniorTool：工具栏"Note"高级按钮
│   ├── note-menu-config.ts       # ★NOTE_MENU_ITEMS：便签首块候选（文本/标题/列表/代码/引用…）
│   ├── note-menu.ts / note-senior-button.ts / note-tool-button.ts
└── components/                   # 显示模式面板、阴影面板、图标

# 便签块本体不在本包：
#   blocksuite/affine/blocks/note —— NoteBlockModel + 便签块组件（DOM 渲染、双模式显示）
```

## 3. 实现细节

### 3.1 `NoteTool`：三种新建姿势

`NoteTool extends BaseTool<NoteToolOption>`（`note-tool.ts:43`，`toolName='affine:note'`，`activatedOption` 记 `childFlavour`/`childType`/`tip`——即"便签里默认装什么块"）：

- **点击 `click`**（`:119`）：在落点调 `addNote` 建一个 `DEFAULT_NOTE_WIDTH × DEFAULT_NOTE_HEIGHT` 的便签，`collapse:false`。
- **拖拽画**：`dragStart`（`:172`）建一个 `DraggingNoteOverlay`（拖拽矩形预览）；`dragMove`（`:166`）调 `_resize` 把拖拽区域实时喂给预览，**`shift` 锁正方形**（取宽高较大值，`:85-91`）；`dragEnd`（`:136`）按最终矩形建便签，且因是手动画大的，`collapse:true`——高度超 `NOTE_MIN_HEIGHT` 时把便签设为**折叠态**并记 `collapsedHeight`（`addNote` `:244-250`），即"画一个大框 = 一个带固定高度的折叠便签"。
- **幽灵预览**：`activate`（`:110`）建一个 `NoteOverlay` 跟随鼠标，`pointerMove` 更新位置并显形、`pointerOut` 隐藏（但鼠标移到其它便签/工具栏上时不隐藏，`EXCLUDING_MOUSE_OUT_CLASS_LIST` 判定，`:205-215`）。

### 3.2 `addNote`：建块 + 塞首块 + 聚焦

`addNote`（`:224`）是新建便签的完整流程：

1. `addNoteAtPoint`（`:278`）用 `EdgelessCRUDIdentifier.addBlock('affine:note', { xywh, displayMode: EdgelessOnly }, parentId)` 建便签块。注意 `displayMode: NoteDisplayMode.EdgelessOnly`（`:315`）——白板上新建的便签**默认只在白板显示、不出现在页面文档流**。落点用 `DEFAULT_NOTE_OFFSET_X/Y` 做偏移，让便签相对指针居中。
2. 往便签里 `doc.addBlock(childFlavour, { type: childType }, noteId)` 塞一个首块（`:239`）——这个 `childFlavour`/`childType` 就是工具栏菜单选的（文本/标题/列表…）。
3. 切回 `DefaultTool`，`requestAnimationFrame` 里等便签 DOM 就绪后 `selection.set({ editing:true })` 并 `focusTextModel(blockId)` **把光标落进首块**（`:254-274`）——新建即可打字，无需再点一下。

### 3.3 预览 overlay：两种幽灵

`overlay/overlay.ts` 有两个预览类，都继承 surface 的 `ToolOverlay`（画在 canvas overlay 层）：

- **`NoteOverlay`**（`:23`，点击模式用）：画一个**带文字标签的圆角矩形**幽灵——`quadraticCurveTo` 手绘圆角（`:65-97`），里面用 `fillText` 写便签将装的块名（如 "Text"/"Heading 1"）。还做了**字号自适应**：若文字超过便签宽度就循环减小 `fontSize`（`:113-116`）。它用 `effect` 订阅当前工具选项（`:33`），换菜单项时实时更新标签文字。
- **`DraggingNoteOverlay`**（`:122`，拖拽模式用）：只画一个 `roundRect` 半透明矩形（`globalAlpha=0.8`，`:151`），通过 rxjs `Subject` `draggingNoteUpdated` 接收拖拽尺寸并刷新（`:140-146`）——展示"你将画多大的便签"。

### 3.4 工具栏：便签首块菜单

`NOTE_MENU_ITEMS`（`toolbar/note-menu-config.ts:139`）定义了便签新建时可选的**首块类型**：由 `TEXT_ITEMS`（文本/H1–H6/代码/引用）与 `LIST_ITEMS`（无序/有序/待办）拼成，去掉分割线，映射为 `{ icon, tooltip, childFlavour, childType }`。用户在工具栏选"便签+待办列表"，`NoteTool.activatedOption` 就变成 `{ childFlavour:'affine:list', childType:'todo' }`，新建的便签里首块即一个待办项。`noteSeniorTool`（`senior-tool.ts:4`）把这套菜单挂成工具栏的 "Note" 高级按钮。

## 4. 语法特色

- **`BaseTool<Option>` 的选项泛型**：`NoteTool extends BaseTool<NoteToolOption>`，`activatedOption` 带 `childFlavour`/`childType`/`tip`，工具的"当前配置"类型安全。
- **`effect` 响应式预览**：`NoteOverlay` 用 `@preact/signals-core` 的 `effect` 订阅 `gfx.tool.currentTool$`，菜单项一变预览标签就变——signal 驱动 canvas 重绘。
- **rxjs `Subject` 做 overlay 通信**：`DraggingNoteOverlay.slots.draggingNoteUpdated` 用 `Subject<{xywh}>` 把工具的拖拽数据推给 overlay，解耦工具与渲染。
- **`requestAnimationFrame` 等 DOM**：便签是 DOM 块，建完要等下一帧 DOM 挂载后才能聚焦（`:254`）——异步 DOM 时序的常见处理。
- **`displayMode` 枚举**：`NoteDisplayMode.EdgelessOnly` 表达"只在白板显示"，便签的页面/白板双栖特性靠它控制。
- **`canvas` 手绘圆角 + 字号自适应**：`quadraticCurveTo` 画圆角矩形、`while` 循环缩字号——纯 canvas 的 UI 绘制技巧。
- **继承复用预览**：`DraggingNoteOverlay extends NoteOverlay`，复用背景色解析逻辑，只覆写 `render`。

## 5. 设计 / 实现亮点

- **工具与块实体彻底解耦**：gfx-note 只管"放便签"，block-note 管"便签是什么"——同一个便签块在页面模式和白板模式复用，gfx 层不重复实现渲染。
- **点击 vs 拖拽的语义区分**：点击 = 默认大小的普通便签；拖拽 = 指定大小的折叠便签——用一个工具表达两种意图。
- **新建即可编辑**：建块、塞首块、聚焦一气呵成，用户落点即打字，交互零摩擦。
- **预览幽灵的信息量**：点击预览带"将插入什么块"的文字标签且字号自适应，拖拽预览实时反映尺寸——落笔前所见即所得。
- **首块可配置**：工具栏菜单让"新便签默认装什么"可选（文本/标题/列表/代码/引用），一步到位创建带内容结构的便签。

## 6. 对外 API 与注意事项

- 主要导出：`NoteTool`（`NoteToolOption`）、`NoteOverlay`/`DraggingNoteOverlay`、`noteSeniorTool`、`NOTE_MENU_ITEMS`；`./view` 的 `NoteViewExtension`。
- **便签块本体不在本包**：`NoteBlockModel`、便签渲染、双模式显示在 `@blocksuite/affine-block-note`。要改便签外观/编辑行为去那里。
- **便签是块不是 canvas 图元**：它是 `GfxBlockElementModel`（`affine:note`），DOM 渲染，不经过 `ElementRenderer`；本包因此没有 element-renderer/element-view。
- **白板新建便签默认 `EdgelessOnly`**：不会自动出现在页面文档流，需显式改 `displayMode` 才双栖显示。
- **拖拽新建会折叠**：拖出的大便签是折叠态（记 `collapsedHeight`），与点击新建的普通便签行为不同。
- **首块由工具选项决定**：`activatedOption.childFlavour/childType` 控制新便签装什么首块，默认取工具栏当前选择。

## 7. 延伸

- 基础设施：`@blocksuite/std/gfx` 的 `BaseTool`/`GfxBlockElementModel`/`GfxControllerIdentifier`。
- 画布层：`@blocksuite/affine-block-surface` 的 `ToolOverlay`/`EdgelessCRUDIdentifier`/默认偏移常量。
- 便签本体：`@blocksuite/affine-block-note`（`NoteBlockModel` 与便签块组件，本包的"下游实体"）。
- 富文本：`@blocksuite/affine-rich-text` 的 `focusTextModel`（新建后聚焦首块）。
- 工具栏：`@blocksuite/affine-widget-edgeless-toolbar`（`SeniorToolExtension` 等）。
