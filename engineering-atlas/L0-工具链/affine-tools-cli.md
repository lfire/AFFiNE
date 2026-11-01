# `@affine-tools/cli`

> 一句话定位：AFFiNE monorepo 的**统一命令入口**——即 `yarn affine`（及别名 `r`/`af`）。它把"在某个包里跑脚本/构建/开发"统一成一条命令，自带一个零配置的 TypeScript 运行时（SWC/tsx 加载器）、一套 clipanion 命令体系，以及 `init` 代码生成（tsconfig references、工作区类型清单）与 rspack 打包。

| 项        | 值                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `tools/cli`                                                                                                                                                |
| 所属层    | L0 · 工具链与类型基座                                                                                                                                      |
| 语言/形态 | TypeScript / CLI 可执行                                                                                                                                    |
| 关键依赖  | `clipanion`、`typanion`、`@swc/core`、`tsx`、`@rspack/core`、`@rspack/dev-server`、`inquirer`、`@affine-tools/utils`、`jsonc-parser`、`oxfmt`              |
| 被谁依赖  | 根 `package.json` 的 `affine`/`dev`/`build` 脚本、各业务包（`@affine/doc-diff`、`@affine/playstore-auto-bump`、`@affine/revert-update` 等经 `r` 运行脚本） |
| 对外入口  | `bin`：`affine`→`./bin/cli.js`、`r`→`./bin/runner.js`；`exports`：`./loader`、`./bundle`（`./src/bundle.ts`）                                              |

## 1. 设计逻辑

一个 60+ 包的 monorepo 面对几个反复出现的痛点：

1. **"在哪个包里跑什么脚本"过于啰嗦**。原生要 `yarn workspace @affine/web dev`，包名长、要记全称。
2. **`.ts` 脚本无法直接 `node` 执行**。大量工具脚本是 TypeScript，且用到装饰器（NestJS 后端）、`import attributes` 等新语法，需要一个能即时转译的运行时，但又不想让每个包各自配置 loader。
3. **跨包的派生配置需要同步生成**。例如 TypeScript 的 `references`（增量编译 / go-to-definition 依赖它）必须和真实的 workspace 依赖图保持一致；`PackageName` 联合类型要覆盖所有包——这些都应由工具根据依赖图自动生成，而非人工维护。
4. **前端应用的打包逻辑高度相似**（web/mobile/ios/android/electron-renderer 都是 "HTML 入口 + 若干 Worker"），适合收敛到一处。

`@affine-tools/cli` 就是这四件事的集中答案。它的核心立场是**"一条命令 + 自动注入运行时"**：用户只需 `yarn affine <包别名> <脚本>`，CLI 负责解析包、按需注入 TypeScript 运行时、把命令转交给 `yarn`。它刻意**不发明新的任务编排系统**（不是 turbo/nx 的替代品），而是做一层"贴近 AFFiNE 包结构"的智能分发层，真正执行仍回落到各包 `package.json` 里的 `scripts`。

与同层 `@affine-tools/utils` 的分工很清晰：`utils` 提供"知识层"（工作区依赖图、`Package`/`Path` 抽象、进程/日志），`cli` 提供"动作层"（命令、运行时注入、打包、代码生成），后者构建在前者之上。

## 2. 目录与关键文件

```text
tools/cli/
├── bin/
│   ├── cli.js          # affine 可执行：spawnSync('yarn', ['r', 'affine.ts', ...])
│   └── runner.js       # r 可执行：定位脚本文件 + 按文件类型注入运行时后 spawn node
├── register.js         # Node --import 钩子注册器（register('./hooks.js')）：服务端用
├── hooks.js            # Node module customization hooks：用 @swc/core 即时转译 .ts/.tsx（含装饰器）
├── tsx-register.js      # 仅 `import 'tsx'`：前端/通用脚本用的运行时
├── src/
│   ├── affine.ts       # CLI 装配：new Cli() + 注册全部 Command，runExit
│   ├── context.ts      # CliContext：把 Workspace 注入 clipanion 上下文
│   ├── command.ts      # Command 基类族：Command / PackageCommand / PackagesCommand / PackageSelectorCommand
│   ├── run.ts          # RunCommand（默认命令）：核心的"按包跑脚本"分发逻辑
│   ├── build.ts        # BuildCommand：-p <pkg> build 的代理
│   ├── dev.ts          # DevCommand：交互式选包后跑 dev
│   ├── clean.ts        # CleanCommand：清 dist/lib、node_modules、cargo target
│   ├── init.ts         # InitCommand：生成 tsconfig references / workspace.gen.ts / oxlint 配置
│   ├── bundle.ts       # BundleCommand：用 rspack 打包前端/服务端包
│   ├── cert.ts         # CertCommand：本地证书
│   ├── rspack/index.ts # createHTMLTargetConfig / createWorkerTargetConfig / createNodeTargetConfig
│   └── rspack-shared/  # html-plugin / cache-group / node-loader 等打包共享件
└── package.json        # bin: affine, r；exports: ./loader, ./bundle
```

