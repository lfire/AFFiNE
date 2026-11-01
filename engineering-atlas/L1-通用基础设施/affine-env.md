# `@affine/env`

> 一句话定位：AFFiNE 前端的**环境与常量中枢**——用构建期注入的全局常量 `BUILD_CONFIG` 回答"我是哪个发行版"，用运行期探测的全局 `environment` 回答"我跑在什么设备/浏览器上"，并集中托管一批跨端共享的常量、schema 与工具函数。

| 项        | 值                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/common/env`                                                                                     |
| 所属层    | L1 · 通用基础设施                                                                                         |
| 语言/形态 | TypeScript 库（多子入口、无默认入口）                                                                     |
| 关键依赖  | `zod`（运行时 schema）；peer：`@blocksuite/affine`、`@affine/templates`                                   |
| 被谁依赖  | `@affine/core`、`@affine/debug`、几乎所有前端包（通过全局 `BUILD_CONFIG` / `environment` 间接依赖其类型） |
| 对外入口  | `./global`、`./constant`、`./filter`、`./automation`、`./worker`、`./workspace`、`./blocksuite`           |

## 1. 设计逻辑

AFFiNE 的同一套前端代码要编译出 6 种发行版（`web` / `desktop` / `admin` / `mobile` / `ios` / `android`），还要在运行时适配 Linux/macOS/Windows/iOS、Safari/Chrome/Firefox、PWA/普通网页等组合。如果让业务代码到处写 `if (navigator.userAgent...)` 或 `process.env.XXX`，会导致两类问题：**判定逻辑分散、口径不一致**，以及**打包工具无法据此做死代码消除（tree-shaking）**。

`@affine/env` 把"环境判定"拆成正交的两层，并刻意用不同机制实现：

1. **构建期常量 `BUILD_CONFIG`**：在打包时就确定、整个 bundle 内是字面量常量。它回答"这份产物是为谁构建的"——发行版、是否 Electron、是否原生壳、版本号、各类外链 URL。因为是编译期常量，`if (BUILD_CONFIG.isElectron)` 这样的分支能被 rspack/vite 直接折叠并删除另一分支，移动端产物里不会残留桌面端代码。
2. **运行期环境 `environment`**：在应用启动时通过 `setupGlobal()` 探测 UA、`display-mode`、`<meta>` 标签后写入的全局对象。它回答"用户此刻在什么设备/浏览器里"——这些事只有运行时才知道。

**核心立场**：这两者都是**全局变量而非导出值**（`declare global`）。这是一个有意的权衡——让 `BUILD_CONFIG` / `environment` 像 `window`、`console` 一样随处可用、无需 import，代价是依赖一套 `tools/@types` 下的全局类型声明来保证类型安全。`@affine/env` 包本身主要负责：提供 `setupGlobal()` 的实现、UA 探测逻辑，以及把一批"跨端共享但又不属于任何业务模块"的常量/schema/工具归拢到一处。

## 2. 目录与关键文件

```text
packages/common/env/
├── package.json            # 多子入口；无 "." 主入口；dep: zod，peer: blocksuite/templates
└── src/
    ├── global.ts           # setupGlobal()：探测 UA + <meta env:*> 覆盖，写入 globalThis.environment
    ├── ua-helper.ts        # UaHelper：从 navigator.userAgent 解析设备/浏览器标志位
    ├── constant.ts         # 跨端常量：工作区默认名、MessageCode/Messages、几个错误类
    ├── filter.ts           # zod schema：Collection/Filter/Literal（文档过滤器与集合）
    ├── automation.ts       # Action<InputSchema, Args> 类型（配合 zod input 的动作描述）
    ├── worker.ts           # getWorkerUrl()：按 appVersion 拼 worker 脚本 URL
    ├── is-valid-ip-address.ts  # IPv4/localhost 校验（自托管地址判定用）
    └── page-info.ts
```

类型声明不在本包，而在仓库的全局类型目录（被各 `tsconfig` 引入）：

```text
tools/@types/
├── build-config/__all.d.ts # declare interface BUILD_CONFIG_TYPE + declare var BUILD_CONFIG
└── env/__all.d.ts          # declare type Environment + declare var environment / process / $AFFINE_SETUP

