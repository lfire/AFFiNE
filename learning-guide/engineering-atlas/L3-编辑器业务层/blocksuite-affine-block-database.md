# `@blocksuite/affine-block-database`

> 一句话定位：AFFiNE 的**数据库块**（flavour `affine:database`）——文档内的"表格 / 看板 / 日历"多视图数据库。它和 `data-view` 块共用同一个视图引擎 `@blocksuite/data-view`，差异只在数据源：database 通过 `DatabaseBlockDataSource` **自己拥有**行（行就是它的子块）、列（存在块 `props.columns`）与单元格（存在块 `props.cells`），并提供一整套列类型、类型转换、选区与记录详情面板。它是"把通用视图引擎接上一个自有数据源"的完整范例。

| 项        | 值                                                                                                                                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/database`                                                                                                                                                                                                                                                                                                            |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                                                                                    |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                          |
| 关键依赖  | `@blocksuite/data-view`（视图引擎 + 视图/列/属性预设）、`@blocksuite/affine-model`（`DatabaseBlockSchema`）、`@blocksuite/affine-components`（caption/context-menu/peek/drop-indicator）、`@blocksuite/affine-rich-text`/`affine-inline-*`（标题/富文本列）、`@blocksuite/std`、`@blocksuite/store`、`zod`、`date-fns`、`@preact/signals-core` |
| 被谁依赖  | 编辑器预设、`@affine/core`、`@blocksuite/affine-block-data-view`（复用其 DataSource/列/选区/渲染器）                                                                                                                                                                                                                                           |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                       |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | database 实现                                                                                                                                       | 对比 data-view 块                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| schema/model                      | `affine-model` 的 `DatabaseBlockSchema`/`DatabaseBlockModel`（`role: 'hub'`，props: `title: Text`/`views`/`columns`/`cells`/`comments`，version=3） | data-view 的 model 自带、无 rich-text title |
| `*-block.ts`                      | `database-block.ts` → `DatabaseBlockComponent`：托管 `DataViewRootUILogic`                                                                          | 同样托管引擎，但数据源不同                  |
| DataSource                        | ★`DatabaseBlockDataSource`（`data-source.ts`）：行=子块、列/单元格=块 props                                                                         | `BlockQueryDataSource`：查询现成块          |
| service                           | `service/`（`DatabaseBlockService` 等）                                                                                                             | data-view 无独立 service                    |
| widgets                           | 复用引擎 `widgetPresets`（viewBar/tools/quickSettingBar） + drag-handle                                                                             | 同样复用引擎 widget                         |
| selection                         | ★`selection.ts` → `DatabaseSelection`（包裹引擎的 `DataViewSelection`）                                                                             | **复用** database 的 `DatabaseSelection`    |
| 列类型                            | ★`properties/`（title/rich-text/link/created-time + 引擎预设 6 种）                                                                                 | data-view 复用这些列 + 转换器               |
| `adapters`                        | `adapters/`：markdown/html/notion-html/plain-text 四向序列化整张表                                                                                  | data-view **无** adapters                   |
| slash-menu                        | `configs/slash-menu.ts`（Table/Kanban 入口）                                                                                                        | data-view 的 "Todo" 入口                    |
| `effects.ts`/`view.ts`/`store.ts` | `DatabaseViewExtension`/`DatabaseStoreExtension`                                                                                                    | 结构同形，store 注册更多                    |

**核心命题——数据的"所有者"**：引擎（`@blocksuite/data-view`）只认一个抽象 `DataSource`。database 的工作就是实现这个接口，把数据库的真实存储（Yjs 里的块树 + props）翻译成引擎要的 "property / row / cell"：

- **行 = 子块**：`rows$ = computed(() => this._model.children.map(v => v.id))`，加一行就是 `addBlock('affine:paragraph', …)`，删行就是 `deleteBlock`。
- **列 = `props.columns`**：每列是一个 `ColumnDataType`（id/type/name/data）。
- **单元格 = `props.cells[rowId][columnId]`**。

因此 database 与 data-view 是"同引擎、不同数据源"的一对镜像——详见 `blocksuite-affine-block-data-view.md`。

### 数据库块的独有问题

1. **自有且可持久化的表结构**：列、单元格、视图都要存进 Yjs 并协同/撤销，读写要包 `transact`/`captureSync`。
2. **丰富的列类型与类型转换**：title/rich-text/link/date/number/select/multi-select/checkbox/progress/created-time 等，且允许列类型互转（文本→多选、复选→文本…），每种转换都要迁移所有单元格值。
3. **"固定列"与普通列**：Title、Block Type 这类列由块属性派生（固定列/特殊列），不走 `props.columns`，需要单独分流读取。
4. **多视图**：一张表可挂多个视图（表/看板/日历），视图数据存 `props.views`，要支持增删改移与"当前视图"记忆。
5. **记录详情面板**：点开一行要弹出详情（peek 或侧栏），详情里嵌一个 note 子文档编辑区。

## 2. 目录与关键文件

```text
src/
├── database-block.ts        # ★DatabaseBlockComponent：托管引擎 + 标题/工具栏/菜单/拖拽/详情面板
├── data-source.ts           # ★DatabaseBlockDataSource extends DataSourceBase：自有行/列/单元格 + 列类型转换
├── selection.ts             # DatabaseSelection（包裹引擎 DataViewSelection，注册 SelectionExtension）
├── properties/              # ★列类型（cell renderer + model define）
│   ├── index.ts             # databaseBlockProperties：引擎预设 6 种 + title/rich-text/link/created-time
│   ├── model.ts             # databaseBlockModels：纯数据层列模型（供序列化/后端）
│   ├── converts.ts          # ★databasePropertyConverts：列类型互转（文本↔多选/数字/复选…）
│   ├── title/ rich-text/ link/ created-time/   # 各列的渲染器与定义
├── views/index.ts           # databaseBlockViews：table/kanban/calendar 视图元信息
├── detail-panel/            # 记录详情：block-renderer（标题）/ note-renderer（子文档）
├── adapters/                # 整表的 markdown/html/notion-html/plain-text 序列化
├── widgets/ components/ context/ configs/ service/ utils/   # 工具栏、标题组件、host 注入、斜杠、服务、块工具
├── config.ts                # DatabaseConfigExtension（可注入 ops 菜单 configure）
├── commands.ts              # 命令（如 convertToDatabase）
└── view.ts / store.ts / effects.ts / index.ts  # 装配
```

## 3. 实现细节

### 3.1 ★DatabaseBlockDataSource：把块树翻译成"表"

`DatabaseBlockDataSource`（`data-source.ts:60-621`）继承引擎 `DataSourceBase`，是数据库的全部数据语义所在。关键设计：

**行就是子块**：

```ts
rows$ = computed(() => this._model.children.map(v => v.id));
rowAdd(insertPosition) {                      // 加一行 = 加一个段落子块
  this.doc.captureSync();
  const index = typeof insertPosition === 'number' ? insertPosition
    : insertPositionToIndex(insertPosition, this._model.children);
  return this.doc.addBlock('affine:paragraph', {}, this._model.id, index);
}
rowDelete(ids) { …this.doc.deleteBlock(block.model)…; deleteRows(this._model, ids); }
rowMove(rowId, position) { …this.doc.moveBlocks([model], this._model, target); }
```

**单元格读写带 zod 校验**：`cellValueGet`（`:268-292`）先判断是不是"特殊属性"，否则 `getCell(...)?.value ?? default()`，再用该列类型的 `meta.config.rawValue.schema.safeParse(rawValue)` 做运行时校验，不合法返回 undefined——弥补 Yjs 存的是任意 JSON、类型已擦除的缺口。`cellValueChange`（`:238-266`）通过列类型的 `rawValue.setValue` 钩子写回，并用 `_runCapture()` 把一帧内的多次改动合并成一个 undo 断点（`requestAnimationFrame` 批处理，`:207-216`）。

**固定列 / 特殊属性分流**：Title、Block Type、Created Time 等不存在 `props.columns`，而是从行对应块的模型属性派生。`spacialProperties`（`:65-105`）声明了 `created-time`/`created-by`/`type`/`title` 的 `valueGet`（如 `title` 直接取 `model.text`，`type` 取 `getIcon(model)`）。`getPropertyAndIndex`（`:339-366`）先找普通列、找不到再按"固定列"合成一个虚拟 `ColumnDataType`（`index: -1`）。`propertyReadonlyGet` 让 `'type'` 列恒只读。

**静态注册表 + 外部扩展**：列类型清单是类级 `computed`，允许运行时注入外部列：

```ts
static externalProperties = signal<PropertyMetaConfig[]>([]);
static propertiesList = computed(() => [
  ...Object.values(databaseBlockProperties),
  ...this.externalProperties.value,
]);
static propertiesMap = computed(() => Object.fromEntries(
  this.propertiesList.value.map(v => [v.type, v])));
