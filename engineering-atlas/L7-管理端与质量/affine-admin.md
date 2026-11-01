# `@affine/admin`

> 一句话定位：AFFiNE **自托管部署的 Web 管理后台**——一个独立构建、挂在 `/admin` 路径下的 React SPA，面向服务器管理员，提供账号/工作区管理、服务器 `runtime settings`（App Config）可视化编辑、首次安装向导与登录鉴权。它复用 `@affine/graphql` 的 GraphQL 客户端对接 server 的 Admin API，用一套基于 radix + Tailwind 的 shadcn/ui 组件自成体系。

| 项        | 值                                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/admin`                                                                                                                                                         |
| 所属层    | L7 · 管理端与质量                                                                                                                                                                 |
| 语言/形态 | TypeScript / React 19 SPA（应用）                                                                                                                                                 |
| 关键依赖  | `@affine/core`、`@affine/graphql`、`@affine/component`、`@affine/routes`、`@radix-ui/*`、`swr`、`react-router-dom@7`、`react-hook-form`、`tailwindcss@4`、`@tanstack/react-table` |
| 被谁依赖  | 不被其它包 import；由 `affine bundle` 独立打包成 `static/admin/*.html`，由 server 的 `StaticFilesResolver` 托管                                                                   |
| 对外入口  | `src/index.tsx`（SPA 挂载点）；`exports` 暴露 `./*` 与 `./components/ui/*` 供内部模块互引                                                                                         |

## 1. 设计逻辑

AFFiNE 社区版/企业版支持**自托管**，部署者需要一个带界面的"服务器控制台"来完成：第一次启动时创建管理员、日常管理用户与工作区、在线调整服务端配置（SMTP、OAuth、AI/Copilot、存储、鉴权策略等）而无需改环境变量重启。这些能力如果塞进主应用 `@affine/web` 会带来三个问题：**权限边界模糊**（普通用户不该看到服务器配置）、**包体污染**（管理界面的表格/表单依赖很重）、**发布节奏耦合**。

因此 admin 被切成**独立的前端应用**：

1. **独立路由与独立构建**：所有页面挂在 `/admin/*`（见 `@affine/routes` 的 `ROUTES.admin`），`affine bundle` 单独打包，产物落在 `static/admin/`，与主应用的 `static/` 并列。
2. **自成一套 UI**：不复用主应用的 Lit/编辑器组件，而是引入 radix-ui primitives + Tailwind，按 shadcn 范式把组件源码"抄"进 `src/components/ui/`（`update-shadcn` 脚本即 `shadcn add`），管理员界面因此拥有与产品 UI 解耦、贴近"后台管理系统"审美的控件。
3. **薄客户端、重 server**：admin 自己几乎不含业务逻辑，所有数据读写都走 `@affine/graphql` 定义的查询/变更，由 server 的 `@Admin()` 守卫鉴权。admin 只负责"把表单变成 GraphQL 调用、把结果渲染成表格"。

**边界**：admin 与同层的测试工程（`@affine-test/*`）同属 L7，但职责正交——admin 是**被测/被运维的管理界面**，测试工程是**质量保障工具**。admin 复用了 `@affine/core` 的 bootstrap（`src/setup.ts` 仅 `import '@affine/core/bootstrap/browser'`）来获得全局 `environment`/`BUILD_CONFIG` 等运行时环境。

## 2. 目录与关键文件

```text
packages/frontend/admin/
├── package.json                 # name=@affine/admin，scripts: build=affine bundle / update-shadcn=shadcn add
├── tailwind.config.js           # Tailwind v4 配置
└── src/
    ├── index.tsx                # 入口：createRoot(#app).render(<App/>)；先 import './setup'
    ├── setup.ts                 # 仅 import '@affine/core/bootstrap/browser'，注入全局 environment
    ├── app.tsx                  # 路由骨架：BrowserRouter + Routes + 鉴权包装 + 懒加载各模块
    ├── config.json              # runtime settings 的字段元数据（module→key→{type,desc,env,link}）
    ├── fetch-utils.ts           # affineFetch：自动带 x-affine-version 头与 CSRF token
    ├── use-query.ts             # useQuery：SWR + gqlFetcherFactory 封装 GraphQL 查询（suspense）
    ├── use-mutation.ts          # useMutation / useMutateQueryResource：SWR mutation 封装
    ├── components/
    │   ├── ui/                  # shadcn 风格基础组件（button/table/dialog/form/select…，radix 封装）
    │   └── shared/              # 跨模块复用：data-table / confirm-dialog / feature-toggle-list…
    ├── hooks/                   # use-debounced-value 等
    └── modules/                 # 按页面划分的业务模块
        ├── common.ts            # useServerConfig / useCurrentUser / isAdmin / useMediaQuery
        ├── layout.tsx header.tsx nav/   # 整体布局、顶栏、侧边导航
        ├── auth/                # 管理员登录
        ├── setup/               # 首次安装向导（创建首个管理员）
        ├── accounts/            # 账号管理（列表/增删/禁用/重置密码/导入导出 CSV）
        ├── workspaces/          # 工作区管理（列表/详情/共享链接面板）
        ├── settings/            # runtime settings（App Config）分组编辑 + 保存
        ├── dashboard/           # 仪表盘（非自托管）
        └── about/               # 版本/关于
```

## 3. 实现细节

### 3.1 应用骨架与分级鉴权（`app.tsx`）

`App` 用 `react-router-dom@7` 的 `BrowserRouter` 构建，`basename={environment.subPath}` 适配子路径部署。路由做了**三层守卫**：

- `RootRoutes`：读 `useServerConfig()`，若服务器 `!config.initialized` 且当前不在 `/admin/setup`，强制跳转安装向导；根路径 `/admin` 按是否自托管重定向到 `accounts` 或 `dashboard`。
- `AuthenticatedRoutes`：读 `useCurrentUser()`，非管理员（`!isAdmin(user)`）一律 `Navigate` 到 `/admin/auth` 并 toast 提示。
- 页面级：`dashboard`/`workspaces` 在 `environment.isSelfHosted` 时重定向到 `accounts`（自托管不展示这些 SaaS 页面）。

各模块用 `lazy(() => import(/* webpackChunkName */ './modules/xxx'))` **按需切块**，首屏只加载骨架：

```tsx
// 来源：src/app.tsx:21-41
export const Setup = lazy(
  () => import(/* webpackChunkName: "setup" */ './modules/setup')
);
export const Accounts = lazy(
  () => import(/* webpackChunkName: "accounts" */ './modules/accounts')
);
// …dashboard / workspaces / about / settings / auth 同理
```

顶层还包了 `ThemeProvider`、`TooltipProvider`、`SWRConfig`（`revalidateOnFocus:false` / `revalidateOnMount:false`，避免后台频繁重拉），以及 Sentry 路由埋点（`window.SENTRY_RELEASE` 时用 `withSentryReactRouterV7Routing` 包裹 `Routes`）。

### 3.2 对接 server Admin API：GraphQL over SWR

admin 不自己写 fetch 逻辑，而是复用 `@affine/graphql` 的类型化查询对象 + `gqlFetcherFactory`，再用 SWR 封装成两枚 hook：

```ts
// 来源：src/use-query.ts（useQuery 默认开启 suspense）
const swr = useQuery({ query: adminServerConfigQuery });
// 来源：src/use-mutation.ts:51-66（useMutation 走 useSWRMutation）
const { trigger } = useMutation({ mutation: updateAppConfigMutation });
```

`common.ts` 把高频查询进一步语义化：`useServerConfig()`→`adminServerConfigQuery`、`useCurrentUser()`→`getCurrentUserFeaturesQuery`、`isAdmin(user)` 则判断 `user.features.includes(FeatureType.Admin)`——与 server 端 `AdminGuard.canActivate` 里 `feature.isAdmin(userId)` 的判定一一对应（`packages/backend/server/src/core/common/admin-guard.ts`）。

账号/工作区列表走分页查询，如 `useUserList` 把 `listUsersQuery` 的 `filter.first/skip/keyword/features` 与本地 `pagination` state 绑定，并用 SWR 的 `keepPreviousData` 保持翻页顺滑（`src/modules/accounts/use-user-list.ts`）。

安全细节在 `fetch-utils.ts`：`affineFetch` 为所有非 GET/HEAD 请求从 `affine_csrf_token` cookie 读取并附加 `x-affine-csrf-token`，同时统一打上 `x-affine-version: BUILD_CONFIG.appVersion` 头。

### 3.3 Runtime Settings 的"脏值暂存 + 分组保存"（`settings/use-app-config.ts`）

这是 admin 最精巧的一块。服务端配置以 `module.key`（如 `auth.allowSignup`、`mailer.SMTP.host`）的扁平命名空间组织，字段元数据静态声明在 `src/config.json`（每项含 `type`/`desc`/可选 `env`/`link`）。`useAppConfig` 的核心是维护一份**未保存改动的 diff**：

```ts
// 来源：src/modules/settings/use-app-config.ts:18-21
export type AppConfigUpdates = Record<
  string,
  { from: any; to: any; clear?: boolean }
