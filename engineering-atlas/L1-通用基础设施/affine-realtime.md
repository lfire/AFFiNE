# `@affine/realtime`

> 一句话定位：AFFiNE 实时通道的**协议契约层**——用两张 TypeScript 类型映射表（`RealtimeRequestMap` 请求/应答、`RealtimeTopicMap` 主题订阅）集中定义"客户端与服务器之间除文档同步外的一切实时交互"的名字、入参、出参/事件形状，外加信封（envelope）类型与一个输入规范化工具。它本身几乎零运行时，是前后端共享的"实时 API 字典"。

| 项        | 值                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/common/realtime`                                                                                                       |
| 所属层    | L1 · 通用基础设施                                                                                                                |
| 语言/形态 | TypeScript 库（单文件 516 行，几乎全是类型）                                                                                     |
| 关键依赖  | `@affine/graphql`（复用部分领域类型语义）                                                                                        |
| 被谁依赖  | `@affine/nbstore`（实现 `RealtimeManager`/`RealtimeClient`）、`@affine/auth`（`createRealtimeAuthAdapter`）、`@affine/core` 业务 |
| 对外入口  | `.`（全部类型 + `getRealtimeInputKey` + 常量）                                                                                   |

## 1. 设计逻辑

AFFiNE 的实时需求不止"文档协同同步"（那由 nbstore + Yjs 负责）。还有大量**非文档的实时信息**：工作区成员/权限/配置变化、文档分享状态、通知未读数、配额、评论变更、AI（copilot）委派工具调用……这些有两种交互范式：

- **请求/应答（request/reply）**：客户端问一次、服务器答一次（如"获取工作区成员列表"）。
- **主题订阅（pub/sub topic）**：客户端订阅一个主题，服务器在状态变化时推事件（如"成员变了"）。

如果让这些交互各自散落、各端手写收发逻辑，名字、入参、返回形状极易前后端对不齐。`@affine/realtime` 的立场是：**把整个实时协议抽象成两张类型表，作为前后端唯一共享的契约**。这样做的价值：

1. **协议即类型**：`RealtimeRequestMap` 的每个键是一个 op 名，值声明 `{ input, output }`；`RealtimeTopicMap` 的每个键是一个 topic 名，值声明 `{ input, event }`。增删/改字段在类型层面一目了然，收发两端共用同一份声明就不可能漂移。
2. **传输无关**：本包**只定义协议、不含传输实现**。真正的 socket.io 收发、重连、鉴权在 `@affine/nbstore` 的 `RealtimeManager`/`RealtimeClient`（见 nbstore 第 3.6 的 worker 代理）。职责分离让协议可被多种传输复用、也便于测试。
3. **与文档同步正交**：nbstore 的 `DocSyncPeer` 走 CRDT 二进制通道；realtime 走结构化 JSON 的 RPC/订阅通道。二者在同一 WebSocket 连接上并行但语义独立。

**为何单独成包**：协议契约需要被前端业务、nbstore 传输层、auth 适配器同时引用，且理想情况下还能被后端复用。独立成一个"几乎只有类型"的包，依赖极轻（仅 `@affine/graphql`），谁都能安全引入。

## 2. 目录与关键文件

```text
packages/common/realtime/
├── package.json          # 仅 dep: @affine/graphql；单入口 "."
└── src/
    └── index.ts          # 全部内容（516 行）：
                          #   - RealtimeRequestMap  （请求/应答协议表）
                          #   - RealtimeTopicMap    （主题订阅协议表）
                          #   - 一堆 XxxSnapshot 领域数据类型
                          #   - Delegated* （copilot 委派工具协议）
                          #   - 信封/状态/配置类型（Envelope/Ack/Status/Configure）
                          #   - getRealtimeInputKey()（唯一运行时函数）
```

## 3. 实现细节

### 3.1 两张协议表：请求表与主题表

```ts
// 来源：src/index.ts:6
export interface RealtimeRequestMap {
  'workspace.members.get': {
    input: {
      workspaceId: string;
      skip?: number;
      take?: number;
      query?: string;
    };
    output: { members: WorkspaceMemberSnapshot[]; memberCount: number };
  };
  'notification.count.get': {
    input: Record<string, never>; // 无入参用空记录类型表达
    output: { count: number };
  };
  // ... workspace.access/config、doc.share-state/grants、user.profile/settings、
  //     quota-state、comment.changes、copilot.delegated.* 等约 20 个 op
}

