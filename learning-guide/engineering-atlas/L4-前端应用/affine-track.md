# `@affine/track`

> 一句话定位：AFFiNE 的**埋点/分析事件体系**——用"页面▸区段▸模块▸事件"四级结构类型安全地描述所有用户行为，通过一个 `Proxy` 生成链式调用 API（`track.page.segment.module.event(args)`），并自带会话/参与时长管理与可插拔的遥测传输层，同时集成 Sentry。

| 项        | 值                                                                                         |
| --------- | ------------------------------------------------------------------------------------------ |
| 目录      | `packages/frontend/track`                                                                  |
| 所属层    | L4 · 前端应用                                                                              |
| 语言/形态 | TypeScript 库                                                                              |
| 关键依赖  | `@sentry/react`、`nanoid`、`react-router-dom`、`@affine/debug`                             |
| 被谁依赖  | `@affine/core` 及各 `apps/*`（埋点调用点、`data-event-props` 自动埋点）                    |
| 对外入口  | `.`（`track` 默认导出、`enableAutoTrack`、`sentry`、`setTelemetryTransport`、`tracker` …） |

## 1. 设计逻辑

埋点系统最怕两件事：**事件命名失控**（同一行为多处拼不同名）与**调用点冗长**（每次手拼 page/segment/module/event + 参数）。本包用一套"声明 + 生成"的设计同时解决：

1. **集中声明事件分类法（taxonomy）**：`events.ts` 用纯类型描述一棵 `page → segment → module → [events]` 的四层树（`PageEvents`），外加 `EventArgs` 为需要参数的事件定义参数形状。所有合法埋点在类型层面被穷举。
2. **`Proxy` 生成链式 API**：`auto.ts` 的 `makeTracker` 把那棵类型树映射成可链式访问的运行时对象，`track.$.cmdk.recent.recentDocs()` 这样的调用天然带类型约束与自动补全。
3. **传输与业务解耦**：`track` 只负责"产生带上下文的事件"，真正发到哪（GA 风格后端 / 自建端点）由 `telemetry.ts` 的可插拔 `TelemetryTransport` 决定；传输未就绪时事件先入内存队列。
4. **会话语义内建**：GA4 式的 `session_id`/`session_number`/`engagement_time_msec`/`first_visit`/`session_start`/`user_engagement` 全在 `tracker.ts` 里算好，业务无感。

## 2. 目录与关键文件

```text
src/
├── index.ts        # 组装：track = makeTracker((e,p)=>tracker.track(e,p))，并 re-export
├── events.ts       # 【核心】事件分类法：UserEvents 联合、PageEvents 四层树、EventArgs 参数表
├── types.ts        # CallableEventsChain / EventsUnion / 四层深度断言 / EventProps
├── auto.ts         # makeTracker（Proxy 链式 API）+ enableAutoTrack（DOM data 属性自动埋点）
├── tracker.ts      # 运行时核心：track/track_pageview/identify/session 管理/engagement 计时
├── state.ts        # trackerState 单例：enabled/clientId/session/middlewares…（含 localStorage 安全封装）
├── telemetry.ts    # TelemetryEvent/TelemetryTransport 抽象 + 待发队列 + context
├── sentry.ts       # 基于 @sentry/react 的初始化/启停封装
└── __tests__/      # auto / tracker 测试
```

## 3. 实现细节

### 3.1 事件分类法：四层类型树（`events.ts`）

所有用户行为先汇成一个大联合 `UserEvents`（按域分组：`DocEvents`、`AuthEvents`、`PaymentEvents`、`MeetingEvents`…）。再用一棵四层对象类型 `PageEvents` 把事件挂到具体位置，`$` 代表"该层不特化"：

```ts
// 来源：src/events.ts（节选）
interface PageEvents extends PageDivision {
  $: {
    // page
    cmdk: {
      // segment
      recent: ['recentDocs']; // module: [events]
      creation: ['createDoc'];
    };
    navigationPanel: {
      docs: ['createDoc', 'deleteDoc', 'linkDoc', 'drop', 'openDoc'];
    };
  };
  doc: { editor: { slashMenu: ['linkDoc', 'createDoc', 'bookmark'] } };
  edgeless: { pageBlock: { headerToolbar: ['toggle', 'switchPageMode'] } };
}
```

需要携带参数的事件在 `EventArgs` 里定义形状，例如：

