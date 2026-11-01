# `@blocksuite/affine-block-data-view`

> 一句话定位：AFFiNE 的**内嵌视图块**（flavour `affine:data-view`）——它本身**不是**一个数据库，而是把独立的表格/看板引擎 `@blocksuite/data-view` 包成一个文档内块，并通过 `BlockQueryDataSource` 把**文档里已存在的其它块**（当前是待办列表项 `todo`）当作"行"投影成一张可筛选、可分组的表。它和 `database` 块共用同一个视图引擎，区别只在"数据从哪来"：database 自己拥有数据，data-view **查询**别人的数据。

| 项        | 值                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/data-view`                                                                                                                                                                                                                                |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                         |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                               |
| 关键依赖  | `@blocksuite/data-view`（视图引擎）、`@blocksuite/affine-block-database`（复用 `DatabaseBlockDataSource`/列类型/选区/渲染器）、`@blocksuite/affine-components`（caption/context-menu/peek）、`@blocksuite/std`、`@blocksuite/store`、`@preact/signals-core`、`rxjs` |
| 被谁依赖  | 编辑器预设、`@affine/core`（经 `enable_block_query` feature flag 开启）                                                                                                                                                                                             |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                            |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | data-view 实现                                                                                                                     | 对比 database 块                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| schema/model                      | 本包自带 `DataViewBlockModel`/`DataViewBlockSchema`（`affine:data-view`，`role: 'hub'`，props: `title`/`views`/`columns`/`cells`） | database 的 model 更重（含 title rich-text 等） |
| `*-block.ts`                      | `data-view-block.ts` → `DataViewBlockComponent`：**把 `DataViewRootUILogic` 渲染进块**                                             | database 同样托管 data-view 引擎                |
| DataSource                        | ★`BlockQueryDataSource`（`data-source.ts`）：查询现有块当行                                                                        | `DatabaseBlockDataSource`：自有行/列/单元格     |
| service                           | 无独立 service（逻辑在组件内 `DataViewRootUILogic`）                                                                               | database 有 service                             |
| widgets                           | 不用块级 widget，用**引擎自带** `widgetPresets`（viewBar/tools/quickSettingBar）                                                   | 同样复用引擎 widget                             |
| slash-menu                        | `configs/slash-menu.ts`（"Todo" 视图，受 `enable_block_query` flag 限制）                                                          | database 有 Table/Kanban 入口                   |
| `adapters`                        | **无**（查询视图不独立序列化内容；行数据属于被查询的块）                                                                           | database 有完整 adapters                        |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define` + `DataViewViewExtension`/`DataViewStoreExtension`（仅注册 schema）                                        | database 结构相同但 store 注册更多              |

**核心命题——"引擎 vs 块" 的三层分工**：

1. `@blocksuite/data-view` 是一个**与 BlockSuite 无关**的通用表格/看板引擎：它只认 `DataSource` 抽象接口（有哪些 property、哪些 row、某 cell 取值/赋值），不关心数据存在 Yjs 还是内存。
2. data-view 块与 database 块都只是这个引擎的**两个宿主**：各自提供一个 `DataSource` 实现，把引擎"种"进一个 Lit 块里。
3. 两者差异集中在 `DataSource`：
   - **database** → `DatabaseBlockDataSource`：行就是数据库块的子块，列/单元格存在块自己的 props。它是数据的**所有者**。
   - **data-view** → `BlockQueryDataSource`：行是**整个工作区里符合条件的现成块**（如所有 `type==='todo'` 的列表项），列一部分是"从块属性读出的只读列"（如块类型），一部分是本块 `props.columns` 里额外附加的列。它是数据的**观察者/投影**。

这正是"把一个引擎包成块"的范式价值：引擎负责交互/渲染/视图管理，块负责接桥（DataSource）+ 装配（view/store）。

### 内嵌视图块的独有问题

1. **数据不归自己所有**：行来自别处的块，要**监听整个工作区**的块增删、动态维护 `blockMap`。
2. **部分列只读**：从块属性映射出的列（如 Block Type）不可写，本块附加的列才可编辑——需要 `propertyReadonlyGet` 按列来源分流。
3. **复用 database 的一切**：列类型、类型转换、选区、记录详情渲染器都直接从 `@blocksuite/affine-block-database` 借用，避免重复造轮子。
4. **部分操作不支持**：既然行是别的块，data-view 不能凭空"加一行/删一行"（`rowAdd`/`rowDelete` 直接 `throw`）。

## 2. 目录与关键文件

