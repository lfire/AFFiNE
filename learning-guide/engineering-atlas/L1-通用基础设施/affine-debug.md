# `@affine/debug`

> 一句话定位：AFFiNE 前端的**统一调试日志开关**——在 npm `debug` 库之上包一层带级别（debug/info/warn/error）与命名空间的 `DebugLogger`，并把"是否输出日志"这件事统一收敛到构建常量、URL 参数、会话存储三个来源。

| 项        | 值                                                       |
| --------- | -------------------------------------------------------- |
| 目录      | `packages/common/debug`                                  |
| 所属层    | L1 · 通用基础设施                                        |
| 语言/形态 | TypeScript 库（单入口）                                  |
| 关键依赖  | `debug`（npm 经典日志库）；全局常量 `BUILD_CONFIG.debug` |
| 被谁依赖  | `@affine/core`、`@affine/nbstore` 等几乎所有前端模块     |
| 对外入口  | `.`（`DebugLogger`）                                     |

## 1. 设计逻辑

一个大型前端应用需要海量调试日志，但生产环境又不能让它们污染控制台、拖慢性能。常见做法是散落的 `console.log` 配合手动注释——既无法按模块开关，也无法在生产环境临时打开排障。

`@affine/debug` 的立场是：**日志默认全部关闭、零成本，但随时可按命名空间精确打开**。它不自己实现日志过滤，而是站在业界成熟的 `debug` 库（`DEBUG=app:*` 这套命名空间机制）肩上，只补两样 AFFiNE 特有的东西：

1. **一个带级别的 `DebugLogger` 类**：`debug` 库本身没有日志级别概念，AFFiNE 包了 `debug/info/warn/error` 四级，并把实际输出路由到对应的 `console` 方法（于是 `warn`/`error` 能在 DevTools 里带黄/红高亮与堆栈）。
2. **三条统一的"开关来源"**：构建期 `BUILD_CONFIG.debug`、URL 里的 `?debug`、以及 `sessionStorage` 持久化标志——让开发者、QA、乃至线上用户都能在不改代码的前提下打开日志。

**为何单独成包**：日志是最底层的横切关注点，几乎每个模块都要用。独立成 `@affine/debug` 既避免每个包各自封装 `debug`，又把"开关策略"这件全局性的事集中到一处、只配置一次。

## 2. 目录与关键文件

```text
packages/common/debug/
├── package.json          # dep: debug ^4；单入口 "."
└── src/
    ├── index.ts          # 全部实现：开关初始化（副作用）+ DebugLogger 类
    └── __tests__/index.spec.ts
```

整个包只有一个文件 `index.ts`，由两部分组成：**模块加载时执行的开关初始化副作用**，和 **`DebugLogger` 类**。

## 3. 实现细节

### 3.1 加载即决定开关（模块级副作用）

`index.ts` 在被 import 的那一刻就运行一段顶层代码，综合三个来源决定是否 `debug.enable(...)`：

```ts
// 来源：packages/common/debug/src/index.ts:4
const SESSION_KEY = 'affine:debug';

if (typeof window !== 'undefined') {
  // URL 带 ?debug → 写入 sessionStorage（页面跳转后 query 可能丢失，故持久化到会话）
  if (window.location.search.includes('debug')) {
    setSessionValue(SESSION_KEY, 'true');
  }
  // 会话里标记过 → 打开全部日志
  if (getSessionValue(SESSION_KEY) === 'true') {
    debug.enable('*');
    console.warn('Debug logs enabled');
  }
  // 构建常量开启（开发构建）→ 打开全部，但排除噪声极大的 micromark
  if (BUILD_CONFIG.debug) {
    debug.enable('*,-micromark');
    console.warn('Debug logs enabled');
  }
}
```

几处细节体现了打磨：

- **`?debug` 持久化到 `sessionStorage`**：浏览器导航后 URL 的 query 常被清掉，若只看 `location.search`，刷新/跳转一次日志就没了。写进会话存储后，整个标签页生命周期内都保持开启。
- **`getSessionValue`/`setSessionValue` 都 `try/catch`**：在沙箱化的 renderer、隐私模式或禁用存储的环境里，`sessionStorage` 访问会抛异常；包一层后优雅降级为"读到 null / 静默忽略写入"，不会让日志初始化拖垮整个应用启动。
- **`'*,-micromark'`**：开发构建打开所有命名空间，但显式排除 `micromark`（Markdown 解析器，日志量巨大且几乎无调试价值）——`debug` 库支持用 `-` 前缀做黑名单。
- **`typeof window !== 'undefined'` 卫兵**：worker/SSR 等无 window 环境不执行这段，仅得到默认关闭状态。

### 3.2 `DebugLogger`：级别 + 命名空间