## 3. 实现细节

### 3.1 三层入口：`affine` → `r` → `node + loader`

命令的"启动链"有三跳，每跳只做一件事：

**第一跳 `bin/cli.js`**（`yarn affine` 落点）只是把参数转交给 `r` 去跑 `affine.ts`：

```js
// tools/cli/bin/cli.js
spawnSync('yarn', ['r', 'affine.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
```

**第二跳 `bin/runner.js`**（`r` 可执行）是真正的"TypeScript 运行器"。它先在三个候选目录（`cwd`、`cli/src`、项目根）里解析出要跑的脚本文件（支持省略扩展名、补 `index`），再**根据文件归属决定注入哪个运行时**：

```js
// tools/cli/bin/runner.js（节选）
if (
  scriptLocation.endsWith('.ts') ||
  scriptLocation.startsWith(scriptsFolder)
) {
  if (scriptLocation.startsWith(serverRoot)) {
    nodeOptions.unshift(`--import=${pathToFileURL(tsRuntimeRegister)}`); // register.js → hooks.js(SWC)
  } else {
    nodeOptions.unshift(`--import=${pathToFileURL(tsxRuntimeRegister)}`); // tsx-register.js
  }
} else {
  nodeOptions.unshift('--experimental-specifier-resolution=node');
}
spawn(node, [...nodeOptions, scriptLocation, ...options], { stdio: 'inherit' });
```

这里藏着一个关键决策：**后端（`packages/backend/server`）用自研的 SWC 钩子，其余用 `tsx`**。原因在 3.2。

**第三跳**才是真正的业务——Node 带着运行时加载 `affine.ts`，进入 clipanion。

### 3.2 自研 SWC 装饰器加载器（`hooks.js`）

`register.js` 用 Node 官方的模块定制 API 把 `hooks.js` 挂成 `--import` 钩子：

```js
// tools/cli/register.js
import { register } from 'node:module';
register('./hooks.js', import.meta.url);
```

`hooks.js` 实现了 Node Loader 的两个钩子 `resolve` 与 `load`。`load` 钩子拦截所有 `file:` 协议的 `.ts/.tsx/.mts/.cts`，用 `@swc/core` 的 `transform` **即时编译为 JS**，核心配置是：

```js
// tools/cli/hooks.js（load 钩子节选）
output = await transform(sourceText, {
  module: { type: isCommonJs ? 'commonjs' : 'es6' },
  jsc: {
    target: 'es2022',
    keepClassNames: true,
    experimental: { keepImportAttributes: true },
    parser: {
      syntax: 'typescript',
      tsx,
      decorators: true,
      dynamicImport: true,
    },
    transform: {
      legacyDecorator: true, // ← 关键：启用 TC39 旧版（experimentalDecorators）
      decoratorMetadata: true, // ← 关键：产出 design:type 元数据
      useDefineForClassFields: false,
      react: tsx ? { runtime: 'automatic', importSource: 'react' } : undefined,
    },
  },
});
```

**为什么后端要单独走这套而不是用 tsx？** 因为 AFFiNE 服务端是 NestJS，重度依赖 `legacyDecorator` + `decoratorMetadata`（`reflect-metadata` 的 `design:type`/`design:paramtypes` 依赖它做依赖注入）。而 `tsx`（底层 esbuild）对"legacy 装饰器 + 发射元数据"的支持与 TypeScript 语义不完全一致，容易让 NestJS 的 DI 失效。于是 AFFiNE 针对后端自写了一个薄薄的 SWC 钩子，精确开 `legacyDecorator: true` / `decoratorMetadata: true`，保证装饰器元数据被正确发射。

`load` 钩子还带了一个**按 mtime 的转译缓存**（`transformCache`），同一文件未改动则直接复用上次编译结果，省掉重复转译开销：

```js
const cached = transformCache.get(filePath);
if (cached?.mtimeMs === stat.mtimeMs) {
  return { format: cached.format, source: cached.source, shortCircuit: true };
}
```

`resolve` 钩子则是一个"兜底解析器"：先让 Node 原生 `nextResolve` 试，失败了再用 `resolvePathLikeSpecifier` 对相对/绝对路径补扩展名（`.js` → `.ts/.tsx`）或补 `index`，模拟 TypeScript 的模块解析习惯，让源码里写 `./foo.js` 也能解析到 `./foo.ts`。

