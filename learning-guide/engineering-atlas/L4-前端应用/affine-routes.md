# `@affine/routes`

> 一句话定位：AFFiNE 的**路由常量/定义中心**——用一份 `routes.json` 声明路由树，经 `build.ts` 用 `path-to-regexp` 解析后生成类型安全的 `ROUTES`（绝对路径）、`RELATIVE_ROUTES`（相对路径）、`FACTORIES`（带参数类型的路径工厂）与 `RouteParamsTypes`（`useParams` 的参数类型），外加一个带 `Suspense` 的 `lazy` 组件助手。

| 项        | 值                                                                          |
| --------- | --------------------------------------------------------------------------- |
| 目录      | `packages/frontend/routes`                                                  |
| 所属层    | L4 · 前端应用                                                               |
| 语言/形态 | TypeScript 库（含 codegen 构建脚本）                                        |
| 关键依赖  | `path-to-regexp`（构建期）、`react`（peer，`lazy`）                         |
| 被谁依赖  | `@affine/core`、各 `apps/*`（注册 react-router、生成跳转 URL、读路由参数）  |
| 对外入口  | `.`（`ROUTES`、`RELATIVE_ROUTES`、`FACTORIES`、`RouteParamsTypes`、`lazy`） |

## 1. 设计逻辑

路由在前端是"字符串硬编码"的重灾区：`/admin/settings/${module}` 这种路径在注册、跳转、读参三处各写一遍，改名就漏。本包的立场是**路由定义单一真相源 + 代码生成**：

1. **一处声明**：`routes.json` 用嵌套对象描述路由树（父路由 + children），既有 `route`（本段路径）又隐含层级。
2. **四态产物**：`build.ts` 把这棵树编译成四种互补的产物——注册 react-router 用 `ROUTES`/`RELATIVE_ROUTES`，生成跳转 URL 用 `FACTORIES`（参数有类型），读 URL 参数用 `RouteParamsTypes`。
3. **参数类型自动推导**：带 `:param`/通配的路径会被 `path-to-regexp` 解析出参数名，生成 `` (params: { module: string }) => `/admin/settings/${params.module}` ``，从源头保证"路径需要哪些参数"在类型里可见。

**为什么单独成包**：路由常量是跨 app（web/electron/mobile）共享的纯定义，独立成包可被所有端一致引用，且把"生成"与"消费"隔开——业务只 import 生成结果，不碰 `path-to-regexp`。

## 2. 目录与关键文件

```text
routes/
├── routes.json        # 【真相源】路由树：{ route, children: { key: string | {route, children} } }
├── schema.json        # routes.json 的 JSON Schema
├── build.ts           # codegen：读 routes.json → path-to-regexp 解析 → 生成 src/routes.ts
└── src/
    ├── index.ts       # export * from './lazy' + './routes'
    ├── routes.ts      # 【生成物】RouteParamsTypes / ROUTES / RELATIVE_ROUTES / FACTORIES（四个 #region）
    ├── lazy.ts        # lazy()：React.lazy + Suspense 封装，兼容 default/命名导出
    └── __tests__/routes.spec.ts
```

## 3. 实现细节

### 3.1 真相源 `routes.json`

```jsonc
// 来源：routes.json
{
  "route": "/",
  "children": {
    "admin": {
      "route": "admin",
      "children": {
        "auth": "auth",
        "setup": "setup",
        "dashboard": "dashboard",
        "settings": {
          "route": "settings",
          "children": { "module": ":module" },
        },
        "notFound": "404",
      },
    },
  },
}
```

约定：叶子节点用字符串（相对父的路径段），分支节点用 `{ route, children }`；`:module` 是动态参数段。

### 3.2 `build.ts`：三遍处理

1. **`loadRoutesSchema`**：把 raw JSON 递归成 `RouteSchema`，为每个节点算出 `fromParent`（相对父）与 `fromRoot`（`join(fromRoot, segment)` 得到的绝对路径）。
2. **`buildRoutes`**：对每个节点的 `fromRoot` 跑 `path-to-regexp` 的 `parse`，遍历 `tokens`：`param`/`wildcard` token 收集进 `types` 和 `factories`（`${params.name}`），`text` token 直接拼进 `factories`。于是得到该路由的参数类型字符串 `{ module: string }` 与模板字面量工厂体。

```ts
// 来源：build.ts
const { tokens } = parse(schema.fromRoot);
for (const token of tokens) {
  switch (token.type) {
    case 'param':
    case 'wildcard':
      types.push(token.name);
      factories.push(`\${params.${token.name}}`);
      break;
    case 'text':
      factories.push(token.value);
      break;
  }
}
const type = types.length
  ? `{ ${types.map(t => `${t}: string`).join('; ')} }`
  : undefined;
```

3. **四个 printer**：`printSchemaTypes` / `printAbsolutePaths` / `printRelativePaths` / `printFactories` 分别递归打印四种产物，用 `@affine-tools/utils` 的 `formatCode` 格式化后写回 `src/routes.ts`。每段包在 `// #region <name>` 注释里。