// 来源：src/index.ts:248
export interface RealtimeTopicMap {
  'workspace.members.changed': {
    input: { workspaceId: string };
    event: { changed: true; reason: string }; // 多数主题只推"变了 + 原因"，客户端再去 get 拉最新
  };
  'notification.count.changed': {
    input: Record<string, never>;
    event: { count: number; reason: NotificationCountChangedReason };
  };
  // ...
}
```

命名遵循统一约定：请求表用 `名词.动作.get`（如 `doc.grants.get`），主题表用 `名词.changed`（如 `doc.grants.changed`），**get 与 changed 成对出现**。这体现了一个清晰的实时模式——**"变更通知 + 按需拉取"**：大多数主题事件只携带 `{ changed: true; reason }`，不带完整数据；客户端收到通知后再调对应的 `.get` 请求拉最新快照。这避免了"推送大体积数据"的带宽浪费，也让客户端自行决定是否需要刷新。少数高频小数据主题（如 `notification.count.changed` 直接带 `count`）才在事件里带数据。

### 3.2 领域快照类型（Snapshot）

两张表的 output/event 大量引用 `XxxSnapshot` 类型（`WorkspaceAccessSnapshot`、`WorkspaceMemberSnapshot`、`UserQuotaStateSnapshot`…）。命名用 "Snapshot" 后缀强调语义：**这是某一刻的状态切片，而非实时流**。角色类型还刻意用开放联合：

```ts
// 来源：src/index.ts:103
export type WorkspaceRoleSnapshot =
  'Owner' | 'Admin' | 'Collaborator' | 'External' | string;
```

末尾的 `| string` 是有意为之——**前向兼容**：服务器将来新增角色时，旧前端类型仍能接收（不会因未知字面量而类型错误），同时已知角色仍享有自动补全。这是"协议演进"的务实权衡。

### 3.3 copilot 委派工具：双向实时协议样例

`copilot.delegated.*` 是一组更复杂的实时协议，让后端 AI 能"委派"前端编辑器执行工具调用（读选区、读节点、快照文档等）。它同时用到请求表和主题表：

```ts
// 来源：src/index.ts:331
export type DelegatedToolName =
  | 'frontend_get_editor_state' | 'frontend_read_selection'
  | 'frontend_read_nodes' | 'frontend_snapshot_document';

// 主题：服务器请求前端执行工具
'copilot.delegated.tool.requested': { input: { clientId }; event: DelegatedToolRequest | DelegatedToolCancel };
// 请求：前端把工具结果回传服务器
'copilot.delegated.tool.respond': { input: DelegatedToolResponse; output: { accepted: boolean } };
```

`DelegatedToolRequest`/`Cancel`/`Response` 共享一个 `DelegatedToolIdentity`（含 `requestId`/`runId`/`toolCallId`/`sessionId`… 的全链路标识），用 `extends` 复用。`Cancel` 带 `reason: 'aborted' | 'timeout' | 'disconnect'`。这展示了协议表如何承载"服务器→前端请求、前端→服务器应答"的反向 RPC。

### 3.4 信封（Envelope）与泛型投影

在协议表之上，本包定义了实际在线路上传输的"信封"类型，把 op/topic 名、输入、可选的 requestId/clientVersion 打包：

```ts
// 来源：src/index.ts:401
export type RealtimeRequestEnvelope<Op extends RealtimeRequestName = RealtimeRequestName> = {
  requestId?: RealtimeRequestId;
  op: Op;
  input: RealtimeRequestInputOf<Op>;
  clientVersion?: string;
};
export type RealtimeAck<T> = { data: T } | { error: RealtimeError };   // 应答判别联合
export type RealtimeEvent<Topic extends ...> = Topic extends RealtimeTopicName
  ? { topic: Topic; inputKey: string; seq?: number; sentAt: number; event: RealtimeTopicEventOf<Topic> }
  : never;
```

以及一组"投影"工具类型，从协议表里按 op/topic 取 input/output/event：

```ts
// 来源：src/index.ts:381
export type RealtimeRequestInputOf<Op extends RealtimeRequestName> =
  RealtimeRequestMap[Op]['input'];
export type RealtimeRequestOutputOf<Op extends RealtimeRequestName> =
  RealtimeRequestMap[Op]['output'];
export type RealtimeTopicEventOf<Topic extends RealtimeTopicName> =
  RealtimeTopicMap[Topic]['event'];