>;
```

- `update(path, value)`：`path` 形如 `module/field/subField`，用 lodash `get/set` 计算新值，若 `isEqual(from, to)` 则把该键从 `updates` 中删除（改回原值即视为未改动），同时维护一份 `patchedAppConfig` 供 UI 即时回显。
- `clear(path)`：标记 `{ clear: true }`，对应 server 的"重置该项为默认"。
- `save()` / `saveGroup(module)`：把 `updates` 转成 `UpdateAppConfigInput[]`（`getUpdateInputs` 按首个 `.` 拆出 `module` 与 `key`），调 `updateAppConfigMutation`，成功后 `mutate()` 重新拉取并清空 diff，`notify.success` 提示。
- 还维护 `savingModules`、`groupVersions`（`bumpGroupVersion` 用于强制重挂某组表单）、`isGroupDirty`/`resetGroup` 等分组级交互状态。

### 3.4 首次安装向导（`setup/`）

当 server 尚未初始化，`RootRoutes` 导向 `/admin/setup`。该流程对应 server 的 `selfhost` 控制器 `POST /create-admin-user`（`packages/backend/server/src/core/selfhost/controller.ts:36`），创建第一个 `administrator` 账号后进入正常后台。

### 3.5 独立构建与 server 托管

`build` 脚本就是 `affine bundle`，产物进入 `static/admin/`。server 启动时 `StaticFilesResolver`（`packages/backend/server/src/core/selfhost/static.ts`）注册路由：

```ts
// 来源：static.ts:49-76（节选）
app.get(basePath + '/admin/index.html', (_req, res) =>
  res.redirect(basePath + '/admin')
);
app.use(
  basePath + '/admin',
  serveStatic(join(staticPath, 'admin'), { index: false, fallthrough: true })
);
app.get(
  [basePath + '/admin', basePath + '/admin/*path'],
  this.check.use,
  (_req, res) =>
    res.sendFile(
      join(staticPath, 'admin', env.selfhosted ? 'selfhost.html' : 'index.html')
    )
);
```

即：静态资源直出，未知子路由回落到 SPA 的 `index.html`/`selfhost.html`（自托管用后者），由前端路由接管——标准的 SPA history 回落托管。

## 4. 语法特色

- **路由懒加载 + webpack magic comment**：`lazy(() => import(/* webpackChunkName: "accounts" */ ...))` 让每个管理模块成为独立 chunk，`webpackChunkName` 给产物命名，利于按页面缓存（`app.tsx:24-41`）。
- **TypeScript 函数重载 + SWR 泛型**：`useMutation` 用一个带完整泛型约束的重载签名（`<Mutation extends GraphQLQuery, K extends Key>`）保证 `trigger(arg)` 的入参类型由 mutation 文档推断，实现体再用 `any` 收口（`use-mutation.ts:33-66`）——对外强类型、对内简单。
- **`exports` 子路径映射做内部分发**：`package.json` 里 `"./*": "./src/*.ts"` 与 `"./components/ui/*": "./src/components/ui/*.tsx"`，使模块间用 `@affine/admin/use-query`、`@affine/admin/components/ui/sonner` 这类稳定别名互引，而非相对路径穿越。
- **non-null 断言 + 注释豁免 lint**：入口 `createRoot(document.getElementById('app')!)` 用 `// oxlint-disable-next-line` 显式豁免（`index.tsx:8`）。
- **shadcn/radix 组合范式**：`components/ui/*` 不是 npm 依赖而是源码内联，配合 `class-variance-authority` + `tailwind-merge` 做变体与类名合并——这是 shadcn 的标志性写法，`update-shadcn` 脚本直接 `shadcn add` 追加新组件。
- **GraphQL 枚举做权限判定**：`isAdmin` 用 `user.features.includes(FeatureType.Admin)`，枚举来自 `@affine/graphql` 的 codegen，前后端共用同一套类型。

