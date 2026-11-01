# `@affine/auth`

> 一句话定位：AFFiNE 前端的**令牌生命周期代理（Token Broker）**——把"access/refresh token 的加载、校验、刷新、并发去重、失败分类、状态广播、持久化"这套极易出错的认证逻辑，收敛进一个与存储/传输解耦、可测试、并发安全的 `AuthTokenBroker`，并为 GraphQL 请求、Realtime 连接、Worker 等不同调用方提供适配器。

| 项        | 值                                                                       |
| --------- | ------------------------------------------------------------------------ |
| 目录      | `packages/common/auth`                                                   |
| 所属层    | L1 · 通用基础设施                                                        |
| 语言/形态 | TypeScript 库（单入口，核心仅一个文件 464 行，零运行时依赖）             |
| 关键依赖  | 无（刻意零依赖，仅用标准 Promise/Date）                                  |
| 被谁依赖  | `@affine/core` 认证模块、GraphQL 请求层、`@affine/realtime`、同步 Worker |
| 对外入口  | `.`（`AuthTokenBroker` 及一众适配器/类型）                               |

## 1. 设计逻辑

令牌管理是认证里"看似简单、实则陷阱密布"的部分。一个正确的实现必须同时处理：**access token 临近过期要主动刷新**、**多处并发请求同时触发刷新要去重（避免 refresh token 被用两次而失效）**、**刷新失败要区分"临时故障（可重试、保持离线可用）"与"永久失效（必须登出）"**、**持久化存储（IndexedDB/SQLite/Keychain）可能不可用**、**刷新进行中用户又手动登出的竞态**、以及**把认证状态变化广播给 UI**。

`@affine/auth` 的立场是：**把这套状态机做一次、做对、做到可测试，所有端共用**。它的关键设计抉择有三：

1. **依赖倒置——存储与传输都是注入的接口**：`AuthTokenBroker` 不关心 token 存哪（`AuthTokenStorage`）、怎么刷（`AuthTokenTransport`），只负责编排。Web 用 IndexedDB、桌面用 Keychain、测试用内存 mock，各自实现接口即可。这让核心逻辑**可在纯内存环境被完整单元测试**（见同目录 `token-broker.spec.ts` 409 行）。
2. **用 epoch（版本号）解决并发竞态**：每次会改变凭据的操作（set/clear/revoke/refresh）都递增 `mutationEpoch`。异步刷新完成后比对 epoch，若已变化说明期间发生了更新的操作，本次结果作废（`AUTH_OPERATION_CANCELLED`）——这是用单调计数器实现乐观并发控制的经典手法。
3. **错误分类决定"登出还是保持离线"**：通过三层嵌套的错误码集合（`PERMANENT` ⊂ `PUBLIC` ⊂ `SAFE`），把任意异常归类为"永久失效"或"临时故障"，从而决定是清空凭据进入 `revoked`，还是保留凭据进入 `offline-authenticated`。

**为何零依赖、单独成包**：认证是安全敏感的核心逻辑，越少外部依赖越可审计；且它要被主线程、SharedWorker、Realtime 等多处共用，独立成包避免重复实现，并以适配器函数适配各调用方的不同需求。

## 2. 目录与关键文件

```text
packages/common/auth/
├── package.json            # 零 dependencies；单入口 "."
└── src/
    ├── index.ts            # 仅 export * from './token-broker'
    ├── token-broker.ts     # 全部实现（464 行）：状态机 + 适配器 + 校验
    └── token-broker.spec.ts# 409 行单元测试（内存 mock 存储/传输）
```

`token-broker.ts` 内部分四块：**错误码集合**（第 1–23 行）、**契约接口与类型**（25–100）、**`AuthTokenBroker` 状态机**（102–380）、**独立函数与适配器**（`classifyAuthError`/`withAuthRetry`/`createXxxAdapter`/`isAuthTokenPair`，382–464）。

## 3. 实现细节

### 3.1 三层错误码集合：用集合包含关系表达分类策略