```ts
export type EventArgs = {
  createDoc: { mode?: 'edgeless' | 'page' };
  signIn: AuthArgs; // { method: 'password'|'magic-link'|..; provider? }
  import: ImportArgs; // { type; status?; error?; result? }
  loadDoc: {
    workspaceId: string;
    docId: string;
    time: number;
    success: boolean;
  };
};
```

文件末尾有两处**编译期自检**，是本包类型工程的点睛之笔：

```ts
// EventArgs 的键必须是 UserEvents 的子集，否则这行报错
export const YOU_MUST_DEFINE_ARGS_WITH_WRONG_EVENT_NAME: keyof EventArgs extends UserEvents
  ? true
  : false = true;
```

### 3.2 四层深度断言（`types.ts`）

为防止有人把树写浅/写深，`types.ts` 用递归条件类型 `IsFourLevelsDeep` 在编译期断言整棵树恰好四层到达数组叶子：

```ts
type IsFourLevelsDeep<
  T,
  Depth extends number[] = [],
> = Depth['length'] extends 3
  ? T extends Array<any>
    ? true
    : false
  : T extends object
    ? {
        [K in keyof T]: IsFourLevelsDeep<T[K], [...Depth, 0]>;
      }[keyof T] extends true
      ? true
      : false
    : false;
export const _assertIsAllEventsDefinedInFourLevels: IsFourLevelsDeep<Events> = true;
```

`CallableEventsChain` 则把这棵树映射成"可调用"的同构结构——每个叶子事件变成一个函数，参数类型按该事件是否在 `EventArgs` 里取 `Partial<EventArgs[Event]> & EventPropsOverride` 或仅 `EventPropsOverride`。`EventsUnion` 用模板字面量把树拍平成 `` `${Page}.${Segment}.${Module}.${Event}` `` 的字符串联合，供 DOM 自动埋点用。

### 3.3 `makeTracker`：用 Proxy 把类型树变成运行时链式 API

运行时并没有那棵树的实体，`auto.ts` 用递归 `Proxy` 按访问路径现场构造：

```ts
// 来源：src/auto.ts
const levels = ['page', 'segment', 'module', 'event'] as const;
function makeTrackerInner(level, info) {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (levels[level] === 'event') {
          // 到第 4 层，返回真正的上报函数
          return arg =>
            trackFn(prop, {
              ...info,
              ...(typeof arg === 'string' ? { arg } : arg),
            });
        }
        // 否则下钻一层，$ 表示该层不写入 info
        const next = makeTrackerInner(
          level + 1,
          prop === '$' ? { ...info } : { ...info, [levels[level]]: prop }
        );
        target[prop] = next; // 缓存
        return next;
      },
    }
  );
}
```

于是 `track.doc.editor.slashMenu.createDoc({ mode: 'page' })` 在运行时等价于 `trackFn('createDoc', { page:'doc', segment:'editor', module:'slashMenu', mode:'page' })`。`index.ts` 把 `trackFn` 接到 `tracker.track`。

### 3.4 DOM 自动埋点：`enableAutoTrack`

为避免给每个可点元素都写 `onClick` 埋点，`enableAutoTrack(root, trackFn)` 在 `root` 挂一个 `click` 事件委托，读元素 `data-event-props="page.segment.module.event"`（`$` 表示留空）与 `data-event-arg` / `data-event-args-*` 自动上报。它还用 `declare module 'react'` 扩展了 `HTMLAttributes`，让 JSX 里写 `data-event-props` 有类型（值为 `EventsUnion`）。

### 3.5 会话与参与时长（`tracker.ts` + `state.ts`）

`tracker.track(name, props)` 的流程：先过 `middlewares`（可插拔改写），再 `buildQueuedEvents`——它负责**会话管理**：从 `sessionStorage` 读 `session_id`/最后活动时间，超过 `SESSION_TIMEOUT_MS = 30min` 则 `startNewSession`（`session_id = floor(now/1000)`，`session_number` 在 `localStorage` 自增）；首访补发 `first_visit`、新会话补发 `session_start`。`engagement_time_msec` 由 `visibilitychange`/`pagehide` 监听累计可见时长（`consumeEngagementTime`）。最终 `buildEvent` 封装成 `TelemetryEvent`（带 `BUILD_CONFIG` 里的 appVersion/channel/isDesktop、locale、timezone、url、`eventId: nanoid()`、`timestampMicros`）。`state.ts` 的 `trackerState` 持有这些状态，所有 `localStorage`/`sessionStorage` 访问都包了 try/catch（隐私模式/SSR 安全）。