```text
src/
├── data-view-block.ts     # ★DataViewBlockComponent：承载 DataViewRootUILogic + 引擎 widget + 顶栏/菜单
├── data-view-model.ts     # DataViewBlockModel/Schema：views/columns/cells + view 增删改移
├── data-source.ts         # ★BlockQueryDataSource extends DataSourceBase：查询块→行，桥接引擎
├── data-view-spec.ts      # DataViewBlockSpec：FlavourExtension + BlockViewExtension（轻量 spec）
├── block-meta/            # "把哪种块当行"的声明
│   ├── base.ts            # BlockMeta/PropertyMeta + createBlockMeta 工厂
│   ├── todo.ts            # todoMeta：selector = 列表块且 type==='todo'
│   └── index.ts           # blockMetaMap = { todo }
├── columns/index.ts       # 可用列类型（date/number/progress/select/... + 隐藏的 richText）
├── configs/
│   ├── slash-menu.ts      # "Todo" 斜杠入口（受 enable_block_query flag 限制）
│   └── tooltips.ts
├── views/index.ts
├── view.ts / store.ts / effects.ts / index.ts  # 装配
```

## 3. 实现细节

### 3.1 ★DataSource：把"现成的块"投影成表

`BlockQueryDataSource`（`data-source.ts:27-326`）继承引擎的 `DataSourceBase`，是本块的灵魂。它在构造时就扫描**整个工作区**，把符合 `meta.selector` 的块收进 `blockMap`：

```ts
constructor(host, block: DataViewBlockModel, config: BlockQueryDataSourceConfig) {
  super();
  this.meta = blockMetaMap[config.type];                 // 当前只有 'todo'
  for (const collection of this.workspace.docs.values()) {
    for (const block of Object.values(collection.getStore().blocks.peek())) {
      if (this.meta.selector(block)) this.blockMap.set(block.id, block);
    }
  }
  this.workspace.docs.forEach(doc => this.listenToDoc(doc.getStore()));
  this.workspace.slots.docListUpdated.subscribe(() => { /* 文档增删时补挂/解挂监听 */ });
}
```

- **行 = 符合条件的块**：`get rows() { return this.blocks.map(v => v.id); }`。
- **实时同步**：`listenToDoc`（`:155-170`）订阅每个文档的 `slots.blockUpdated`，`add`/`delete` 时增删 `blockMap` 并 `slots.update.next()` 通知引擎重算；`docListUpdated` 处理文档本身的增删。这是"观察者型数据源"必须自己扛的复杂度——database 的行就是子块、无需跨文档监听。
- **两类列、两条取值路径**：`cellValueGet`（`:139-149`）先看该列是不是本块 `props.columns` 里的"视图列"（存在 `block.props.cells[rowId][propertyId]`），否则回退到 `meta.properties` 的 `get(block.model)` 从被查询块的模型属性读。`cellValueChange`/`propertyNameGet`/`propertyTypeGet` 等都遵循这条"先视图列、后块属性"的分流。
- **只读分流**：`propertyReadonlyGet`（`:260-267`）——视图列可写；块属性列仅当其 `set` 存在才可写；特殊的 `'type'` 列（Block Type）恒只读。
- **列类型转换复用 database**：`propertyTypeSet`（`:280-315`）直接用 `databasePropertyConverts` 找 `from→to` 的转换函数、用 `DatabaseBlockDataSource.propertiesMap` 建新列默认值——**把 database 的列类型系统整套借来**。
- **不支持的操作**：`rowAdd`/`rowDelete`/`propertyDuplicate` 直接 `throw new Error('Method not implemented.')`，`rowMove` 空实现——因为"行"不归它管。

### 3.2 block-meta：声明"把哪种块当行"

`block-meta/`（`base.ts`）定义了可插拔的"块→行映射"协议：

```ts
export type BlockMeta<T extends BlockModel> = {
  selector: (block: Block) => boolean;          // 哪些块算一行
  properties: PropertyMeta<T>[];                // 每行能读出哪些列
};
export const createBlockMeta = <T>(options) => ({ ...meta, addProperty(p) {…} });
```

`todo.ts` 是当前唯一实现：

```ts
export const todoMeta = createBlockMeta<ListBlockModel>({
  selector: block =>
    block.flavour === ListBlockSchema.model.flavour &&
    (block.model as ListBlockModel).props.type === 'todo',
});
```

`blockMetaMap = { todo: todoMeta }`（`index.ts`）。`DataViewBlockComponent.dataSource` getter 固定用 `{ type: 'todo' }` 构造数据源——即当前内嵌视图块就是"全工作区待办聚合视图"。这个 `BlockMeta` 抽象留好了扩展位：未来要"把某种块聚合成表"，加一个 meta 即可。

### 3.3 ★把引擎"种"进块：DataViewRootUILogic

