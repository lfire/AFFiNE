# `@affine/nbstore`

> 本包是重点包，运行机制、关键流程和易错点见 [重点包精讲](../重点包精讲/04-affine-nbstore.md)。

> 一句话定位：AFFiNE 的**本地优先存储与同步引擎**——定义一套"文档/Blob/Awareness/索引"的 Storage 抽象，为其提供 IndexedDB、SQLite、Cloud（socket.io）、磁盘、BroadcastChannel 等多种实现，用基于 Yjs 状态向量的增量同步算法把本地与多个远端对等体（peer）双向合流，并把整套引擎跑在后台 Worker（Web 端优先 SharedWorker）里、通过 Op RPC 对主线程透明暴露。它是 AFFiNE "离线可用 + 实时协同"的心脏。

| 项        | 值                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/common/nbstore`                                                                                                                   |
| 所属层    | L1 · 通用基础设施                                                                                                                           |
| 语言/形态 | TypeScript 库（多子入口，`sideEffects: false`）                                                                                             |
| 关键依赖  | `yjs`、`y-protocols`、`rxjs`、`@toeverything/infra`（Op RPC）、`@affine/realtime`、`@affine/reader`、`eventemitter2`、`nanoid`、`lodash-es` |
| 被谁依赖  | `@affine/core` 的 workspace/doc 引擎，经 `./frontend` 与 `./worker/client`                                                                  |
| 对外入口  | `.`、`./frontend`、`./sync`、`./worker/client`、`./worker/consumer`、`./idb`、`./sqlite`、`./cloud`、`./disk`、`./broadcast-channel` 等     |

## 1. 设计逻辑

AFFiNE 的数据模型是"每个文档/工作区 = 一个 Yjs 文档（YDoc），编辑产生二进制 update"。围绕它，nbstore 要同时满足四个苛刻目标：**本地优先**（离线能读能写）、**实时协同**（多端/多标签页即时看到彼此编辑）、**跨端复用**（Web 用 IndexedDB、桌面用 SQLite、云端走 WebSocket，同一套上层逻辑）、**不卡 UI**（繁重的存储与同步在后台线程）。

nbstore 的架构由四层正交抽象支撑：

1. **Storage 抽象层**：把"存什么"拆成七种正交的 `StorageType`——`doc`/`blob`/`awareness`/`indexer` 四种数据，各配一个 `xxxSync` 记录同步元数据。每种都是接口 + 抽象基类，具体后端只实现差异部分。
2. **多后端实现（impls）**：`idb`/`sqlite`/`cloud`/`disk`/`broadcast-channel` 各提供一组实现，用静态 `identifier` 字符串注册、可按需组合。**本地后端**（IDB/SQLite）负责持久化，**Cloud 后端**负责与服务器同步。
3. **同步引擎（sync）**：核心是 `DocSyncPeer`——一个"本地 Storage ↔ 单个远端 Storage"的双向增量同步状态机，用 Yjs 状态向量计算最小 diff、用优先级任务队列调度 pull/push/save。
4. **Worker 层**：整套引擎跑在后台线程里——Web/移动 Web 在浏览器支持时用 SharedWorker（多标签页共享一个同步引擎），否则用独立 Worker；Electron 用后台渲染页，iOS/Android 用普通 Worker。主线程通过 `@toeverything/infra` 的 Op RPC（`OpClient`/`OpConsumer`）调用，`frontend` 提供面向业务的 YDoc 绑定。

**核心立场——本地优先 + CRDT**：因为数据是 Yjs CRDT，合并天然无冲突；nbstore 只需负责"把 update 搬来搬去并持久化"，无需实现冲突解决。读时按需合并快照（见 3.2）则在"写入快、读取新"之间取得平衡。

## 2. 目录与关键文件

```text
src/
├── index.ts                # 聚合入口：connection + 仅类型的 frontend/sync + universal-id
├── storage/                # 【抽象层】
│   ├── storage.ts          # Storage 接口、七种 StorageType
│   ├── doc.ts              # DocStorage 接口 + DocStorageBase/SnapshotDocStorageBase（读时合并快照）
│   ├── blob.ts / blob-sync.ts
│   ├── awareness.ts
│   ├── indexer.ts / indexer-sync.ts / doc-sync.ts
│   ├── index.ts            # SpaceStorage：聚合七种 storage，缺省填 Dummy
│   ├── dummy/              # 各类型的空实现（未注册时的占位）
│   └── errors/
├── impls/                  # 【多后端实现】每个子目录含 doc/blob/... + index.ts(导出 xxxStorages 数组)
│   ├── idb/                # IndexedDB（Web 本地）：doc 继承 SnapshotDocStorageBase
│   ├── sqlite/             # SQLite（桌面本地，经 native）：doc 继承 DocStorageBase
│   ├── cloud/              # 云端：socket.io 实时 + http；doc/blob/awareness/indexer
│   ├── disk/               # 磁盘文件源
│   ├── broadcast-channel/  # 跨标签页
│   └── index.ts            # StorageConstructor（带 static identifier）+ 可用实现映射
├── sync/                   # 【同步引擎】
│   ├── index.ts            # Sync：按 peer 组装 doc/blob/awareness/indexer 四个 SyncImpl
│   ├── doc/peer.ts         # DocSyncPeer：核心双向增量同步状态机
│   ├── doc/index.ts        # DocSyncImpl：聚合多 peer
│   ├── blob/ awareness/ indexer/
├── worker/                 # 【Worker 层】
│   ├── client.ts           # 主线程侧：StoreManagerClient/StoreClient + Worker{Doc,Blob,...}Storage 代理
│   ├── consumer.ts         # Worker 侧：StoreManagerConsumer（store 池 + 引用计数）
│   ├── store.ts / ops.ts   # StoreConsumer / Op 方法签名定义
├── frontend/               # 【业务绑定】DocFrontend/BlobFrontend/AwarenessFrontend/IndexerFrontend
│   └── doc.ts              # DocFrontend：YDoc ↔ storage 的 load/save/apply 任务循环
├── connection/             # Connection 抽象 + AutoReconnectConnection（指数退避重连）
├── realtime/ telemetry/    # 实时请求管理、埋点队列
└── utils/                  # async-priority-queue、clock(ClockMap)、is-empty-update、universal-id…
```

## 3. 实现细节

### 3.1 Storage 抽象：七种类型 + `SpaceStorage` 聚合

```ts
// 来源：storage/storage.ts:3
export type StorageType =
  | 'blob'
  | 'blobSync'
  | 'doc'
  | 'docSync'
  | 'awareness'
  | 'indexer'
  | 'indexerSync';

