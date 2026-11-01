# `@blocksuite/sync`

> 一句话定位：BlockSuite 的**数据同步引擎抽象**——它不关心"连到哪个后端"，只定义三类可同步数据（文档 Doc、二进制 Blob、在线状态 Awareness）各自的 `Source`（数据源接口）与 `Engine`（调度器），并用"main 主源 + shadows 影子源"的多源策略把一个 Y.Doc 及其子文档可靠地同步起来。具体怎么连 WebSocket/IndexedDB/S3 由上层实现 `Source` 注入。

| 项        | 值                                                                                        |
| --------- | ----------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/framework/sync`                                                               |
| 所属层    | L2 · 编辑器内核框架                                                                       |
| 语言/形态 | TypeScript 库                                                                             |
| 关键依赖  | `yjs`(peer)、`y-protocols`、`@blocksuite/global`、`rxjs`、`idb`/`idb-keyval`、`lodash-es` |
| 被谁依赖  | `@blocksuite/store`（`Workspace` 持有 `BlobEngine`）、上层 nbstore/provider 集成层        |
| 对外入口  | `.`                                                                                       |

## 1. 设计逻辑

Yjs 自己只负责"文档内部的 CRDT 合并"，但**"把更新推给谁、从哪里拉、断线怎么重连、二进制附件怎么同步、别人的光标怎么广播"**这些 Yjs 不管。`@blocksuite/sync` 就是补齐这一层，核心立场是**把"同步协议/调度"与"具体存储介质"彻底解耦**：

- **抽象在本包**：`DocEngine`/`DocSource`、`BlobEngine`/`BlobSource`、`AwarenessEngine`/`AwarenessSource`——三组"引擎 + 数据源接口"。
- **实现在别处**：`Source` 是 interface，谁想接 IndexedDB / WebSocket / HTTP，就实现一个 `Source` 传进 `Engine`。本包只随附 `broadcast`（BroadcastChannel，跨标签页）等少量内置实现。

三类数据同步策略不同，所以分三套引擎：

1. **Doc（文档）**：CRDT 增量更新，需要精细的 push/pull 队列、子文档递归、断线重试 → 最复杂，用 `DocEngine` + `SyncPeer`。
2. **Blob（二进制大对象）**：图片/附件，内容寻址（sha 做 key），只需"有没有、拉过来/推过去" → `BlobEngine` 定期对账。
3. **Awareness（在线状态）**：光标、选区等易失 presence，不需持久化，广播即可 → 最轻量的 `AwarenessEngine`。

**统一贯穿的模式是"main + shadows 多源"**：main 是权威主源（如远端服务器或主存储），shadows 是影子源（如本地 IndexedDB 缓存）。先同步 main，再铺 shadows，让"本地优先、最终一致"成为默认行为。

## 2. 目录与关键文件

```text
src/
├── index.ts              # 汇总导出 doc / blob / awareness 三组
├── doc/
│   ├── engine.ts         # DocEngine：管理 main + shadows 的 SyncPeer，分 4 步同步
│   ├── peer.ts           # SyncPeer：一个 Source 与一个 Y.Doc（含子文档）的同步核心
│   ├── source.ts         # DocSource 接口：pull / push / subscribe
│   ├── consts.ts         # DocEngineStep / DocPeerStep 状态枚举
│   └── impl/             # 内置实现：broadcast(跨标签页) / indexeddb / noop
├── blob/
│   ├── engine.ts         # BlobEngine：get/set/list + 后台定期对账 sync()
│   ├── source.ts         # BlobSource 接口：get/set/delete/list(+ blobState$/upload)
│   └── impl/             # memory / indexeddb
├── awareness/
│   ├── engine.ts         # AwarenessEngine：把 awareness 广播到各 Source
│   ├── source.ts         # AwarenessSource 接口：connect / disconnect
│   └── impl/broadcast.ts # BroadcastChannelAwarenessSource：跨标签页同步 presence
└── utils/
    ├── async-queue.ts    # AsyncQueue / PriorityAsyncQueue / SharedPriorityTarget
    └── throw-if-aborted.ts # MANUALLY_STOP 哨兵 + throwIfAborted
