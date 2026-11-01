# `@toeverything/infra`

> 一句话定位：AFFiNE 前端的**自研基础设施层**——提供一套轻量依赖注入容器（`Framework`）、响应式数据类型（`LiveData`）、把 Yjs 当数据库用的 ORM，以及跨 Worker/标签页的 Op RPC。它是 `@affine/core` 及几乎所有前端业务模块的地基。

| 项        | 值                                                                           |
| --------- | ---------------------------------------------------------------------------- |
| 目录      | `packages/common/infra`                                                      |
| 所属层    | L1 · 通用基础设施                                                            |
| 语言/形态 | TypeScript 库                                                                |
| 关键依赖  | `@preact/signals-core`、`rxjs`、`yjs`、`jotai`、`zod`、`nanoid`、`lodash-es` |
| 被谁依赖  | `@affine/core`、各前端业务模块、部分 BlockSuite 集成层                       |
| 对外入口  | `.`（Framework/LiveData）、`./op`、`./orm`、`./storage`、`./atom`、`./utils` |

## 1. 设计逻辑

AFFiNE 前端面对三个横切难题：**对象生命周期与依赖关系复杂**（服务、实体、存储层层嵌套且有作用域）、**数据高度响应式**（UI 需随数据变化自动更新）、**计算分散在多个线程**（主线程、SharedWorker、BroadcastChannel）。与其每个业务模块各自造轮子，AFFiNE 把这三件事沉淀为 `infra` 的三根支柱：

1. **`Framework`（DI 容器）**：声明式注册"接口 → 实现"，按作用域（global / workspace / doc…）解析，统一管理实例生命周期。
2. **`LiveData`（响应式）**：既是 RxJS `Observable` 又是 Signal 的"双形态"值，统一前端一切可观察状态。
3. **`ORM` + `Op`**：把 Yjs 当本地数据库（ORM），并用极简 RPC（Op）屏蔽跨线程通信样板。

**核心立场**：不引入 Angular/InversifyJS 这类重型 DI，而是自研一个"够用、类型安全、支持作用域与实体工厂"的最小容器——因为 AFFiNE 的作用域模型（文档/工作区嵌套）是框架不具备的特化需求。

## 2. 目录与关键文件

```text
src/
├── framework/              # DI 容器
│   └── core/
│       ├── framework.ts    # Framework / FrameworkEditor：注册 API（scope/service/entity/store/impl/override）
│       ├── identifier.ts   # createIdentifier<T>()：类型安全的注入标识符
│       ├── provider.ts     # FrameworkProvider / BasicFrameworkProvider：解析与缓存实例
│       ├── scope.ts        # 作用域机制
│       └── components/      # 五种组件原型：service / entity / store / scope / component
├── livedata/
│   ├── livedata.ts         # LiveData<T>：Observable + Signal 双形态
│   ├── ops.ts              # 响应式操作符
│   └── effect/             # 副作用封装
├── orm/                    # 把 Yjs 当数据库：schema / table / client / adapters
├── op/                     # 跨 Worker/标签页 的极简 RPC：client / consumer / message
├── storage/                # 存储抽象
├── atom/                   # jotai 原子封装
└── utils/                  # shallow-equal 等工具
```

## 3. 实现细节

### 3.1 Framework：注册与解析分离

`Framework` 是**注册期**构建器，`FrameworkProvider` 是**运行期**解析器。注册用链式 API：

```ts
// 来源：framework/core/framework.ts（方法签名）
framework.service(WorkspaceService, [DepA, DepB]); // 注册服务 + 声明依赖
framework.scope(WorkspaceScope).service(DocService); // 限定作用域
framework.impl(SomeIdentifier, Implementation); // 接口 → 实现
framework.override(Id, MockImpl); // 测试时覆盖
```

底层统一落到 `collection.addFactory` / `addValue`（见 `framework.ts:97-114`）：每个注册项要么是**工厂**（惰性构造 + 依赖解析），要么是**定值**。`impl` 其实是 `FrameworkEditor` 的语法糖（`framework.ts:62`），把 `addImpl(Id, Class, [deps])`、`addImpl(Id, Instance)`、`addImpl(Id, Factory)` 三种形态归一。

解析时 `FrameworkProvider.get(Identifier)` 按作用域栈（`FrameworkStackProvider`）向上查找，`ComponentCachePool` 缓存已构造实例，保证同作用域内单例。

### 3.2 五种组件原型

`framework/core/components/` 定义了五类注册目标，对应产品中的不同角色：