export interface Storage {
  readonly storageType: StorageType;
  readonly connection: Connection; // 每个 storage 自带一个连接
}
```

`SpaceStorage`（`storage/index.ts:32`）把一个工作区的七种 storage 聚合到一个对象，**缺省的类型自动填充 `DummyXxxStorage`**：

```ts
// 来源：storage/index.ts:40
this.storages = {
  awareness: storages.awareness ?? new DummyAwarenessStorage(),
  doc: storages.doc ?? new DummyDocStorage(),
  docSync: storages.docSync ?? new DummyDocSyncStorage(),
  // ...
};

get<T extends StorageType>(type: T): Extract<Storages, { storageType: T }> { ... }
```

Dummy 填充的意义：同步引擎总能拿到齐全的七种 storage、无需到处判空；只读或仅索引场景下用 Dummy 禁用某类能力。`connect()`/`disconnect()`/`waitForConnected()` 批量驱动所有 storage 的连接。

### 3.2 读时合并快照（Snapshot + Updates 队列）——性能关键

这是 nbstore 最核心的数据结构设计，位于 `SnapshotDocStorageBase`。文档以"**一个快照 + 一队增量 update**"存储：写入时只追加 update（极快），**只有在读取最新文档时才把积压的 update 合并进快照**：

```ts
// 来源：storage/doc.ts:235  SnapshotDocStorageBase.getDoc
override async getDoc(docId: string) {
  await using _lock = this.isReadonly ? undefined : await this.lockDocForUpdate(docId);

  const snapshot = await this.getDocSnapshot(docId);
  const updates  = await this.getDocUpdates(docId);

  if (updates.length) {
    const { timestamp, bin, editor } = await this.squash(
      snapshot ? [snapshot, ...updates] : updates     // 快照 + 积压 update 一起 mergeUpdates
    );
    const newSnapshot = { spaceId: this.spaceId, docId, bin, timestamp, editor };
    if (!this.isReadonly) {
      await this.setDocSnapshot(newSnapshot, snapshot); // 写回新快照
      await this.markUpdatesMerged(docId, updates);     // 标记已合并、可清理
    }
    return newSnapshot;
  }
  return snapshot;
}
```

注释道破缘由（`storage/doc.ts:293`）：_"A huge amount of write time will be saved if we don't merge updates into snapshot immediately. Updates will be merged into snapshot when the latest doc is requested."_ 即**写放大换读延迟**——高频编辑只追加、不重写整个文档；读取时一次性合并并落盘新快照，分摊成本。`setDocSnapshot` 的注释还提醒：多线程下可能用过期快照调用，实现须"仅当新快照时间戳更新时才写入"。

`DocStorageBase.getDocDiff`（基类，`storage/doc.ts:156`）则基于 Yjs 的 `diffUpdate`/`encodeStateVectorFromUpdate` 返回"相对给定状态向量的缺失部分 + 自身状态向量"——这是增量同步的数据基础。IDB 与 Cloud 的 doc storage 都继承 `SnapshotDocStorageBase`；SQLite 继承更底层的 `DocStorageBase`，但合并策略相同（快照 + update 队列、读时合并），只是放在 Rust 侧 `packages/frontend/native/nbstore/src/doc.rs` 实现并用乐观 CAS 重试。

### 3.3 多后端：静态 `identifier` + `satisfies` 注册

每个实现是一个带**静态 `identifier`** 的类，各 impl 目录导出一个数组：

```ts
// 来源：impls/idb/index.ts:16
export const idbStorages = [
  IndexedDBDocStorage,
  IndexedDBBlobStorage,
  IndexedDBDocSyncStorage,
  IndexedDBBlobSyncStorage,
  IndexedDBIndexerStorage,
  IndexedDBIndexerSyncStorage,
] satisfies StorageConstructor[];

