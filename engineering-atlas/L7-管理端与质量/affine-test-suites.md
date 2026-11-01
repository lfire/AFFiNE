# E2E / 集成测试套件合篇（`@affine-test/*`）

> 一句话定位：AFFiNE 的**七套 Playwright 测试工程**——按"数据模式（本地/云）× 宿主（web/desktop/mobile）× 特性（Copilot/编辑器内核）"切分的端到端与集成测试集合。它们共享 `@affine-test/kit` 的 fixture 与动作库，各自用一份 `playwright.config.ts` 声明被测服务与运行参数，构成 AFFiNE 质量保障的主干。

| 项        | 值                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `tests/affine-local`、`tests/affine-cloud`、`tests/affine-cloud-copilot`、`tests/affine-desktop`、`tests/affine-desktop-cloud`、`tests/affine-mobile`、`tests/blocksuite`                          |
| 所属层    | L7 · 管理端与质量                                                                                                                                                                                  |
| 语言/形态 | TypeScript / Playwright 测试工程（无运行时产物）                                                                                                                                                   |
| 关键依赖  | 全部 `@affine-test/kit@workspace:*` + `@playwright/test@=1.58.2`；desktop 另加 `@affine/electron-api`/`playwright`/`fs-extra`；blocksuite 另加 `@blocksuite/affine`/`@blocksuite/integration-test` |
| 被谁依赖  | 不被 import；由 CI 与开发者通过各自的 `e2e`/`test` 脚本运行                                                                                                                                        |
| 运行入口  | 各包 `yarn e2e`（blocksuite 为 `yarn test`），底层均 `yarn playwright test`                                                                                                                        |

## 1. 设计逻辑

AFFiNE 是一个**本地优先 + 可选云同步**、同时发布 **web / 桌面(Electron) / 移动** 三端、并内置 **AI Copilot** 与 **BlockSuite 编辑器内核**的产品。它的质量风险不在单一维度，而在"组合"：同一个"新建文档"动作，在纯本地 web 下只碰 IndexedDB，在云端要走同步引擎，在桌面要穿过 Electron 多窗口，在移动端是另一套布局。若用一套测试覆盖所有组合，配置会互相打架（本地套件不该启动 server，云套件必须连 Postgres/邮件服务器）、运行会慢且 flaky。

因此 AFFiNE 沿**两条正交轴**把测试切成七套：

- **数据模式轴**：`local`（无 server，纯本地）vs `cloud`（必须起 `@affine/server` + Postgres + 邮件）。
- **宿主轴**：`web`（浏览器）vs `desktop`（Electron 壳）vs `mobile`（移动 web/设备模拟）。
- 外加两套**特性专项**：`cloud-copilot`（AI 功能，云 + 特殊账号/额度）与 `blocksuite`（编辑器内核，连的是 BlockSuite 自己的 playground 而非 AFFiNE 应用）。

**为什么这样分层**：把"需要重环境"的云/桌面套件与"轻量"的本地套件分开，使本地套件能高并发快速反馈（PR 必跑），云/桌面套件按需或在合适并发下跑；把特性专项独立，让 AI、编辑器内核这类高频变动领域有自己的配置与重试策略，不拖累主干。七套的共同点是**都 `extend` 自 `@affine-test/kit`**——宿主启动、登录、建工作区、覆盖率等被 kit 统一吸收，各套件只负责"选对入口 + 写业务断言 + 配好被测服务"。

## 2. 目录与关键文件

