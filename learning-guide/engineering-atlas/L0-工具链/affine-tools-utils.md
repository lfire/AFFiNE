# `@affine-tools/utils`

> 一句话定位：AFFiNE monorepo 工具链的**知识层与基础原语**——把"工作区依赖图、包、路径、子进程、日志、构建配置、包别名/发行版映射"抽象成一组可复用的类与函数，为 `@affine-tools/cli` 及各构建脚本提供统一的"工作区认知"。

| 项        | 值                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------- |
| 目录      | `tools/utils`                                                                                            |
| 所属层    | L0 · 工具链与类型基座                                                                                    |
| 语言/形态 | TypeScript 库（源码直出，`exports` 指向 `./src/*.ts`）                                                   |
| 关键依赖  | `chalk`、`lodash-es`、`oxfmt`、`@types/node`                                                             |
| 被谁依赖  | `@affine-tools/cli`、`@affine/playstore-auto-bump`、各 rspack/构建脚本                                   |
| 对外入口  | `.`（format/path）、`./path`、`./workspace`、`./process`、`./logger`、`./build-config`、`./distribution` |

## 1. 设计逻辑

构建脚本反复需要回答几个问题："工作区里有哪些包？""这个包依赖谁、被谁依赖？""某个包的 `dist`/`src`/`node_modules` 在哪？""当前这次构建是什么发行版（web/desktop/ios…）、什么渠道（canary/stable…）？"如果每个脚本各自 `glob` 目录、各自解析 `package.json`、各自拼路径，必然散落且易错。

`@affine-tools/utils` 把这些"工作区常识"收敛成稳定原语：

1. **`Workspace` / `Package`**：以 `yarn workspaces` 的真实输出为唯一事实来源，构建出带依赖边的包对象图，并在构建时做**循环依赖检测**与**"公有包不得引用私有包"约束**。
2. **`Path`**：一个围绕 `node:path`/`node:fs` 的不可变路径对象，统一正斜杠、相对路径、存在性判断等高频操作。
3. **`process` / `Logger`**：带 tag 的子进程 spawn 与彩色分行日志。
4. **`build-config` / `distribution`**：把"包 → 发行版 → 构建配置对象（`BUILD_CONFIG_TYPE`）"的推导集中到一处。

它是**纯知识 + 纯工具**，不含任何命令行交互（那是 `cli` 的职责）。源码以 `.ts` 直接作为 `exports` 暴露，由调用方的 TS 运行时即时转译——不预编译、零构建产物。

## 2. 目录与关键文件

```text
tools/utils/src/
├── index.ts          # 聚合入口：re-export ./format 与 ./path
├── workspace.ts      # Workspace：构建包图 + 循环依赖/私有引用检测
├── package.ts        # Package：单包抽象（路径、scripts、deps、packageJson）
├── path.ts           # Path 类 + ProjectRoot 常量
├── yarn.ts           # PackageList（来自 workspace.gen）+ yarnList()（实时 yarn workspaces list）
├── workspace.gen.ts  # 自动生成：PackageList 常量 + PackageName 联合类型（由 cli init 生成）
├── distribution.ts   # PackageToDistribution / AliasToPackage 两张映射表
├── build-config.ts   # getBuildConfig(pkg, flags) → BUILD_CONFIG_TYPE
├── process.ts        # spawn / execAsync / exec（带 tag 日志、子进程登记）
├── logger.ts         # Logger：chalk 彩色、按行拆分、带 tag 前缀
├── format.ts         # formatCode：用 oxfmt 按 .oxfmtrc.json 格式化
└── types.ts          # YarnWorkspaceItem / CommonPackageJsonContent 接口
```

## 3. 实现细节

### 3.1 `Workspace`：从 yarn 输出构建包图

`Workspace` 的构造接收一个包清单（默认用 `workspace.gen.ts` 里的 `PackageList`，`init` 时则传入实时 `yarnList()`），先为每个 meta 造一个 `Package` 并以 `location` 为键放进 Map，再统一 `buildDeps` 连边：

```ts
// tools/utils/src/workspace.ts（节选）
constructor(list: typeof PackageList = PackageList) {
  this.packageJson = readPackageJson(ProjectRoot);
  const packages = new Map<string, Package>();
  for (const meta of list) {
    const pkg = new Package(meta.name as PackageName, meta);
    pkg.workspace = this; // @ts-expect-error internal api
    packages.set(meta.location, pkg);
  }
  const building = new Set<string>();
  packages.forEach(pkg => this.buildDeps(pkg, packages, building));
  this.packages = Array.from(packages.values());
}
```

`buildDeps` 是一个带 "正在构建集合 `building`" 的递归 DFS，在连边过程中就地做两类校验：

```ts
// tools/utils/src/workspace.ts（buildDeps 节选）
if (building.has(dep.name)) throw new CircularDependenciesError(dep.name);
if (!pkg.packageJson.private && dep.packageJson.private)
  throw new ForbiddenPackageRefError(pkg.name, dep.name);
```