### 3.3 clipanion 命令装配

`src/affine.ts` 是 CLI 的"根装配"：创建一个带自定义上下文 `CliContext` 的 `Cli`，注册所有命令，`runExit` 时把一个 `new Workspace()` 实例注入上下文——于是每个命令都能通过 `this.context.workspace` 拿到完整的工作区依赖图：

```ts
// tools/cli/src/affine.ts
const cli = new Cli<CliContext>({
  binaryName: 'affine',
  enableColors: true,
  enableCapture: true,
});
cli.register(RunCommand);
cli.register(InitCommand);
cli.register(CleanCommand);
cli.register(BuildCommand);
cli.register(DevCommand);
cli.register(BundleCommand);
cli.register(CertCommand);
await cli.runExit(process.argv.slice(2), {
  workspace: new Workspace(),
  stdin,
  stdout,
  stderr,
});
```

`src/command.ts` 定义了命令基类族。`Command` 基类把日志、`exec`/`execAsync`/`spawn` 都绑定到命令名（作为日志 tag），并用一个 hack 从 `this.constructor.paths[0][0]` 取命令名：

```ts
// tools/cli/src/command.ts
export abstract class Command extends BaseCommand<CliContext> {
  // @ts-expect-error hack: Get the command name
  cmd = this.constructor.paths[0][0];
  get logger() {
    return new Logger(this.cmd);
  }
  get workspace() {
    return this.context.workspace;
  }
  exec = exec.bind(null, this.cmd);
  execAsync = execAsync.bind(null, this.cmd);
  spawn = spawn.bind(null, this.cmd);
}
```

在它之上派生出三个"选包"基类，区别只在"选几个包 / 是否可选 / 是否交互"：

| 基类                     | 选包方式                                       | 典型命令                 |
| ------------------------ | ---------------------------------------------- | ------------------------ |
| `PackageCommand`         | 必选单包（`--package,-p`，带 typanion 校验器） | `build`、`bundle`、`run` |
| `PackagesCommand`        | 必选多包（`Option.Array`）                     | —                        |
| `PackageSelectorCommand` | 可选单包，缺省时用 `inquirer` 列表交互选       | `dev`                    |

三者共用一个**包名校验器**：把所有真实包名（`Workspace.PackageNames`）与所有别名（`AliasToPackage` 的 key，如 `web`/`server`/`gql`）拼成白名单，用 `typanion` 的 `t.isOneOf(...t.isLiteral)` 校验，于是 `yarn affine xxx dev` 里的 `xxx` 不合法会在解析阶段就报错并给出可选项。

### 3.4 `run`：按包跑脚本的核心分发

`RunCommand` 是 CLI 的**默认命令**（`paths = [[], ['run'], ['r']]`，空数组表示"无子命令时的缺省"），它把"包名"从选项改成了位置参数，于是 `affine web build` 这样的自然写法得以成立：

```ts
// tools/cli/src/run.ts
static override paths = [[], ['run'], ['r']];
protected override packageNameOrAlias: string = Option.String({ required: true, validator: this.packageNameValidator });
args = Option.Proxy({ name: 'args', required: 1 }); // 透传其余所有参数
```

`run(name, args)` 的分发逻辑是：取 `args[0]` 当脚本名，**若该包 `package.json` 的 `scripts` 里有同名脚本就 `runScript`，否则当裸命令 `runCommand`**。

`runScript` 有几个精巧处理：

- **`--deps`（含依赖执行）**：遍历 `pkg.deps`（来自 `utils` 构建好的依赖图）对每个依赖递归跑同名脚本，`--wait-deps` 决定是并行等待还是火后不理（`Promise.all` vs `.catch` 记日志）。这让 `affine build -p web --deps` 能先把依赖全 build 再 build web。
- **`affine` 脚本自引用**：如果某个脚本本身是 `affine xxx`，它会剥掉开头的 `affine`、补上 `-p <当前包>`，直接 `this.cli.run(args)` 进程内递归，而不是再 fork 一个进程——省一次启动开销。
- **环境变量前缀提取**：`extractEnvs` 解析脚本里 `cross-env FOO=bar node ...` 这类前缀，把 `FOO=bar` 收进 `envs`、把 `cross-env` 跳过，于是不依赖 `cross-env` 包也能跨平台设置环境变量。