## 5. 设计 / 实现亮点

- **"diff 暂存 + 回显"的配置编辑模型**：`useAppConfig` 把"当前值/草稿值/是否脏/能否重置/分组保存"统一在一组 state 里，`isEqual` 判等自动消除无意义改动，是可视化配置后台的教科书式实现——避免了"全量提交"和"逐字段即时保存"两种极端。
- **彻底的应用级隔离**：独立路由 + 独立 bundle + 独立 UI 体系 + server 端 `/admin` 静态托管与 `@Admin()` 守卫，使管理端在构建、运行、权限三个维度都与主产品解耦。
- **薄客户端架构**：admin 几乎零业务规则，所有决策下沉到 server 的 GraphQL + Guard，前端只做"表单↔GraphQL↔表格"的映射，降低了被绕过鉴权的风险面。
- **元数据驱动的设置界面**：`config.json` 以声明式元数据描述每个配置项（类型/说明/环境变量/文档链接），设置页据此渲染，新增配置项基本只需补元数据。

## 6. 对外 API 与注意事项

- **不是库**：`@affine/admin` 是应用，不应被其它业务包 import；`exports` 仅服务其内部模块互引。要新增页面，走 `modules/` + `app.tsx` 路由注册 + `@affine/routes` 的 `ROUTES.admin` 常量。
- **所有数据操作都要有对应 GraphQL 文档**：新功能先在 `@affine/graphql` 定义查询/变更并在 server 加 `@Admin()`，admin 侧再用 `useQuery`/`useMutation` 接入；不要在 admin 里直接裸写 fetch（统一走 `affineFetch` 以带上版本号/CSRF）。
- **鉴权是双保险**：前端 `AuthenticatedRoutes` 只是体验层，真正的权限由 server `AdminGuard` 把关；切勿把敏感逻辑只放在前端判断。
- **自托管 vs SaaS 分支**：`environment.isSelfHosted` 会改变可见页面（隐藏 dashboard/workspaces），改路由时注意两套形态。
- **配置保存语义**：`clear` 与设置 `undefined` 不同——`clear:true` 是"恢复默认"，会生成 `{ module, key, clear: true }` 的输入；误用会导致配置被清空而非留空。

## 7. 延伸

- 服务端对应：`packages/backend/server/src/core/selfhost/`（静态托管、创建首个管理员）、`core/common/admin-guard.ts`（`@Admin()` 守卫）、各 `resolvers/*admin*.ts`（Admin API）。
- 共享底座：`@affine/graphql`（类型化查询）、`@affine/core`（bootstrap/environment）、`@affine/component`（`notify`）、`@affine/routes`（路由常量）。
- 同层测试：管理端相关的自动化验证属于 `@affine-test/*`（见 `affine-test-kit.md`、`affine-test-suites.md`）。
- 相关概念：L1 `@affine/env` 的 `BUILD_CONFIG`、L4 前端应用的构建/部署链路。
