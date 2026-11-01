# 类型基座 `tools/@types/*`（`@types/affine__env`、`@types/assets`、`@types/build-config`）

> 一句话定位：三个**只含全局类型声明、无任何运行时代码**的"环境类型"包——分别为"编译期注入的 `BUILD_CONFIG` 常量"、"非代码资源导入（`*.css`）"、"运行时全局环境（`environment`/`process`/`BUILD_CONFIG` 变量与 `Environment` 类型）"提供 TypeScript 类型。它们是整个前端能"类型安全地使用魔法全局量"的底座。

| 项        | 值                                                                     |
| --------- | ---------------------------------------------------------------------- |
| 目录      | `tools/@types/build-config`、`tools/@types/assets`、`tools/@types/env` |
| 所属层    | L0 · 工具链与类型基座                                                  |
| 语言/形态 | 纯 `.d.ts` 声明包（`types` 指向 `./__all.d.ts`，无 JS 产物）           |
| 关键依赖  | `env` 包依赖 `@affine/env`、`@blocksuite/affine`；其余无依赖           |
| 被谁依赖  | 全前端源码（通过 TS 的全局类型合并自动生效）                           |
| 对外入口  | 各包 `package.json` 的 `"types": "./__all.d.ts"`                       |

## 1. 设计逻辑

AFFiNE 前端代码里存在一批"凭空出现"的标识符——没有 `import` 却能直接用：

- `BUILD_CONFIG.isElectron`、`BUILD_CONFIG.appVersion`……（打包时由 rspack `DefinePlugin` 替换成字面量）；
- `environment.isMobile`、`environment.isSafari`……（运行时由启动代码填充的设备/变体信息）；
- `import styles from './x.css'`（非 JS 资源，TS 默认不认识）。

这些若没有类型，要么全是 `any`（丢失自动补全与类型检查），要么直接编译报错。把它们的类型**集中声明在几个独立的 `@types` 包**里，有三点好处：

1. **职责单一、边界清晰**：`build-config` 管编译期常量、`env` 管运行时全局、`assets` 管资源导入，各管一摊。
2. **全局生效、零 import**：用 `declare global` / `declare module` 做**全局声明合并**，被纳入 `tsconfig` 的 `types`/依赖后自动对全仓可见，无需每个文件再引。
3. **类型与实现分离**：类型声明在此、实际取值在别处（`BUILD_CONFIG` 的值由 `@affine-tools/utils` 的 `getBuildConfig` 算、由 `cli` 的 `DefinePlugin` 注入），声明包只负责"长什么样"。

命名上，`@types/affine__env` 用 `affine__env` 是 DefinitelyTyped 的 scope 编码惯例（`@affine/env` → `affine__env`），表示"为 `@affine/env` 补充的全局类型"。

## 2. 目录与关键文件

```text
tools/@types/
├── build-config/
│   ├── __all.d.ts     # declare interface BUILD_CONFIG_TYPE + declare var BUILD_CONFIG
│   └── package.json   # @types/build-config
├── assets/
│   ├── __all.d.ts     # declare module '*.css'
│   └── package.json   # @types/assets
└── env/
    ├── __all.d.ts     # Environment 类型 + 全局 var（environment/process/$AFFINE_SETUP/SENTRY_RELEASE）+ 扩展 DocMeta
    └── package.json   # @types/affine__env（依赖 @affine/env、@blocksuite/affine）
```

## 3. 实现细节

### 3.1 `@types/build-config`：编译期常量的类型

它声明了全局接口 `BUILD_CONFIG_TYPE` 与全局变量 `BUILD_CONFIG`：

