# `@blocksuite/store`

> 一句话定位：BlockSuite 的**文档数据层**——把一棵"块树"持久化到 Yjs CRDT，同时向上暴露一套**响应式、强类型、可观察**的数据 API。它用 `Y.Map` 承载每个块、用 `defineBlockSchema` 描述块结构、用 Proxy + Preact Signal 把"改 JS 对象"自动翻译成"改 Yjs"（反之亦然），并用 `Transformer` 在块树与 JSON `Snapshot` 之间双向转换。编辑器里一切"数据"都从这里来。

| 项        | 值                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/framework/store`                                                                                    |
| 所属层    | L2 · 编辑器内核框架                                                                                             |
| 语言/形态 | TypeScript 库                                                                                                   |
| 关键依赖  | `yjs`、`@blocksuite/global`、`@blocksuite/sync`、`@preact/signals-core`、`zod`、`y-protocols`、`nanoid`、`lib0` |
| 被谁依赖  | `@blocksuite/std`、所有 `@blocksuite/affine-model`/`affine-block-*` 数据定义                                    |
| 对外入口  | `.`、`./test`                                                                                                   |

## 1. 设计逻辑

富文本/白板编辑器的数据层有三个硬约束，缺一不可：

1. **协同（CRDT）**：多人同时编辑不能冲突，必须基于 Yjs。但 Yjs 的 `Y.Map`/`Y.Array`/`Y.Text` API 是命令式、弱类型的，直接写业务代码会非常痛苦。
2. **响应式**：UI（Lit 组件）要随数据自动更新，需要细粒度 Signal。
3. **可移植**：复制粘贴、导入导出、跨文档迁移，需要一种与 Yjs 解耦的**纯 JSON 快照**格式。

`@blocksuite/store` 的核心设计就是**在 Yjs 之上架一层"双向响应式代理"**，让业务代码以为自己在操作普通 JS 对象，底层却是 CRDT：

- **`defineBlockSchema`**：声明式定义一种块（flavour）的 props、父子关系、版本、默认值。
- **`Block` / `BlockModel`**：运行期的块实例。`BlockModel.props` 是一个 `Proxy`，读写它会同步到底层 `Y.Map`；同时每个 prop 额外生成一个 `xxx$` Signal 供细粒度订阅。
- **`Store`**：一棵块树的门面，提供 `addBlock`/`updateBlock`/`deleteBlock`/`getParent` 等 CRUD，并把 Yjs 事件翻译成 `slots`（RxJS Subject）。
- **`reactive/`**：最底层的 `Y.Map↔对象`、`Y.Array↔数组`、`Y.Text↔Text`、`Boxed`（存原始对象）转换引擎。
- **`Transformer` + `Snapshot`**：块树 ↔ JSON 的双向序列化。
- **`Workspace` / `Doc`**：接口抽象，把"一个工作区里有多个文档、每个文档一个子 Y.Doc"的结构交给上层实现（store 只定义 interface）。

**边界**：`store` 不碰 DOM、不碰视图。它和 `@blocksuite/sync` 的分工是——sync 负责"Y.Doc 怎么和远端/本地存储同步"，store 负责"Y.Doc 里的数据怎么变成好用的块树"；store 通过 `Workspace.blobSync: BlobEngine` 等接口向 sync 要能力。

## 2. 目录与关键文件

```text
src/
├── index.ts               # 汇总导出；并用 __$BLOCKSUITE_STORE$__ 检测"重复打包"
├── consts.ts              # NATIVE_UNIQ_IDENTIFIER（Boxed 标记）等常量
├── schema/
│   ├── schema.ts          # Schema 类：注册/校验 flavour 的父子关系（支持 role 与通配）
│   └── error.ts           # SchemaValidateError
├── model/
│   ├── block/
│   │   ├── zod.ts         # BlockSchema(zod) + defineBlockSchema + internalPrimitives
│   │   ├── block-model.ts # BlockModel：props/children 的响应式封装
│   │   ├── block.ts       # Block：选 SyncController/FlatSyncController
│   │   ├── sync-controller.ts      # 核心！Y.Map ↔ model.props 双向绑定
│   │   ├── flat-sync-controller.ts # 扁平数据模型（isFlatData）
│   │   ├── draft.ts       # DraftModel：脱离 Yjs 的只读快照态
│   │   └── types.ts       # YBlock = Y.Map<unknown> 的类型精化
│   └── store/
│       ├── store.ts       # Store 门面（CRUD / transact / history / slots）
│       ├── crud.ts        # DocCRUD：直接操作 yBlocks 的底层增删改
│       ├── query.ts       # Query：按规则过滤块（blockViewType）
│       └── identifier.ts  # StoreIdentifier（DI）
├── reactive/
│   ├── proxy.ts           # ReactiveYArray / ReactiveYMap / createYProxy
│   ├── native-y.ts        # native2Y / y2Native：JS 值 ↔ Yjs 类型互转
│   ├── boxed.ts           # Boxed：把"原始对象"整体塞进一个 Y.Map
│   ├── text/              # Text：对 Y.Text 的富文本封装
│   ├── flat-native-y/     # 扁平化（点分 key）的 Y 绑定
│   ├── base-reactive-data.ts # BaseReactiveYData：observe/stash/skip 基类
│   └── memory.ts          # proxies：Y 对象 → 其响应式包装的 WeakMap 缓存
├── transformer/
│   ├── transformer.ts     # Transformer：block/doc/slice ↔ snapshot
│   ├── base.ts            # BaseBlockTransformer：props ↔ json 默认实现
│   ├── type.ts            # BlockSnapshot/DocSnapshot/SliceSnapshot + zod schema
│   ├── middleware.ts      # 导入导出中间件（slots）
│   ├── assets.ts          # AssetsManager：快照里的 blob 资源
│   └── slice.ts           # Slice：一段块的集合
├── extension/
│   ├── extension.ts       # Extension 基类（继承自 global DI 约定）
│   ├── store-extension.ts # StoreExtension：带 loaded/disposed 生命周期的扩展
│   ├── schema.ts          # BlockSchemaExtension / BlockSchemaIdentifier
│   ├── history/           # HistoryExtension（Y.UndoManager 封装）
│   ├── selection/         # StoreSelectionExtension + BaseSelection（选择状态）
│   └── workspace/         # Workspace / Doc / WorkspaceMeta 接口 + DocIdentifier
├── yjs/
│   └── awareness.ts       # AwarenessStore：光标/选区等 presence 状态
└── adapter/               # 与外部格式对接的 adapter 基类
```

## 3. 实现细节

### 3.1 定义一种块：`defineBlockSchema` 与 `Schema`

一种块叫一个 **flavour**（如 `affine:paragraph`）。`defineBlockSchema`（`model/block/zod.ts:53`）用重载同时提供"强类型声明"与"运行时校验"：

```ts
export const paragraph = defineBlockSchema({
  flavour: 'affine:paragraph',
  props: internal => ({ text: internal.Text(), type: 'text' }),
  metadata: { version: 1, role: 'content', parent: ['affine:note'] },
});
```

`props` 是一个**接收 `internalPrimitives` 的工厂**，而非静态对象——因为 `Text`/`Boxed` 这类 CRDT 包装必须每次新建实例。`internalPrimitives`（`model/block/zod.ts:20`）就是 `{ Text, Boxed }` 两个构造器。定义末尾 `BlockSchema.parse(schema)` 用 **zod** 做运行时校验，弥补 TS 类型擦除后的空缺。

所有 schema 注册进 `Schema` 类（`schema/schema.ts`），它维护 `flavourSchemaMap` 并负责**父子关系校验**。`validate(flavour, parentFlavour, childFlavours)` 会检查：root 块不能有父、非 root 块必须有父，以及 `parent`/`children` 约束。约束值既可以是 flavour，也可以是 `@role`（以 `@` 开头表示按角色匹配），还支持 `*` 通配和 `minimatch` 글로브（`schema/schema.ts:139-227`）——这让 "note 下只能放 content 角色的块" 这类规则得以声明式表达。

### 3.2 一个块的运行期结构：`Block` → `SyncController` → `BlockModel`

`Store` 为每个 `yBlock`（一个 `Y.Map`）创建一个 `Block`（`model/block/block.ts`）。`Block` 根据 schema 的 `isFlatData` 选择 `SyncController` 或 `FlatSyncController`，再由它造出 `BlockModel`。

一个 `yBlock`（`Y.Map`）的内部 key 有两类约定（`model/block/sync-controller.ts:245-274`）：

- `sys:*` 系统字段：`sys:id`、`sys:flavour`、`sys:version`、`sys:children`（一个 `Y.Array<string>`，存子块 id）。
- `prop:*` 业务字段：每个 schema `props` 对应一个 `prop:xxx`。

**`SyncController` 是整个数据层的心脏**（`model/block/sync-controller.ts`），它把 `yBlock` 和 `BlockModel.props` 双向绑定起来：

- **读 Yjs → 建 model**：`_parseYBlock` 遍历 `Y.Map`，把 `prop:*` 用 `createYProxy` 包成响应式代理；缺省的 props 用 schema 的默认值补齐并写回 Yjs。
- **model.props 是个 Proxy**（`sync-controller.ts:174-218`）：`set` 拦截器把赋值 `native2Y` 后写进 `yBlock.set('prop:x', ...)`；`deleteProperty` 同理删 Yjs key。于是 `model.props.type = 'h1'` 这一句普通赋值，实际触发了一次 Yjs 变更。
- **每个 prop 额外有一个 Signal**：`_createModel`（`sync-controller.ts:129-228`）为每个 prop 建一个 `signal(value)`，暴露为 `model.props['x$']`（命名加 `$` 后缀）。UI 可以 `model.props.type$` 细粒度订阅，而不必监听整个块。
- **Yjs → model 回流**：`_observeYBlockChanges`（`sync-controller.ts:38-85`）监听 `yBlock.observe`，远端/撤销等变更回来时，用 `_byPassUpdate` 绕过 Proxy 的写拦截（避免"回声"再写一次 Yjs），只更新本地 `props` 与对应 `$` Signal。它还用 `lib0` 的 `createMutex` 防止 Signal↔props 互相触发的死循环。

`BlockModel`（`model/block/block-model.ts`）在此之上管理**子节点响应式**：`sys:children` 这个 `Y.Array` 的变化被映射成 `_children` Signal，再 `computed` 出 `children`（真正的子 `BlockModel[]`）和 `childMap`。它还暴露 `created`/`deleted`/`propsUpdated` 三个 RxJS `Subject` 作为生命周期信号。

有一个精巧的类型技巧（`block-model.ts:11-13`）：

```ts
type SignaledProps<Props> = Props & {
  [P in keyof Props & string as `${P}$`]: Signal<Props[P]>;
};
```

它用**模板字面量键重映射**，让 `model.props` 的类型里既有 `type: string` 又自动有 `type$: Signal<string>`，IDE 能同时补全两者。

### 3.3 reactive：`Y.Map↔对象`、`Y.Array↔数组` 的递归代理

`reactive/` 是比 `SyncController` 更底层的通用引擎，处理**嵌套结构**。核心是一对互转函数（`reactive/native-y.ts`）：

- `native2Y(value)`：JS 值 → Yjs 类型。数组转 `Y.Array`、纯对象转 `Y.Map`、`Text`/`Boxed` 转其底层 Y 结构，递归进行。
- `y2Native(yAbstract)`：反向，并在每一层调用 `transform` 回调。

`createYProxy`（`reactive/proxy.ts:352`）据此把一个 Yjs 容器包成响应式代理：`Y.Array` → `ReactiveYArray`、`Y.Map` → `ReactiveYMap`。它们继承 `BaseReactiveYData`，`get` 时返回代理、`set`/`delete`/`splice`/`shift`/`unshift` 时**先改 Yjs 再改本地镜像**（`proxy.ts:50-192`）；同时 `observe` Yjs 事件把远端变更同步回镜像。两个关键守卫贯穿始终：

- `proxies`（`reactive/memory.ts`）是一个 `WeakMap<Y对象, 包装>`，保证**同一个 Y 对象只有一个代理**，`createYProxy` 开头先查缓存（`proxy.ts:356`）。
- 操作前强制校验 `this._ySource.doc` 存在，否则抛 `ReactiveProxyError('YData is not bound to a Y.Doc')`——未挂到文档的数据不允许改。

`Boxed`（`reactive/boxed.ts`）是一个逃生舱：当你想把一个**原始对象整体**存进 Yjs、自己管理而不要 store 递归代理它时，用 `new Boxed(obj)`。它内部是一个带 `type: NATIVE_UNIQ_IDENTIFIER` 标记的 `Y.Map`，`Boxed.is(v)` 靠这个标记识别。

### 3.4 Store：块树门面与"Yjs 事件 → slots"翻译

`Store`（`model/store/store.ts`）是业务最常打交道的类。构造时它建一个 DI `Container`，注册内部扩展（`StoreSelectionExtension`、`HistoryExtension`）和用户扩展，从 DI 取出 `Doc`（`DocIdentifier`）与已注册的 `BlockSchema`，再建 `DocCRUD`（`store.ts:562-609`）。

- **CRUD**：`addBlock`/`updateBlock`/`deleteBlock`/`moveBlocks` 都在 `transact` 里调 `DocCRUD` 直接操作 `yBlocks`（`store.ts:743-970`）。`updateBlock` 在写前会 `schema.validate` 校验父子合法性。
- **只读与历史**：`readonly` 用 Signal 承载（`readonly$`）；`undo`/`redo`/`captureSync` 转发给 `HistoryExtension`（底层 `Y.UndoManager`）。
- **事务**：`transact(fn)` 包 `spaceDoc.transact`，并用 `clientID` 当 origin，使 Yjs 事件能分辨本地/远端（`store.ts:371-386`）。
- **Yjs 事件 → slots**：构造时 `_yBlocks.observeDeep(this._handleYEvents)`。`_handleYEvent`（`store.ts:1266-1293`）只关心顶层 `yBlocks` 的 add/delete，判断 `isLocal` 后发到 `slots.yBlockUpdated`；`_subscribeToSlots` 再据此 `_onBlockAdded`/`_onBlockRemoved`，建/销 `Block` 实例，并对外发 `slots.blockUpdated`（add/delete/update 三类载荷）、`rootAdded`/`rootDeleted`、`ready`。所有 slot 都是 RxJS `Subject`，业务层用 `.subscribe()` 或 rxjs 操作符消费。
- **`getBlock` vs `getBlock$`**：前者 `_blocks.peek()`（读值不订阅），后者 `_blocks.value`（在 computed/effect 里会建立依赖）——`$` 后缀=响应式，是全包统一约定。

### 3.5 Transformer 与 Snapshot：块树 ↔ 纯 JSON

`Snapshot` 是与 Yjs 完全解耦的 JSON 树（`transformer/type.ts`），用 zod 定义并自校验：`BlockSnapshot`（`{type:'block', id, flavour, props, children[]}`）、`DocSnapshot`（含 meta）、`SliceSnapshot`（一段块）。`BlockSnapshotSchema` 用 `z.lazy(() => ...)` 表达**递归 children**（`type.ts:21`）。

`Transformer`（`transformer/transformer.ts`）提供六向转换：`blockToSnapshot`/`docToSnapshot`/`sliceToSnapshot` 导出，`snapshotToBlock`/`snapshotToDoc`/`snapshotToSlice` 导入。每种 flavour 可在 schema 里挂 `transformer` 自定义 props↔json 逻辑，默认走 `BaseBlockTransformer`（`transformer/base.ts`，用 `toJSON`/`fromJSON` 递归处理 `Text`/`Boxed`）。导入是**异步 + 分批**的：`_insertBlockTree` 每插 `BATCH_SIZE=100` 个块就 `await nextTick()` 让出主线程（`transformer.ts:571-573`），避免大文档导入卡死 UI。全流程还穿插 `beforeExport`/`afterImport` 等**中间件 slots**，供上层注入资源处理、ID 重写等逻辑。

### 3.6 扩展与协同状态

`StoreExtension`（`extension/store-extension.ts`）是带生命周期（`loaded`/`disposed`）的扩展基类，它用 `storeExtensionSymbol` 做类型守卫，`setup` 时把自己注册进 DI 并要求子类定义唯一 `key`。`StoreSelectionExtension`（`extension/selection/selection-extension.ts`）就是典型：它用 Signal 持有本地选区、监听 `awareness` 的 `change` 还原**远端选区**（`_remoteSelections`），并挂到 `Y.UndoManager` 的 `stack-item-added/popped` 以便撤销时恢复选区。`AwarenessStore`（`yjs/awareness.ts`）封装 `y-protocols` 的 `Awareness`，把多人光标/选区放在 `selectionV2` 字段里广播。

## 4. 语法特色

- **模板字面量键重映射**：`SignaledProps<Props>` 用 `[P in keyof Props & string as \`${P}$\`]`自动派生出`xxx$: Signal<...>` 伴生类型（`block-model.ts:11`），让一个声明同时拥有值和 Signal 两套 API 的类型。
- **zod 作"运行时类型"**：`BlockSchema`/`BlockSnapshotSchema` 既是校验器又是类型源（`z.infer`）。`z.function().args(...).returns(...)` 甚至给 `props`/`toModel`/`transformer` 这些**函数字段**做签名校验（`model/block/zod.ts:33-44`）；`z.lazy` 表达递归结构。
- **Proxy 元编程**：`SyncController` 与 `ReactiveYMap/Array` 大量用 `new Proxy(target, { get/set/deleteProperty })` + `Reflect.*`，把"改对象"透明翻译成"改 Yjs"。这是整个"看起来像普通对象、其实是 CRDT"幻觉的实现手段。
- **`Symbol` 做私有标记与可释放协议**：`BlockModel` 用 `const modelLabel = Symbol('model_label')` 携带幻影泛型（规避 TS 泛型类推断问题，`block-model.ts:15,59`）；并实现 `[Symbol.dispose]()`（显式资源管理提案）。`Boxed` 用 `NATIVE_UNIQ_IDENTIFIER` 字符串标记做 `is` 判定。
- **Yjs API 精化类型**：`YBlock = Y.Map<unknown> & { get(prop:'sys:children'): Y.Array<string>; ... }`（`model/block/types.ts`）用交叉类型给 `get` 加重载，让 `yBlock.get('sys:children')` 直接拿到 `Y.Array` 类型。
- **`satisfies` 校验形状**：`defineBlockSchema` 内 `const schema = {...} satisfies z.infer<typeof BlockSchema>`，在不拓宽类型的前提下确保结构匹配（`model/block/zod.ts:114`）。
- **防重复打包的运行时自检**：`index.ts:17-23` 在 `globalThis` 挂 `__$BLOCKSUITE_STORE$__` 标记，二次 import 时 `console.error`——因为 Yjs 的 `instanceof` 依赖单例构造器，重复打包会引发隐蔽 bug。

## 5. 设计 / 实现亮点

- **"普通对象语义 + CRDT 底座"**：`model.props.x = v` 即协同写入，开发者几乎无需感知 Yjs，这是 store 最大的价值。实现靠 Proxy 双向拦截 + `native2Y`/`y2Native` 递归转换。
- **值与 Signal 并行暴露（`x` 与 `x$`）**：既能命令式读写，又能细粒度响应式订阅，统一了 BlockSuite 全栈的响应式心智（与 global 的 `SignalWatcher` 配合）。
- **`WeakMap` 单例代理 + mutex 防回声**：`proxies` 缓存保证一个 Y 对象只有一个响应式包装；`createMutex` 和 `_byPassUpdate`/`_skipNext` 守卫彻底解决"本地改→Yjs 事件→又改本地"的死循环，这是双向绑定最易踩的坑。
- **Snapshot 与 Yjs 解耦**：复制粘贴、持久化、跨端迁移都走纯 JSON，不受 CRDT 内部格式约束；导入分批让出主线程，兼顾大文档性能。
- **schema 校验声明式化**：父子关系支持 flavour / `@role` / 通配，复杂的块嵌套规则不用散落在业务代码里硬编码。
- **DI 驱动的可插拔**：Store/扩展/Schema 全经 `@blocksuite/global` 的 DI 注册，上层按需组合，保证内核可裁剪。

## 6. 对外 API 与注意事项

- 常用入口：`Store`（CRUD/transact/slots）、`BlockModel`（`props`/`props.x$`/`children`）、`defineBlockSchema`、`Transformer`、`Text`/`Boxed`、`Schema`。`Workspace`/`Doc` 是**接口**，具体实现由上层（如 AFFiNE 的 nbstore 集成）提供。
- **改数据务必在 `store.transact` 内**（CRUD 方法已自带）。脱离 Yjs 文档的响应式对象直接写会抛 `ReactiveProxyError`。
- **`getBlock`（peek）与 `getBlock$`（响应式）别用混**：在 `computed`/`effect`/render 里要用 `$` 版本才能建立依赖。
- **`props` 访问限制**：非 flatData 模型直接读 `model.props` 没问题，但其 getter 要求模型已初始化；`props is only supported in flat data model` 的报错多来自错误地在裸 `BlockModel` 上访问。
- **version 不一致**：schema 升级后旧数据的 `sys:version` 与 schema version 不符时，上层需做迁移（`MigrationError`）；store 本身在解析时会用 schema version 兜底。
- **不要重复打包**：monorepo 里确保 `@blocksuite/store`/`yjs` 单实例，否则命中 `__$BLOCKSUITE_STORE$__` 警告并出现 `instanceof` 诡异失败。

## 7. 延伸

- 同层：`@blocksuite/sync`（提供 `BlobEngine` 等同步能力，被 `Workspace` 引用）、`@blocksuite/std`（视图层，消费 `Store`/`BlockModel`）、`@blocksuite/global`（DI、异常、Signal 桥）。
- 上层：`@blocksuite/affine-model` 用 `defineBlockSchema` 定义具体块；`@blocksuite/affine-shared` 的 transformer 中间件做格式转换。
- 对应教程：learning-guide 第 16 章《BlockSuite 架构与 Store 数据层》。