```text
tests/
├── kit/                         # 共享工具包 @affine-test/kit（见 affine-test-kit.md）
├── affine-local/                # @affine-test/affine-local —— 本地模式 web E2E（用例最多，~69 个 spec）
│   ├── e2e/*.spec.ts            # all-page / journal / links / drag-page / local-first-* …
│   │   └── blocksuite/          # 嵌入 AFFiNE 宿主内的块级用例
│   └── playwright.config.ts     # 仅起 @affine/web(:8080)，workers=4，timeout 30s/50s(CI)
├── affine-cloud/                # @affine-test/affine-cloud —— 云同步 web E2E
│   ├── e2e/                     # collaboration / comments / login / share-page-* / page-history / storage / workspace …
│   ├── runtime-config.json      # 注入 server 的 runtime 配置
│   └── playwright.config.ts     # 起 web(:8080) + server(:3010/graphql) + 邮件，timeout 120s
├── affine-cloud-copilot/        # @affine-test/affine-cloud-copilot —— AI Copilot E2E
│   ├── e2e/{basic,chat-with,ai-action,insertion,settings,...}
│   │   ├── base/base-test.ts    # 本套件自定义 fixture：utils + loggedInPage(AI 用户)
│   │   └── utils/*.ts           # ChatPanelUtils / EditorUtils / SettingsPanelUtils / TestUtils（POM）
│   ├── README.md                # 用例分类说明
│   └── playwright.config.ts     # 同 cloud，retries=3，webServer 超时 240s
├── affine-desktop/              # @affine-test/affine-desktop —— 桌面(Electron) 本地 E2E
│   ├── e2e/                     # basic / tabs / split-view / disk-sync / image / workspace（6 个）
│   └── playwright.config.ts     # 无 baseURL；仅当 DEV_SERVER_URL 时起 electron-renderer
├── affine-desktop-cloud/        # @affine-test/affine-desktop-cloud —— 桌面 + 云 E2E
│   ├── e2e/basic.spec.ts        # 目前 1 个 spec（桌面连云冒烟）
│   ├── runtime-config.json
│   └── playwright.config.ts     # 起 electron-renderer(DISTRIBUTION=desktop) + server，timeout 60s/300s(CI)
├── affine-mobile/               # @affine-test/affine-mobile —— 移动 E2E
│   ├── e2e/                     # home / detail / explorer-* / settings / back-button-visibility（8 个）
│   └── playwright.config.ts     # projects: iPhone 14(CI) / Pixel 5；起 @affine/mobile(:8080)
└── blocksuite/                  # @affine-test/blocksuite —— 编辑器内核集成测试
    ├── e2e/                     # ~121 个 spec：edgeless / database / clipboard / markdown / hotkey …
    ├── snapshots/               # 快照基线（snapshotPathTemplate 指向此）
    └── playwright.config.ts     # 连 @blocksuite/playground(dev:5173 / preview:4173)，非 AFFiNE 应用
```

## 3. 实现细节

### 3.1 分工矩阵

| 套件（包名）                        | 数据模式  | 宿主              | 被测服务（webServer）                              | 典型 spec                                                                | 入口（来自 kit）                             |
| ----------------------------------- | --------- | ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| `@affine-test/affine-local`         | 本地      | web               | `@affine/web` :8080                                | `all-page` / `journal` / `links` / `drag-page` / `local-first-*`         | `./playwright`                               |
| `@affine-test/affine-cloud`         | 云        | web               | web :8080 + `@affine/server` :3010 + 邮件          | `collaboration` / `login` / `share-page-*` / `comments` / `page-history` | `./playwright` + `utils/cloud`               |
| `@affine-test/affine-cloud-copilot` | 云        | web               | web + server（超时 240s，retries 3）               | `basic` / `chat-with` / `ai-action` / `insertion` / `settings`           | 自建 `base-test.ts`（extend `./playwright`） |
| `@affine-test/affine-desktop`       | 本地      | desktop(Electron) | 可选 `electron-renderer`（仅 `DEV_SERVER_URL`）    | `basic` / `tabs` / `split-view` / `disk-sync`                            | `./electron`                                 |
| `@affine-test/affine-desktop-cloud` | 云        | desktop(Electron) | `electron-renderer`(DISTRIBUTION=desktop) + server | `basic`（冒烟）                                                          | `./electron` + `utils/cloud`                 |
| `@affine-test/affine-mobile`        | 本地      | mobile web        | `@affine/mobile` :8080                             | `home` / `detail` / `explorer-*` / `settings`                            | `./mobile`                                   |
| `@affine-test/blocksuite`           | —（内核） | web(playground)   | `@blocksuite/playground` dev:5173 / preview:4173   | `edgeless` / `database` / `markdown` / `clipboard` / `hotkey`            | `kit/playwright` + kit `bs/*`                |

读法：**行=一种"模式×宿主"组合**。`local/cloud` 决定是否起 server；`web/desktop/mobile` 决定 kit 入口与 config 的设备/壳设置。`blocksuite` 是特例——它不测 AFFiNE 应用而测编辑器内核本身，连的是 BlockSuite 的 playground。

### 3.2 config 差异：被测服务的不同就是模式的不同

七份 `playwright.config.ts` 的分野几乎全在 `webServer` 与超时/重试上。

