# `@affine/server`

> 一句话定位：AFFiNE 的**全栈后端核心**——一个基于 NestJS 的单仓库服务端，用依赖注入组织 28 个业务模块与 9 个可插拔插件，对外暴露 code-first 的 GraphQL API、文档协同的 socket.io 网关与 REST 控制器，对内以 Prisma 访问 PostgreSQL、以 `@affine/server-native`（Rust）承载计算密集与安全敏感的"控制面"逻辑。它是前端一切数据、权限、协同、计费、AI 能力的来源。

| 项        | 值                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/backend/server`                                                                                                                                                 |
| 所属层    | L6 · 后端                                                                                                                                                                 |
| 语言/形态 | TypeScript / NestJS 应用                                                                                                                                                  |
| 关键依赖  | `@nestjs/*`、`@nestjs/graphql`+`@apollo/server`、`@prisma/client`、`nestjs-cls`+`@nestjs-cls/transactional`、`socket.io`、`@affine/server-native`、`ioredis`、`commander` |
| 被谁依赖  | 前端经网络消费：`@affine/graphql`（codegen 读 `schema.gql`）、`@affine/error`（镜像 `USER_FRIENDLY_ERRORS`）、`@affine/nbstore`（同步协议）                               |
| 对外入口  | `src/index.ts`（进程入口：server 或 cli）；网络面 `/graphql`、socket.io、若干 REST                                                                                        |

## 1. 设计逻辑

后端面对的核心矛盾是：**单一代码库要同时扮演多种进程角色**——对外的 GraphQL API 服务、文档实时同步服务、渲染服务、静态前端服务、以及后台队列 worker。AFFiNE 没有拆成多个微服务仓库，而是用一套代码 + 一个 `Flavor` 开关在启动期**按角色装配不同的 NestJS 模块子集**。

这套装配逻辑集中在 `app.module.ts` 的 `buildAppModule(env)`（`app.module.ts:161`）：`AppModuleBuilder` 提供 `use` / `useIf(predicate, ...modules)` 两个链式方法，根据 `env.flavors`（graphql / sync / renderer / front / worker / script）决定导入哪些模块。例如 `GqlModule`、`WorkspaceModule`、`PaymentModule`、`CopilotModule` 只在 `env.flavors.graphql` 为真时装配；`DocJobsModule`、各 `*WorkerModule` 只在 worker 角色装配（`app.module.ts:173-205`）。于是**同一镜像**可通过环境变量 `SERVER_FLAVOR` 部署成 API 节点、同步节点或 worker 节点。

围绕这个"可变装配"的骨架，代码分三个同心圆：

1. **`base/`——框架级基础设施**：配置、错误、日志、事件总线、缓存、分布式锁、GraphQL/Prisma/Redis/WebSocket 的接入。这些是业务无关的横切能力，`FunctionalityModules`（`app.module.ts:71`）无条件全量装配。
2. **`core/`——业务领域模块**（28 个）：auth、workspaces、doc、sync、permission、quota、storage、user、notification、comment、realtime 等，是产品的主干。
3. **`plugins/`——可插拔能力**（9 个）：payment、copilot、oauth、license、indexer、captcha、calendar、gcloud、worker。它们可被 flavor/配置整体开关，承载"非必须但增值"的功能。

**核心立场**：业务逻辑尽量下沉到 NestJS 的"模块 + 服务"里用 DI 组织；而**权限判定、配额计费、搜索、Yjs 解析、LLM 调度等"要么计算密集、要么必须强一致/防篡改"的逻辑，统一下沉到 Rust 的 `@affine/server-native`**（见 `BackendRuntimeProvider` / `native.ts`）。TS 层退化为"编排 + 持久化 + 协议适配"，Rust 层做"控制面决策"。这是本后端最重要的架构取舍（详见第 5 章与 affine-server-native.md）。

## 2. 目录与关键文件

```text
packages/backend/server/src/
├── index.ts                 # 进程入口：script→runCli，否则 runServer
├── app.module.ts            # buildAppModule(env)：按 flavor 装配模块（全工程装配中枢）
├── server.ts / cli.ts       # 两种启动形态（HTTP 服务 / 数据迁移 CLI，基于 commander）
├── env.ts                   # Env：Flavor/ServerRole/Namespace 判定；持有 native ServerConfigHandle
├── native.ts                # @affine/server-native 的 TS 门面（重导出 + 包装）
├── schema.gql               # code-first 自动生成的 GraphQL SDL（禁止手改）
├── base/                    # 框架级基础设施（业务无关、全量装配）
│   ├── config/              # defineModuleConfig：声明式分模块配置 + 运行时校验
│   ├── error/               # def.ts(USER_FRIENDLY_ERRORS) + errors.gen.ts(代码生成产物)
│   ├── event/               # EventBus：类型安全的进程内/跨进程事件（@OnEvent）
│   ├── graphql/             # GqlModule：ApolloDriver + autoSchemaFile + formatError
│   ├── prisma/              # PrismaModule：PrismaClient 注入
│   ├── cache/ mutex/ redis/ # 缓存、分布式锁、Redis
│   ├── throttler/ guard/    # 限流（@Throttle）与守卫
│   └── logger/ metrics/ websocket/ helpers/
├── models/                  # 数据访问层：每个 Prisma 实体一个 *Model（BaseModel 封装事务）
│   ├── base.ts              # BaseModel：注入 Models + TransactionHost，提供 this.db
│   └── index.ts             # ModelsModule：Proxy 聚合所有 Model 为 Models 门面
├── core/                    # 28 个业务模块（下列为代表）
│   ├── auth/                # 认证：module/resolver/service/controller/guard/session
│   ├── workspaces/          # 工作区：resolvers/ + 实时协同入口
│   ├── doc/                 # 文档存储：reader/writer/adapters（Yjs 落库）
│   ├── permission/          # 权限：薄封装，委托 native BackendRuntime 决策
│   ├── quota/               # 配额：ResolveField 挂到 UserType
│   ├── storage/ sync/ realtime/ comment/ notification/ user/ ...
│   └── backend-runtime/     # BackendRuntimeProvider：native 控制面的 NestJS 包装
├── plugins/                 # 9 个可插拔插件：copilot payment oauth license indexer ...
├── mails/                   # React(Email) 邮件模板 + render.ts
├── middleware/              # timing 等 Express 中间件
├── data/                    # 数据迁移脚本与 CLI 命令
└── realtime-handlers.module.ts
```

## 3. 实现细节

### 3.1 一个 NestJS 模块的标准构成（以 `core/auth` 为代表）

AFFiNE 的每个领域模块都遵循同一套"五件套"，`auth` 最典型。`AuthModule`（`core/auth/index.ts:25`）用 `@Module` 声明装配：

```ts
@Module({
  imports: [BackendRuntimeModule, FeatureModule, EntitlementModule, UserModule, QuotaModule, MailModule],
  providers: [AuthService, AuthResolver, AuthGuard, AccessTokenService, SessionIssuer, MagicLinkAuthService, ...],
  exports: [AuthService, AuthGuard, ...],
  controllers: [AuthController],
})
export class AuthModule {}
```

- **module（`index.ts`）**：声明依赖哪些模块（`imports`）、注册哪些 provider、暴露哪些给别的模块（`exports`）、挂哪些 HTTP 控制器。注意这里同时导出了一个 `AuthWorkerModule`——worker 角色只需要 `AuthCronJob`，于是拆成独立的轻量模块按角色装配。
- **resolver（`resolver.ts`）——GraphQL 入口**：`@Resolver(() => UserType)` 把一组查询/变更挂到 `UserType` 上。`currentUser` 用 `@Query`，`changePassword`/`changeEmail` 用 `@Mutation`，`token` 用 `@ResolveField`（字段级解析器，`resolver.ts:60`）。`@CurrentUser()` 是自定义参数装饰器，从请求上下文取出已登录用户；`@Public()` 标记无需登录即可访问（`resolver.ts:50`）。
- **service（`service.ts`）——业务逻辑**：`@Injectable()` 的 `AuthService`（`service.ts:53`）通过构造器注入 `Config`、`Models`、`AuthSessionService`、`Cache`、`BackendRuntimeProvider`、`EventBus` 等协作者。它实现 `OnApplicationBootstrap` 生命周期钩子，在启动时于 dev 环境创建测试用户。限流、会话签发、密码校验等都在这层。
- **controller（`controller.ts`）——REST 入口**：处理不适合走 GraphQL 的场景（如 OAuth 回调、magic-link 重定向、Set-Cookie）。
- **entity——Prisma 模型**：`auth` 不自带独立实体，而是通过注入的 `Models` 门面读写 `UserSession` 等表（见 3.3）。

这套分层的价值是**职责单一且可测**：resolver 只管协议与鉴权装饰器，service 只管逻辑，controller 只管 HTTP 细节，数据访问收口到 models。

### 3.2 code-first GraphQL：装饰器即 schema 真值源

AFFiNE 采用 **code-first**：不手写 SDL，而是用 TS 类与装饰器描述类型，运行时由 NestJS 反推 schema。`GqlModule`（`base/graphql/index.ts:25`）配置 `ApolloDriver`，关键在 `autoSchemaFile`（`index.ts:36`）：

```ts
autoSchemaFile: env.prod ? true : join(env.projectRoot, './src/schema.gql'),
sortSchema: true,
```

开发态下每次启动把推断出的 schema **写回 `src/schema.gql`**（顶部注明"自动生成，勿改"）。这份文件正是前端 `@affine/graphql` 的 codegen 输入——于是 `@ObjectType`/`@Field`/`@Query`/`@Mutation` 这些装饰器成为**前后端类型契约的单一真值源**：后端加一个字段，前端 codegen 后即获得对应 TS 类型（见 affine-graphql.md）。

`@ObjectType('tokenType') class ClientTokenType { @Field() token!: string }`（`core/auth/resolver.ts:29`）展示了最小单元：类 → GraphQL object type，字段 → GraphQL field。可空性由 `@Field({ nullable: true })` 控制。

### 3.3 数据访问层：`models/` 与 Prisma + 事务

`base.ts` 的 `BaseModel`（`models/base.ts:8`）是所有 Model 的基类，只做两件事：

```ts
export class BaseModel {
  @Inject(MODELS_SYMBOL) protected readonly models!: Models;
  @Inject(TransactionHost)
  private readonly txHost!: TransactionHost<TransactionalAdapterPrisma>;
  protected get db() {
    return this.txHost.tx;
  } // 无事务时即默认 PrismaClient
}
```

`this.db` 的巧妙之处在于**它永远指向"当前应该用的 Prisma 实例"**：若调用栈处在 `@Transactional()` 装饰的事务中（由 `nestjs-cls` 的 CLS 上下文驱动，见 `app.module.ts:101` 装配的 `ClsPluginTransactional`），`txHost.tx` 就是事务客户端；否则是默认非事务客户端。业务代码无需手动传递 `tx`，事务边界由装饰器声明——`DocModel`（`models/doc.ts:50`）即在方法上标 `@Transactional()`。

`Models` 门面本身是一个 **Proxy**（`models/index.ts:93`）：按属性名惰性从 NestJS `ModuleRef` 解析出对应 Model 实例并缓存。于是任意 service 只需注入一个 `Models`，即可 `this.models.doc.xxx` / `this.models.user.xxx` 访问全部数据访问对象，避免注入几十个 Model 的样板。

另外 `models/doc.ts:11` 用 `declare global { interface Events { 'doc.created': {...} } }` **声明合并**扩展全局 `Events` 接口——这就是事件总线类型安全的来源（见 3.5）。

### 3.4 权限/配额：TS 薄层委托 Rust 控制面

`PermissionService`（`core/permission/service.ts:29`）几乎不含判定逻辑，只注入一个 `BackendRuntimeProvider`，把 `{ actorUserId, workspaceId, workspaceActions, docs }` 转发给 native：

```ts
async canWorkspace(input) {
  const output = await this.authorize({ actorUserId, workspaceId, workspaceActions: [action] });
  return output.decisions[0]?.allowed ?? false;
}
```

返回的 `PermissionEvaluationOutputV1`（类型来自 `native.ts:373`）由 Rust 的 `affine_core::access_control` 计算。权限决策之所以放在 Rust，是为了**单点、强一致、可被同步协议复用**——同一套授权函数既服务 GraphQL 也服务 socket.io 同步鉴权（`authorizeReservedDocSubject` 等）。`QuotaService` 同理，通过 `BackendRuntimeProvider.getUserQuotaStateV1` 读 native 维护的配额缓存，`QuotaResolver`（`core/quota/resolver.ts`）再以 `@ResolveField` 把 `quota`/`quotaUsage` 挂到 `UserType` 上懒加载。

### 3.5 事件总线：声明式、类型安全的解耦

`base/event` 提供 `@OnEvent('doc.created', ...)` 监听与 `EventBus.emit/broadcast` 发布。`OnEvent`（`base/event/def.ts:38`）把事件名首段作为 namespace，用元数据标注到方法上，由 `ScannerModule` 扫描装配。事件名的合法集合来自全局 `interface Events`——各 model/service 用 `declare global` 往里**声明合并**自己的事件（如 `doc.created`、`realtime.connection.disconnected`），从而 `emit` 的事件名与 payload 形状都有编译期校验。`emit` 是进程内同步分发，`broadcast` 经 Redis 跨进程广播（配合多 flavor 部署）。

### 3.6 实时协同网关

`RealtimeGateway`（`core/realtime/gateway.ts:58`）用 `@WebSocketGateway()` 暴露 socket.io 服务。它校验客户端版本（`MIN_REALTIME_CLIENT_VERSION = >=0.26.0`，`gateway.ts:41`）、管理订阅（`subscribe`/`unsubscribe`），并在断连时清理订阅、发事件。文档内容的增量（Yjs update）经 `sync` 模块的 `DocReader`/`DocWriter` 落到 PostgreSQL，`doc/adapters` 里的 `PgWorkspaceDocStorageAdapter` 负责把 Yjs 二进制 merge（调用 native `mergeUpdatesInApplyWay`）与持久化。`CLS Interceptor`（`gateway.ts:59`）让每个 WS 消息也拥有独立 request-id 以便追踪。

### 3.7 错误契约：后端定义、前端镜像

`base/error/def.ts` 的 `USER_FRIENDLY_ERRORS` 表（`def.ts:246`）集中定义所有业务错误：每项含 `type`（映射到 HTTP 状态，`def.ts:29`）、`message`、可选 `args`。`generateUserFriendlyErrors()`（`def.ts:189`）遍历此表**代码生成** `errors.gen.ts`：为每个错误码产出一个继承 `UserFriendlyError` 的类（如 `NotFound`、`GraphqlBadRequest`）、一个大写枚举项（`enum ErrorNames`）、以及带 `args` 者的 `XxxDataType` 与 `ErrorDataUnion`（`def.ts:235`）。抛错时经 GraphQL 的 `formatError`（`base/graphql/index.ts:60`）调用 `ufe.toJSON()` 序列化进 `extensions`。这条链路的前端终点正是 `@affine/error`（见 affine-error.md）：**后端一处定义，前后端错误类型自动对齐，永不漂移**。

## 4. 语法特色

- **类装饰器组合装配**：`@Module({imports,providers,exports,controllers})` 是 NestJS 的核心——用装饰器声明依赖图，容器据此做构造器注入。`@Injectable()` 标记可注入，`@Resolver`/`@Query`/`@Mutation`/`@ResolveField` 把类方法映射为 GraphQL 字段，`@WebSocketGateway`/`@SubscribeMessage` 映射 socket.io 事件。
- **参数装饰器**：`@CurrentUser()`、`@Args('token')`、`@Parent()`、`@Context()`、`@MessageBody()`、`@ConnectedSocket()`——在方法签名处声明"从哪取参数"，把横切的上下文提取从方法体里消掉。
- **自定义装饰器工厂**：`@Public()`、`@Throttle('strict')`、`@SkipThrottle()`、`@OnEvent('x')` 都是用 `applyDecorators` / 元数据反射封装的组合装饰器（如 `gateway.ts:38` 的 `SubscribeMessage` = `GatewayErrorWrapper` + 原生 `SubscribeMessage`）。
- **生命周期接口**：`implements OnApplicationBootstrap`（`auth/service.ts:54`）、`OnGatewayInit`/`OnGatewayDisconnect`（`gateway.ts:60`）让类参与容器启动/销毁钩子。
- **全局声明合并**：`declare global { interface Events {...} }`（`models/doc.ts:11`）、`interface AppConfigSchema {...}`（`base/graphql/config.ts:5`）——各模块往全局接口"增量补充"自己的事件/配置键，实现**去中心化却类型安全**的扩展。
- **`ApplyType<T>()` 伪基类**：`class Config extends ApplyType<NodeConfig>() {}`（`base/config/config.ts:4`、`base/utils/types.ts:3`）返回一个"假装实现了 T 的空类"，把纯 interface 变成可被 DI 注入的 token，又不写任何样板字段。
- **Proxy 聚合 + 惰性解析**：`Models` 用 `new Proxy` 把几十个 Model 聚合成单一注入点（`models/index.ts:96`）。
- **Prisma 类型复用**：`Omit<Prisma.WorkspaceDocUncheckedCreateInput, 'workspaceId'|'docId'> & {...}`（`models/doc.ts:33`）直接复用 Prisma 生成的输入类型做派生。

## 5. 设计 / 实现亮点

- **单代码库多角色（flavor）装配**：`AppModuleBuilder.useIf` 让同一镜像按环境变量部署成 API/Sync/Renderer/Front/Worker，避免微服务拆库的协作与版本漂移成本，又保留了水平伸缩的灵活性。
- **TS 编排 + Rust 控制面的双层架构**：把权限、配额、搜索、Yjs 解析、LLM 调度等"重 + 敏感"逻辑下沉到 `@affine/server-native`，TS 层只做编排与持久化。既获得 Rust 的性能与内存安全，又让授权决策单点化、可跨协议复用。
- **契约驱动的前后端对齐**：GraphQL schema（code-first → `schema.gql`）与错误表（`USER_FRIENDLY_ERRORS` → `errors.gen.ts`）都以后端为单一真值源，经 codegen 流向前端，杜绝手工同步。
- **CLS 驱动的透明事务**：借 `nestjs-cls` + `@Transactional` 把 Prisma 事务做成"装饰器声明、隐式传播"，业务代码零样板，`this.db` 自动选对客户端。
- **配置系统声明式 + 运行时**：`defineModuleConfig` 让每个模块就近声明自己的配置项（含 desc/default/link），配置真值由 native `ServerConfigHandle` 从 `config.json` 读取并校验（`env.ts:121`），支持自托管场景的持久化配置。

## 6. 对外 API 与注意事项

- **网络面才是"对外 API"**：本包不被其他 TS 包 `import`，而是通过 `/graphql`（code-first，SDL 见 `schema.gql`）、socket.io 实时通道、以及若干 REST 控制器对外。前端通过 `@affine/graphql` 消费，务必在改 resolver 后重新生成 `schema.gql` 并让前端 codegen 跟进。
- **改错误必须改表**：新增/修改业务错误只能改 `base/error/def.ts` 的 `USER_FRIENDLY_ERRORS`，再重新生成 `errors.gen.ts`；切勿手改生成文件，否则前端 `@affine/error` 的类型会与后端脱节。
- **flavor 决定可用模块**：某个 resolver"404/未装配"往往是因为当前 flavor 没装配其模块（见 `app.module.ts` 的 `useIf` 条件）。worker 角色拿不到 GraphQL 业务模块，API 角色拿不到 `DocJobsModule`。
- **权限/配额不要在 TS 里"自己判"**：一律走 `PermissionService`/`QuotaService` → `BackendRuntimeProvider`，以保证与同步协议、native 决策一致。
- **事务传播依赖 CLS**：脱离请求/CLS 上下文（如裸 `setTimeout` 回调）调用 model 可能拿不到期望的事务客户端，需显式进入事务上下文。

## 7. 延伸

- 原生底座：`@affine/server-native`（Rust napi 控制面，见 affine-server-native.md）——本包的权限、配额、搜索、Yjs、LLM、加密能力均来自它。
- 前端对接：`@affine/graphql`（codegen 消费 `schema.gql`，见 affine-graphql.md）、`@affine/error`（镜像 `USER_FRIENDLY_ERRORS`，见 affine-error.md）、`@affine/nbstore`（同步协议对端）。
- 关键机制交叉参考：`base/config`（配置系统）、`models/`（Prisma 数据层）、`core/realtime` 与 `core/sync`（文档协同）。
- 对应教程：learning-guide 关于"NestJS 后端架构与前后端契约"的章节。