tools/utils/src/build-config.ts # getBuildConfig()：打包时按 distribution+channel 生成 BUILD_CONFIG 的值
```

## 3. 实现细节

### 3.1 `BUILD_CONFIG` 的"类型在一处、取值在另一处"

类型契约由 `tools/@types/build-config/__all.d.ts` 声明为**全局环境类型**：

```ts
// 来源：tools/@types/build-config/__all.d.ts:1
declare interface BUILD_CONFIG_TYPE {
  debug: boolean;
  distribution: 'web' | 'desktop' | 'admin' | 'mobile' | 'ios' | 'android';
  isDesktopEdition: boolean; // 'web' | 'desktop' | 'admin'
  isMobileEdition: boolean; // 'mobile'
  isElectron: boolean;
  isWeb: boolean;
  isNative: boolean; // 'desktop' | 'ios' | 'android'
  // ... appVersion / appBuildType / 各类外链 URL / SENTRY_DSN
}
declare var BUILD_CONFIG: BUILD_CONFIG_TYPE;
```

实际取值在打包时由 `getBuildConfig()` 计算，再由打包器以 `define`（字面量替换）注入：

```ts
// 来源：tools/utils/src/build-config.ts:20
const buildPreset: Record<BuildFlags['channel'], BUILD_CONFIG_TYPE> = {
  get stable() {
    return {
      debug: buildFlags.mode === 'development',
      distribution,
      isDesktopEdition: (['web','desktop','admin'] as ...).includes(distribution),
      isElectron: distribution === 'desktop',
      isNative: distribution === 'desktop' || distribution === 'ios' || distribution === 'android',
      // ...
    };
  },
  get beta() { return { ...this.stable, appBuildType: 'beta' }; },
  // internal / canary 同理，仅覆盖 appBuildType 与 changelogUrl
};
```

这里有两个值得注意的工程手法：

- **用 getter 做"继承式预设"**：`beta`/`internal`/`canary` 都 `...this.stable` 再覆盖差异字段，避免四份配置复制粘贴；getter 保证每次读取都是新对象、不互相污染。
- **`distribution` 单一真值派生出一堆布尔**：`isElectron`、`isNative`、`isWeb`… 全由 `distribution` 计算而来，业务侧只需读语义布尔而不必记忆枚举值的含义。

### 3.2 `setupGlobal()`：幂等 + 可被 `<meta>` 覆盖

运行期环境在 `global.ts` 中装配：

```ts
// 来源：packages/common/env/src/global.ts:3
export function setupGlobal() {
  if (globalThis.$AFFINE_SETUP) return; // 幂等：多次调用只生效一次

  let environment: Environment = {
    isLinux: false,
    /* ...全量默认值... */ publicPath: '/',
    subPath: '',
  };

  if (globalThis.navigator) {
    // 无 navigator（如 worker/SSR）时退回默认
    const uaHelper = new UaHelper(globalThis.navigator);
    environment = {
      ...environment,
      isMobile: uaHelper.isMobile,
      /* ... */ isPwa: uaHelper.isStandalone,
    };
    if (environment.isChrome && !environment.isIOS) {
      /* 修正 iOS 上的 Chrome 实为 Safari */
    }
  }

  applyEnvironmentOverrides(environment); // 读 <meta name="env:*"> 覆盖
  globalThis.environment = environment;
  globalThis.$AFFINE_SETUP = true;
}
```

`applyEnvironmentOverrides` 扫描所有 `<meta name="env:xxx">`，若 `xxx` 是 `environment` 的已知键，则用 `meta.content` 覆盖——字符串字段直接赋值，非字符串字段 `JSON.parse`。这让**服务端渲染/自托管部署能通过 HTML 注入运行时配置**（如 `subPath`、`isSelfHosted`），而不必重新打包。

### 3.3 `UaHelper`：把浏览器探测的"脏逻辑"隔离

UA 解析是出了名的陷阱（iOS 上的 Chrome 实为 WebKit、微信/抖音/微博内置浏览器伪装 Safari…）。`ua-helper.ts` 把这些启发式规则集中成一张标志位表：

```ts
// 来源：packages/common/env/src/ua-helper.ts:64
const ios = mobile && !android && /Mac OS/i.test(ua);
const chrome = /CriOS/i.test(ua) || /Chrome/i.test(ua);
const safari =
  !chrome && !wx && !weibo && !tiktok && /Safari|Macintosh/i.test(ua);
```

`getChromeVersion()` 还额外兼容 iOS 上的 `CriOS/` 前缀。所有判定都在 `initUaFlags()` 一次性算好，外部只读布尔属性。

### 3.4 `constant.ts`：跨端常量与 `as const satisfies`

`MessageCode` 是一组数字错误码，`Messages` 是其文案映射。映射用 `as const satisfies` 约束：

```ts
// 来源：packages/common/env/src/constant.ts:84
} as const satisfies {
  [key in (typeof MessageCode)[keyof typeof MessageCode]]: { message: string };
};
```

它保证 `Messages` **恰好**覆盖 `MessageCode` 的每个取值（漏一个就编译报错），同时 `as const` 又保留了字面量类型。

### 3.5 `filter.ts`：zod 自递归 schema

文档"集合/过滤器"的数据会被持久化到 YDoc，必须在读入时做运行时校验。`literalValueSchema` 是一个自递归类型（值可以是数组/对象再嵌套值），用 `z.lazy` 打破定义时的循环引用：

```ts
// 来源：packages/common/env/src/filter.ts:4
export const literalValueSchema: z.ZodType<LiteralValue, z.ZodTypeDef> =
  z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.array(z.lazy(() => literalValueSchema)), // 递归
    z.record(z.lazy(() => literalValueSchema)),
  ]);