```ts
// 来源：src/token-broker.ts:1
export const PERMANENT_AUTH_CODES = new Set([
  'ACCESS_TOKEN_INVALID',
  'AUTH_SESSION_EXPIRED',
  'AUTH_SESSION_REVOKED',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_REUSED',
  'UNSUPPORTED_CLIENT_VERSION',
]);
const PUBLIC_AUTH_CODES = new Set([
  ...PERMANENT_AUTH_CODES,
  'ACCESS_TOKEN_EXPIRED',
  'AUTH_SESSION_TEMPORARILY_UNAVAILABLE',
  /* ... */ 'NETWORK_ERROR',
  'TOO_MANY_REQUESTS',
]);
const SAFE_AUTH_CODES = new Set([
  ...PUBLIC_AUTH_CODES,
  'AUTH_OPERATION_CANCELLED',
  'AUTH_SESSION_EMPTY',
]);
```

三个集合层层包含，各司其职：

- **`PERMANENT`**：永久失效码，意味着"凭据再也救不回来，必须登出"。`transient` 判定为 `!PERMANENT.has(code)`。
- **`PUBLIC`**：可安全暴露给外部的码。不在此集合的未知码一律脱敏为 `AUTH_SESSION_TEMPORARILY_UNAVAILABLE`——**防止后端内部错误码泄漏到前端日志/UI**。
- **`SAFE`**：加上两个纯内部码。`AuthSessionError` 若携带非 SAFE 码也会被脱敏。

`classifyAuthError` 把任意 `unknown` 异常归一为带 `code` 与 `transient` 的 `AuthSessionError`：

```ts
// 来源：src/token-broker.ts:382
export function classifyAuthError(error: unknown) {
  if (error instanceof AuthSessionError) {
    return SAFE_AUTH_CODES.has(error.code) ? error
      : new AuthSessionError('AUTH_SESSION_TEMPORARILY_UNAVAILABLE', true);
  }
  const code = /* 鸭子类型取 error.code，否则兜底 */ ;
  const publicCode = PUBLIC_AUTH_CODES.has(code) ? code : 'AUTH_SESSION_TEMPORARILY_UNAVAILABLE';
  return new AuthSessionError(publicCode, !PERMANENT_AUTH_CODES.has(publicCode));
}
```

### 3.2 `AuthState`：判别联合建模认证状态机

```ts
// 来源：src/token-broker.ts:57
export type AuthState =
  | { status: 'initializing' }
  | { status: 'empty' }
  | { status: 'authenticated'; session: AuthSessionSnapshot }
  | { status: 'refreshing'; session: AuthSessionSnapshot; reason: string }
  | {
      status: 'offline-authenticated';
      session: AuthSessionSnapshot;
      code: string;
    }
  | { status: 'revoked'; code: string };
```

用**判别联合（discriminated union）**精确建模六种状态，且每种状态携带的数据不同（如 `refreshing` 带刷新原因、`offline-authenticated` 带临时故障码、`revoked` 带失效码）。消费方 `switch (state.status)` 时 TS 自动收窄，不可能访问到该状态下不存在的字段。`offline-authenticated` 是点睛之笔——**网络故障时保留旧凭据、让应用离线可用**，而非粗暴登出。

### 3.3 并发刷新去重：单 Promise 复用

多处代码可能同时调用 `refresh`。若各自发起刷新请求，refresh token 会被用多次而触发 `REFRESH_TOKEN_REUSED`。解法是复用同一个在途 Promise：

```ts
// 来源：src/token-broker.ts:159
async refresh(reason: string) {
  await this.initialize();
  if (!this.pair) throw new AuthSessionError('AUTH_SESSION_EMPTY', false);
  if (!this.refreshPromise) {                       // 仅第一个调用真正发起
    this.refreshPromise = (this.pending ? this.persistPending() : this.performRefresh(reason))
      .finally(() => { this.refreshPromise = null; });  // 完成后清空，允许下次刷新
  }
  return this.toAccessToken(await this.refreshPromise);  // 后续调用共享同一 Promise
}
```

