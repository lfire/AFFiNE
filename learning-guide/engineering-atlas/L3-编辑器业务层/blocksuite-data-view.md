# `@blocksuite/data-view`

> 本包是重点包，运行机制、关键流程和易错点见 [重点包精讲](../重点包精讲/09-blocksuite-data-view.md)。

> 一句话定位：一套**与具体存储/数据库解耦的通用数据视图引擎**——定义 `DataSource` 适配接口、`ViewManager`/`SingleView` 视图模型、以及可插拔的属性（property）、逻辑类型（logical type）、分组/筛选/排序/统计能力；内置 table / kanban / calendar 三种视图预设。AFFiNE 的 `affine:database` 块只是它的一个 `DataSource` 实现者。

| 项        | 值                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/data-view`                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（基座）                                                                                                                             |
| 语言/形态 | TypeScript 库（含大量 Lit 组件）                                                                                                                      |
| 关键依赖  | `@blocksuite/std`（std/gfx）、`@blocksuite/affine-shared`、`@blocksuite/affine-components`、`@preact/signals-core`、`lit`、`date-fns`、`@emotion/css` |
| 被谁依赖  | 共 8 个：`@blocksuite/affine-block-database`、`@blocksuite/affine-block-data-view`、`@blocksuite/affine-block-root`、`@blocksuite/affine-foundation`（`dataViewEffects`）、`@blocksuite/affine-widget-keyboard-toolbar`、`@blocksuite/affine`、`@blocksuite/playground`、`@affine/core` |
| 对外入口  | `.`（core 全量）、`./view-presets`、`./property-presets`、`./property-pure-presets`、`./widget-presets`、`./effects`                                  |

## 1. 设计逻辑

数据库/表格视图是编辑器里最复杂的子系统：它要支持多种展示形态（表格、看板、日历），每种形态又共享同一份底层数据、同一套属性类型与筛选/排序/分组能力。如果把这些逻辑和 `affine:database` 块的 Yjs 数据结构耦合在一起，就无法复用，也难以测试。

`data-view` 的核心立场是**"引擎 / 数据源"分离**：

- **引擎**（本包）只认一个抽象接口 `DataSource`（`core/data-source/base.ts`）——它描述"有哪些行、哪些属性、某格的值怎么读写、有哪些视图配置"，全部以 **Signal** 形式暴露（`xxx$: ReadonlySignal`）。
- **数据源**由使用方实现：`affine:database` 把 Yjs 数据适配成一个 `DataSource`，未来接入别的后端也只需另写一个实现。

于是整套视图逻辑（`ViewManager` → `SingleView` → `Row`/`Property`/`Cell`）只依赖接口、不依赖存储，既可跨块复用，又能脱离编辑器单测。

三层模型自上而下：

1. **`ViewManager`**：管理一个 DataSource 上的多个视图（增删、切换当前视图、改视图类型）。
2. **`SingleView`**：单个视图实例（一张 table 或一个 kanban），聚合该视图可见的行、列、属性、变量。
3. **`Row` / `Property` / `Cell`**：视图内的细粒度单元。

横切能力（property 类型系统、logical 逻辑类型、filter / sort / group-by / statistics）以**预设 + matcher**方式可插拔注册。

## 2. 目录与关键文件

```text
src/
├── index.ts                     # 仅 re-export core
├── core/
│   ├── index.ts                 # core 的聚合导出
│   ├── data-source/base.ts      # ★ DataSource 接口 + DataSourceBase 抽象基类 + DataSourceScope
│   ├── view/
│   │   ├── data-view.ts         # ★ ViewMeta / DataViewModel / viewType() 工厂
│   │   ├── types.ts             # DataViewProps / DataViewInstance（UI 逻辑契约）
│   │   └── data-view-base.ts    # UI 逻辑基类
│   ├── view-manager/
│   │   ├── view-manager.ts      # ★ ViewManager 接口 + ViewManagerBase
│   │   ├── single-view.ts       # ★ SingleView 接口 + SingleViewBase
│   │   ├── row.ts property.ts cell.ts  # 行/属性/单元格抽象
│   ├── property/property-config.ts  # ★ propertyType() 属性类型工厂 / PropertyMetaConfig
│   ├── logical/                 # 逻辑类型系统：type-system / matcher / type-presets
│   ├── filter/ sort/ group-by/ statistics/  # 可插拔的筛选/排序/分组/统计
│   ├── expression/              # 变量（Variable）与引用
│   ├── traits/                  # 视图能力 trait（traitGet(key)）
│   ├── widget/ component/ detail/  # UI 组件与明细面板
│   └── effect.ts                # coreEffects()：注册 core 的自定义元素
├── view-presets/                # ★ table / kanban / calendar 三种视图预设
│   ├── index.ts                 # viewPresets = { tableViewMeta, kanbanViewMeta, calendarViewMeta }
│   └── table/define.ts          # viewType('table').createModel(...) 示例
├── property-presets/            # 内置属性类型（8 种）：checkbox/date/image/multi-select/number/progress/select/text
└── widget-presets/              # 工具条、视图切换条等
```

## 3. 实现细节

### 3.1 DataSource：以 Signal 描述一切

`DataSource`（`core/data-source/base.ts:18-102`）是一份"数据契约"，方法成对出现：命令式 getter（`cellValueGet`）+ Signal 版（`cellValueGet$`）。节选：

```ts
export interface DataSource {
  properties$: ReadonlySignal<string[]>;
  rows$: ReadonlySignal<string[]>;
  cellValueGet(rowId, propertyId): unknown;
  cellValueGet$(rowId, propertyId): ReadonlySignal<unknown | undefined>;
  cellValueChange(rowId, propertyId, value): void;
  rowAdd(pos): string;
  rowDelete(ids): void;
  rowMove(rowId, pos): void;
  propertyAdd(pos, ops?): string | undefined;
  viewManager: ViewManager;
  viewMetas: ViewMeta[];
  viewDataList$: ReadonlySignal<DataViewDataType[]>;
  // ...
}
```

`DataSourceBase`（`:106-305`）是抽象基类：把所有 `xxx$` 的 Signal 版用 `computed(() => this.xxxGet(...))` 默认实现（如 `:154-159`），子类只需实现命令式方法。它还内置了一个 **DI 子容器**：

```ts
// base.ts:104,116,161-163
export const DataSourceScope = createScope('data-source');
protected container = new Container();
get provider() {
  return this.container.provider(DataSourceScope, this.parentProvider);
}
```

`serviceGetOrCreate`（`:173-181`）实现了"服务懒注册"：取不到就 `create()` 并存入子容器。`fixedProperties$` / `isFixedProperty`（`:279-304`）用 `computed` 识别"固定列"（如标题列不可删），逻辑全程响应式。

### 3.2 ViewMeta 与 viewType()：声明一种视图类型

一种视图（table/kanban/calendar）= 一个 `ViewMeta`，由 `type`、`model`（数据模型配置）、`renderer`（UI 渲染配置）三部分组成（`core/view/data-view.ts:58-63`）。构造它的是 `viewType()` 工厂的链式调用（`:65-80`）：

```ts
export const viewType = <Type extends string>(type: Type) => ({
  type,
  createModel: <Data>(model: DataViewModelConfig<Data>) => ({
    type,
    model,
    createMeta: renderer => ({ type, model, renderer }),
  }),
});
```

table 预设据此定义（`view-presets/table/define.ts:7-51`）：

```ts
export const tableViewType = viewType('table');
export const tableViewModel = tableViewType.createModel<TableViewData>({
  defaultName: 'Table View',
  dataViewManager: TableSingleView,          // 该视图的 SingleView 子类
  defaultData: viewManager => ({ mode: 'table', columns: [], filter: {...}, header: {...} }),
});
```

`defaultData` 能访问 `viewManager.dataSource` 来推断默认标题列——视图初始数据由数据源现状决定。

### 3.3 ViewManager：多视图编排

`ViewManagerBase`（`core/view-manager/view-manager.ts:40-130`）把"视图列表""当前视图"全部建成 `computed`：

```ts
views$ = computed(() => this.dataSource.viewDataList$.value.map(d => d.id));
currentView$ = computed(() => {
  const id = this.currentViewId$.value;
  return id && this.viewGet(id);
});
```

`viewAdd(type)`（`:75-86`）向 DataSource 读取该 type 的 meta、调 `meta.model.defaultData(this)` 生成初始数据、分配 `nanoid()`、写回数据源；`viewChangeType`（`:88-109`）切换视图类型时会查 `dataSource.viewConverts` 找到 `from→to` 的转换器迁移数据（如 kanban 转 table 保留 `groupBy`），没有则用默认数据。`viewGet`（`:125-129`）**每次都 `new meta.model.dataViewManager(this, id)`**——状态虽都在数据源，但构造并不轻量（会注册带 `effect` 的 trait，并可能排一次写入），UI 层按 `id + mode` 缓存而非随取随建（详见 [精讲](../重点包精讲/09-blocksuite-data-view.md)）。

### 3.4 SingleView：视图内的响应式投影

`SingleView`（`core/view-manager/single-view.ts:22-78`）把一个视图能看到的行/列/属性/变量全部暴露为 Signal：`rows$`、`properties$`、`propertyIds$`、`vars$`、`mainProperties$`（标题/图标/图片列）等。`SingleViewBase`（`:80+`）用 `data$ = computed(() => dataSource.viewDataGet(this.id))` 把自己绑定到数据源对应的那条视图数据，并提供 `propertyGetOrCreate` / `rowGetOrCreate` / `cellGetOrCreate` 惰性构造细粒度对象，以及 `traitGet(key)`（基于 `traitMap` 的能力查询）。

### 3.5 property 与 logical：可插拔的类型系统

`propertyType(type).modelConfig(ops)`（`core/property/property-config.ts:49+`）用同款链式工厂产出 `PropertyModel`，内含 `create`（建默认数据）与 `createPropertyMeta`（绑定渲染器）。`property-presets/` 下的 checkbox/date/image/multi-select/number/progress/select/text 共 8 种都是它的产物，经 `./property-presets` 子入口导出，可按需摇树。

`logical/` 是一套独立的**运行时逻辑类型系统**（`type-system`、`type-presets`、`composite-type`、`matcher`），用于描述属性值的类型、并让 filter/sort 根据类型匹配可用操作——这是把"筛选条件对什么类型的列可用"做成数据驱动的关键。

### 3.6 effects：集中注册自定义元素

`core/effect.ts` 的 `coreEffects()` 用 `customElements.define` 批量注册 core 的 Lit 组件（`affine-data-view-renderer`、`affine-multi-tag-select`、各 group 视图等）。`src/effects.ts`（子入口 `./effects`）汇总 core/view-presets 的 effects，被 `affine-foundation` 的 `effects()` 调用（见 `foundation/src/effects.ts:31,37`）——与 `ext-loader` 的 `effect()` 一次性机制配合，保证全局只注册一次。

## 4. 语法特色

- **链式工厂 + 泛型推断**：`viewType<Type>` / `propertyType<Type>`（`view/data-view.ts:65`、`property/property-config.ts:49`）用一串返回带下一步方法的对象，把 `Type` 字面量、`Data` 结构在调用链中逐级推断出来，调用方 `viewType('table')` 即锁定 `'table'` 字面量类型。
- **条件类型抽取泛型**：`GetDataFromDataViewModel<Model> = Model extends DataViewModel<infer _, infer R> ? R : never`（`view/data-view.ts:41-42`），用 `infer` 从模型类型里反解出数据类型。
- **Signal 成对 API**：接口里几乎每个读方法都有命令式与 `$` 响应式两版，基类用 `computed(() => this.xxxGet())` 统一派生（`data-source/base.ts:154-277`），既兼顾命令式调用又天然可观察。
- **抽象基类默认实现**：`DataSourceBase` 把 Signal 版全部默认实现、命令式版声明 `abstract`，子类只补命令式方法即可——典型的"模板方法 + 响应式派生"。
- **作用域化 DI 子容器**：`createScope('data-source')` + `container.provider(scope, parentProvider)`（`base.ts:104,161-163`）让每个数据源拥有独立服务作用域，又能回退父容器。
- **`new meta.model.dataViewManager(this, id)`**：把"类构造函数"存进数据，运行时按需 `new`（`view-manager.ts:128`），实现"视图类型 → 视图实现类"的数据驱动分派。

## 5. 设计 / 实现亮点

- **DataSource 适配层是全局解耦点**：引擎基本不感知数据库存储（但声明了 `yjs` 依赖、有三处直接使用 Yjs，类型上依赖 `affine-model`），`affine:database` 只是实现者之一。这让 data-view 可独立演进、独立测试，也为"接别的数据后端"留了口子。
- **全响应式投影**：从 DataSource 到 ViewManager 到 SingleView，视图层只是数据源之上的一串 `computed`，数据一变视图自动更新，不需要手写同步逻辑。
- **预设 + matcher 的可插拔横切能力**：property 类型、logical 类型、filter/sort/group-by 全部用"工厂产出 meta + matcher 按类型匹配"注册，新增一种列类型不改引擎核心。
- **视图模型与 UI 分离**：`ViewMeta` 把 `model`（数据）与 `renderer`（`pcLogic`/`mobileLogic`/`icon`，见 `view/data-view.ts:51-56`）拆开，同一数据模型可在 PC/移动端用不同 UI 逻辑渲染。
- **SingleView 无自有持久态**：状态都在数据源（构造会注册 trait 的 `effect`，UI 层按 `id + mode` 缓存），避免了"视图对象与数据不一致"的常见 bug。

## 6. 对外 API 与注意事项

- 主要导出：core（`DataSource`/`DataSourceBase`/`ViewManager`/`SingleView`/`viewType`/`propertyType`/logical 等）、`viewPresets`（`view-presets/index.ts`）、property-presets、widget-presets、`effects`。
- **约定**：接入新数据后端＝继承 `DataSourceBase` 实现其 `abstract` 命令式方法；新增视图＝`viewType(x).createModel({ dataViewManager: XxxSingleView, ... }).createMeta(renderer)`。
- **注意**：必须在应用启动时调用 `effects`（经 `affine-foundation`）注册自定义元素，否则 `affine-data-view-renderer` 等标签不渲染；视图实例 `viewGet` 每次新建，不要缓存其引用当单例用；`$` 结尾的是 Signal，读值用 `.value` 且只应在响应式上下文/`computed` 中依赖。
- `./property-pure-presets` 是不含 UI 副作用的纯属性预设入口，用于无需渲染的场景（如数据转换）。

## 7. 延伸

- 主要使用方：`@blocksuite/affine-block-database`（提供把数据库块适配成 `DataSource` 的实现）、`@blocksuite/affine-foundation`（装配 `dataViewEffects`）。
- 依赖的响应式底座：`@preact/signals-core`（`computed`/`signal`），与 L1 `@toeverything/infra` 的 `LiveData` 思路一致。
- 相关：同层 `@blocksuite/affine-model` 的 `database` 块模型（`ColumnDataType` 等），`@blocksuite/affine-shared` 的 `InsertToPosition`、telemetry 事件类型。