```

## 3. 实现细节

### 3.1 DocSource：最小三方法接口

一切文档同步的后端只需实现三个方法（`doc/source.ts`）：

```ts
export interface DocSource {
  name: string; // 调试用
  pull(docId, state): Promise<{ data: Uint8Array; state?: Uint8Array } | null> | ...;
  push(docId, data: Uint8Array): Promise<void> | void;
  subscribe(cb, disconnect): Promise<() => void> | (() => void);
}
```

`pull` 给定本地 state vector 拉回缺失的更新；`push` 推本地更新上去；`subscribe` 监听来自该源的远端更新（返回退订函数）。这三件事足以表达任何 CRDT 同步后端。

### 3.2 SyncPeer：一个源 ↔ 一个 Y.Doc 的同步机器

`SyncPeer`（`doc/peer.ts`）负责把**一个 `DocSource` 与一个 rootDoc（及其所有子文档）**同步，是本包逻辑最密集的类。它的生命周期（见源码顶部 ASCII 流程图）：

1. **listen**：`doc.on('update', handleYDocUpdates)` 监听本地 Y.Doc 变更，塞进 `pushUpdatesQueue`。注意它跳过 origin 等于自身 `name` 的更新（`peer.ts:95-98`），避免把"刚从该源拉来的更新"又推回去。
2. **subscribe**：`source.subscribe(handleStorageUpdates, ...)` 监听远端变更，塞进 `pullUpdatesQueue`。
3. **connectDoc**（`peer.ts:167-191`）：`pull` 一次拿到初始数据 `applyUpdate`，再 `encodeStateAsUpdate` 把本地相对远端的差量推进 `pushUpdatesQueue`，然后 `doc.emit('sync', [true, doc])` 标记已加载。
4. **子文档递归**：监听 `rootDoc.on('subdocs', ...)`，新增子文档进 `subdocsLoadQueue` 逐个 `connectDoc`，删除则 `disconnectDoc`。

主循环用 `Promise.all` 并发跑三个 `while` 协程（`peer.ts:258-318`）：加载子文档、消费 `pullUpdatesQueue`（`applyUpdate`）、消费 `pushUpdatesQueue`（`mergeUpdates` 合并后 `source.push`）。三者都用 `throwIfAborted(signal)` 作为循环条件，`abort` 时统一退出。还有两处性能/正确性细节：

- **空更新过滤**：`Uint8Array([0,0])`（Yjs 的"空"update）不 push/pull，省流量（`peer.ts:279-283`、`304-309`）。
- **合并后再推**：`pushUpdatesQueue` 里同一 doc 的多条 update 先 `mergeUpdates` 成一条，减少请求次数。

**断线自愈**：`syncRetryLoop`（`peer.ts:331-374`）包住 `sync`，任何异常（非手动停止）都等 5 秒后重试，期间状态置 `Retrying`。`stop()` 用 `abort.abort(MANUALLY_STOP)`，`MANUALLY_STOP` 是个哨兵常量，retry 循环识别它即彻底退出而非重试。

状态用 `DocPeerStatus`（step + totalDocs/loadedDocs + pendingPull/PushUpdates）表达，`updateSyncStatus` 据队列长度推导 step，并只在真正变化时（`lodash isEqual` 比对）发 `onStatusChange`，避免风暴（`peer.ts:141-147`）。

### 3.3 DocEngine：main 优先、shadows 跟随的四步调度

`DocEngine`（`doc/engine.ts`）管理一个 main `DocSource` 和多个 shadow `DocSource`，为每个源建一个 `SyncPeer`。`sync()` 的四步（`engine.ts:116-196`）正是"本地优先"策略的落地：

1. 启动 main peer；
2. `await mainPeer.waitForLoaded(signal)` —— **等主源先加载完**；
3. 再启动所有 shadow peer；
4. 持续同步，直到 `abort`。

`finally` 里统一 `stop` 所有 peer 并清理订阅。聚合状态 `updateSyncingState`（`engine.ts:198-215`）：所有 peer 都 `Synced` 才算 `Synced`，任一在 `Retrying` 则整体 `retrying=true`。对外提供 `waitForSynced`/`waitForLoadedRootDoc`/`waitForGracefulStop` 三个基于 `onStatusChange` 的 Promise 等待点，`canGracefulStop()` 要求主源无待推更新（`pendingPushUpdates===0`），保证"优雅停止"不丢数据。

状态枚举值刻意非连续（`doc/consts.ts`）：`DocPeerStep` 里 `Synced=6 > Syncing=5 > LoadingSubDoc=3 > LoadingRootDoc=2 > Retrying=1 > Stopped=0`，于是 `status.step >= DocPeerStep.LoadingSubDoc` 这类**数值比较**就能表达"至少加载到某阶段"，`waitForLoaded` 正是这么写的（`peer.ts:405`）。

### 3.4 BlobEngine：内容寻址 + 后台对账

Blob 是图片等二进制，策略比 Doc 简单得多（`blob/engine.ts`）：

- `get(key)`：按 `[main, ...shadows]` 顺序找，第一个命中即返回（`engine.ts:35-44`）。
- `set(value)`：若未给 key，用 `sha(await value.arrayBuffer())` 算**内容哈希当 key**（内容寻址，天然去重）；先 `await main.set` 确保主源写入，再 `Promise.allSettled` 后台推给各 shadow（不阻塞）（`engine.ts:63-105`）。
- `start()`：每 60 秒跑一次 `sync()` 做**双向对账**——`list()` 比对 main 与各 shadow 的 key 集合，缺哪边补哪边（`engine.ts:145-204`）。
- `delete` 被**刻意禁用**（只打日志）：因为没有索引知道某个 blob 还被哪些文档引用，贸然删会损坏文档（`engine.ts:29-33`）——一个诚实的"暂不支持"。

`BlobSource`（`blob/source.ts`）除 `get/set/delete/list` 外，还有可选的 `blobState$`（上传/下载进度的 RxJS Observable）和 `upload`（重传）。`@blocksuite/store` 的 `Workspace.blobSync` 类型就是这个 `BlobEngine`。

### 3.5 AwarenessEngine：最薄的广播层

Presence（光标/选区）易失、无需持久化，所以 `AwarenessEngine`（`awareness/engine.ts`）只有 `connect`/`disconnect` 两个方法，把一个 `y-protocols` 的 `Awareness` 实例接到一组 `AwarenessSource` 上。内置的 `BroadcastChannelAwarenessSource`（`awareness/impl/broadcast.ts`）用浏览器 `BroadcastChannel` 在**同源多标签页**间同步：本地 awareness 变化时 `encodeAwarenessUpdate` 后 `postMessage`，收到消息则 `applyAwarenessUpdate`，并用 `origin==='remote'` 守卫避免回环。

### 3.6 AsyncQueue：可等待、可优先级的异步队列

三套引擎的"更新队列"都基于 `utils/async-queue.ts` 的 `AsyncQueue`：`next(abort)` 在队列空时返回一个 Promise 挂起，`push` 时唤醒；`AbortSignal` 可中断等待。`PriorityAsyncQueue` + `SharedPriorityTarget` 允许设置"优先同步某个 docId"的规则（`DocEngine.setPriorityRule`），让用户当前正在看的文档优先同步——大工作区下的体验优化。

## 4. 语法特色

- **接口即契约，实现靠注入**：`DocSource`/`BlobSource`/`AwarenessSource` 全是 `interface`，方法返回类型写成 `Promise<T> | T`（同步/异步都兼容），最大化实现自由度。这是本包"抽象与实现分离"的语法体现。
- **`AbortController`/`AbortSignal` 贯穿取消**：所有长循环都接收 `signal`，用 `signal.addEventListener('abort', reject)` 把取消接进 `Promise.race`；配合 `MANUALLY_STOP` 哨兵常量（`throw-if-aborted.ts`）区分"手动停"与"真异常"。
- **非连续枚举值做阶段比较**：`DocPeerStep.Synced=6`、`Loaded=4.5` 等刻意留出大小关系（甚至用小数插队），使 `step >= X` 的数值比较能表达"已到达某阶段"。
- **Yjs 底层 API 直用**：`encodeStateVector`/`encodeStateAsUpdate`/`applyUpdate`/`mergeUpdates`（`peer.ts:5-10`）是 CRDT 同步的标准四件套；`doc.emit('sync', [true, doc])` 手动触发 Yjs 的加载信号。
- **`satisfies` 约束消息联合类型**：broadcast 源里 `this.channel.postMessage({ type: 'update', update } satisfies ChannelMessage)`，保证消息形状符合联合类型又不丢字面量类型。
- **`Promise.allSettled` 容错并发**：Blob 推影子源用它，保证"某个影子源挂了不影响主流程"。

## 5. 设计 / 实现亮点

- **协议与介质解耦**：引擎管调度、Source 管介质。换后端（IndexedDB→WebSocket→S3）只实现一个 Source，引擎代码零改动——这是本包最大的架构价值。
- **main + shadows 本地优先**：先等主源、再铺影子源，天然实现"本地缓存秒开 + 远端最终一致"，是离线可用编辑器的标准形态。
- **队列化 + 合并 + 空包过滤**：push/pull 全走可等待队列，同 doc 更新先 merge、空更新直接丢，兼顾吞吐与带宽。
- **自愈式重连**：`syncRetryLoop` 5 秒退避重试 + `MANUALLY_STOP` 哨兵，断网恢复无需外部干预，又能被干净地手动停止。
- **三类数据各用其所**：Doc 要精细增量、Blob 要内容寻址对账、Awareness 要轻量广播——没有强行统一成一套，而是按数据特性分别建模。
- **诚实的 `delete` 禁用**：宁可明确不支持删 blob，也不做会损坏文档的危险操作，并在日志里说明原因（等索引实现后再开放）。

## 6. 对外 API 与注意事项

- 主要导出：`DocEngine`/`DocSource`/`SyncPeer`/`DocPeerStep`、`BlobEngine`/`BlobSource`/`BlobState`、`AwarenessEngine`/`AwarenessSource`、`BroadcastChannelAwarenessSource`。
- **`yjs` 是 peerDependency**：本包不自带 Yjs，必须由宿主提供同一个 Yjs 实例（否则 CRDT 的 `instanceof` 会失效，呼应 store 的"防重复打包")。
- **你需要自己实现 Source**：本包内置实现很少（broadcast/indexeddb/memory/noop），生产环境的网络同步 Source 由上层（AFFiNE 的 nbstore/provider）提供。
- **blob 无法删除**：`BlobEngine.delete` 目前仅打日志不执行，设计使然。
- **优雅停止前确认 `canGracefulStop`**：直接 `forceStop` 可能丢失尚未 push 的本地更新；需要无损停止时用 `waitForGracefulStop`。
- **状态比较用枚举大小**：读 step 时用 `>=`/`===` 而非假设连续递增，枚举值是非连续的。

## 7. 延伸

- 同层：`@blocksuite/store`（`Workspace` 用 `BlobEngine` 做 `blobSync`，`AwarenessStore` 配合 `AwarenessEngine`）、`@blocksuite/global`（提供 `Logger`、`sha`）。
- 上层：AFFiNE 侧 `@affine/nbstore`（L1）实现具体的 Doc/Blob Source，把 BlockSuite 文档接入真正的本地库与云端。
- 对应教程：learning-guide 第 16 章《BlockSuite 架构与 Store 数据层》中关于协同与存储的部分。