**本地（affine-local）只起 web**：

```ts
// 来源：tests/affine-local/playwright.config.ts（节选）
use: { baseURL: 'http://localhost:8080/', browserName: 'chromium', viewport: { width: 1440, height: 800 } },
timeout: process.env.CI ? 50_000 : 30_000,
workers: 4, retries: 1,
webServer: [{ command: 'yarn run -T affine dev -p @affine/web', url: 'http://localhost:8080' }],
```

**云（affine-cloud）额外起 server + 邮件，并喂 runtime-config**：

```ts
// 来源：tests/affine-cloud/playwright.config.ts（节选）
const runtimeConfigPath = fileURLToPath(new URL('./runtime-config.json', import.meta.url));
timeout: 120_000,
webServer: [
  { command: 'yarn run -T affine dev -p @affine/web', url: 'http://localhost:8080' },
  { command: 'yarn run -T affine dev -p @affine/server', url: 'http://localhost:3010/graphql',
    env: { DATABASE_URL: '...postgresql://affine:affine@localhost:5432/affine', NODE_ENV: 'test',
           AFFINE_BACKEND_RUNTIME_CONFIG_PATH: runtimeConfigPath,
           MAILER_HOST: '0.0.0.0', MAILER_PORT: '1025', MAILER_SENDER: 'noreply@toeverything.info', ... } },
],
workers: process.env.CI && !process.env.COPILOT ? 1 : 4,
```

注意云套件把 `workers` 在 CI 下压到 `1`（串行，避免共享 Postgres 下的数据竞争），而本地套件可 4 并发——这是"轻/重环境分离"的直接体现。`MAILER_*` 对应 kit `cloud.ts` 里收 MailHog 验证邮件的逻辑（`:8025` 查询、`:1025` SMTP）。

**copilot** 与 cloud 近乎同构，但 `webServer` 超时拉到 `240s`、`retries=3`、`stdout/stderr:'pipe'`，因为 AI 流程更慢更易抖。

**桌面（affine-desktop）无 `baseURL`**，因为被测的是 Electron 壳而非某个 URL；仅当显式给了 `DEV_SERVER_URL`（且必须是 `http://localhost:8080`，用 `assert` 校验）时才起 `electron-renderer` dev server：

```ts
// 来源：tests/affine-desktop/playwright.config.ts（节选）
if (process.env.DEV_SERVER_URL) {
  const devServerUrl = new URL(process.env.DEV_SERVER_URL);
  assert(
    devServerUrl.origin === 'http://localhost:8080',
    'DEV_SERVER_URL must be http://localhost:8080'
  );
  config.webServer = [
    {
      command: 'yarn run -T affine bundle -p @affine/electron-renderer --dev',
      url: 'http://localhost:8080',
    },
  ];
}
if (process.env.CI) {
  config.retries = 5;
  config.workers = 1;
}
```

桌面应用的启动由 kit 的 `./electron` fixture（复制 dist、`electron.launch`）负责，config 只管渲染进程的 dev server。**desktop-cloud** 则同时起 `electron-renderer`（`DISTRIBUTION=desktop`）与 server，超时在 CI 下高达 `300s`。

**移动（affine-mobile）用 Playwright `projects` + `devices` 做设备模拟**：

```ts
// 来源：tests/affine-mobile/playwright.config.ts（节选）
projects: [
  process.env.CI ? { name: 'Mobile Safari', use: { ...devices['iPhone 14'] } } : undefined,
  { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
].filter(Boolean),
webServer: [{ command: 'yarn run -T affine dev -p @affine/mobile', url: 'http://localhost:8080' }],
```

被测应用换成 `@affine/mobile`，且 CI 跑 iPhone+Pixel 两档、本地只跑 Pixel。

**blocksuite 最特殊**：它既不起 AFFiNE web 也不起 server，而是连 BlockSuite 自己的 playground，并启用快照：

```ts
// 来源：tests/blocksuite/playwright.config.ts（节选）
snapshotDir: 'snapshots', snapshotPathTemplate: 'snapshots/{testFilePath}/{arg}{ext}',
webServer: { command: process.env.CI ? 'yarn workspace @blocksuite/playground run preview'
                                       : 'yarn workspace @blocksuite/playground run dev',
             url: process.env.CI ? 'http://localhost:4173' : 'http://localhost:5173' },
use: { viewport: { width: 960, height: 900 }, colorScheme: 'light', timezoneId: 'Asia/Tokyo' },
workers: '80%', retries: process.env.CI ? 3 : 0,
```