- **循环依赖**：若一个包的依赖正处于"构建中"集合里，说明出现环，抛 `CircularDependenciesError`；外层 catch 住后，用 `building` 的插入顺序切片拼出完整环路（`a -> b -> c -> a`）打印后 `process.exit(1)`。
- **公有引用私有**：公有包（非 `private`）不得依赖私有包——这是发布正确性的硬约束，提前在工作区构建期暴露，而非等到发包才崩。

`getPackage(name)` 找不到即抛错；`tryGetPackage` 返回可空。`forEach`/`join` 等是便捷转发。

### 3.2 `Package`：单包抽象

`Package` 在构造时就把该包的全套派生路径算好（`srcPath`/`libPath`/`distPath`/`nodeModulesPath`），读取并缓存 `package.json`，记录 `isTsProject`（是否存在 `tsconfig.json`）与 `workspaceDependencies`（来自 yarn 的依赖位置列表）：

```ts
// tools/utils/src/package.ts（节选）
this.path = ProjectRoot.join(meta.location);
this.srcPath = this.path.join('src');
this.distPath = this.path.join('dist');
this.isTsProject = this.path.join('tsconfig.json').isFile();
get entry() { return this.packageJson.main || this.packageJson.exports?.['.']; }
get scripts() { return this.packageJson.scripts || {}; }
```

`deps: Package[]` 初始为空，由 `Workspace.buildDeps` 回填，形成双向可导航的包图。`workspace` getter 做了"未初始化即抛错"的防御。

### 3.3 `Path`：不可变路径对象