```ts
// tools/@types/build-config/__all.d.ts
declare interface BUILD_CONFIG_TYPE {
  debug: boolean;
  distribution: 'web' | 'desktop' | 'admin' | 'mobile' | 'ios' | 'android';
  isDesktopEdition: boolean; // 'web' | 'desktop' | 'admin'
  isMobileEdition: boolean; // 'mobile'
  isElectron: boolean;
  isWeb: boolean;
  isNative: boolean; /* 'desktop'|'ios'|'android' */
  isMobileWeb: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isAdmin: boolean;
  appVersion: string;
  editorVersion: string;
  appBuildType: 'stable' | 'beta' | 'internal' | 'canary';
  githubUrl: string;
  changelogUrl: string;
  pricingUrl: string;
  downloadUrl: string;
  discordUrl: string;
  requestLicenseUrl: string;
  imageProxyUrl: string;
  linkPreviewUrl: string;
  SENTRY_DSN: string;
}
declare var BUILD_CONFIG: BUILD_CONFIG_TYPE;
```

这个接口是**三处一致性的锚点**：

- `@affine-tools/utils` 的 `getBuildConfig(pkg, flags)` 返回值类型就是 `BUILD_CONFIG_TYPE`（`tools/utils/src/build-config.ts`），编译器据此确保它产出的对象字段齐全、类型正确；
- `@affine-tools/cli` 的 rspack 配置把该对象逐字段喂给 `DefinePlugin`，以 `BUILD_CONFIG.<key>` 为 key 做源码级字面量替换（`tools/cli/src/rspack/index.ts`）：

```ts
// tools/cli/src/rspack/index.ts（DefinePlugin 节选）
new rspack.DefinePlugin({
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
  ...Object.entries(buildConfig).reduce((def, [k, v]) => {
    def[`BUILD_CONFIG.${k}`] = JSON.stringify(v);
    return def;
  }, {}),
});
```

- 前端源码里 `if (BUILD_CONFIG.isElectron) { ... }` 既有编译期常量折叠（打包后变成死代码消除），又有本声明带来的类型检查与补全。

所以 `BUILD_CONFIG` 是个**"运行时根本不存在的变量"**——它在打包时已被替换成字面量，`declare var` 只是让 TS 在源码阶段相信它存在并知道其形状。

### 3.2 `@types/assets`：非代码资源导入

仅一行，声明 `*.css` 为合法模块，使 `import './x.css'` 不再报 "Cannot find module"：

```ts
// tools/@types/assets/__all.d.ts
declare module '*.css';
```

无类型体，等价于把该导入视为 `any`——因为 CSS 的"值"在前端由 rspack 的 css-loader/style-loader 处理，TS 侧只需承认它是一个可被 import 的模块即可。

### 3.3 `@types/affine__env`：运行时全局环境

这是最丰富的一个，做了三件事：

**（1）引入上游声明副作用**：顶部 `import '@affine/env/constant'` 与 `import '@blocksuite/affine/global/types'`，把这两个包里的全局声明一并激活——本包因此在 `package.json` 里真实依赖 `@affine/env` 与 `@blocksuite/affine`。

**（2）用声明合并扩展第三方接口 `DocMeta`**：对 `@blocksuite/affine/store` 的 `DocMeta` 接口追加 AFFiNE 特有字段，而不改 BlockSuite 源码：

```ts
// tools/@types/affine__env/__all.d.ts（节选）
declare module '@blocksuite/affine/store' {
  interface DocMeta {
    /** @deprecated */ favorite?: boolean;
    trash?: boolean;
    trashDate?: number;
    updatedDate?: number;
    mode?: 'page' | 'edgeless';
    isPublic?: boolean;
  }
}
```

这是 TypeScript **接口声明合并**的典型用法：对同名模块内同名 `interface` 的声明会被合并，于是全仓拿到的 `DocMeta` 自动带上这些字段。

**（3）声明运行时全局量与 `Environment` 类型**：

```ts
// tools/@types/affine__env/__all.d.ts（节选）
declare global {
  declare type Environment = {
    isSelfHosted: boolean;
    isLinux: boolean;
    isMacOs: boolean;
    isIOS: boolean;
    isSafari: boolean;
    isWindows: boolean;
    isFireFox: boolean;
    isMobile: boolean;
    isChrome: boolean;
    isPwa: boolean;
    chromeVersion?: number;
    publicPath: string;
    subPath: string;
  };
  var process: { env: Record<string, string> };
  var environment: Environment;
  var $AFFINE_SETUP: boolean | undefined;
  /** Inject by @sentry/webpack-plugin */
  var SENTRY_RELEASE: { id: string } | undefined;
}
```

