# `@blocksuite/affine-block-table`

> 一句话定位：AFFiNE 的**原生表格块**——一个轻量、所见即所得的表格（区别于功能重、面向结构化数据的 `affine:database`）。它独有的核心是**用三张扁平 Record（`rows`/`columns`/`cells`）而非嵌套树来建模表格**、**每个单元格是一段可富文本编辑的 `Y.Text`**、**一套独立于块选区的表格区域/行/列选择系统**，以及**行列的拖拽排序、宽度调整、虚拟行列（添加预览）**。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/table`                                                                                                                                                                                                                                                                                                                                                                           |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                                                                                                                                                |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                                      |
| 关键依赖  | `@blocksuite/std`（`CaptionedBlockComponent`/`KeymapExtension`/inline 常量）、`@blocksuite/store`（`BaseSelection`/`SelectionExtension`/`Text`/`nanoid`）、`@blocksuite/affine-model`（`TableBlockModel`）、`@blocksuite/affine-rich-text`（`RichText`）、`@blocksuite/affine-inline-preset`（`textKeymap`）、`@blocksuite/affine-components`（caption）、`@floating-ui/dom`、`@emotion/css`、`zod`、`lit` |
| 被谁依赖  | 编辑器预设、`@affine/core`                                                                                                                                                                                                                                                                                                                                                                                 |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                                                                                   |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | table 实现                                                                                                                                                                              | 独有之处                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| schema/model                      | 复用 `affine-model` 的 `TableBlockSchema`/`TableBlockModel`（props：`rows`/`columns`/`cells` 三张 Record + `textAlign`，`role:'content'`，`parent:['affine:note']`，`isFlatData:true`） | 扁平数据建模，见 3.1                         |
| `*-block.ts`                      | `table-block.ts`→`TableBlockComponent`（渲染 `<table>`，组合 cell/add-button/selection-layer）                                                                                          | 用原生 `<table>`/`<tr>`/`<td>`               |
| 子组件                            | `table-cell.ts`→`TableCell`、`add-button.ts`→`AddButton`、`selection-layer.ts`→`SelectionLayer`                                                                                         | cell 是独立自定义元素                        |
| 数据层                            | `table-data-manager.ts`→`TableDataManager`（增删行列/排序/染色/宽度/虚拟行列）                                                                                                          | ★把所有写操作封装成方法                      |
| 选择系统                          | `selection-schema.ts`→`TableSelection`（area/row/column）、`selection-controller.ts`→`SelectionController`                                                                              | ★独立于 BlockSelection 的三态选区            |
| service                           | 无                                                                                                                                                                                      | 用 `ReactiveController` + `TableDataManager` |
| inline                            | 复用共享 `inlineManager`（cell 内富文本）                                                                                                                                               | 每格一个 rich-text                           |
| keymap                            | `table-keymap.ts`→复用 `textKeymap` + cell 内 Tab/Enter                                                                                                                                 | 单元格导航                                   |
| commands                          | `commands.ts`                                                                                                                                                                           | —                                            |
| widgets/configs                   | `configs/`：slash-menu                                                                                                                                                                  | —                                            |
| adapters                          | `adapters/`：html/markdown/plain-text/notion（表格↔`<table>`/GFM table）                                                                                                                | 扁平数据↔二维表                              |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define`（4 个元素）+ `TableViewExtension`/`TableStoreExtension`（注册 `TableSelectionExtension`）                                                                       | store 额外注册选区类型                       |

### 表格块的独有问题

1. **怎么建模一张表**：不用"行是数组、行里套单元格数组"的嵌套树，而用三张扁平 Record——`rows`/`columns` 各存元数据（含 fractional order），`cells` 以 `"rowId:columnId"` 为键存单元格。好处是行列增删、排序、单元格定位都变成 O(1) 的键操作，且对协同（Yjs）友好（`isFlatData:true`）。
2. **单元格要能富文本编辑**：每格是一段独立 `Y.Text`，渲染成一个 `<rich-text>`——于是表格里能加粗、链接、内联公式，与段落一致。
3. **三态选区**：表格需要"选一个矩形区域""选整行""选整列"三种选择，且要与编辑器全局的块选区/文本选区共存——这需要一个自定义的 `TableSelection` 类型与专门的 `SelectionController`。
4. **直接操作手感**：拖拽行/列重排、拖动边界调列宽、悬停时出现"加一行/一列"按钮、拖动中显示虚拟行列预览——全套电子表格式交互。
5. **与原生 selection 的边界**：表格用原生 `<table>` DOM，浏览器的原生文本选择可能跨出表格；需要检测"外部原生选择"并临时禁用单元格可编辑，避免选择错乱。