它固定时区 `Asia/Tokyo`、用快照比对渲染结果，用例数最多（~121），覆盖 edgeless/database/clipboard/markdown 等内核能力——属于"集成测试"而非应用 E2E。

### 3.3 复用 kit 的两种方式

**方式一：直接用 kit 的 `test`**（local/cloud/mobile/blocksuite）。如 cloud 的 `login.spec.ts`：

```ts
// 来源：tests/affine-cloud/e2e/login.spec.ts:1-16
import { test } from '@affine-test/kit/playwright';
import {
  createRandomUser,
  enableCloudWorkspace,
  loginUser,
} from '@affine-test/kit/utils/cloud';
import { openHomePage } from '@affine-test/kit/utils/load-page';
import { waitForEditorLoad } from '@affine-test/kit/utils/page-logic';
// …
test.beforeEach(async ({ page }) => {
  user = await createRandomUser();
  await loginUser(page, user);
});
```

套件自身几乎不含基础设施代码，直接拼装 kit 的动作函数。mobile 则 `import { test } from '@affine-test/kit/mobile'`，desktop 用 `.../electron`。

**方式二：在 kit 基座上再 `extend` 出专属 fixture**（copilot）。copilot 用例要求"已登录、已开云、且是带 AI 额度的账号"，于是它基于 kit 再扩展：

```ts
// 来源：tests/affine-cloud-copilot/e2e/base/base-test.ts:2-52
import { skipOnboarding, test as base } from '@affine-test/kit/playwright';
import {
  createRandomAIUser,
  enableCloudWorkspace,
  loginUserDirectly,
} from '@affine-test/kit/utils/cloud';
export const test = base.extend<TestUtilsFixtures>({
  utils: async ({}, use) =>
    use({
      testUtils: TestUtils.getInstance(),
      chatPanel: ChatPanelUtils,
      editor: EditorUtils,
      settings: SettingsPanelUtils,
    }),
  loggedInPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    await skipOnboarding(context);
    const page = await context.newPage();
    await page.goto('http://localhost:8080/', { timeout: 240 * 1000 });
    const user = await createRandomAIUser();
    await page.getByTestId('sidebar-user-avatar').click({ delay: 200 });
    await loginUserDirectly(page, user);
    await openHomePage(page);
    await enableCloudWorkspace(page);
    await use(page);
    await context.close();
  },
});
```

这里 `utils` fixture 注入一组 POM 工具类（`ChatPanelUtils`/`EditorUtils`/`SettingsPanelUtils`），`loggedInPage` fixture 把"造 AI 用户→登录→开云"的 20+ 行前置压缩成用例里的一个参数。这是 kit "可被二次扩展"设计的价值体现——基座通用、套件特化。

### 3.4 运行方式

每套件 `package.json` 的脚本都极薄：

```jsonc
// affine-local / affine-cloud-copilot / affine-mobile / affine-desktop-cloud
"scripts": { "e2e": "yarn playwright test" }
// affine-cloud / affine-desktop：追加 --reporter=list
// blocksuite：          "test": "yarn playwright test"
```

因此开发者在对应目录 `yarn e2e`（blocksuite 为 `yarn test`）即可，Playwright 据同目录 `playwright.config.ts` 自动拉起 `webServer`、按 `projects`/`workers`/`retries` 执行。CI 普遍切 `reporter:'github'` 生成注解、提高 `retries`、并对云套件降并发。

## 4. 语法特色

