# `@affine/core`

> 一句话定位：AFFiNE 前端的**业务总成包**——它用 `@toeverything/infra` 的 `Framework` 把 70 个业务 `module` 装配成一个带作用域的依赖注入世界，用 `@blocksuite/affine` 门面把编辑器内核接进来，再向 web / electron / mobile 各端 `app` 输出同一套业务逻辑与大部分 UI。这是全工程体量最大的包，"把编辑器内核装进真正产品"的那层胶水与骨架都在这里。

| 项        | 值                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/core`                                                                                                                                                    |
| 所属层    | L4 · 前端应用（业务总成）                                                                                                                                                   |
| 语言/形态 | TypeScript / React 库（被各 `app` 消费，自身不含最终打包入口）                                                                                                              |
| 关键依赖  | `@toeverything/infra`（DI/LiveData）、`@blocksuite/affine`（编辑器门面）、`@affine/nbstore`（本地优先存储）、`@affine/graphql`、`@affine/component`、`react`、`rxjs`、`yjs` |
| 被谁依赖  | `apps/web`、`apps/electron-renderer`、`apps/mobile`、`apps/ios`、`apps/android`                                                                                             |
| 对外入口  | `./*`（直接映射 `./src/*`）、`./bootstrap`                                                                                                                                  |

## 1. 设计逻辑

`@affine/core` 要解决的根本矛盾是：**一个本地优先、多端、带复杂作用域的生产力应用，如何把成百上千个业务概念（文档、工作区、账号、权限、分享、导航、面板……）组织得既解耦又可组合**。它的答案不是分层 MVC，而是**模块化 DI + 实体工厂 + 响应式数据流**三件套，全部构建在 L1 `@toeverything/infra` 之上（见 `toeverything-infra.md`）。

核心立场有三条：

1. **一切皆 module，一切经 `Framework` 注册**。`src/modules/` 下 70 个子目录各是一个业务域，每个导出一个 `configureXxxModule(framework)` 函数；`src/modules/index.ts` 的 `configureCommonModules` 把它们串成一条注册流水线（`modules/index.ts:73-139`）。注册与解析分离——core 只负责"声明接口→实现+依赖"，运行期由 `FrameworkProvider` 按作用域惰性构造。

2. **作用域对应产品的生命周期层级**。infra 的 `Scope` 机制在 core 里被实化为三条主轴：**global**（应用级，`framework` 顶层直接注册的服务）、**workspace**（`WorkspaceScope`，一个工作区一套实例）、**doc**（`DocScope`，打开一篇文档才创建）。cloud 还另开了 **server** 作用域（`ServerScope`，一台后端服务器一套实例）。切换工作区即换一整套 workspace 作用域实例，切换文档即换一套 doc 作用域实例，互不串扰。

3. **编辑器内核经门面接入，而非散依赖**。core 只认 `@blocksuite/affine` 一个包名（见 `blocksuite-affine.md`），在 `src/blocksuite/` 里把门面提供的"内置扩展全家桶"与 core 自己的 app 专属扩展拼成 `ViewExtensionManager`。

与同层 `app` 的边界很清楚：**`app` 只做"组装 + 注入宿主能力"**（`new Framework()`、挑平台模块、填 `NbstoreProvider`/`PopupWindowProvider` 这类平台实现），**`core` 提供全部业务逻辑与绝大多数视图**。因此 web 与 mobile 的 `app.tsx` 高度雷同，差异仅在"挑哪些 module、填哪些 impl"。

## 2. 目录与关键文件

```text
src/
├── bootstrap/              # 应用引导（被 app 在最早期 import，ORDER MATTERS）
│   ├── browser.ts          # 浏览器引导序列：env → public-path → polyfill → telemetry
│   ├── electron.ts         # 桌面端引导序列
│   ├── env.ts / public-path.ts / telemetry.ts / cleanup.ts
│   └── polyfill/
├── modules/                # ★ 70 个业务域，core 的主体
│   ├── index.ts            # configureCommonModules(framework)：注册流水线
│   ├── doc/                # 文档域（DocScope）
│   ├── workspace/          # 工作区域（WorkspaceScope）
│   ├── workbench/          # 多标签工作台与视图/导航（ViewScope）
│   ├── cloud/              # 账号/服务器/订阅/配额（ServerScope）
│   ├── permissions/ storage/ db/ navigation/ editor/ peek-view/ …
│   └── <每个 module 内部>: entities/ services/ stores/ scopes/ views|view/ events/ providers/ index.ts
├── blocksuite/             # 与编辑器内核的集成适配层
│   ├── manager/{view,store}.ts    # 构造 ViewExtensionManager/StoreExtensionManager 并 configure
│   ├── view-extensions/           # core 自有的 app 专属 ViewExtension（theme/cloud/pdf/ai/mobile…）
│   ├── block-suite-editor/ editors/ initialization/ …
├── commands/               # 命令面板注册（affine-navigation/creation/settings… + registry/）
├── components/             # 跨端共享 React 组件（如 root-app-sidebar）
├── desktop/                # 桌面/浏览器端入口：router.tsx、pages、route-paths.ts
├── mobile/                 # 移动端入口：router.tsx、modules/（移动专属模块）、views、pages
├── types/                  # 共享类型（dnd.ts、types.d.ts）
└── utils/                  # 工具（clipboard、fuzzy-match、create-emotion-cache…）
```

一个 module 的"标准构成"（以 `doc/` 为例）：`entities/`（有状态实体）、`services/`（业务服务）、`stores/`（数据访问层）、`scopes/`（作用域锚点）、`events/`（事件类型）、`providers/`（可被 app 覆盖的接口）、`index.ts`（具名导出 + `configureXxxModule`）。

## 3. 实现细节

### 3.1 一条注册流水线：`configureCommonModules`

`modules/index.ts` 把 70 个 `configureXxxModule` 顺序调用（`modules/index.ts:73-139`）。顺序有讲究——被依赖的域先注册（`configureWorkspaceModule` 在 `configureDocModule` 之前，`configureCloudModule` 在依赖它的 `configureQuotaModule`/`configurePermissionsModule` 之前）。`app` 拿到同一个 `framework` 后再追加平台模块：

```ts
// 来源：apps/web/src/app.tsx:56-66
const framework = new Framework();
configureCommonModules(framework); // ← core 的 70 个公共模块
configureBrowserWorkbenchModule(framework); // ← 平台特化：浏览器版工作台
configureLocalStorageStateStorageImpls(framework);
configureBrowserWorkspaceFlavours(framework);
framework.impl(NbstoreProvider, {/* 平台存储实现 */});
framework.impl(PopupWindowProvider, {/* 平台开窗实现 */});
const frameworkProvider = framework.provider(); // ← 注册期结束，转入运行期
```

### 3.2 一个典型 module 的 `configure`：`doc`

`configureDocModule` 是"作用域 + service/store/entity 三原型"的教科书样例（`doc/index.ts:26-41`）：

```ts
framework
  .scope(WorkspaceScope) // 以下都挂在 workspace 作用域
  .service(DocsService, [DocsStore, DocPropertiesStore, [DocCreateMiddleware]])
  .store(DocPropertiesStore, [WorkspaceService, WorkspaceDBService])
  .store(DocsStore, [WorkspaceService, DocPropertiesStore])
  .entity(DocRecord, [DocsStore, DocPropertiesStore])
  .entity(DocRecordList, [DocsStore])
  .scope(DocScope) // 切入更内层的 doc 作用域
  .entity(Doc, [DocScope, DocsStore, WorkspaceService])
  .service(DocService);