## 2. 目录与关键文件

```text
src/
├── table-block.ts          # ★TableBlockComponent：渲染 <table>，装配坐标测量函数
├── table-cell.ts           # ★TableCell：单元格，内含 rich-text + 行列操作菜单 + Tab/Enter 导航
├── table-data-manager.ts   # ★TableDataManager：所有数据写操作（增删/排序/染色/宽度/虚拟行列）
├── selection-schema.ts     # ★TableSelection + TableSelectionData（area/row/column）
├── selection-controller.ts # ★SelectionController：拖拽框选/行列拖拽/调宽/复制粘贴
├── selection-layer.ts      # SelectionLayer：绘制选区高亮覆盖层
├── add-button.ts           # AddButton：加行/加列按钮
├── table-keymap.ts         # 复用 textKeymap
├── color.ts commands.ts consts.ts utils.ts
├── configs/                # slash-menu
├── adapters/               # html/markdown/plain-text/notion 序列化
├── view.ts store.ts effects.ts index.ts
```

## 3. 实现细节

### 3.1 ★扁平数据模型：三张 Record

`TableBlockModel`（`model/src/blocks/table/table-model.ts`）是空类，表格的全部结构在 props 里，用三张扁平 Record 表达：

```ts
export interface TableRow {
  rowId: string;
  order: string;
  backgroundColor?: string;
}
export interface TableColumn {
  columnId: string;
  order: string;
  backgroundColor?: string;
  width?: number;
}
export type TableCell = { text: Text };
export interface TableBlockProps extends BlockMeta {
  rows: Record<string, TableRow>;
  columns: Record<string, TableColumn>;
  cells: Record<string, TableCell>; // key = `${rowId}:${columnId}`
  textAlign?: TextAlign;
}
// metadata: { isFlatData: true, role: 'content', parent: ['affine:note'], children: [] }
```

- **行列无序存储、靠 `order` 排序**：`rows`/`columns` 是无序 Record，渲染时按 `order`（fractional indexing 字符串）排序。这让"在中间插入一行"无需移动其它行——只需在相邻两个 order 之间生成一个新 order（`generateFractionalIndexingKeyBetween`）。
- **cell 用复合键定位**：`cells["rowId:columnId"]`——删行就删所有 `startsWith(rowId)` 的键、删列就删所有 `endsWith(":columnId")` 的键（见 `TableDataManager.deleteRow/deleteColumn`）。
- **`isFlatData: true`**：告诉 store 这个块的 props 是扁平数据（而非嵌套块树），影响协同存储与 diff 粒度。
- 单元格 `text` 是 `Y.Text`——可协同、可富文本。

### 3.2 ★TableDataManager：所有写操作的唯一入口

`TableDataManager`（`table-data-manager.ts`）把对三张 Record 的所有修改封装成方法，每个都裹在 `this.model.store.transact(() => …)` 里（保证原子性与协同一致）。它同时用 `computed` 暴露派生只读信号：

- **派生信号**：`rows$`/`columns$`（Object.values 后按 order 排序）、`uiRows$`/`uiColumns$`（叠加虚拟行列，见 3.5）、`readonly$`、`cellCountTips$`。
- **结构写操作**：`addRow(after?)`/`addColumn(after?)`——用 `getOrder` 在指定位置生成 fractional order、`nanoid()` 生成 id，并为新行/列的每个交叉点补建空 `cells`。`addNRow(count)`/`addNColumn(count)` 支持批量（负数即删除末尾）。
- **删除**：`deleteRow`/`deleteColumn` 按复合键前缀/后缀清理 `cells`。
- **排序**：`moveRow`/`moveColumn(from, after?)` 只改目标行/列的 `order` 字段——不搬数据。
- **样式**：`setRowBackgroundColor`/`setColumnBackgroundColor`/`setColumnWidth`。
- **内容**：`clearRow`/`clearColumn`/`clearCells`/`clearCellsBySelection`（按选区清空文本，但 `text.replace(0,len,'')` 保留 `Y.Text` 对象）。
- **复制**：`duplicateRow`/`duplicateColumn`——新 id + 新 order，并 `text.clone()` 复制每格内容。

