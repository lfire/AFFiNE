# `@affine-test/kit`

> 一句话定位：AFFiNE 所有 E2E 测试工程的**共享工具包**——它在 Playwright 的 `test` 之上扩展出带 fixture 的测试基座（web / electron / mobile 三套入口），并沉淀一大批"页面动作"辅助函数（打开首页、新建文档、创建/登录云工作区、拖拽、数据库块…），让 `tests/affine-*` 七套测试只写业务断言、不重复造页面操作样板。

| 项        | 值                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `tests/kit`                                                                                                                                                                                                                                  |
| 所属层    | L7 · 管理端与质量                                                                                                                                                                                                                            |
| 语言/形态 | TypeScript 库（仅在测试期被 import，非运行时产物）                                                                                                                                                                                           |
| 关键依赖  | `@playwright/test@=1.58.2`、`@affine-tools/utils`（`Package`/`Path`/`ProjectRoot`）、`@blocksuite/affine`、`@toeverything/infra`、`@node-rs/argon2`、`express` + `http-proxy-middleware`、测试期动态引入 `@prisma/client`、`@faker-js/faker` |
| 被谁依赖  | `@affine-test/affine-local`、`affine-cloud`、`affine-cloud-copilot`、`affine-desktop`、`affine-desktop-cloud`、`affine-mobile`、`@affine-test/blocksuite`                                                                                    |
| 对外入口  | `./playwright`（web 基座）、`./electron`（桌面基座）、`./mobile`（移动基座）、`./utils/*`（动作库）、`./bs/*`（BlockSuite 块操作）                                                                                                           |

## 1. 设计逻辑

E2E 测试天然面临两类重复：**环境搭建重复**（每个 spec 都要启动浏览器/Electron、跳过 onboarding、准备覆盖率采集）和**页面操作重复**（登录、建工作区、等编辑器加载、点"新建文档"这些动作在成百上千个用例里反复出现）。若放任重复，测试代码会迅速腐化。

kit 的解法是把这两类重复各收敛成一种机制：

1. **用 Playwright 的 `test.extend` 固化环境**：kit 不直接导出 `@playwright/test` 的 `test`，而是 `baseTest.extend({...})` 出一个**预置了 fixture 的 `test`**。各套件统一 `import { test } from '@affine-test/kit/playwright'`，于是"跳过 onboarding、标记 `playwright-test` body class、按需开启 Istanbul 覆盖率、CPU 节流"等横切逻辑对所有用例自动生效。
2. **用纯函数 + 轻量 POM 固化动作**：`utils/` 下按领域（`load-page` / `page-logic` / `cloud` / `workspace` / `setting` / `sidebar`…）组织大量 `(page: Page, ...) => Promise<...>` 形式的动作函数。它们是"半页面对象"——不强求 class，而是用 `getXxx(page)` 返回一组闭包方法，或直接导出独立动作，既有 POM 的复用性又无继承负担。

**三入口对应三种运行形态**：`playwright.ts`（普通浏览器 web）、`electron.ts`（Playwright 的 `_electron` 启动桌面壳）、`mobile.ts`（移动端 web）。三者都 `extend` 自同一个 `baseTest`，共享 `workspace` fixture 的语义，但各自重写 `page`/`context` 以适配形态差异。这正是"为什么要分层测试"的根：**同一份业务断言，需要在 local/cloud × web/desktop/mobile 的不同宿主上跑**，kit 把"宿主差异"封装在入口里，让上层 spec 尽量宿主无关。

## 2. 目录与关键文件