// 来源：impls/index.ts:10
export type StorageConstructor = {
  new (...args: any[]): Storage;
  readonly identifier: string; // 用字符串 id 标识实现，便于跨 worker 按名构造
};
```

`identifier` 字符串（如 `'IndexedDBDocStorage'`、`'CloudDocStorage'`）让 Worker 能在另一个线程里**按名字重建 storage 实例**——因为类本身无法通过 postMessage 传递，只能传其标识符 + 选项。Cloud 实现（`impls/cloud/`）用 `socket.io-client` 建立 WebSocket：`CloudDocStorage.socket.emitWithAck('space:load-doc', ...)` 拉文档、并订阅服务器广播的远端 update；`SocketManager` 还做了按 endpoint 的连接缓存（`SOCKET_MANAGER_CACHE`）。

### 3.4 `DocSyncPeer`：双向增量同步状态机

一个 `DocSyncPeer`（`sync/doc/peer.ts`）管理"本地 ↔ 一个远端"的同步。它的精髓：

**(a) 任务模型**：五种 Job——`connect`/`pull`/`push`/`pullAndPush`/`save`，塞进按 docId 分组的 `jobMap` + 优先级队列 `AsyncPriorityQueue`。主循环按 doc 弹出、**批处理同 doc 的同类任务**（如多个 push 合并成一次 `mergeUpdates` 再发），显著减少网络往返：

```ts
// 来源：sync/doc/peer.ts:889  push 批处理
const push = remove(jobs, j => j.type === 'push');
if (push?.length) { await this.jobs.push(docId, push as ..., signal); continue; }
```

**(b) 基于状态向量的最小 diff**：`pullAndPush` 先用本地 `encodeStateVectorFromUpdate` 得到本地状态向量，向远端 `getDocDiff(docId, stateVector)` 只取"远端有而本地没有"的部分；再用自写的 `docDiffUpdate`（`peer.ts:140`）比较双方状态向量，**仅当真正有差异时才回推**，避免无谓上传：

```ts
// 来源：sync/doc/peer.ts:140
function docDiffUpdate(local, localSv, remoteDiff, remoteSv) {
  if (!isEqualUint8Arrays(localSv, remoteSv))
    return diffUpdate(local, remoteSv);
  const localDiff = diffUpdate(local, localSv);
  return isEqualUint8Arrays(localDiff, remoteDiff)
    ? null /* 无差异 */
    : diffUpdate(local, remoteSv);
}
```

**(c) 时钟去重（ClockMap + pushed/pulled clock）**：用 `syncMetadata` 持久化"对每个 peer 已推送/已拉取到的时间戳"，`connect` 时比较本地 clock 与 pushedClock 决定是否需要推送，避免重复同步已同步过的内容。

**(d) 回环防护**：每个 peer 有唯一 `uniqueId = sync:${peerId}:${nanoid()}`，`pushDocUpdate` 带上它作为 origin；订阅远端 update 时跳过自己的 `uniqueId`，订阅本地 update 时**跳过整个 `sync:${peerId}:` 前缀**（同一 peerId 其他上下文写入的也跳过，`peer.ts:762`），防止把刚同步下来的 update 又同步回去形成死循环。

**(e) 健壮的主循环**：`mainLoop` → `retryLoop`，断线后 5 秒退避重试；但遇到**权限错误**（`DOC_ACTION_DENIED`/`SPACE_ACCESS_DENIED`）则停止重试（`isRemotePermissionError`）。doc 级错误被 `runRemoteDocJob` 隔离——单个文档同步失败只暂停该文档、记入 `docErrors`，不拖垮整个 peer。根文档（`spaceId`）的 Job 优先级为 `Infinity`（`peer.ts:977`），保证"新文档的成员关系先同步"。

**(f) 连接超时**：`retryLoop` 用 `Promise.race` 给"等待所有 storage 连接"加 30 秒超时（`peer.ts:730`）。

### 3.5 `DocFrontend`：YDoc 与 storage 的桥

`frontend/doc.ts` 的 `DocFrontend` 负责把业务层的 YDoc 实例与底层 storage 对接，同样用 load/save/apply 三种 Job 的优先级队列。它暴露细粒度的 `DocFrontendDocState`（`ready`/`loaded`/`updating`/`syncing`/`synced`/`syncRetrying`/`syncErrorMessage`），让 UI 能精确反映"本地已加载 / 正在落盘 / 正与远端同步"等状态。update 的 origin 用 `NBSTORE_ORIGIN`/`frontend:${nanoid()}` 标记，与同步层的 origin 机制协同去重。

### 3.6 Worker 层：SharedWorker 中的引擎 + Op RPC 代理

主线程完全不碰真实 storage，而是通过 `StoreClient`（`worker/client.ts:237`）操作一组**代理类**（`WorkerDocStorage`/`WorkerBlobStorage`/`WorkerDocSync`…）。这些代理把每个方法翻译成一次 Op 调用：

```ts
// 来源：worker/client.ts:278  WorkerDocStorage 代理
class WorkerDocStorage implements DocStorage {
  async getDoc(docId: string) {
    return this.client.call('docStorage.getDoc', docId);
  }
  async pushDocUpdate(update, origin?) {
    return this.client.call('docStorage.pushDocUpdate', { update, origin });
  }
  subscribeDocUpdate(cb) {
    // 订阅类走 Op 的 ob$（Observable over RPC）
    const sub = this.client
      .ob$('docStorage.subscribeDocUpdate')
      .subscribe(v => cb(v.update, v.origin));
    return () => sub.unsubscribe();
  }
}
```

`StoreManagerClient.open`（`client.ts:96`）为每个 store 新建一个 `MessageChannel`，把 `port2` 用 `transfer(..., [port2])` 转移给 worker，自己持有 `port1` 上的 `OpClient`——**每个 store 一条独立 RPC 通道**。关闭时用 `closeKey`（uuid）通知 worker 释放。

Worker 侧 `StoreManagerConsumer`（`worker/consumer.ts`）维护一个 **store 池 + 引用计数**：SharedWorker 模式下同一个工作区被多个标签页打开时**复用同一个 `StoreConsumer`、共享同一套同步引擎**，`refCount` 归零才真正销毁；独立 Worker 模式下每个标签页各有一套引擎，靠 IDB 的 BroadcastChannel 和 `IndexedDBLocker` 协调。`serialize(key, op)` 用 per-key 的 Promise 链把 open/close 串行化，杜绝并发开关的竞态（与 `@affine/auth` 的 `mutateStorage` 异曲同工）。这正是"多标签页只跑一份同步"的实现根基，也呼应了 `@toeverything/infra` 第 5 章"Op 让多线程像本地调用"。

### 3.7 `AutoReconnectConnection`：统一的连接生命周期

除 `DummyConnection` 及其子类（`HttpConnection`、`WorkerDocConnection`、`WorkerBlobConnection`）外，storage 的连接都继承 `AutoReconnectConnection`（`connection/connection.ts:24`），统一提供 `idle→connecting→connected→error→closed` 状态机、引用计数、指数退避重连（`retryDelay=3s`、`maxRetryDelay=60s`、`connectingTimeout=15s`）与 `onStatusChanged` 订阅。同步引擎正是监听它的状态变化，断线即 abort 当前同步、择机重连。

## 4. 语法特色

- **`await using` + `AsyncDisposable`（显式资源管理）**：`getDoc` 里 `await using _lock = await this.lockDocForUpdate(docId)` 用 TC39 显式资源管理语法，作用域结束自动释放文档锁——免去 try/finally 样板，异常路径也不漏锁。
- **判别联合建模任务与状态**：`Job`（connect/pull/push/...）、`ConnectionStatus`、`DocFrontendDocState` 全用联合类型；`remove(jobs, j => j.type === 'push')` 配合类型断言做批处理。
- **方法重载 + EventEmitter 封装**：`DocStorageBase.on/emit` 用重载区分 `'update'` 与 `'snapshot'` 事件各自的回调签名，底层统一走 `eventemitter2`。
- **映射类型做 storage 字典**：`SpaceStorageOptions = { [K in StorageType]?: Storages & { storageType: K } }`、`get<T>(): Extract<Storages, {storageType: T}>`——用映射类型 + `Extract` 让"按类型取 storage"的返回类型精确。
- **`satisfies StorageConstructor[]`**：各 impl 数组用 `satisfies` 校验每个类都带 `static identifier` 且构造签名匹配，同时保留元组字面量类型供推导 `identifier` 联合。
- **RxJS `share({ connector: () => new ReplaySubject(1) })`**：`peerState$` 用它做多订阅者共享 + 新订阅者立即拿到最新状态（见 `peer.ts:268`），与 infra 的 LiveData 惰性上游理念一致。
- **Observable over RPC（`client.ob$`）**：把跨 worker 的订阅建模成 Observable，`subscribeDocUpdate` 透明地跨线程推送 update。
- **Yjs 底层 API**：`diffUpdate`/`encodeStateVectorFromUpdate`/`mergeUpdates`/`applyUpdate`——直接操作 CRDT 二进制，是增量同步的基石。
- **`transfer(payload, [port2])`**：借 infra Op 的 transferable 支持，把 `MessagePort` 零拷贝转移进 worker。

## 5. 设计 / 实现亮点

- **读时合并快照**：用"追加 update + 惰性合并"把高频写的成本降到最低，又保证读到的永远是最新合并结果——离线编辑器的经典权衡，做得干净。
- **CRDT + 本地优先免冲突**：数据天然是 Yjs CRDT，同步层只搬运与持久化 update，彻底规避冲突解决的复杂度。
- **基于状态向量的最小 diff + 时钟去重**：只传真正缺失的字节、不重传已同步内容，配合 origin 回环防护，带宽与正确性兼顾。
- **peer 化同步**：`DocSyncPeer` 把"本地↔一个远端"做成可复用单元，`Sync` 按多 peer 组装，天然支持多远端（如主云端 + 协作服务器）与动态 `reconfigure`。
- **SharedWorker + 引用计数 store 池**：多标签页共享一份同步引擎，既省资源又避免多端重复同步；Op RPC 让主线程对"引擎在别的线程"完全无感。
- **故障隔离粒度到单文档**：`runRemoteDocJob` + `docErrors` 让一个文档的权限/导出错误不影响其余文档继续同步；根文档 `Infinity` 优先级保证成员关系先行。
- **统一自动重连连接**：需要长连接的后端共享一套退避重连状态机，上层只需订阅状态。

## 6. 对外 API 与注意事项

- **主要入口**：业务通过 `./worker/client`（`StoreManagerClient.open` 拿 `StoreClient`，再用其 `docFrontend`/`blobFrontend` 等）操作；`./worker/consumer` 在 SharedWorker 入口装配引擎；`./sync` 的 `Sync` 组装同步；各 `./idb`、`./sqlite`、`./cloud` 导出对应实现数组供注册。主 `.` 入口只 re-export 连接与**类型**（实现刻意要求从具体子入口引入，利于摇树，见 `index.ts` 注释）。
- **约定**：
  - 新增后端只需实现相应 `XxxStorageBase`/接口并给出静态 `identifier`，加进 impl 数组即可被 worker 按名构造。
  - doc 实现若走快照模型应继承 `SnapshotDocStorageBase` 并正确实现 `setDocSnapshot`（时间戳守护）；否则直接继承 `DocStorageBase`。
  - 同步元数据（pushed/pulled clock）持久化很关键，`syncMetadataScope: 'connection'` 的远端（如临时连接）会被换成 `DummyDocSyncStorage` 不持久化。
- **坑**：
  - `setDocSnapshot` 可能被过期快照并发调用——务必"仅更新更新的时间戳"，否则多线程下会回退数据。
  - origin 命名必须遵循 `sync:${peerId}:` / `nbstore-frontend` 等约定，自定义 origin 若与之冲突会破坏回环去重。
  - Cloud 后端依赖 `socket.io-client`、`@affine/realtime`，二者都在 `peerDependencies` 中，其中 `@affine/realtime` 同时也在 `dependencies` 里；`socket.io-client` 须由使用方提供。
  - 遇到 `DOC_ACTION_DENIED`/`SPACE_ACCESS_DENIED` 同步会**停止重试**（权限问题重试无意义），需上层处理鉴权后再触发。

## 7. 延伸

- 同层：`@toeverything/infra`（Op RPC、ORM 经 `connectDoc` 接入 nbstore）、`@affine/realtime`（Cloud 实时请求）、`@affine/reader`、`@affine/error`（同步错误）。
- 底层：Yjs / y-protocols（CRDT 与 awareness）。
- 对应教程：learning-guide 关于"本地优先存储与 CRDT 同步引擎"的章节。