组件把引擎的根 UI 逻辑类实例化为字段 `dataViewRootLogic`（`data-view-block.ts:248-306`），把块与引擎之间的所有协作点（selection、hotkey、event、clipboard、dnd、notification、埋点、详情面板）用回调注入：

```ts
private readonly dataViewRootLogic = new DataViewRootUILogic({
  virtualPadding$: signal(0),
  bindHotkey: this._bindHotkey,          // 转调 host.event.bindHotkey
  handleEvent: this._handleEvent,        // 转调 host.event.add
  selection$: this.selection$,           // 从 DatabaseSelection 读视图选区
  setSelection: this.setSelection,       // 写回 DatabaseSelection
  dataSource: this.dataSource,           // ← BlockQueryDataSource
  headerWidget: this.headerWidget,
  clipboard: this.std.clipboard,
  dnd: this.std.dnd,
  notification: { toast: … },            // 降级：NotificationProvider → toast(host)
  eventTrace: (key, params) => this.std.getOptional(TelemetryProvider)?.track(…),
  detailPanelConfig: { openDetailPanel: (target, data) => …peek… },
});
override renderBlock() {
  return html`<div contenteditable="false" style="position: relative">
    ${this.dataViewRootLogic.render()} ${widgets}
  </div>`;
}
```

- **选区桥接**：引擎有自己的 `DataViewSelection`，但在 BlockSuite 里要包进 `DatabaseSelection`（复用 database 包的选区类型）。`selection$`（computed）从 note 选区组里挑出本块的 `DatabaseSelection` 读 `viewSelection`；`setSelection` 反向包回去。
- **顶栏自绘、工具用引擎预设**：`headerWidget` 用 `defineUniComponent` 自定义（标题 + `renderDatabaseOps()` 更多菜单），但工具栏 `toolsWidget = widgetPresets.createTools({ table: [filter, search, viewOptions, tableAddRow], kanban: [...] })`、视图切换 `widgetPresets.viewBar`、快捷设置 `widgetPresets.quickSettingBar` 全部复用引擎自带 widget。这是"块只补差异、通用能力交给引擎"的典型。
- **详情面板走 peek**：`detailPanelConfig.openDetailPanel` 用 `PeekViewProvider` 弹出记录详情，详情的 header/note 用 `createUniComponentFromWebComponent(BlockRenderer / NoteRenderer)`——这两个渲染器也来自 database 包。
- **`contenteditable="false"` + `RANGE_SYNC_EXCLUDE_ATTR`**：块内是独立交互区，不参与富文本光标同步（`connectedCallback` 里 `setAttribute(RANGE_SYNC_EXCLUDE_ATTR, 'true')`）。

### 3.4 model：视图数组的增删改移

`DataViewBlockModel`（`data-view-model.ts:21-80`）的 props 是 `title/views/columns/cells`，模型方法集中管理 **views 数组**：

- `addBlock` 后由斜杠菜单调 `dataSource.viewManager.viewAdd('table')` 创建首个视图。
- `deleteView`/`duplicateView`/`moveViewTo`/`updateView` 都包在 `store.transact(…)` 里改 `props.views`，再 `applyViewsUpdate()`（`updateBlock` 落库触发重渲）。`duplicateView` 用 `JSON.parse(JSON.stringify(...))` 深拷贝视图配置并换新 id。
- schema `role: 'hub'`、`parent: ['affine:note']`、`children: ['affine:paragraph','affine:list']`——它是容器型块（hub），允许承载段落/列表子块（用于记录详情内的笔记区）。

### 3.5 装配：极简 view/store + spec

- `view.ts`：`DataViewViewExtension` 注册 `FlavourExtension(flavour)` + `BlockViewExtension('affine:data-view', literal\`affine-data-view\`)`，`effect()`里`customElements.define`。
- `store.ts`：`DataViewStoreExtension` **只注册 `DataViewBlockSchemaExtension`**——没有 adapters，因为查询视图不独立序列化行内容。
- `data-view-spec.ts`：另给一份轻量 `DataViewBlockSpec`（纯 `ExtensionType[]`），供不走 ViewExtensionProvider 的装配路径使用。
- 斜杠入口受 `FeatureFlagService.getFlag('enable_block_query')` 与"不在 edgeless-text 内"双重门控（`configs/slash-menu.ts:23-25`），说明它仍是实验特性。

## 4. 语法特色