```ts
// 来源：packages/common/debug/src/index.ts:42
export class DebugLogger {
  private readonly _debug: debug.Debugger;

  constructor(namespace: string) {
    this._debug = debug(namespace); // 每个 logger 绑定一个命名空间
  }

  set enabled(enabled: boolean) {
    this._debug.enabled = enabled;
  }
  get enabled() {
    return this._debug.enabled;
  }

  debug(message, ...args) {
    this.log('debug', message, ...args);
  }
  info(message, ...args) {
    this.log('info', message, ...args);
  }
  warn(message, ...args) {
    this.log('warn', message, ...args);
  }
  error(message, ...args) {
    this.log('error', message, ...args);
  }

  log(level: LogLevel, message: string, ...args: any[]) {
    this._debug.log = console[level].bind(console); // 把输出重定向到对应 console 方法
    this._debug(`[${level.toUpperCase()}] ${message}`, ...args);
  }

  namespace(extra: string) {
    // 派生子命名空间
    return new DebugLogger(`${this._debug.namespace}:${extra}`);
  }
}
```

核心机巧在 `log()`：`debug` 库默认把所有输出走 `console.log`（或 stderr）。这里**每次调用前先把 `this._debug.log` 重新绑定到 `console[level]`**，于是 `logger.error(...)` 真正走 `console.error`——在浏览器里带红色样式与可展开堆栈，在 Node 里走 stderr。消息前缀 `[ERROR]`/`[WARN]` 让日志级别在文本里也一目了然。

`namespace(extra)` 支持链式细分：`logger.namespace('sync')` 得到 `原命名空间:sync`，与 `debug` 库的 `:` 分层约定一致，于是可以用 `DEBUG=affine:nbstore:*` 这样的通配只打开某个子系统。

### 3.3 典型用法

```ts
const logger = new DebugLogger('affine:workspace');
logger.info('workspace loaded', workspaceId); // 仅当命名空间被 enable 时才输出
```

默认情况下这行代码**几乎零成本**：`debug` 判断该命名空间未启用就直接返回，不做任何字符串拼接与 console 调用。只有开发者在控制台执行 `localStorage.debug = 'affine:*'`（`debug` 库标准入口）或通过 `?debug` 打开后，日志才涌出。

## 4. 语法特色

- **模块级副作用（top-level side effect）**：`index.ts` 顶层直接跑开关逻辑，"import 即初始化"。这要求打包器不要把本模块错误地 tree-shake 掉——用 import 的位置来表达"在此刻决定日志策略"的时序语义。
- **`console[level].bind(console)` 动态方法分派**：用索引访问把运行时的 `level` 字符串映射到对应 console 方法，再 `bind` 保证 `this` 正确；一行代码取代四个 `switch` 分支。
- **TS 字面量联合类型做级别**：`type LogLevel = 'debug' | 'info' | 'warn' | 'error'`，既约束调用方，又恰好与 `console` 的方法名对齐，使 `console[level]` 类型安全。
- **getter/setter 透传封装状态**：`enabled` 用 accessor 直接代理到底层 `_debug.enabled`，对外像普通属性，内部仍是库的真实状态。
- **防御式 `try/catch` 包裹存储访问**：承认 Web 存储 API 在边缘环境会抛异常，用降级而非崩溃应对。

## 5. 设计 / 实现亮点

- **站在巨人（`debug` 库）肩上**：不重造命名空间匹配、通配、彩色输出这些轮子，只补 AFFiNE 真正缺的"级别 + 统一开关"，是"最小增量封装"的范例。
- **默认零成本、按需打开**：生产环境日志全关且几乎无运行时开销，但排障时可用 URL 参数或控制台一键打开指定子系统，兼顾性能与可观测性。
- **三源合一的开关策略集中管理**：构建常量（面向发布渠道）、URL `?debug`（面向 QA/用户）、sessionStorage（跨导航保持）三条路径在一处统一，而非散落各模块。
- **级别重定向到原生 console**：复用浏览器 DevTools 对 warn/error 的高亮、过滤、堆栈能力，而非自绘样式。

## 6. 对外 API 与注意事项

- **主要导出**：`DebugLogger` 类。`new DebugLogger('affine:xxx')` 后用 `.debug/.info/.warn/.error` 打日志，`.namespace('sub')` 派生子 logger，`.enabled` 读写开关。
- **命名空间约定**：建议用 `affine:<模块>:<子模块>` 分层，便于用 `DEBUG` / `localStorage.debug` 通配开启。
- **开关的真正入口是 `debug` 库自身**：除本包的三条策略外，开发者仍可在控制台 `localStorage.debug = 'affine:*'` 后刷新来精确控制——这是 `debug` 库的标准机制。
- **坑**：日志默认关闭，很多人误以为 `logger.info` "不工作"；需先打开命名空间。另外 `?debug` 会打开 `*`（除 micromark 外）全部日志，量极大，精确排障应改用具体命名空间。
- **副作用依赖 `window`/`BUILD_CONFIG`**：在无这两者的环境里仅得到默认关闭态，属预期行为。

## 7. 延伸

- 同层：`@affine/env` 提供本包消费的 `BUILD_CONFIG.debug` 常量。
- 底层库：npm `debug`（命名空间日志事实标准）。
- 对应教程：learning-guide 关于"可观测性与调试"的章节。