```

`VariableMap` 是一个空接口 `interface VariableMap {}`，供上层通过**声明合并**注入可用的过滤字段名——这是把"字段集合"开放给业务模块扩展的经典手法。

## 4. 语法特色

- **全局类型声明（`declare global` / `declare var`）**：`BUILD_CONFIG`、`environment` 不走 import，而是在 `tools/@types` 里 `declare var`，让它们像 `window` 一样全局可用且类型安全。这是"约定优于导入"的取舍——省去无处不在的 import，代价是必须把类型目录纳入每个 `tsconfig`。
- **`as const satisfies T`（constant.ts）**：既用 `satisfies` 校验结构完整/类型正确，又用 `as const` 保留字面量——比单独的类型注解更精确。
- **`z.input<typeof schema>` 派生类型（automation.ts/filter.ts）**：类型直接从 zod schema 推导，`Action<InputSchema>` 的 `action` 入参类型 `z.input<InputSchema>` 与校验逻辑自动保持同步，杜绝"类型和校验器两处维护、悄悄漂移"。
- **`z.lazy` + 显式 `z.ZodType` 注解**：递归 schema 必须给变量显式标注类型，否则 TS 无法推断自引用；这是写递归 zod 的固定套路。
- **空接口 + 声明合并（`VariableMap`）**：用空 `interface` 作为"扩展点"，上层包各自 `declare module` 合并字段。
- **打包期 `define` 常量折叠**：`BUILD_CONFIG.isElectron` 在产物里是字面量 `true`/`false`，使 `if` 分支可被静态消除——这是"构建期常量"相较"运行期变量"的根本价值。

## 5. 设计 / 实现亮点

- **构建期 vs 运行期的清晰二分**：`BUILD_CONFIG`（我是谁）与 `environment`（我在哪）职责正交、机制不同，避免把"编译目标"和"运行设备"混为一谈——这是跨 6 端代码库保持整洁的关键划分。
- **死代码消除友好**：把发行版判定做成编译期字面量，直接让移动端产物不含桌面端代码，是体积与安全的双赢。
- **运行时可覆盖（`<meta env:*>`）**：同一份产物靠 HTML 注入即可切换自托管子路径等配置，自托管部署无需重新构建。
- **幂等装配（`$AFFINE_SETUP` 卫兵）**：`setupGlobal()` 在主线程/worker/多入口被重复调用也安全。
- **脏逻辑集中（UaHelper）**：把全世界最易出错的 UA 判定收敛到一个文件、一组标志位，业务侧只读语义布尔。

## 6. 对外 API 与注意事项

- **主要导出**：`setupGlobal()`（`./global`，应用启动最早期调用一次）、`UaHelper`、`getWorkerUrl(name)`（`./worker`）、`DEFAULT_WORKSPACE_NAME`/`MessageCode`/`Messages`/`WorkspaceNotFoundError` 等（`./constant`）、`filterSchema`/`collectionSchema` 等（`./filter`）、`isValidIPAddress`。
- **本包无 `.` 主入口**：必须按子路径 import（如 `@affine/env/constant`），这是刻意为之以保证按需加载、利于摇树。
- **`BUILD_CONFIG` / `environment` 不是本包导出**：它们是全局变量，直接用即可；类型来自 `tools/@types`。在**纯 Node 脚本/测试**里若未注入 `BUILD_CONFIG` 会得到 `undefined`，访问其字段将报错——需由测试环境或打包器提供。
- **`environment` 需先 `setupGlobal()`**：在它执行前读到的是未初始化值；worker/SSR 等无 `navigator` 场景只会得到默认标志位。
- **`getWorkerUrl` 依赖 `BUILD_CONFIG.appVersion` 与 `environment.subPath`**：worker 脚本名带版本号用于缓存失效，且刻意不用 `publicPath`（worker 须同源）。

## 7. 延伸

- 同层：`@affine/debug` 直接消费 `BUILD_CONFIG.debug` 决定是否开日志；`@toeverything/infra` 的 ORM/配置同样用 `zod` 做运行时校验（见其第 4 章"类型擦除")。
- 构建侧：`tools/utils/src/build-config.ts`（取值生成）、`tools/utils/src/distribution.ts`（包名→发行版映射）、`tools/cli/src/rspack-shared/html-plugin.ts`（注入）。
- 对应教程：learning-guide 关于"跨端构建与环境判定"的章节。