- **抽象基类 + 方法覆盖做桥接**：`class BlockQueryDataSource extends DataSourceBase` 用继承实现引擎要求的接口；未支持的方法显式 `throw`，是"部分实现接口"的诚实写法。文件顶的 `// @ts-expect-error FIXME: ts error` 标注了一处已知类型不匹配。
- **`satisfies` 约束映射表**：`blockMetaMap = { todo: todoMeta } satisfies Record<string, BlockMeta>`——既保留 `keyof typeof blockMetaMap`（供 `config.type` 精确取值）的字面量类型，又校验每项符合 `BlockMeta`。
- **泛型工厂 + 收集器**：`createBlockMeta<T extends BlockModel>(options)` 返回带 `addProperty<Value>()` 的对象，用泛型把"某种块的属性读写"类型安全地收集起来。
- **`uniComponent` 跨框架适配**：`defineUniComponent`/`createUniComponentFromWebComponent`/`uniMap`/`renderUniLit` 是引擎的"通用组件"抽象——让引擎（可能面向多种 UI 框架）与 Lit Web Component 互通；`uniMap(renderer, props => ({...props, host}))` 做 props 变换注入。
- **`computed`/`signal` 响应式选区**：`selection$ = computed(() => …find(DatabaseSelection)…)`，引擎读它即自动追踪选区变化。
- **`instanceof` 类型守卫 + 用户定义类型谓词**：`(selection): selection is DatabaseSelection => …` 在 `find` 回调里收窄类型。
- **`literal` 静态标签 + 声明合并**：同其它块，`literal\`affine-data-view\``+`declare global { HTMLElementTagNameMap }`。

## 5. 设计 / 实现亮点

- **"引擎—块—数据源"三层解耦**：通用视图引擎（`@blocksuite/data-view`）零 BlockSuite 耦合；块只负责把引擎种进文档并桥接宿主能力；`DataSource` 是唯一变量。于是同一引擎既能做"自有数据库"（database）又能做"查询视图"（data-view），是本设计最高含金量处。
- **观察者型数据源**：`BlockQueryDataSource` 把"散落全工作区的待办"实时聚合成一张表——跨文档监听块增删、双路径取值、按列来源分流只读，完整示范了"数据不归自己所有"的视图如何实现。
- **最大化复用 database 资产**：列类型、类型转换（`databasePropertyConverts`）、选区（`DatabaseSelection`）、记录渲染器（`BlockRenderer`/`NoteRenderer`）全部跨包借用，data-view 自己几乎只写了一个 DataSource + 一点装配。
- **可插拔的 `BlockMeta`**：把"哪种块算一行、能读出哪些列"抽象成声明，`blockMetaMap` 留足扩展位（当前仅 `todo`）。
- **能力降级**：notification 优先用 `NotificationProvider`、缺失时回退到裸 `toast`；详情面板优先 peek、缺 provider 则静默 resolve——在可选依赖缺席时不崩。

## 6. 对外 API 与注意事项

- 主要导出：`DataViewBlockComponent`、`DataViewBlockModel`/`DataViewBlockSchema`、`DataViewBlockSpec`（`index.ts`）；装配 `DataViewViewExtension`（`./view`）、`DataViewStoreExtension`（`./store`）。
- **约定**：当前数据源固定为 `{ type: 'todo' }`，即"全工作区待办聚合视图"；要支持新"可查询块类型"须在 `block-meta/` 加 `BlockMeta` 并挂进 `blockMetaMap`。
- **注意**：
  - 它**不拥有**行数据——`rowAdd`/`rowDelete`/`propertyDuplicate` 会抛错，不要当普通数据库用。
  - 行来自整个工作区的块，`BlockQueryDataSource` 会跨文档订阅块增删；销毁时依赖 `docDisposeMap` 的回调解挂，注意生命周期。
  - 列分"视图列"（本块 `props.columns`，可写）与"块属性列"（只读或由块属性 setter 决定），改列逻辑要区分来源。
  - 功能受 `enable_block_query` feature flag 门控，默认可能不出现在斜杠菜单。
  - 它**没有 adapters**，复制/导出走被查询块自身的序列化，而非这张视图。

## 7. 延伸

- 核心依赖：`@blocksuite/data-view`（视图引擎：`DataSourceBase`/`DataViewRootUILogic`/`widgetPresets`/`property-presets`）、`@blocksuite/affine-block-database`（`DatabaseBlockDataSource`/`databasePropertyConverts`/`DatabaseSelection`/`BlockRenderer`/`NoteRenderer`/列类型）。
- 同层协作：`@blocksuite/affine-components`（caption/context-menu/peek/toast/icons）、`@blocksuite/affine-shared`（services/consts/utils）、`@blocksuite/affine-widget-slash-menu`。
- 对照阅读：`blocksuite-affine-block-database.md`（同引擎、自有数据源的另一宿主），两篇并读即可彻底分清"数据库块 vs 内嵌视图块"。