```text
tests/kit/
├── package.json              # name=@affine-test/kit，exports 四类子入口；peerDeps: @playwright/test/express/...
├── tsconfig.json
└── src/
    ├── playwright.ts         # ★web 基座：export const test = baseTest.extend({ workspace, page, context })
    ├── electron.ts           # ★桌面基座：启动/清理 Electron app，扩展 electronApp/shell/appInfo/views/router
    ├── mobile.ts             # ★移动基座：page fixture 先 goto('/') 并等待 .affine-page-viewport
    ├── utils/
    │   ├── load-page.ts      # openHomePage / open404Page / openJournalsPage / setCoreUrl（coreUrl=:8080）
    │   ├── page-logic.ts     # 文档层动作：clickNewPageButton / waitForEditorLoad / createLinkedPage / addDatabase / dragTo …
    │   ├── cloud.ts          # ★云场景：createRandomUser(Prisma) / loginUser / enableCloudWorkspace / enableShare / 收邮件
    │   ├── workspace.ts      # createLocalWorkspace / openWorkspaceListModal
    │   ├── setting.ts selection.ts sidebar.ts filter.ts properties.ts
    │   ├── clipboard.ts keyboard.ts drop-file.ts image.ts attachment.ts url.ts
    │   ├── app-tabs.ts       # 桌面多标签
    │   └── edgeless-perf.ts  # 画布性能
    └── bs/                   # 直接操作 BlockSuite 块（供 blocksuite 套件/块级用例复用）
        ├── table.ts          # createTable / inputToCell / getCellText …
        ├── linked-toolbar.ts
        └── misc.ts           # waitNextFrame 等
```

## 3. 实现细节

### 3.1 web 基座 `playwright.ts`：三个 fixture

kit 的灵魂是 `baseTest.extend<{...}>({...})`。它声明了一个 `workspace` fixture 并重写 `page`、`context`：

```ts
// 来源：src/playwright.ts:35-63
export const test = baseTest.extend<{
  workspace: { current: () => Promise<CurrentDocCollection> };
}>({
  workspace: async ({ page }, use) => {
    await use({
      current: async () =>
        await page.evaluate(async () => {
          if (!(globalThis as any).currentWorkspace) {
            await new Promise<void>((resolve, reject) => {
              globalThis.addEventListener(
                'affine:workspace:change',
                () => resolve(),
                { once: true }
              );
              setTimeout(() => reject(new Error('timeout')), 5000);
            });
          }
          return { meta: (globalThis as any).currentWorkspace.meta };
        }),
    });
  },
  // …page / context
});
```

- `workspace.current()` 在**被测页面上下文**里 `page.evaluate` 读取全局 `currentWorkspace`，若尚未就绪则监听 `affine:workspace:change` 事件（5s 超时）——把"等工作区加载"这类异步时序封装成一次 `await`。
- `context` fixture（`playwright.ts:73-119`）做三件横切事：注入 init script 给 `document.body` 加 `playwright-test` class（让 `global.css` 在测试时保留 0.1s 动画而非关闭，兼顾稳定与可观测）；调 `skipOnboarding(context)` 写 `localStorage` 跳过各种引导；当 `enableCoverage`（CI 或 `COVERAGE`）时，在 `beforeunload` 收集 `window.__coverage__` 并经 `exposeFunction` 写入 `.nyc_output/playwright_coverage_<uuid>.json`。
- `page` fixture（`playwright.ts:64-72`）仅在 `CPU_THROTTLE` 环境变量存在时用 CDP `Emulation.setCPUThrottlingRate` 做 CPU 降速，用于性能回归。

`skipOnboarding` 本身是导出的独立函数（`playwright.ts:26-33`），因此 copilot 这类需要自建 context 的套件也能单独调用它。

### 3.2 桌面基座 `electron.ts`：把 Electron 当"多页面应用"测

桌面入口 `base.extend`（base 即 `./playwright` 的 test）新增 `electronApp`/`shell`/`appInfo`/`views`/`router` 等 fixture，核心是 `electronApp`（`electron.ts:358-424`）：