这种"数据管理器"模式把"表格怎么改"从视图里完全剥离，视图只读 `uiRows$`/`uiColumns$` 渲染、调 `dataManager.xxx()` 写——职责清晰。

### 3.3 ★渲染：原生 table + 坐标测量

`TableBlockComponent.renderBlock()`（`table-block.ts:205-290`）用原生 `<table>`/`<tbody>`/`<tr>` + `repeat` 双重循环渲染，每个交叉点是一个 `<affine-table-cell>`（`style="display: contents"` 让自定义元素不破坏 table 布局）：

```ts
const rows = this.dataManager.uiRows$.value;
const columns = this.dataManager.uiColumns$.value;
// <table ${ref(this.table$)}><tbody>
//   repeat(rows, row.rowId, (row, rowIndex) =>
//     <tr data-row-id=${row.rowId}>
//       repeat(columns, column.columnId, (column, columnIndex) =>
//         <affine-table-cell .row .column .text=${getCell(rowId,columnId)?.text} .dataManager .selectionController>
```

- 用 `data-row-id`/`data-column-id` 把 DOM 与数据关联，供选区坐标测量。
- 块本身 `contenteditable="false"`，编辑交给每格的 rich-text。
- 末尾挂 `<affine-table-add-button>`（移动端/只读时省略）与 `<affine-table-selection-layer>`。
- **坐标测量函数**：组件提供 `getRowRect`/`getColumnRect`/`getAreaRect`（`:145-203`）——从 DOM `getBoundingClientRect` 算出行/列/区域相对表格的位置，并除以 `getScale()`（白板缩放补偿）。这些函数传给 selection-layer 绘制高亮。
- **虚拟 padding**：`VirtualPaddingController` + 负 margin 让表格可超出正文宽度（宽表横向扩展）。

### 3.4 ★三态选区系统

表格的选区**不复用** `BlockSelection`/`TextSelection`，而是自定义 `TableSelection`（`selection-schema.ts`）。其数据 `TableSelectionData` 是三种的联合：

```ts
z.union([
  z.object({
    type: z.literal('area'),
    rowStartIndex,
    rowEndIndex,
    columnStartIndex,
    columnEndIndex,
  }),
  z.object({ type: z.literal('row'), rowId }),
  z.object({ type: z.literal('column'), columnId }),
]);
```

- `TableSelection extends BaseSelection`，`static group='note'`、`type='table'`、`recoverable=true`——它登记进编辑器选区系统（`TableSelectionExtension` 在 store 注册），于是能与块/文本选区共存、可序列化恢复。
- `TableSelectionData.equals` 按类型逐字段比较——用于避免重复 set 选区触发无谓重渲。
- `area` 用行列**索引区间**而非 id：因为区域天然是"连续矩形"，用索引更自然；`clearCellsBySelection` 据此遍历 `uiRows$`/`uiColumns$` 定位要清空的格。

`SelectionController`（`selection-controller.ts`）是一个 Lit `ReactiveController`，`hostConnected` 时挂载各种交互：

- **拖拽框选**：`dragListener` 监听 `mousedown`，按 target 的 `data-*` 分流到调宽、列拖、行拖或 `onDragStart`（框选区域）；拖拽中 `document.body.style.pointerEvents='none'` 防止干扰。
- **调列宽**：`widthAdjust`（`:63-98`）记录初始宽度，`mousemove` 时写 `virtualWidth$`（实时预览，不落盘），`mouseup` 才 `setColumnWidth` 持久化。
- **行列拖拽重排**：`columnDrag`/`rowDrag` 拖动 `data-drag-column-id`/`data-drag-row-id` 手柄，最终调 `moveColumn`/`moveRow` 改 order。
- **复制/剪切/粘贴**：`host.handleEvent('copy'/'cut'/'paste', …)`——按当前 `TableSelection` 导出选中区域为 html/plain-text，粘贴时解析 `text/html` 的 `<table>` 或 `text/plain` 填回单元格（`:435-476`）。