`runCommand` 负责真正 spawn，其**运行时注入**逻辑与 `runner.js` 呼应：根据包是不是 `@affine/server` 选 `serverRuntimeLoader`（SWC）还是 `tsxRuntimeLoader`，再根据 bin 是否在 `ignoreLoaderScripts`（`vitest`/`vite`/`tsx`/`prisma`/`tsc`/`electron`…）白名单里，决定是否追加 `--import=<loader>` 到 `NODE_OPTIONS`。最后统一在命令前补 `yarn`，让所有 bin 走 yarn 的 PATH 解析：

```ts
// tools/cli/src/run.ts（runCommand 节选）
const loader = pkg.name === '@affine/server' ? serverRuntimeLoader : tsxRuntimeLoader;
const isLoaderRequired = !ignoreLoaderScripts.some(i => new RegExp(i).test(bin)) || hasKnownLoader || ...;
if (isLoaderRequired) NODE_OPTIONS.push(`--import=${loader}`);
if (args[0] !== 'yarn') args.unshift('yarn');
await execAsync(pkg.name, args, { cwd: pkg.path.value, env: { ...envs, NODE_OPTIONS: NODE_OPTIONS.join(' ') } });
```

`BuildCommand` / `DevCommand` 本质都是 `run` 的语法糖：`build` 把 `-p <pkg> build` 转 `this.cli.run`；`dev` 先用 `PackageSelectorCommand.getPackage()` 交互选出一个可 dev 的包（白名单限定 web/server/electron/mobile/ios/android/admin 等），再转 `run`。

### 3.5 `init`：从依赖图生成派生配置

`InitCommand`（`paths = [['init'], ['i'], ['codegen']]`）解决"配置与依赖图同步"问题。它先用 `yarnList()` 实时拉一遍 `yarn workspaces list` 重建工作区，然后生成四类文件，每类都是 `(prev) => next` 的纯函数，生成后用 `oxfmt` 格式化再写回：

```ts
// tools/cli/src/init.ts（generateWorkspaceFiles 节选）
const filesToGenerate = [
  [this.workspace.join('tsconfig.json'), this.genProjectTsConfig],
  [utils.join('src/workspace.gen.ts'), this.genWorkspaceInfo],
  [this.workspace.join('.oxlintrc.json'), this.genOxlintConfig],
  ...this.workspace.packages
    .filter(p => p.isTsProject)
    .map(p => [p.join('tsconfig.json'), this.genPackageTsConfig.bind(this, p)]),
];
```

- **根 `tsconfig.json` 的 `references`**（`genProjectTsConfig`）：列出所有 TS 工程包的相对路径。用 `jsonc-parser` 的 `modify`+`applyEdits` 做"外科手术式"改写，只改 `references` 字段、保留注释与其余内容。
- **每个包的 `tsconfig.json` 的 `references`**（`genPackageTsConfig`）：改成"仅指向该包的 workspace 依赖里的 TS 工程"，于是 TS 的 Project References 增量编译图与真实依赖图严格一致。（代码里对 `@affine/electron-api` 留了特判，因存在已知循环依赖 `electron-api → electron → nbstore → electron-api`。）
- **`workspace.gen.ts`**（`genWorkspaceInfo`）：把 `yarn workspaces list` 的结果序列化成 `PackageList` 常量，并把所有包名拼成 `export type PackageName = 'a' | 'b' | ...` 联合类型——这就是 `utils` 里 `PackageName` 类型的来源，也是整个 CLI 包名自动补全/校验的类型基础。
- **`.oxlintrc.json`**：把 `.prettierignore` 的内容搬进 oxlint 的 `ignorePatterns`，让 lint 忽略与格式化忽略一致。

### 3.6 `bundle`：rspack 打包

`BundleCommand`（`paths = [['bundle'], ['pack'], ['bun']]`）用 rspack 打包前端/服务端应用。`getRspackBundleConfigs` 按包名 `switch` 出不同的"目标组合"：web/mobile 是"HTML 主入口 + 一组 Worker（profile/pdf/turbo/mermaid/typst/nbstore）"，ios/android 砍掉 mermaid/typst，server/reader 走 Node target。`src/rspack/index.ts` 的三个工厂（`createHTMLTargetConfig`/`createWorkerTargetConfig`/`createNodeTargetConfig`）产出真正的 rspack 配置，TS 用 `swc-loader`（`decoratorVersion: '2022-03'` 或 legacy），并把 `@affine-tools/utils` 算出的 `BUILD_CONFIG` 通过 `DefinePlugin` 以 `BUILD_CONFIG.<key>` 形式编译期替换进产物（详见 `types-base.md`）。`--dev` 则改用 `RspackDevServer` 起开发服务器。

## 4. 语法特色