- 用 `@affine-tools/utils` 的 `Package('@affine/electron').path` 定位桌面产物，把 `dist` **复制到 `e2e-dist-<uuid>`** 并改写 `package.json` 的 `name/productName/main`，实现多实例隔离、测后 `removeWithRetry` 清理。
- `electron.launch({ args:[clonedDist], env, colorScheme:'light' })` 启动，环境里设 `SKIP_ONBOARDING=1`、`AFFINE_E2E=1`、`DEBUG='pw:browser'`，并**带一次重试**（首次失败则 `forceKillElectronApp` 再启）。
- `page` fixture 覆写为"从 Electron 的多个窗口里挑出活动内容页"：`getActivePage` 先问 `window.__apis.ui.isActiveTab()`，再排除 `pageId==='shell'` 的外壳窗、选有 `v-line`（编辑器）的页；`shell` fixture 则专门取外壳窗。这解决了桌面端"一个进程多 BrowserWindow"与 web"一个 page"的形态差异。
- 退出时 `cleanupElectronApp` 用 `tree-kill` 做带超时的优雅关闭 + 兜底 SIGKILL，并区分 CI/Linux 的特殊路径——这些都是桌面 E2E 稳定性的硬骨头，被一次性封装掉。

### 3.3 移动基座 `mobile.ts`：最薄的一层

```ts
// 来源：src/mobile.ts:13-27
export const test = baseTest.extend<{ workspace: {...} }>({
  page: async ({ page }, use) => {
    await page.goto('/');
    const editor = page.locator('.affine-page-viewport[data-mode="page"]');
    await expect(editor).toBeVisible({ timeout: 30 * 1000 });
    await page.goto('/');
    await use(page);
  },
});
```

移动端复用 web 的 `context`/覆盖率逻辑，仅重写 `page`：先导航并等待移动版页面视口可见，确保编辑器就绪后再交给用例。宿主差异（设备尺寸、UA）则由各套件的 `playwright.config` 用 `devices['iPhone 14']`/`['Pixel 5']` 提供。

### 3.4 动作库：`load-page` 与 `page-logic`

动作函数是上层 spec 的主要词汇。最基础的是 `load-page.ts`：模块级可变量 `coreUrl = 'http://localhost:8080'` + `setCoreUrl()`，`openHomePage(page)` 就是 `page.goto(coreUrl)`——把"被测地址"收敛到一处，便于不同套件重指向。

`page-logic.ts` 覆盖文档编辑的常用动作，典型如：

```ts
// 来源：src/utils/page-logic.ts:39-62
export async function clickNewPageButton(page: Page, title?: string) {
  const newPageButton = page.getByTestId('sidebar-new-page-button');
  await expect(newPageButton).toBeVisible({ timeout: 30000 });
  await newPageButton.click({ timeout: 30000 });
  await waitForEmptyEditor(page);
  if (title) await getBlockSuiteEditorTitle(page).fill(title);
}
export async function waitForEditorLoad(page: Page) {
  await page.waitForSelector('v-line', { timeout: 20000 });
}
export function getBlockSuiteEditorTitle(page: Page) {
  return page.locator('doc-title .inline-editor').nth(0);
}
```

注意三个范式：**一律用 `data-testid` 定位**（如 `sidebar-new-page-button`、`doc-list-item`）以抗 UI 重构；**内置等待与超时**（`waitForEditorLoad` 以 `v-line` 出现为编辑器就绪信号）；**可选参数增强**（`clickNewPageButton(page, title?)`）。更复杂的动作如 `createLinkedPage`（输入 `@` 触发 linked-doc popover 再选项）、`addDatabase`（走 slash-menu 建数据库块）、`dragTo`（用 `page.mouse` 分步 move/down/up 模拟拖拽，带 `boundingBox` 计算落点）也都在此。

### 3.5 云场景动作库 `cloud.ts`：直连数据库造数据

云测试要求"快速造一个真实用户并登录"，kit 的做法是**绕过注册 UI、直接操作 Postgres**：