- **`playwright.config.ts` 的声明式环境编排**：`webServer` 是一个"启动命令 + 就绪 URL + 超时 + env"的数组，Playwright 负责起停与健康检查（轮询 `url`）。云套件用它把 `@affine/server` + 邮件服务 + `runtime-config.json` 一起拉起，测试与被测服务的生命周期绑定（`affine-cloud/playwright.config.ts`）。
- **`import.meta.url` + `fileURLToPath` 定位同目录资源**：`new URL('./runtime-config.json', import.meta.url)` 在 ESM 下稳健地解析相对文件路径（`affine-cloud`/`desktop-cloud`/`copilot` 三套均用）。
- **`projects` + `devices[...]` 的参数化矩阵**：mobile 用 Playwright 内置设备描述符派生多项目运行，`.filter(c => c !== undefined)` 在非 CI 时裁掉 iPhone 项目——用数组推导表达"环境相关的用例矩阵"。
- **`test.extend` 的继承链**：copilot 的 `base.extend(...)` 以 kit 的 `test` 为父，fixture 可叠加/覆写，形成"kit 基座 → 套件特化"的两级继承（`base-test.ts:26`）。
- **`assert` 做配置护栏**：desktop 用 `node:assert` 校验 `DEV_SERVER_URL` 的 origin，把"误配端口"在启动期就拦下（`affine-desktop/playwright.config.ts`）。
- **快照模板字符串**：blocksuite 的 `snapshotPathTemplate: 'snapshots/{testFilePath}/{arg}{ext}'` 用占位符规则化快照落盘路径，使视觉/DOM 快照与用例一一对应。
- **环境变量驱动差异**：`process.env.CI`/`COPILOT`/`COVERAGE`/`BROWSER`/`CPU_THROTTLE` 贯穿各 config 与 kit，同一套代码按环境切换并发、重试、浏览器与节流。

## 5. 设计 / 实现亮点

- **正交分层，互不拖累**：用"数据模式 × 宿主 × 特性"切套件，使轻量本地套件能高并发做 PR 门禁，重环境云/桌面套件独立调度，AI/内核专项有专属重试与超时策略——测试规模化的关键结构性决策。
- **环境即配置**：被测服务（web/server/mailer/electron-renderer/playground）全部写进 `webServer`，一条 `yarn e2e` 就能在干净机器上自举出完整被测栈，极大降低"跑不起来"的门槛。
- **kit 两档复用**：简单套件直接用 kit 的 `test` + 动作函数；复杂套件（copilot）在 kit 上再 `extend` 专属 fixture + POM，既避免重复又允许特化，层次清晰。
- **贴近真实的云测试**：云套件起真 server、真 Postgres、真 SMTP（MailHog），kit 直连 DB 造数据、直读邮件取 token，验证的是接近生产的链路而非 mock。
- **桌面/移动的宿主保真**：Electron 多窗口、设备尺寸/UA 这些"宿主真实度"被 kit 入口与 config 的 `devices`/`DISTRIBUTION` 还原，避免"只测 web 代理"的失真。
- **内核测试独立成套**：blocksuite 连 playground + 快照比对，把高频变动的编辑器内核与应用层解耦验证，变更定位更准。

## 6. 对外 API 与注意事项

- **跑云/桌面套件需先备外部依赖**：Postgres（`:5432`）、MailHog（`:8025`/`:1025`）、以及桌面需先构建 `@affine/electron` 的 `dist`（kit 会复制它）。缺任一项，`webServer` 或 fixture 会超时失败。
- **云套件 CI 串行**：`workers` 在 CI 非 copilot 时为 `1`，本地改大并发可能因共享 DB 出现数据竞争，调参需谨慎。
- **`blocksuite` 用 `yarn test` 而非 `yarn e2e`**，且连的是 BlockSuite playground；改快照需理解 `snapshots/` 基线更新流程（`--update-snapshots`）。
- **Playwright 版本全仓钉死 `=1.58.2`**：七套 + kit 必须一致，升级要整体进行。
- **testid 契约**：用例大量依赖 `data-testid`（登录、建工作区、文档列表等），产品改 UI 时优先改 kit，再核对各套件专属选择器（如 copilot 的 chat-panel utils）。
- **desktop 的 `DEV_SERVER_URL` 有护栏**：origin 必须是 `http://localhost:8080`，否则 `assert` 直接抛错。
- **超时分档**：local 30s、cloud/copilot 120s、desktop-cloud 300s(CI)——新增用例应落在对应套件，避免把慢用例塞进本地套件拖慢门禁。

## 7. 延伸

- 核心依赖：`affine-test-kit.md`（`@affine-test/kit` 的 fixture 与动作库，本篇所有套件的共同底座）。
- 被测对象：`@affine/web`/`@affine/mobile`（L4）、`@affine/electron`(-renderer)（L5）、`@affine/admin`（同层）、BlockSuite 内核与 playground（L2）。
- 服务端：`@affine/server`（云套件拉起的后端）、其 Prisma schema 与 runtime config（`runtime-config.json`）。
- 工具链：`affine` CLI 的 `dev`/`bundle`（L0），`@affine-tools/utils` 的 `Package`（kit 定位各包路径）。