- **clipanion 命令类与静态 `paths`**：命令是继承 `Command` 的类，`static override paths = [[], ['run'], ['r']]` 用"路径数组的数组"表达"多别名 + 默认命令"；`static override usage` 内联帮助文本与示例。选项用 `Option.String`/`Option.Boolean`/`Option.Array`/`Option.Proxy` 声明为类字段，解析期自动填充——是典型的"声明式 CLI"。
- **typanion 运行时校验器**：`t.isOneOf(list.map(t.isLiteral))` 在运行期把字符串参数收窄到包名白名单，与 `workspace.gen.ts` 生成的 `PackageName` 编译期联合类型形成"编译期 + 运行期"双保险。
- **Node Module Customization Hooks**：`register()` + 导出 `resolve`/`load` 异步钩子，是 Node 原生的 loader 机制；`shortCircuit: true` 表示本钩子已终结解析/加载，不再往下传。
- **`--import` 预加载**：通过 `NODE_OPTIONS=--import=<fileURL>` 在任意子进程里注入 TS 运行时，是"不改调用方代码就让 `.ts` 可跑"的关键手法。
- **方法绑定做隐式参数**：`exec = exec.bind(null, this.cmd)` 把命令名预绑进工具函数，命令内调用 `this.exec(cmd)` 就自带日志 tag。
- **`@ts-expect-error` 受控逃逸**：`cmd = this.constructor.paths[0][0]` 访问了 TS 看不到的静态属性，用 `@ts-expect-error` 显式标注"这里我知道在越界"。
- **`satisfies` 保形**：`init.ts` 里 `... satisfies [Path, (prev: string) => string]` 校验元组形状又不丢失具体类型。
- **jsonc 外科改写**：`modify`+`applyEdits` 只改 JSON 的某个 path，保留注释/格式，适合改维护者手写的配置文件。

## 5. 设计 / 实现亮点

- **"一条命令，三层入口"**：`affine`（装配）→ `r`（运行时注入）→ `node`（执行），每层职责单一，`r` 还能被任意包的脚本直接复用（如 `"diff": "r ./src/index.ts"`），成为 monorepo 的通用 TS 脚本运行器。
- **按包选运行时**：后端 SWC（精确发射装饰器元数据，保 NestJS DI）、其余 tsx（更快、够用），用一行 `startsWith(serverRoot)` 判断切换——用最小代价解决"一套 monorepo 两种装饰器语义"的难题。
- **配置由依赖图生成而非手写**：`init` 把 tsconfig references、`PackageName` 类型、lint ignore 全部从 `yarn workspaces` 的真实依赖图派生，杜绝"加了包忘了改 references"的长期熵增。
- **进程内递归 `this.cli.run`**：`affine` 自引用脚本、`build`/`dev` 代理都走进程内递归而非重新 fork，省启动开销也让日志连续。
- **mtime 转译缓存**：loader 层自带缓存，重复运行脚本几乎零转译成本。

## 6. 对外 API 与注意事项

- **可执行**：`affine`（= `yarn affine`）、`r`（通用 TS 脚本运行器，`r ./x.ts`）。README 还演示了在仓库根建一个 `af` 脚本把按键缩到 `af web build`。
- **`exports`**：`./loader`（供外部复用转译钩子）、`./bundle`（`BundleCommand`，供外部编程式调用 `BundleCommand.dev(pkg)` 等）。
- **常见坑**：
  - 包名/别名不在白名单会在参数解析阶段直接报错——新增包后需 `yarn affine init` 重新生成 `workspace.gen.ts`，否则 `PackageName` 不含新包。
  - `--deps` 默认等待依赖（`waitDependencies`），依赖脚本缺失会被 `ignoreIfNotFound` 静默跳过，别误以为"没跑"。
  - `ignoreLoaderScripts` 列表决定哪些 bin 不注入 TS 运行时（如 `vitest`/`tsc` 自带 TS 能力），新增自带 TS 能力的工具时可能需要补进该列表以免双重转译。
  - `bundle` 不支持 `--deps`（`override _deps = false`）。

## 7. 延伸

- 同层：`@affine-tools/utils`（本包的"知识层"：`Workspace`/`Package`/`Path`/`process`/`build-config`）、`types-base`（`BUILD_CONFIG_TYPE` 等全局类型，`bundle` 的 `DefinePlugin` 注入它们）。
- 下游使用：`@affine/doc-diff`、`@affine/revert-update`、`@affine/playstore-auto-bump` 都以 `r ./...ts` 作为脚本运行器。
- 对应教程：learning-guide 工具链章节《monorepo 的统一命令入口与 TS 运行时注入》。