```ts
// 来源：src/utils/cloud.ts:57-75
const server = new Package('@affine/server');
const require = createRequire(server.srcPath.join('index.ts').toFileUrl());
export const runPrisma = async <T>(cb) => {
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({
    datasourceUrl:
      process.env.DATABASE_URL ||
      'postgresql://affine:affine@localhost:5432/affine',
  });
  await client.$connect();
  try {
    return await cb(client);
  } finally {
    await client.$disconnect();
  }
};
```

- `createRandomUser()`：`faker` 造邮箱/用户名，密码用 `@node-rs/argon2` 的 `hash()` 入库，并建一条 `free_plan_v1` feature；返回后用 `zod` 的 `cloudUserSchema.parse` 校验结果结构。`createRandomAIUser()` 额外插 `unlimited_copilot` feature 与 `ai` entitlement，供 copilot 套件用。
- `loginUser(page, user)`：打开首页→点 `sidebar-user-avatar`→`loginUserDirectly` 填邮箱/密码点登录，并支持 `isElectron`/`beforeLogin`/`afterLogin` 钩子。
- `enableCloudWorkspace(page)`：进设置→点 `publish-enable-affine-cloud-button`→确认→`waitForWorkspaceSynced`（在页面上下文 `page.evaluate` 调 `currentWorkspace.engine.doc.waitForSynced(...)`，60s 超时，等本地工作区真正同步到云）。
- 收验证邮件：`getLatestMailMessage()`/`getTokenFromLatestMailMessage()` 直接请求 MailHog 的 `http://localhost:8025/api/v2/messages` 并正则抽 token——配合 cloud 套件 config 里启动的 `MAILER_*`。

`addUserToWorkspace(workspaceId, userId, permission)` 等也走 `runPrisma`，把权限数字（99/10/其它）映射成 `owner/admin/member` 角色，用于协作用例的前置数据准备。

### 3.6 块级动作 `bs/`

`bs/table.ts` 等直接操作 BlockSuite 块，如 `createTable(page)` 走 slash-menu 建 `affine-table` 并校验 4 个 `affine-table-cell`，`inputToCell` 定位第 n 个 cell 填文本。这类工具主要服务 `@affine-test/blocksuite` 与涉及块交互的用例，`waitNextFrame`（`bs/misc.ts`）用于帧对齐等待。

## 4. 语法特色

- **`test.extend<Fixtures>({...})` 泛型 fixture**：Playwright 的 fixture 用一个泛型对象描述"本 test 额外提供哪些注入物"，每个 fixture 是 `async ({ deps }, use) => { await use(value) }` 的"中间件"——`use(value)` 之前是 setup、之后是 teardown。kit 的 `context` fixture 正是在 `use(context)` 前后分别注入 init script 和回收覆盖率（`playwright.ts:73-119`），这是 fixture 最经典的"环绕式"用法。
- **fixture 覆写（override）**：web/electron/mobile 三套都重写内置的 `page`/`context` fixture 名，Playwright 允许用同名 fixture 覆盖默认实现，从而在不改用例 API 的前提下替换宿主行为——"一套 spec、多种宿主"靠的就是这个。
- **`page.evaluate` 的双上下文编程**：`workspace.current` / `waitForWorkspaceSynced` 把一段函数序列化进浏览器执行，Node 侧与浏览器侧在同一文件里书写却运行在不同 realm，类型上用 `(globalThis as any)` / `window as typeof window & {...}` 收口（`playwright.ts:43-60`、`cloud.ts:331-353`）。
- **`createRequire` 动态加载 server 依赖**：`cloud.ts` 用 `createRequire(server.srcPath...)` 在运行时从 `@affine/server` 的位置解析 `@prisma/client`，避免把后端重依赖写进 kit 的静态 import，也保证用的是 server 同款 Prisma（`cloud.ts:57-63`）。
- **zod 运行时校验测试数据**：`cloudUserSchema.parse(result)` 在造数据后对 DB 返回结构做运行时断言，弥补 `any` 返回的类型空洞（`cloud.ts:50-55`）。
- **闭包式"迷你 POM"**：`getAllPage(page)` 返回 `{ clickNewPageButton, clickNewEdgelessDropdown }` 一组绑定了 `page` 的方法（`page-logic.ts:6-24`），既有页面对象的内聚，又不用 class/继承。
- **`WeakMap` 缓存启动页**：electron 入口用 `initialActivePages = new WeakMap<ElectronApplication, Page>()` 把首个活动页与 app 实例弱关联，避免重复等待且不阻止 GC（`electron.ts:16`）。