### 3.5 ★虚拟行列：添加前的预览

`uiRows$`/`uiColumns$`（`table-data-manager.ts:39-74`）在真实行列之后**临时追加** `virtualRowCount$`/`virtualColumnCount$` 个占位行/列（id 用 `"0"`、`"1"`…）：

```ts
readonly uiRows$ = computed(() => {
  const virtualRowCount = this.virtualRowCount$.value;
  const rows = this.rows$.value;
  if (virtualRowCount === 0) return rows;
  if (virtualRowCount > 0) return [...rows, ...Array.from({length: virtualRowCount}, (_, i) => ({ rowId: `${i}`, … }))];
  return rows.slice(0, rows.length + virtualRowCount);   // 负数：预览删除
});
```

- 当用户悬停/拖拽"加行/加列"按钮时，设 `virtualRowCount$`，表格立即多出几行空格**作为预览**——但这是纯 UI 态（signal），没写进模型。确认添加才调 `addNRow`/`addNColumn` 真正落盘；负值则预览"将删除末尾 N 行"。
- 这把"添加/删除行列的即时反馈"与"真实数据修改"解耦，交互流畅且可取消。

### 3.6 单元格：每格一个 rich-text

`TableCell`（`table-cell.ts`）是独立自定义元素，核心是渲染一个绑定本格 `Y.Text` 的 `<rich-text>`（`:755-776`）：复用全局 `inlineManager` 的 schema/renderer/markdownMatches，于是单元格内支持与段落一致的富文本与内联 markdown。它还：

- 承载**行/列操作菜单**（`openRowOptions`/`openColumnOptions`/`renderColumnOptions`/`renderRowOptions`）——悬停出现的"插入/删除/染色/复制"菜单，用 `@floating-ui/dom` 定位。
- **键盘导航**（`:656+`）：`Tab` 在单元格间移动、`Enter` 等——把表格变成可用方向键/Tab 游走的网格。
- `mouseenter` 更新 `hoverRowIndex$`/`hoverColumnIndex$`，驱动高亮与按钮显隐。

### 3.7 与原生选择的边界处理

因为表格是真 `<table>` DOM，浏览器原生文本选择可能从表格外延伸进来，破坏单元格编辑。`TableBlockComponent` 在 `connectedCallback`（`:40-79`）监听 document 的 `selectionchange`/`pointerdown`：

- `hasExternalNativeSelection()`（`:99-117`）检测"选区与本表格相交、但锚点/焦点在表格外"。
- 若有外部选择，`setInternalEditablesEnabled(false)` 把所有 `.inline-editor` 临时 `contentEditable='false'`（标记 `data-tableExternalSelectionDisabled`），避免原生选择在格内乱跳；在表格内 pointerdown 时再恢复。
- 块上还设 `RANGE_SYNC_EXCLUDE_ATTR`/`RANGE_QUERY_EXCLUDE_ATTR`——把表格排除出编辑器的 range 同步/查询，因为表格自己管理选区。

## 4. 语法特色

- **扁平 Record + fractional index**：`Record<string, TableRow>` + `order: string` 的建模，配合 `generateFractionalIndexingKeyBetween` 实现"任意位置插入/移动不搬数据"——这是协同编辑里顺序维护的经典手法（与 blocksuite 全局的 block index 同源）。
- **`ReactiveController`**：`SelectionController implements ReactiveController` + `host.addController(this)`——Lit 的控制器模式，把一块独立的交互逻辑（选区）封装成可复用的 controller 挂到组件上，而非塞进组件本身。
- **zod 判别联合 + `SelectionExtension`**：`TableSelectionData` 用 `z.union` 的字面量 `type` 做判别联合，`TableSelection extends BaseSelection` 并经 `SelectionExtension` 注册为一等选区类型；`fromJSON` 里 `TableSelectionSchema.parse(json)` 做运行时校验。
- **`computed` 派生 UI 数据**：`uiRows$`/`uiColumns$`/`cellCountTips$` 用 `@preact/signals-core` 的 `computed` 从真实数据 + 虚拟计数派生，自动追踪依赖。
- **`ref` 指令绑 signal**：`<table ${ref(this.table$)}>` 把 DOM 元素写进 `table$` signal，供坐标测量读取。
- **`display: contents`**：自定义元素（cell/add-button/selection-layer）用 `display:contents` 让自身"透明"，不破坏原生 `<table>` 的布局算法。
- **复合字符串键**：`` `${rowId}:${columnId}` `` 做 cells 的键，删除时用 `startsWith`/`endsWith` 批量定位——字符串键当二维坐标用。