```

### 3.2 ★列类型与类型转换

`properties/index.ts` 把引擎预设的 6 种列（checkbox/date/multiSelect/number/progress/select/image）与 database 自定义的 4 种（`titleColumnConfig`/`richTextColumnConfig`/`linkColumnConfig`/`createdTimeColumnConfig`）合成 `databaseBlockProperties`。其中 title/rich-text/link 需要内联富文本能力，所以本包才依赖 `affine-rich-text`/`affine-inline-preset`/`affine-inline-reference`。

**列类型互转**是 database 的硬功能。`propertyTypeSet`（`data-source.ts:497-537`）：取当前所有行在该列的值 → 在 `databasePropertyConverts` 里查 `from→to` 的 `convert` 函数 → 用它把旧列数据与所有单元格值整体转换 → 一次性 `updateProperty` 改列类型/列数据、`updateCells` 写回所有单元格。`converts.ts` 定义了大量转换对，例如"富文本→多选"把逗号分隔文本拆成 tag、"复选框→富文本"把 `true/false` 写成 `Yes/No`：

```ts
createPropertyConvert(richTextPropertyModelConfig, multiSelectPropertyModelConfig,
  (_property, cells) => ({
    cells: cells.map(v => v?.toString().split(',').map(…getTag(value).id…)),
    property: { options: Object.values(options) },
  }));