`Path` 把一个字符串路径包成对象，所有变换（`join`/`parent`/`relative`）都返回新 `Path`，不改原值。它还统一了跨平台的"正斜杠"问题（`toPosixString`/`relative` 在 Windows 上把 `\` 换成 `/`）与一组 fs 便捷方法（`exists`/`isFile`/`isDirectory`/`rm`/`mkdir`/`readAsFile`/`writeFile`/`toFileUrl`）：

```ts
// tools/utils/src/path.ts（节选）
static dir(url: string) { return new Path(fileURLToPath(url)).join('..'); }
get relativePath() { return './' + this.path.slice(ProjectRoot.path.length).replace(/\\/g, '/'); }
export const ProjectRoot = Path.dir(import.meta.url).join('../../../');
```

`ProjectRoot` 是全局锚点：从本文件 URL 往上三级即仓库根，所有相对路径计算以它为基准。`Path.dir(import.meta.url)` 这种"以当前模块位置定位"的写法贯穿工具链（`cli` 的 `run.ts`、`rspack` 的 node-loader 路径都用它）。

### 3.4 `yarn.ts`：两种包清单来源

本包有两条获取包清单的路径，对应"快"与"准"：

```ts
// tools/utils/src/yarn.ts（节选）
export const PackageList = await loadPackageList(); // 来自生成文件，秒读
export const yarnList = once(() => {
  // 实时 yarn，once 缓存
  const output = exec('', 'yarn workspaces list -v --json', { silent: true });
  let packageList = JSON.parse(`[${output.trim().replace(/\r\n|\n/g, ',')}]`);
  packageList.forEach(p => {
    p.location = p.location.replaceAll(/\\/g, '/');
    delete p['mismatchedWorkspaceDependencies'];
  });
  return packageList.filter(p => p.location !== '.'); // 排除根包
});
```

- `PackageList`（来自 `workspace.gen.ts`）是**预生成**的静态清单，普通命令直接用，避免每次都 fork yarn。注意这里用了**顶层 `await`** 动态 `import` 并容错（加载失败返回 `[]` 并记错），因此本模块是 ESM 异步模块。
- `yarnList()` 用 `lodash` 的 `once` 包裹，**首次调用才真的跑 `yarn workspaces list`**，把 NDJSON（每行一个 JSON）手动拼成 JSON 数组解析，统一正斜杠、丢掉无用字段、排除根包。`init` 命令用它来刷新 `workspace.gen.ts`。

### 3.5 `build-config.ts` / `distribution.ts`：构建配置推导

`distribution.ts` 维护两张静态映射表：`PackageToDistribution`（包名 → 发行版，如 `@affine/electron-renderer` → `desktop`）和 `AliasToPackage`（别名 → 包名，含手写的 `web`/`server`/`gql` 等 + 每个包"最后一段名"自动派生）。后者正是 `cli` 里 `-p web` 能解析成 `@affine/web` 的底层表。

`getBuildConfig(pkg, { channel, mode })` 把包映射成发行版后，产出符合全局类型 `BUILD_CONFIG_TYPE` 的配置对象。它用 **getter 做渠道继承**：`stable` 是基准，`beta`/`internal`/`canary` 都 `...this.stable` 再覆盖少量字段（主要是 `appBuildType` 与 `changelogUrl`）：

```ts
// tools/utils/src/build-config.ts（节选）
const buildPreset = {
  get stable() {
    return {
      debug: mode === 'development',
      distribution,
      isElectron: distribution === 'desktop',
      /* ...一堆 isXxx */ appBuildType: 'stable' as const,
      appVersion: pkg.version,
      githubUrl: '...',
      SENTRY_DSN: process.env.SENTRY_DSN ?? '',
    };
  },
  get beta() {
    return {
      ...this.stable,
      appBuildType: 'beta' as const,
      changelogUrl: '...releases',
    };
  },
  // internal / canary 同理
};
```

最后把非 CI 环境下的 `CHANGELOG_URL` 环境变量覆盖进去（`process.env.CI ? {} : environmentPreset`）——仅供本地调试，CI 不受影响。这个对象后续在 `cli` 的 rspack 配置里被 `DefinePlugin` 编译期替换成 `BUILD_CONFIG.*` 字面量（见 `types-base.md`）。

### 3.6 `process.ts` / `logger.ts`

`spawn` 统一了子进程行为：yarn 命令直接 `inherit` 三条流、其余 `pipe` stdout/stderr 再经 `Logger` 彩色输出；所有子进程登记进 `children` 集合便于管理；退出非零码打印错误。`execAsync` 是 `spawn` 的 Promise 封装，`exec` 则是同步 `execSync`（`yarnList` 用它）。

`Logger` 用 `chalk` 给 `info/warn/error/success` 各配一种配色，核心是 `getLineLogger`：把任意可 `toString` 的参数**按换行符拆成多行**，逐行加 `[tag]` 前缀与颜色——于是子进程大段输出也能带上一致的来源标记。

## 4. 语法特色

- **自定义错误类型 + 结构化信息**：`CircularDependenciesError`/`ForbiddenPackageRefError` 把出错上下文（`currentName`/`refName`）存进字段，让上层能重建环路、给出可读报错。
- **顶层 `await` 的 ESM 模块**：`yarn.ts` 用顶层 `await import()` 动态加载生成文件并容错，体现 `"type": "module"` 下的异步初始化。
- **`once` 惰性 + 记忆化**：`yarnList`/`format.ts` 的 `readConfig` 都用 `lodash.once`，保证昂贵操作（fork yarn、读配置）全程仅执行一次。
- **getter 做"继承式配置"**：`build-config` 用对象 getter + `...this.stable` 表达渠道间的"基准 + 覆盖"关系，惰性求值且无需类。
- **`as const` 收窄字面量**：`appBuildType: 'beta' as const` 让字段类型精确到字面量而非 `string`，匹配 `BUILD_CONFIG_TYPE` 的联合类型。
- **不可变路径对象**：`Path` 所有方法返回新实例，避免共享可变状态引发的路径污染。
- **`@ts-expect-error` 标注内部可写字段**：`pkg.workspace = this` / `pkg.deps = ...` 是"构建期由 Workspace 回填"的内部写入，用注释显式标注越过了 `private`/`readonly` 的意图。

## 5. 设计 / 实现亮点

- **单一事实来源**：包图完全由 `yarn workspaces` 派生，`Workspace`/`Package` 只是它的类型化视图，杜绝"手维护包列表"的漂移。
- **约束前移**：循环依赖与"公有引私有"在工作区构建阶段即报错并打印可读环路，把发布期才会暴露的问题提前到开发期。
- **快/准双清单**：静态 `PackageList`（快）+ `yarnList()`（准）分工明确，日常命令零 yarn 开销，`init` 时才付实时查询成本。
- **路径与日志的"小而统一"**：`Path` 与带 tag 的 `Logger` 看似琐碎，却让整条工具链的路径处理与输出风格高度一致、跨平台无忧。
- **配置推导集中化**：所有发行版/渠道差异收敛在 `build-config` + `distribution` 两处，新增渠道/发行版改动点可控。

## 6. 对外 API 与注意事项

- 子路径导出按关注点切分（`./workspace`/`./path`/`./process`/`./logger`/`./build-config`/`./distribution`），按需引入。
- **`workspace.gen.ts` 是生成物**，顶部明确 "DO NOT MODIFY"，新增/删除包后须 `yarn affine init` 重新生成，否则 `PackageName` 类型与 `PackageList` 滞后。
- `Package.deps` 只有经由 `new Workspace()` 构建后才被回填；单独 `new Package()` 的实例 `deps` 为空。
- `getBuildConfig` 对未登记发行版的包会抛 `Distribution for X is not found`——新增可打包前端包需同步在 `distribution.ts` 登记。
- `exec`/`spawn` 的首参是日志 tag（可传 `''`），别误当命令。

## 7. 延伸

- 上层：`@affine-tools/cli` 几乎每个命令都依赖本包（`Workspace`/`Package`/`Path`/`process`/`build-config`/`distribution`）。
- 相关：`types-base`（`BUILD_CONFIG_TYPE` 的声明，本包 `build-config.ts` 产出符合它的对象）。
- 对应教程：learning-guide 工具链章节《工作区依赖图与构建配置推导》。