```

几点值得读：

- **链式作用域切换**：`.scope(WorkspaceScope)...` 一段注册在工作区级，`.scope(DocScope)` 之后注册在文档级。`Doc` 实体依赖 `DocScope`，意味着它只能在"某篇文档"的作用域里被构造。
- **数组即依赖声明**：`.service(DocsService, [A, B, [C]])` 第二参是依赖标识符列表；嵌套数组 `[DocCreateMiddleware]` 表示"注入所有已注册的该类型"（多实例集合，用于中间件）。
- **三原型分工**：`DocsStore`/`DocPropertiesStore` 是**数据访问层**（直接操作 Yjs），`DocsService` 是**业务服务**（无状态、长生命周期），`DocRecord`/`Doc` 是**有状态实体**（可多实例）。

### 3.3 分层样例：store → entity → service 如何协作

**store（数据层，继承 infra 的 `Store`）**直接把 Yjs 当数据库操作。`DocsStore.createDoc` 用 `transact` 往 `rootYDoc` 的 `meta.pages` 里 push 一个 `Y.Map`（`doc/stores/docs.ts:37-64`），`watchDocIds` 用 `yjsGetPath(...).pipe(...)` 把 Yjs 变化转成 RxJS 流——这正是 infra ORM/响应式的落地。

**entity（有状态实体，继承 `Entity`）**持有"一篇活着的文档"。`Doc` 构造时订阅 `yDoc.on('afterTransaction')`、给引擎加载优先级，并把这些清理逻辑 push 进 `this.disposables`（`doc/entities/doc.ts:11-45`）。它的 `title$`/`trash$`/`updatedAt$` 等全是 `LiveData`，直接代理自内部 `record`（`doc/entities/doc.ts:62-70`）。

**service（业务服务，继承 `Service`）**编排一切。`DocService` 极薄——用 `this.framework.createEntity(Doc)` 产出当前作用域的那篇文档（`doc/services/doc.ts:6`）。`DocsService` 则厚重：它用 `ObjectPool` 缓存已打开的 `Doc`，`open(docId)` 时**现场创建一个 doc 作用域**再取服务（`doc/services/docs.ts:120-141`）：

```ts
// 来源：doc/services/docs.ts:120-139
const docScope = this.framework.createScope(DocScope, {
  docId,
  blockSuiteDoc,
  record: docRecord, // ← 注入作用域 props
});
blockSuiteDoc.load();
const doc = docScope.get(DocService).doc; // ← 在该作用域内解析 DocService
const { obj, release } = this.pool.put(docId, doc);
```

`DocScope` 本身只是个带类型 props 的锚点（`doc/scopes/doc.ts:6-10`）：`Scope<{ docId: string; record: DocRecord; blockSuiteDoc: Store }>`。作用域 props 让"当前文档是哪篇"成为可注入的、类型安全的上下文。

`WorkspaceService` 同理，惰性 `createEntity(Workspace)` 并在 `dispose` 时销毁（`workspace/services/workspace.ts:5-18`）——于是"当前工作区"也是作用域内单例。

### 3.4 cloud：第四条作用域轴与 `getOptional`

`configureCloudModule` 展示了 global 服务 + `ServerScope` 的混合（`cloud/index.ts:124-198`）。`ServersService`/`RealtimeService` 是全局单例，而 `ServerService`/`FetchService`/`GraphQLService`/`AuthService` 都挂在 `.scope(ServerScope)` 下——因为自建服务器（self-host）可接入多台后端，每台一套鉴权与请求栈。注意 `CaptchaService` 用了**工厂形态**注册并调 `getOptional` 取可选依赖：

```ts
// 来源：cloud/index.ts:140-146
.service(CaptchaService, f => new CaptchaService(
  f.get(ServerService),
  f.get(FetchService),
  f.getOptional(ValidatorProvider),   // ← 可选依赖，未注册则为 undefined，不抛错
))
```

### 3.5 blocksuite 集成：备料来自门面，装配在 core

`src/blocksuite/manager/view.ts` 把门面的 `getInternalViewExtensions()` 与 core 自有扩展拼成一个 `ViewExtensionManager`（`manager/view.ts:87-105`）：

```ts
this._manager = new ViewExtensionManager([
  ...getInternalViewExtensions(), // ← @blocksuite/affine 门面的内置全家桶
  AffineThemeViewExtension,
  AffineEditorViewExtension,
  CloudViewExtension,
  PdfViewExtension,
  MobileViewExtension,
  AIViewExtension,
  ElectronViewExtension,
  CommentViewExtension /* … */,
]);
```

随后用链式 `config.foundation(framework).editorView(...).cloud(...).mobile(...)` 把宿主能力（`FrameworkProvider`、各 service）注入到这些扩展里（`manager/view.ts:112-199` 的 `Configure` 类型）。这条链印证了门面文档的分界：**`@blocksuite/affine` 备料、`@affine/core` 配置实例化、`ext-loader` 的 Manager 按 scope 装配**。

## 4. 语法特色

- **DI 泛型 + 构造即标识符**：`framework.service(DocsService, [...])` 里类直接当标识符用，infra 的 `createIdentifierFromConstructor` 为其生成稳定 id，`provider.get(DocsService)` 的返回类型被精确推断成 `DocsService`——全链路无 `as` 断言。
- **抽象基类三原型**：`class DocsStore extends Store`、`class Doc extends Entity`、`class DocService extends Service`（分别见各文件首行）。继承即声明角色，`Entity`/`Service` 自带 `disposables`/`framework`/`eventBus`，子类无需重复搭建生命周期。
- **`LiveData` 作后缀 `$` 约定**：实体上所有可观察字段以 `$` 结尾（`title$`、`trash$`、`updatedAt$`），既是 RxJS `Observable` 又是 Signal。React 侧用 `useLiveData(service.xxx$)` 订阅、`useService(SomeService)` 取实例（`components/root-app-sidebar/trash-button.tsx:17-21`）：

```ts
const docsService = useService(DocsService);
const trashActive = useLiveData(globalContextService.globalContext.isTrash.$);
```

- **作用域 props 的类型化**：`Scope<{ docId: string; record: DocRecord; blockSuiteDoc: Store }>` 用泛型把"作用域上下文"固化成类型，`this.scope.props.docId` 读取时有完整类型（`doc/entities/doc.ts:54-59`）。
- **依赖数组的嵌套语义**：`[DocsStore, [DocCreateMiddleware]]` 中裸标识符是"取一个"，`[X]` 包一层是"取全部该类型实例"——用数组结构编码"单例 vs 集合"两种注入语义。
- **工厂形态注册**：当依赖需运行时判断（可选、条件）时，用 `(f) => new X(f.get(A), f.getOptional(B))` 取代声明式数组（`cloud/index.ts:140`）。

## 5. 设计 / 实现亮点

- **模块化 DI 架构**：70 个 module 各自 `configureXxxModule`，彼此只通过导出的标识符耦合，新增/删除一个业务域就是在 `configureCommonModules` 里加/减一行——大型前端的可维护性来源于此。
- **作用域即生命周期**：global→workspace→doc（+server）四轴嵌套，让"当前文档的服务""当前工作区的引擎""当前服务器的鉴权"自动隔离与回收。`DocsService` 的 `ObjectPool` + `createScope`/`release` 把"打开/关闭文档"实现成作用域的创建/销毁，无内存泄漏。
- **本地优先与 nbstore 衔接**：store 层直接操作 Yjs（`DocsStore` 的 `transact`/`yjsGetPath`），持久化与多端同步由 `WorkspaceEngine` 经 `NbstoreService` 下沉到 SharedWorker 里的 `@affine/nbstore`——业务代码用"表/记录/LiveData"心智，感知不到跨线程与网络。
- **跨端同构**：web/mobile 的 `app.tsx` 共用 `configureCommonModules`，仅在挑平台模块（`configureBrowserWorkbenchModule`）与填平台 impl（`NbstoreProvider`/`PopupWindowProvider`）上分叉。`workbench` 更把这种分叉做进框架——同一 `configureWorkbenchCommonModule` 配不同 impl：

```ts
// 来源：workbench/index.ts:53-77
export function configureBrowserWorkbenchModule(services: Framework) {
  configureWorkbenchCommonModule(services);
  services
    .scope(WorkspaceScope)
    .impl(WorkbenchDefaultState, InMemoryWorkbenchDefaultState)
    .impl(WorkbenchNewTabHandler, () => BrowserWorkbenchNewTabHandler);
}
export function configureDesktopWorkbenchModule(services: Framework) {
  configureWorkbenchCommonModule(services);
  services
    .scope(WorkspaceScope)
    .impl(WorkbenchDefaultState, DesktopWorkbenchDefaultState, [
      GlobalStateService,
      DesktopApiService,
    ])
    .impl(WorkbenchNewTabHandler, DesktopWorkbenchNewTabHandler, [
      DesktopApiService,
    ])
    .service(DesktopStateSynchronizer, [
      WorkbenchService,
      DesktopApiService,
      PeekViewService,
    ]);
}
```

公共逻辑一份、平台差异收敛在 `impl` 覆盖与少量平台 service——这是"同构"的精髓。

- **门面隔离编辑器内核**：core 只依赖 `@blocksuite/affine` 一个包与其子路径，BlockSuite 内部几十个包的演化被门面吸收，core 的集成层只在 `blocksuite/manager/` 做一次装配。

## 6. 对外 API 与注意事项

- **主要导出**：按 `./*` 直接映射源码，`app` 通常从 `@affine/core/modules/<domain>` 具名引入（如 `import { DocsService } from '@affine/core/modules/doc'`），从 `@affine/core/modules` 引入 `configureCommonModules`，从 `@affine/core/bootstrap` 引入引导副作用。
- **引导顺序**：`bootstrap/browser.ts` 注释 `ORDER MATTERS`——`env` 必须最先（注入 `BUILD_CONFIG`），`public-path`、`polyfill`、`telemetry` 依次其后；`app` 应在业务代码前 import 它。
- **注册顺序**：`configureCommonModules` 中被依赖的模块需先注册，否则运行期 `get` 会抛 `Missing dependency`。新增 module 要在此函数登记。
- **作用域错层**：把本应在 `WorkspaceScope`/`DocScope` 的服务注册到 global，或反之，会导致解析失败或实例串扰。实体（`entity`）是工厂多实例，别当单例缓存——要缓存请像 `DocsService` 那样显式用 `ObjectPool` + `release`。
- **`core` 不自带 `new Framework()`**：它只提供 `configureXxxModule`，容器的创建、平台 impl 的填充、`framework.provider()` 的时机都由各 `app` 掌握（见 `apps/web/src/app.tsx`、`apps/mobile/src/app.tsx`）。

## 7. 延伸

- 地基：L1 `@toeverything/infra`（`Framework`/`Scope`/`LiveData`/ORM，见 `toeverything-infra.md`）——core 是它最大的使用者；`@affine/nbstore`（本地优先存储与同步，经 `NbstoreService` 衔接）。
- 编辑器：L3 `@blocksuite/affine`（聚合门面，见 `blocksuite-affine.md`）——core 在 `blocksuite/manager/` 消费其两份扩展清单与 `AffineSchemas`。
- 使用方：`apps/web`、`apps/electron-renderer`、`apps/mobile`、`apps/ios`、`apps/android`——它们挑平台模块、填平台 impl、构造 `Framework` 并渲染 `FrameworkRoot`。
- 对应教程：learning-guide 第 20 章（DI 与 LiveData）为前置，第 21–24 章讲 `@affine/core` 的模块化架构、作用域模型、本地优先数据流与跨端同构。