## 5. 设计 / 实现亮点

- **"一次封装、七套复用"**：七个测试工程的 `devDependencies` 都只写 `@affine-test/kit` + `@playwright/test`，所有宿主启动、登录、建工作区、覆盖率、CPU 节流逻辑集中在 kit——新增一套测试几乎零样板。
- **宿主差异下沉到入口**：local(web)/desktop(electron)/mobile 的巨大差异（尤其 Electron 多窗口与进程清理）被 `./electron`、`./mobile` 吸收，上层断言得以尽量宿主无关，这是跨端 E2E 能规模化的关键。
- **造数据走 DB 而非 UI**：`runPrisma` + argon2 + faker 让"准备一个已登录云用户"从"点一串注册表单"变成一次 SQL，极大提速且更稳定；用 `zod` 校验兜底数据正确性。
- **稳定性工程细节**：统一 `data-testid` 选择器、显式 `waitForSelector('v-line')` 的就绪信号、`waitForWorkspaceSynced` 的真实同步等待、Electron 带重试启动与分平台清理——这些"看不见的功夫"正是 flaky 率的决定因素。
- **测试期也测覆盖率**：fixture 层无侵入地采集 Istanbul 覆盖率并落盘，CI 可合并 E2E 覆盖率，测试工具自身成为质量度量的一环。

## 6. 对外 API 与注意事项

- **永远 `import { test } from '@affine-test/kit/playwright'`（或 `/electron`、`/mobile`）**，不要直接用 `@playwright/test` 的 `test`，否则丢失所有 fixture（跳过 onboarding、覆盖率等）。
- **Playwright 版本被钉死**：`@playwright/test@=1.58.2`（含 peerDep 约束），各套件须与 kit 对齐，避免 fixture/API 漂移。
- **云动作有外部前置**：`cloud.ts` 依赖可连的 Postgres（`DATABASE_URL`）与 MailHog（`:8025`/`:1025`），这些由 `affine-cloud*` 套件的 `playwright.config` 的 `webServer`/`env` 提供，脱离该环境直接调会失败。
- **动作函数靠 `data-testid` 契约**：改动产品 UI 若动了 testid（如 `sidebar-new-page-button`、`doc-list-item`、`publish-enable-affine-cloud-button`），需同步更新 kit，否则大面积用例红。
- **`coreUrl` 是模块级可变量**：多套件/多 server 场景可用 `setCoreUrl()` 重指向，但它是全局状态，注意并发下的副作用。
- **桌面 fixture 有副作用与成本**：`electronApp` 会复制整个 `dist`，务必让 teardown 正常执行（不要在用例里吞掉异常导致 `removeWithRetry` 不跑）。

## 7. 延伸

- 使用者：`affine-test-suites.md`（七套测试工程如何各自 `extend`/复用本 kit）。
- 被测对象：`@affine/web`/`@affine/mobile`/`@affine/electron`（L4/L5）、`@affine/admin`（同层）、BlockSuite 编辑器内核（L2）。
- 工具支撑：`@affine-tools/utils` 的 `Package`/`Path`/`ProjectRoot`（L0 工具链）、`@affine/graphql`（云用例的数据契约）。
- 相关概念：`@toeverything/infra` 的 `engine.doc.waitForSynced`（`cloud.ts` 等待同步即调它）、server 的 Prisma schema（`createRandomUser` 直写的表）。