```

这套转换器被 **data-view 块整个借用**（`BlockQueryDataSource.propertyTypeSet` 直接引用 `databasePropertyConverts`），是跨包复用的典型。

### 3.3 ★把引擎种进块：DatabaseBlockComponent

组件（`database-block.ts:78-531`）继承 `CaptionedBlockComponent`，核心同样是实例化 `DataViewRootUILogic` 并注入所有宿主协作点，但比 data-view 多了若干能力：

- **`lazy()` 延迟构造数据源与根逻辑**：`dataSource = lazy(() => new DatabaseBlockDataSource(this.model, ds => {…serviceSet…}))`（`:143-168`）——用引擎的 `lazy` 包装，首次 `.value` 才构造，避免渲染前就建重对象。构造回调里用 `dataSource.serviceSet(...)` 把 `EditorHost`、外部分组配置 `ExternalGroupByConfigProvider`、日历外部源 `CalendarExternalSourceProvider` 注入数据源——**可插拔的外部能力**。
- **标题是真正的 rich-text**：`renderTitle` 渲染 `<affine-database-title .titleText=${this.model.props.title}>`，`title` 是 `Y.Text`、可协同编辑（区别于 data-view 的纯字符串 title）。
- **当前视图记忆**：`currentViewStorage.getCurrentView/ setCurrentView`（`:163, 220`）把用户上次所在视图存起来，切视图时持久化。
- **拖拽重排**：`onDrag`（`:234-269`）接 `@blocksuite/affine-widget-drag-handle` 的 `getDropResult`，用 `DropIndicator` 画落点、松手时 `moveBlocks`。
- **记录详情双路径**：`detailPanelConfig.openDetailPanel`（`:463-506`）优先用 `PeekViewProvider` 弹 peek；若该行文本里是一个链接文档（`getSingleDocIdFromText`）则直接 peek 该文档，否则用 `createTemplate` 构造详情（header=`BlockRenderer`、note=`NoteRenderer`）；无 peek 服务则降级 `popSideDetail` 侧栏。
- **宽度自适应**：`listenFullWidthChange` 用 `@floating-ui/dom` 的 `autoUpdate` 持续算出块相对编辑器的左偏移写入 `virtualPadding$`，让表格虚拟滚动区正确对齐。
- **移动端保护**：`handleMobileEditing`——未开 `enable_mobile_database_editing` flag 时点击弹提示，`readonly$` 也据此置真（`data-source.ts:160-168`）。
- **工具栏按视图配置**：`toolsWidget = widgetPresets.createTools({ table:[filter,sort,search,viewOptions,tableAddRow], kanban:[…], calendar:[…] })`——同一块不同视图装不同工具。

### 3.4 selection：包裹引擎选区并接入协同

引擎有自己的 `DataViewSelection`（表格选区/看板选区），但 BlockSuite 的选区系统需要一个 `BaseSelection`。`DatabaseSelection`（`selection.ts:19-66`）就是适配器：

```ts
export class DatabaseSelection extends BaseSelection {
  static override group = 'note';
  static override type = 'database';
  readonly viewSelection: DataViewSelection;
  static fromJSON(json) { const { blockId, viewSelection } = DatabaseSelectionSchema.parse(json); … }
  toJSON() { return { type: 'database', blockId, viewSelection }; }
}
export const DatabaseSelectionExtension = SelectionExtension(DatabaseSelection);
```

用 zod（`TableViewSelectionWithTypeSchema | KanbanViewSelectionWithTypeSchema` 的 union）在 `fromJSON` 时校验，保证选区能被协同系统安全序列化/反序列化。组件里 `viewSelection$`（computed）从 note 选区组挑出本块的 `DatabaseSelection`、`setSelection` 反向包回——与 data-view 完全相同，且 data-view **直接复用这个类**。

### 3.5 多视图与模型

schema（`model/src/blocks/database/database-model.ts`）props：`views: ViewBasicDataType[]`、`title: Text`、`cells: SerializedCells`、`columns: ColumnDataType[]`、可选 `comments`。`role: 'hub'`、`children: ['affine:paragraph','affine:list']`（行就是这些子块）、version=3（经历过结构迁移）。

视图元信息 `databaseBlockViews = [tableViewMeta, kanbanViewMeta, calendarViewMeta]`（`views/index.ts`，来自引擎 `viewPresets`）。数据源的 `viewDataAdd/Delete/Duplicate/MoveTo/Update`（`data-source.ts:571-601`）全部操作 `props.views` 并包 `transact`/`captureSync`。初始化辅助 `databaseViewInitTemplate` 建 3 个空行 + 一个视图；命令 `convertToDatabase`（`:632-665`）把选中的块搬进新建的 database 块，实现"选几段文字→转成数据库"。

### 3.6 装配：带 zod schema 的 ViewExtension

`view.ts` 的 `DatabaseViewExtension` 比其它块多一个**可配置项 schema**：

```ts
const optionsSchema = z.object({
  configure: z
    .function()
    .args(z.instanceof(DatabaseBlockModel), z.custom<MenuOptions>())
    .returns(z.custom<MenuOptions>()),
});
export class DatabaseViewExtension extends ViewExtensionProvider<DatabaseViewExtensionOptions> {
  override schema = optionsSchema;
  override setup(context, options?) {
    context.register([
      FlavourExtension('affine:database'),
      BlockViewExtension('affine:database', literal`affine-database`),
      SlashMenuConfigExtension('affine:database', databaseSlashMenuConfig),
    ]);
    if (options)
      context.register(
        DatabaseConfigExtension({ configure: options.configure })
      );
  }
}
```

`store.ts` 的 `DatabaseStoreExtension` 注册 `DatabaseBlockSchemaExtension` + `DatabaseSelectionExtension` + `DatabaseBlockAdapterExtensions`（四种格式序列化整张表）——比 divider/data-view 的 store 都重，因为它既有选区又有完整 adapters。

## 4. 语法特色

- **`computed`/`signal` 构建响应式数据源**：`rows$`/`properties$`/`readonly$`/`viewDataList$` 全是 `@preact/signals-core` 的 `computed`，引擎读它们即自动追踪，数据变化自动重渲，无需手动失效。
- **类级静态 `signal` + `computed` 做可扩展注册表**：`static externalProperties = signal([])` + `static propertiesList = computed(...)`，让"内置列 + 运行时外部列"合并成一个响应式清单。
- **`lazy()` 惰性字段**：`dataSource`/`dataViewRootLogic` 用引擎的 `lazy` 包装，推迟重对象构造到首次访问。
- **zod 运行时校验贯穿**：单元格值 `schema.safeParse`、选区 `fromJSON` 校验、ViewExtension 的 options `z.function().args().returns()`——在"类型擦除 + 协同任意 JSON"的边界补回运行时保证。
- **用户定义类型谓词 + `instanceof`**：`(selection): selection is DatabaseSelection => … instanceof DatabaseSelection`。
- **`uniComponent` 跨框架适配**：`defineUniComponent`/`createUniComponentFromWebComponent`/`uniMap`/`renderUniLit` 把 Lit Web Component 接进引擎的通用组件体系；`uniMap(renderer, props => ({...props, host}))` 注入宿主依赖。
- **`static override group/type` + `SelectionExtension(...)`**：声明选区的分组/类型并注册进协同选区系统。
- **`requestAnimationFrame` 批处理**：`_runCapture` 把一帧内多次写合并为一个撤销点。

## 5. 设计 / 实现亮点

- **"引擎 + 自有数据源"的完整样板**：把通用视图引擎接上一个"数据归自己所有"的 `DataSource`，行映射到子块、列/单元格映射到块 props——这是理解 database 与 data-view 异同的关键，两者同引擎、数据源互为镜像。
- **列类型系统 + 可逆转换**：十余种列类型、`databasePropertyConverts` 定义的成对转换器（并被 data-view 整套借用），把"改一列类型要迁移全部单元格"这件繁事做成声明式表，易扩展、跨包复用。
- **固定列/特殊属性的虚拟列合成**：Title/Block Type/Created Time 不占 `props.columns`、由块属性派生，用"找不到普通列就合成 index=-1 的虚拟列"统一了普通列与派生列的读取路径。
- **记录详情的三级降级**：链接文档直接 peek → peek 服务弹详情 → 无服务侧栏——在不同宿主能力下都可用。
- **协同友好的写入**：所有写操作包 `transact`/`captureSync`，并用 rAF 批处理合并撤销点；单元格读写带 zod 校验，抵御协同数据的类型漂移。
- **可配置的 ops 菜单**：`DatabaseViewExtension` 用 zod 校验的 `configure` 回调，让宿主自定义"更多菜单"项——扩展点设计得类型安全。

## 6. 对外 API 与注意事项

- 主要导出（`index.ts`）：`DatabaseBlockComponent`、`DatabaseBlockDataSource`（+ `databaseViewInitTemplate`/`convertToDatabase`）、`databaseBlockProperties`/`databasePropertyConverts`、`DatabaseSelection`、`BlockRenderer`/`NoteRenderer`、`databaseBlockModels`、以及 `export * from '@blocksuite/data-view'`（把引擎一并转出，方便上层只依赖本包）。装配：`DatabaseViewExtension`（`./view`）、`DatabaseStoreExtension`（`./store`）。
- **约定**：新列类型 = 加一个 property config 进 `databaseBlockProperties`（需要富文本则在 `properties/` 下建渲染器）；列互转 = 往 `databasePropertyConverts` 加 `createPropertyConvert(from, to, fn)`；外部分组/日历源经 `serviceSet` 注入数据源。
- **注意**：
  - 行就是子块（段落/列表），删库会连带删所有行子块；不要把它当成"独立表存储"。
  - Title/Block Type 等固定列不在 `props.columns` 里，改列逻辑必须经 `getPropertyAndIndex` 分流，`'type'` 恒只读。
  - 单元格值读出时经 zod `safeParse`，存入的脏数据会被丢弃为 undefined——协同/迁移时注意。
  - 移动端默认只读，需 `enable_mobile_database_editing` flag 才能编辑。
  - data-view 块复用了本包的 DataSource 片段、列类型、转换器、选区与详情渲染器——改这些导出要同步考虑 data-view 的依赖。

## 7. 延伸

- 核心依赖：`@blocksuite/data-view`（`DataSourceBase`/`DataViewRootUILogic`/`ViewManagerBase`/`widgetPresets`/`property-presets`/`view-presets`）、`@blocksuite/affine-model`（`DatabaseBlockSchema`/`ColumnDataType`）。
- 同层协作：`@blocksuite/affine-components`（caption/context-menu/peek/drop-indicator/toast）、`@blocksuite/affine-rich-text` + `affine-inline-preset`/`affine-inline-reference`（标题/富文本/链接列）、`@blocksuite/affine-widget-drag-handle`/`affine-widget-slash-menu`、`@blocksuite/affine-shared`（services/commands/consts）。
- 对照阅读：`blocksuite-affine-block-data-view.md`（同引擎、查询型数据源的镜像实现），并读即可彻底区分"自有数据库 vs 内嵌查询视图"。