### 3.6 可插拔传输 + 待发队列（`telemetry.ts`）

`track` 不直接发网络。`sendTelemetryEvent` 若 `transport` 未设置就 `enqueuePending`（上限 `PENDING_LIMIT = 500`，满了丢最旧）；`setTelemetryTransport(next)` 注入传输后自动 `flushPending`。`TelemetryTransport` 接口要求 `setContext/track/pageview?/flush?`，`TelemetryContext` 携带 `isAuthed/isSelfHosted/channel/userId/officialEndpoint`。这样核心库与"事件发往何处"彻底解耦。

### 3.7 Sentry 集成（`sentry.ts`）

`createSentry()` 封装 `Sentry.init`（DSN 来自 `BUILD_CONFIG.SENTRY_DSN`），集成 `reactRouterV6BrowserTracingIntegration`（接入 react-router 路由追踪），并暴露 `enable()/disable()` 通过改 `client.getOptions().enabled` 做运行时开关（与用户的遥测授权联动）。

## 4. 语法特色

- **递归条件类型 + 元组长度计数**：`IsFourLevelsDeep` 用 `Depth extends number[]`、`[...Depth, 0]` 累加、`Depth['length'] extends 3` 判深度——TS 里"用元组长度当计数器"的经典技巧。
- **映射类型同构变换**：`CallableEventsChain` 对 `Events` 逐层 `[K in keyof T]` 映射，把"数据树"变成"函数树"，并用 `Event extends keyof EventArgs ? ... : ...` 条件分支决定参数类型。
- **模板字面量类型拍平**：`EventsUnion` 用 `` `${Page & string}.${Segment & string}...` `` 把四层树压成点分字符串联合，直接用作 `data-event-props` 的类型。
- **编译期断言常量**：`keyof EventArgs extends UserEvents ? true : false = true` 与 `_assertIsAllEventsDefinedInFourLevels` 用"给常量标注一个只可能为 `true` 的类型"把约束前移到编译期。
- **递归 `Proxy`**：`makeTracker` 在没有数据实体的情况下按属性访问路径惰性生成并缓存子代理，是"类型树"到"运行时 API"的零样板桥接。
- **`declare module 'react'` 扩展 JSX 属性**：给 `HTMLAttributes` 增补 `data-event-props?: EventsUnion`，让自动埋点属性获得类型与补全。

## 5. 设计 / 实现亮点

- **类型即规范**：事件分类法是一棵被编译期强校验（四层/子集/穷举）的类型树，杜绝"野生事件名"，新增事件必须落位到 page/segment/module。
- **一处声明、两种消费**：同一棵树既生成命令式链式 API（`track.x.y.z.e()`），又拍平成字符串供声明式 DOM 埋点（`data-event-props`），覆盖手动与自动两种场景。
- **传输解耦 + 离线缓冲**：核心库与后端彻底分离，`transport` 未就绪先入队、就绪即 flush，保证早期事件不丢。
- **隐私友好**：所有存储访问带 try/catch 回退，支持 SSR / 隐私模式；`opt_out_tracking`/`enabled` 开关与 Sentry 启停联动尊重用户授权。

## 6. 对外 API 与注意事项

- 主用法：`import track from '@affine/track'`，`track.page.segment.module.event(args)`；`$` 占位表示该层不特化。
- 自动埋点：应用根调用一次 `enableAutoTrack(document.body, trackFn)`，元素上写 `data-event-props="..."`。
- 必须由宿主注入 `setTelemetryTransport(transport)` 才会真正发送；之前的事件会缓冲（上限 500，溢出丢最旧）。
- 新增事件：先在 `events.ts` 的 `UserEvents` 加名、挂到 `PageEvents` 某个位置；需参数则在 `EventArgs` 定义——漏任一步编译期即报错。
- 依赖全局 `BUILD_CONFIG`（appVersion/channel/SENTRY_DSN/isElectron…），非 AFFiNE 构建环境需自行提供。

## 7. 延伸

- 监控：`@sentry/react`；路由追踪依赖 `react-router-dom`。
- 上下文来源：`@affine/env` 的 `BUILD_CONFIG`。
- 消费方：`@affine/component`（`data-event-props`）、`@affine/core`、各 `apps/*`。
- 日志：`@affine/debug`。