`printFactories` 的巧思：对有 children 的节点，先 `const admin = () => '/admin'`，再把子工厂挂成 `admin.auth = () => '/admin/auth'`、`admin.settings.module = (params) => ...`——用"函数对象"把层级结构映射成可链式访问的工厂。

### 3.3 四态产物（`src/routes.ts`）

```ts
// 来源：src/routes.ts（生成物）
// #region Path Parameter Types
export interface RouteParamsTypes { admin: { settings: { module: { module: string } } }; }

// #region Absolute Paths —— 注册 react-router <Route path=...>
export const ROUTES = { index: '/', admin: { index: '/admin', settings: { index: '/admin/settings', module: '/admin/settings/:module' }, ... } };

// #region Relative Paths —— 嵌套 <Route> 用相对段
export const RELATIVE_ROUTES = { admin: { settings: { index: 'settings', module: ':module' } } };

// #region Path Factories —— 生成跳转 URL，带参数类型
const admin_settings = () => '/admin/settings';
admin_settings.module = (params: { module: string }) => `/admin/settings/${params.module}`;
export const FACTORIES = { admin, home };
```

四者各司其职：`ROUTES` 给绝对路径注册；`RELATIVE_ROUTES` 给嵌套路由的相对段；`FACTORIES` 在代码里安全生成 URL（`FACTORIES.admin.settings.module({ module: 'ai' })`）；`RouteParamsTypes` 给 `useParams<RouteParamsTypes['admin']['settings']['module']>()` 提供参数类型。

> 注：`routes.json` 当前含 `queue` 段，但 `src/routes.ts` 生成物未含该段——生成物可能滞后于源，重跑 `build.ts` 即同步。

### 3.4 `lazy.ts`：路由级代码分割助手

```ts
// 来源：src/lazy.ts
export function lazy<T extends ComponentType<any>>(factory, fallback?) {
  const LazyComponent = reactLazy(() =>
    factory().then(
      mod =>
        'default' in mod
          ? { default: mod.default }
          : { default: Object.values(mod)[0] } // 兼容命名导出，取第一个
    )
  );
  return props =>
    React.createElement(
      Suspense,
      { fallback },
      React.createElement(LazyComponent, props)
    );
}
```

它封装 `React.lazy + Suspense`，并处理一个常见痛点：动态 import 的模块若无 `default` 导出，自动取第一个命名导出（多于一个会 `console.warn`）——让路由模块不必强制 default export。

## 4. 语法特色

- **模板字面量工厂**：生成的工厂体 `` `/admin/settings/${params.module}` `` 用模板字面量把参数插进路径，参数对象带精确类型 `{ module: string }`，拼错/漏参编译期报错。
- **函数对象（callable + 属性）**：`const admin = () => '/admin'; admin.auth = () => ...`——把函数当对象挂子属性，表达层级路由，调用 `FACTORIES.admin()` 得父路径、`FACTORIES.admin.settings.module({...})` 得子路径。
- **`#region`/`#endregion` 分块生成**：生成文件按四类产物分 region，便于人读与工具折叠。
- **`path-to-regexp` 的 `parse` + token 判别**：按 `token.type`（`param`/`wildcard`/`text`）分派，是把路径模式转成"类型 + 工厂"的核心。
- **泛型约束 + 条件类型兜底导出**：`lazy<T extends ComponentType<any>>` 配合 `'default' in mod ? ... : ...` 运行时判别，兼容 default 与命名导出两种模块形态。
- **JSON Schema 约束真相源**：`schema.json` 给 `routes.json` 做结构校验，`$schema` 字段让编辑器实时提示。

## 5. 设计 / 实现亮点

- **单一真相源 → 四态产物**：一份 JSON 同时产出注册、跳转、读参所需的全部形态，彻底消灭"路径三处硬编码"。
- **参数类型从路径自动推导**：借 `path-to-regexp` 把 `:param` 变成类型字段，"这个路由需要哪些参数"由工具保证，而非人脑记忆。
- **绝对/相对双份**：react-router 既要绝对路径注册顶层、又要相对段做嵌套，本包两份都给，省去手工切分。
- **`lazy` 收敛代码分割样板**：路由懒加载 + Suspense + 导出兼容一次封装，所有路由统一用法。

## 6. 对外 API 与注意事项

- 注册路由用 `ROUTES`/`RELATIVE_ROUTES`，生成跳转 URL 一律用 `FACTORIES.*(params)` 而非手拼字符串，读参用 `useParams<RouteParamsTypes[...]>()`。
- **生成物勿手改**：`src/routes.ts` 由 `build.ts` 生成；改路由要动 `routes.json`（受 `schema.json` 约束）后 `yarn build`。
- 生成物可能滞后于 `routes.json`（如 `queue`）——以重跑构建后的结果为准。
- `lazy` 的 factory 若返回多个命名导出会 `console.warn` 并取第一个，建议每个路由模块单一导出。

## 7. 延伸

- 路由运行时：`react-router-dom`（`@affine/core` 据 `ROUTES` 注册）。
- 构建工具：`path-to-regexp`、`@affine-tools/utils`（`formatCode`/`Path`）。
- 相关埋点：`@affine/track` 的 `navigate` 事件（见 affine-track.md）。