`getValidAccessToken` 的"主动刷新"也经由此路径：当 access token 距过期不足 `minValidity`（默认 60 秒）时触发刷新，于是请求发出时拿到的总是"至少还有 60 秒有效"的 token。

### 3.4 epoch 乐观并发控制

`performRefresh` 开始时记录当时的 `mutationEpoch`，网络往返后比对：

```ts
// 来源：src/token-broker.ts:244
const epoch = this.mutationEpoch;
// ... await 网络刷新 ...
if (epoch !== this.mutationEpoch) {
  // 期间有 set/clear/revoke 发生
  throw new AuthSessionError('AUTH_OPERATION_CANCELLED', true); // 本次结果作废
}
```

同样 `persistPending` 落盘后也校验 epoch（`token-broker.ts:296`）。这样"刷新进行中用户登出"的竞态被正确处理：登出递增 epoch、清空 `pending`，刷新回来发现 epoch 变了就丢弃结果，绝不会把已登出的会话又写回存储。

### 3.5 存储写入串行化

存储是异步且有状态的，并发 save/clear 可能乱序。`mutateStorage` 用一条 Promise 链把所有存储操作串成队列：

```ts
// 来源：src/token-broker.ts:308
private async mutateStorage<T>(operation: () => Promise<T>) {
  const result = this.storageMutation.then(operation, operation);  // 无论前一个成功失败都接着跑
  this.storageMutation = result.then(() => {}, () => {});          // 更新队列尾，吞掉结果
  return await result;
}
```

`then(operation, operation)` 两个参数都传 `operation`——保证即使前一个存储操作失败，后一个仍会执行，队列不会卡死。

### 3.6 刷新重试：指数退避 + 抖动

```ts
// 来源：src/token-broker.ts:317
private async requestRefresh(refreshToken: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await this.transport.refresh(refreshToken); }
    catch (error) {
      const classified = classifyAuthError(error);
      const delay = this.retryDelays[attempt];                     // 默认 [250, 1000]
      if (!classified.transient || delay === undefined) throw classified;  // 永久错误或重试耗尽则放弃
      await this.sleep(delay * (0.75 + this.random() * 0.5));       // ±25% 抖动，避免惊群
    }
  }
}
```

只对**临时错误**重试；重试次数由 `retryDelays` 数组长度决定；延迟加 `±25%` 随机抖动防止多客户端同时重试造成的"惊群效应"。`now`/`random`/`sleep` 全部可注入，使重试逻辑在测试里可用假时钟确定性验证。

### 3.7 运行时校验 `isAuthTokenPair`

从存储读出的数据可能损坏、或来自旧版本格式。`isAuthTokenPair`（`token-broker.ts:445`）是一个类型守卫，逐字段校验 `version===1`、token 非空、各时间戳可被 `Date.parse`——`initialize` 时若校验失败就清空存储当作未登录。`toPair` 还额外防御 `expiresIn` 非正、时间戳溢出（`Math.abs > 8.64e15`，JS Date 的极限）等畸形响应。

### 3.8 四个适配器：同一 Broker，不同消费姿势

```ts
// 来源：src/token-broker.ts:404
export async function withAuthRetry(broker, request) {
  // 请求遇 401 自动刷新重试一次
  const token = await broker.getValidAccessToken();
  try {
    return await request(token);
  } catch (error) {
    const classified = classifyAuthError(error);
    if (classified.code !== 'ACCESS_TOKEN_EXPIRED') throw classified;
    const pair = await broker.refresh('access-token-expired');
    return await request(pair.accessToken); // 用新 token 重试
  }
}
createRealtimeAuthAdapter(broker); // getAccessToken(120s 余量) + recover(过期时刷新)
createRequestAuthAdapter(broker); // execute() 包 withAuthRetry
createWorkerAuthAdapter(broker); // getAccessToken(60s 余量)
```

不同调用方对"提前量"和"失败恢复"的需求不同：Realtime 长连接要 120 秒余量（断线重连成本高），普通请求 60 秒即可。适配器把这些差异收口，核心 Broker 保持单一。

## 4. 语法特色