## 5. 设计 / 实现亮点

- **扁平三 Record 建模**：用 `rows`/`columns`/`cells` 三张扁平表 + fractional order，把"二维表格"拍平成对协同友好、增删改 O(1) 的结构，避免嵌套数组在协同下的合并难题。这是 table 最核心的设计决策，也是它区别于重型 `database` 的轻量之本。
- **数据管理器与视图彻底分离**：`TableDataManager` 收口所有写操作（且都走 `transact`），视图只读派生信号——改表格行为只改一处，视图零散不出数据逻辑。
- **虚拟行列预览**：把"加/删行列的即时视觉反馈"做成纯 signal 的 `uiRows$`/`uiColumns$` 叠加层，与真实数据解耦，交互可预览、可取消、不污染模型。
- **自定义三态选区**：`TableSelection`（area/row/column）作为一等选区类型接入编辑器选区系统，既能表达表格特有的矩形/整行/整列选择，又能与块/文本选区共存、可序列化恢复。
- **原生 table + 原生选择边界守卫**：直接用 `<table>` 获得浏览器表格布局能力，再用 `selectionchange` 检测并隔离外部原生选择——在"复用原生能力"与"自管选区"之间取得平衡。
- **直接操作交互齐全**：拖拽重排（改 order）、调宽（虚拟宽度预览后落盘）、悬停加行列、单元格 Tab 导航——电子表格该有的手感基本到位。

## 6. 对外 API 与注意事项

- 主要导出：`TableBlockComponent`、`TableCell`、`TableDataManager`、`TableSelection`/`TableSelectionData`/`TableSelectionExtension`、`SelectionController`；装配入口 `TableViewExtension`（`./view`）、`TableStoreExtension`（`./store`，额外注册选区类型）。
- **约定**：所有表格数据修改走 `TableDataManager` 的方法（内部已 `transact`），不要直接改 `model.props.rows/columns/cells`；行列顺序由 `order` 决定，插入/移动用 `getOrder` 生成新 order。
- **注意**：
  - 表格只能放在 `affine:note` 下（`parent:['affine:note']`），且 `children:[]`（单元格不是子块，而是 props 里的 `Y.Text`）。
  - `cells` 的键是 `"rowId:columnId"`，删行列后务必同步清理对应 cells（`TableDataManager` 已处理）；孤儿 cell 会导致渲染错位。
  - 虚拟行列（`virtualRowCount$`/`virtualColumnCount$`）是纯 UI 预览，id 为数字字符串，不要误当真实行列持久化。
  - 表格自管选区并被排除出 range 同步（`RANGE_SYNC_EXCLUDE_ATTR`）；外部原生选择会临时禁用格内 contentEditable，调试"表格里打不了字"先查是否有跨表格的原生选区。
  - 这是原生表格，不是 `affine:database`——需要字段类型、视图、过滤排序等结构化能力时应用 database 而非本块。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`TableBlockModel`/`TableRow`/`TableColumn`/`TableCell`）、`@blocksuite/store`（`BaseSelection`/`SelectionExtension`/`Text`/`nanoid`）、`@blocksuite/std`（`CaptionedBlockComponent`/`ReactiveController` 宿主）。
- 同层协作：`@blocksuite/affine-rich-text`（单元格 `RichText`）、`@blocksuite/affine-inline-preset`（`textKeymap`/inlineManager）、`@blocksuite/affine-shared`（`generateFractionalIndexingKeyBetween`/`VirtualPaddingController`）、`@floating-ui/dom`（菜单定位）。
- 对照阅读：`blocksuite-affine-block-paragraph.md`（单元格内复用的富文本能力）、以及 `database` 相关文档（重型结构化表格，与本块的分工边界）。