| 原型        | 角色                               | 生命周期               |
| ----------- | ---------------------------------- | ---------------------- |
| `service`   | 无状态/长生命周期业务服务          | 随作用域               |
| `entity`    | 有状态实体（如一个 Doc）           | 工厂按需创建、可多实例 |
| `store`     | 数据访问层                         | 随作用域               |
| `scope`     | 作用域锚点（global/workspace/doc） | 嵌套                   |
| `component` | 通用组件基类                       | —                      |

### 3.3 LiveData：一个值，两种消费方式

`LiveData<T>` 内部用 `@preact/signals-core` 的 `signal` 持有当前值，同时实现 RxJS `Observable` 接口（`livedata.ts` 顶部导入了大量 rxjs 操作符）。于是：

- 在 **Lit/命令式** 场景当 Signal 用（`.value`，细粒度依赖追踪）；
- 在 **RxJS 流式** 场景当 Observable 用（`.pipe(map, switchMap, ...)`）；
- 在 **React** 中通过 `useLiveData` 订阅。

关键巧思 **惰性上游**：`LiveData.from(upstream$, initial)` 用引用计数统计订阅者，只有存在订阅者时才订阅上游、无人订阅即退订，避免悬挂订阅泄漏。

### 3.4 Op：屏蔽跨线程样板

`op/` 是一个"前后端通用的微型 RPC"（见 `op/README.md`）。用 `OpSchema` 声明 `方法名: [入参, 返回]`，`consumer.register('add', fn)` 注册、`client.call('add', arg)` 调用，底层适配 Worker / SharedWorker / BroadcastChannel。nbstore 的 Worker 通信即建立在它之上。

### 3.5 ORM：把 Yjs 当数据库

`orm/core/` 提供 `schema` / `table` / `client`，把每张"表"映射到一个 YDoc，记录即 `Y.Map`。通过 `engine.doc.connectDoc` 接入 nbstore 获得持久化与同步能力——于是业务代码用熟悉的"表/记录"心智操作本地优先数据。

## 4. 语法特色

- **泛型标识符**：`createIdentifier<T>(name)`（`identifier.ts:79`）返回带幻影类型的 `Identifier<T>`，使 `framework.get(Id)` 的返回类型被精确推断——这是整套 DI 类型安全的关键。`createIdentifierFromConstructor` 用 `stableHash(target)` 给类生成稳定 id，支持"用类当标识符"。
- **方法重载**：`impl`/`service`/`store` 都用 TypeScript 重载同时支持 `(Id, Class, deps)`、`(Id, Instance)`、`(Id, Factory)` 三种调用形态，运行时在 `framework.ts:256-323` 按参数类型分派到 `addFactory`/`addValue`。
- **接口即 Observable**：`LiveData` 实现 `InteropObservable`（`Symbol.observable`），让它能无缝进入 RxJS 管道。
- **zod 运行时校验**：ORM/配置用 `zod` 在运行时校验 schema，弥补"类型擦除"后的运行时缺口（见 L1 的 `@affine/env`、第 5 章类型擦除）。

## 5. 设计 / 实现亮点

- **作用域化 DI**：global→workspace→doc 的嵌套作用域，让"当前文档的服务"自动隔离，切换文档即换一套实例——这是编辑器类应用的刚需，通用 DI 框架难以优雅表达。
- **双形态 LiveData**：一个类型同时服务 Lit（Signal）与 React/业务（RxJS），消除了"两套响应式"的割裂，是全前端状态统一的基石。
- **惰性上游 + 引用计数**：从源头杜绝订阅泄漏，大型响应式应用的常见隐患被框架层一次性解决。
- **Op 让多线程"像本地调用"**：nbstore 跑在 SharedWorker 却对业务透明，得益于 Op 的 `call/register` 抽象。

## 6. 对外 API 与注意事项

- 主入口导出 `Framework`、`LiveData`、`useLiveData` 等；子入口 `./op`、`./orm`、`./storage`、`./atom` 按需引入，利于摇树。
- **注意**：`get` 解析不到会抛错，可选依赖用 `getOptional`；实体（entity）是工厂多实例，不要误当单例缓存。
- DI 的作用域一旦注册错层，会出现"Missing dependency [X] in creating [Y]"——排查见 learning-guide 第 20 章常见坑表。

## 7. 延伸

- 同层：`@affine/nbstore`（建立在 Op/storage 之上）、`@affine/env`（提供 `BUILD_CONFIG`）。
- 上层：`@affine/core` 用 `configureXxxModule` 把业务模块注册进 `Framework`。
- 对应教程：learning-guide 第 20 章《前端基础设施：DI 与 LiveData》。