```

nbstore 的 `RealtimeClient`（`worker/client.ts`）正是用这些投影类型，使 `realtime.request(op, input)` 的 `input` 与返回值被精确约束——op 传 `'workspace.members.get'`，`input` 就必须是其声明的形状，返回就是其 output（见 affine-nbstore.md 3.6）。

### 3.5 `getRealtimeInputKey`：唯一的运行时逻辑

本包 500 多行里唯一的运行时函数，用于把"订阅输入"规范化成一个**稳定的字符串键**，作为订阅/缓存的去重标识：

```ts
// 来源：src/index.ts:486
export function getRealtimeInputKey(input: unknown): string {
  if (input === undefined || typeof input === 'function' || typeof input === 'symbol') return 'null';
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(getRealtimeInputKey).join(',')}]`;
  if (input instanceof Date) return JSON.stringify(input.toJSON());
  const record = input as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter(key => /* 剔除 undefined/function/symbol */)
    .sort()                                         // 关键：键排序，保证顺序无关
    .map(key => `${JSON.stringify(key)}:${getRealtimeInputKey(record[key])}`)
    .join(',')}}`;
}
```

它的本质是一个**顺序无关的确定性序列化**：对象键先 `sort` 再拼接，于是 `{a:1,b:2}` 与 `{b:2,a:1}` 得到同一个键；递归处理嵌套；剔除无法稳定序列化的 `function`/`symbol`/`undefined`；`Date` 用 ISO 串。这解决了实时订阅的一个现实问题——**同一主题 + 等价输入应复用同一个订阅**（例如两处组件都订阅同一 workspace 的成员变化），用规范化键即可识别"等价订阅"并去重，而不受调用方传参字段顺序的影响。这也是为什么它必须是运行时函数而非类型：键要在运行时真实计算。

## 4. 语法特色

- **接口作协议表（index signature 风格的映射）**：`RealtimeRequestMap`/`RealtimeTopicMap` 用接口把"op 名 → {input, output}"固化，`keyof` 即可得到所有合法 op 名（`RealtimeRequestName = keyof RealtimeRequestMap`）。
- **索引访问类型做投影**：`RealtimeRequestMap[Op]['input']` 从协议表按 op 精确取出入参类型，是传输层强类型的基础。
- **开放联合 `... | string` 前向兼容**：角色/模式类型末尾加 `| string`，容忍服务器新增枚举值而不破坏旧前端。
- **分布式条件类型 `Op extends X ? {...} : never`**：`RealtimeRequestInput`/`RealtimeEvent` 用条件类型对联合分配，为每个具体 op/topic 生成专属形状。
- **判别联合 `RealtimeAck<T>`**：`{ data } | { error }` 用结构区分成功/失败应答。
- *_`extends` 复用标识结构（Delegated_）**：多个消息类型共享 `DelegatedToolIdentity` 基础字段。
- **`Record<string, never>` 表达"无入参"**：比 `{}` 更严格，明确表示"不接受任何键"。
- **递归 + 排序的确定性序列化**：`getRealtimeInputKey` 用键排序实现顺序无关的稳定键。

## 5. 设计 / 实现亮点

- **协议即单一真值源**：两张类型表集中定义全部非文档实时交互，前后端共享、编译期对齐，从根上消除协议漂移。
- **"变更通知 + 按需拉取"模式**：主题事件多只报"变了 + 原因"，客户端自行决定拉取，节省带宽、给客户端刷新控制权——大规模实时系统的经典做法。
- **传输与协议彻底解耦**：本包零传输实现，socket.io/重连/鉴权都在 nbstore，使协议可独立演进、复用、测试。
- **前向兼容的开放联合**：务实处理"服务器先行、前端后更"的版本错配。
- **订阅去重的规范化键**：`getRealtimeInputKey` 用顺序无关序列化让等价订阅复用同一通道，是实时订阅复用的关键基础设施。
- **几乎零运行时体积**：`sideEffects: false` + 绝大部分是类型，被广泛引入也不增加打包负担。

## 6. 对外 API 与注意事项

- **主要导出**：类型 `RealtimeRequestMap`/`RealtimeTopicMap`、`RealtimeRequestName`/`RealtimeTopicName`、投影类型 `RealtimeRequestInputOf`/`...OutputOf`/`RealtimeTopicEventOf`、信封类型 `RealtimeRequestEnvelope`/`RealtimeSubscribeEnvelope`/`RealtimeAck`/`RealtimeEvent`、状态/配置 `RealtimeStatus`/`RealtimeConfigureInput`、各 `XxxSnapshot`、`Delegated*`；运行时 `getRealtimeInputKey` 与常量 `WORKSPACE_MEMBERS_REQUEST_TAKE_MAX`。
- **使用约定**：业务不直接用本包发请求，而是通过 nbstore 的 `RealtimeClient`（`StoreManagerClient.realtime.request/subscribe`）；本包提供其类型约束。新增一个实时交互 = 往对应表加一个键（get 加请求表、changed 加主题表，通常成对）。
- **坑**：
  - 本包**不含任何收发实现**，误以为能直接 `import` 发请求会落空——实现在 `@affine/nbstore`。
  - 开放联合 `| string` 意味着拿到的角色/模式字符串可能是前端未知的新值，`switch` 时需有 default 分支。
  - `getRealtimeInputKey` 会剔除 `undefined`/函数/symbol 字段，依赖它做键时，这些字段不参与去重判定（通常正是期望行为）。
  - 请求表里 `copilot.transcript.task.*` 的 output `task: unknown` 未强类型化，使用处需自行断言。

## 7. 延伸

- 同层：`@affine/nbstore`（实现传输层 `RealtimeManager`/`RealtimeClient`，见 affine-nbstore.md 3.6）、`@affine/auth`（`createRealtimeAuthAdapter` 提供 120s 余量的 token）、`@affine/graphql`（部分领域语义来源）。
- 对应教程：learning-guide 关于"实时协议契约与 pub/sub"的章节。