- **判别联合建模状态机（`AuthState`）**：`status` 作判别字段，每个变体携带专属数据，`switch` 时类型自动收窄——用类型系统确保"状态与其数据"始终匹配。
- **依赖倒置的接口注入**：`AuthTokenStorage`/`AuthTokenTransport` 以接口形式由构造函数注入，核心零具体实现依赖，是可测试性的根基。
- **`Set` 的展开构造表达包含关系**：`new Set([...PERMANENT, ...])` 让三层码集的"子集关系"在代码上一目了然。
- **类型守卫 `value is AuthTokenPair`**：`isAuthTokenPair` 返回类型谓词，校验后 TS 自动把 `unknown` 收窄为 `AuthTokenPair`。
- **可注入的副作用（`now`/`random`/`sleep`）**：把时间、随机、延时都做成可选注入项，默认用真实实现、测试用假实现——纯函数式的可测试设计。
- **Promise 链串行化 + 双 handler（`then(op, op)`）**：用一条滚动 Promise 实现互斥队列，且失败不断链。
- **`finally` 清理在途状态**：`refreshPromise` 在 `.finally` 里置空，保证无论成败都能发起下一次刷新。
- **单调计数器做乐观锁（epoch）**：无锁地解决异步竞态，比加锁更轻量。

## 5. 设计 / 实现亮点

- **把最易错的认证状态机做对一次、全端复用**：并发去重、竞态取消、重试退避、离线降级、错误脱敏——这些在业务里散落实现几乎必然出 bug 的点，被集中到一个经测试覆盖的类里。
- **"临时故障保留凭据、永久失效才登出"**：`offline-authenticated` 状态体现了极佳的用户体验判断——网络抖动不该把用户踢下线。
- **错误脱敏（PUBLIC 集合过滤）**：未知/内部错误码统一降级为通用码，防止敏感信息泄漏到前端。
- **彻底的可测试性**：存储、传输、时钟、随机、睡眠全部可注入，409 行测试可在纯内存中确定性地验证所有竞态分支。
- **零依赖、可审计**：安全核心不引入任何第三方，减小攻击面、便于审查。
- **适配器模式收口差异**：一个 Broker 通过薄适配器服务 request/realtime/worker 三类不同节奏的消费者。

## 6. 对外 API 与注意事项

- **主要导出**：`AuthTokenBroker`（核心类）、`classifyAuthError`、`withAuthRetry`、`createRequestAuthAdapter`/`createRealtimeAuthAdapter`/`createWorkerAuthAdapter`、`isAuthTokenPair`、`AuthSessionError`，以及全部类型（`AuthState`/`AuthTokenPair`/`AuthTokenStorage`/`AuthTokenTransport` 等）。
- **使用约定**：使用方需自行实现 `AuthTokenStorage`（load/save/clear）与 `AuthTokenTransport`（refresh），注入构造函数；通过 `observeAuthState` 订阅状态驱动 UI；发请求用 `getValidAccessToken` 或适配器而非直接读 `pair`。
- **坑**：
  - `getValidAccessToken` 的 `minValidity` 需大于一次请求的最大耗时，否则 token 可能在请求途中过期；Realtime 因此用 120 秒。
  - 存储实现必须保证 `save`/`clear` 的原子性语义；Broker 已做串行化，但单次写入的原子性由存储层负责。
  - `observeAuthState` 的 listener 抛错会被静默吞掉（注释："Observers cannot participate in credential lifecycle decisions"）——观察者不得影响凭据生命周期，副作用需自行保证不抛。
  - 错误码脱敏意味着前端拿到的 code 未必是后端原始码；排障需结合后端日志。

## 7. 延伸

- 同层：`@affine/error`（错误码体系）、`@affine/graphql`（请求层消费 `createRequestAuthAdapter`）、`@affine/realtime`（消费 `createRealtimeAuthAdapter`）、`@affine/nbstore`（Worker 侧消费 `createWorkerAuthAdapter`）。
- 对应教程：learning-guide 关于"认证与令牌生命周期"的章节。