与 `BUILD_CONFIG`（编译期字面量）不同，`environment` 是**真正的运行时全局对象**，由应用启动代码探测设备/浏览器/变体后填充；这里只给它类型。`process` 被收窄成只有 `env`（浏览器环境没有完整 Node process），`$AFFINE_SETUP`/`SENTRY_RELEASE` 则是启动流程与 Sentry 插件注入的标记。

## 4. 语法特色

- **`declare global { ... }`**：在模块文件（有 `import`，故本身是模块）里重新打开全局作用域追加声明——这是"模块内声明全局"的唯一合法方式。
- **全局 `var` vs `interface`/`type`**：`declare var BUILD_CONFIG`/`var environment` 声明的是"值空间"的全局变量；`BUILD_CONFIG_TYPE`/`Environment` 是"类型空间"的形状——二者分离，值可被 DefinePlugin 替换、类型留给检查器。
- **接口声明合并（declaration merging）**：`declare module '@blocksuite/affine/store' { interface DocMeta {...} }` 向第三方接口非侵入式加字段，是扩展外部库类型的标准手法。
- **`declare module '*.css'` 通配模块声明**：用通配符为一类文件扩展名兜底类型。
- **字面量联合类型**：`distribution`/`appBuildType`/`mode` 等用字面量联合精确约束取值，呼应 `utils` 里 `as const` 的产出。
- **`import` 作副作用激活声明**：`import '@affine/env/constant'` 不取任何绑定，只为把其全局声明拉进编译上下文。
- **JSDoc `@deprecated`**：在 `.d.ts` 上标注废弃字段（如 `favorite`），IDE 会给出删除线提示。

## 5. 设计 / 实现亮点

- **"魔法全局量"的类型安全**：把 `BUILD_CONFIG`/`environment` 这类无 import 的全局做成有形状、可补全、可检查的类型，既享受编译期常量折叠的性能，又不牺牲类型安全。
- **声明与取值彻底分离**：类型声明（本包）、取值计算（`utils/getBuildConfig`）、注入（`cli/DefinePlugin`）三权分立，`BUILD_CONFIG_TYPE` 作为三者共同契约，改字段一处牵动、处处对齐。
- **非侵入扩展第三方类型**：用声明合并给 BlockSuite 的 `DocMeta` 加 AFFiNE 字段，避免 fork 或污染上游。
- **按关注点切成三个小包**：编译期常量 / 资源 / 运行时环境各一包，依赖面最小（`assets`/`build-config` 零依赖），加载与维护都轻。

## 6. 对外 API 与注意事项

- 三者都是**纯类型包**，运行时不存在，`import` 它们取不到任何值。
- 生效依赖 TS 配置：须被相关 `tsconfig` 的 `compilerOptions.types` 或依赖图纳入，全局声明才可见。
- **`BUILD_CONFIG` 在运行时不存在**：它只在打包时被 `DefinePlugin` 替换为字面量；在未经打包的环境（如某些测试/脚本）直接访问会是 `undefined`，需注意。
- 新增 `BUILD_CONFIG` 字段时，要**同时**改 `build-config/__all.d.ts`（类型）与 `utils/src/build-config.ts`（取值），否则类型与实际注入不一致。
- `assets` 只声明了 `*.css`；若将来直接 import 其它资源类型，需补对应 `declare module`。

## 7. 延伸

- 同层：`@affine-tools/utils`（`getBuildConfig` 产出 `BUILD_CONFIG_TYPE`）、`@affine-tools/cli`（`DefinePlugin` 注入 `BUILD_CONFIG`）。
- 上游：`@affine/env`（本包激活其 `constant` 声明）、`@blocksuite/affine`（被声明合并扩展 `DocMeta`）。
- 对应教程：learning-guide 类型基座章节《全局类型声明、声明合并与编译期常量注入》。
