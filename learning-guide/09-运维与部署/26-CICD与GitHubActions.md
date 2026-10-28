# 第 26 章 CI/CD 与 GitHub Actions

> **所属部分**：第 9 部分 · 运维与部署 ｜ **难度**：★★★☆☆ ｜ **建议学时**：6 小时 ｜ **前置章节**：第 4 章 分支版本与发布节奏、第 25 章 测试体系

## 本章导读

当你在 AFFiNE 提交一个 PR，几分钟后 PR 页面下方会出现几十个检查项：Lint、Typecheck、E2E Test (1/5)……最后有一个名字很奇怪的 **"3, 2, 1 Launch"**。它们都来自仓库的 `.github/` 目录。

对一个从前端转向全栈的开发者来说，CI/CD 是"把代码变成产品"的流水线：

- **CI（持续集成）**：每次提交都自动 lint、类型检查、跑单测与 E2E、编译 Rust 原生模块，保证主干永远可发布；
- **CD（持续交付）**：按计划或手动触发，构建 Docker 镜像、桌面安装包、移动端 Web 资源，形成"发布候选"（candidate），再交给签名与发布系统。

本章先补齐 GitHub Actions 的基础概念，再逐个解读 `.github/workflows` 下的全部 11 个工作流与 `.github/actions` 下的 8 个复合 Action，画出 `build-test.yml` 的 job 依赖 DAG，讲清路径过滤、缓存、产物传递、Sentry sourcemap、codecov、签名，以及 `render.yaml`、`.codesandbox` 等周边配置。

## 学习目标

- [ ] 能够解释 workflow、job、step、matrix、needs、concurrency、artifact、cache、secrets 的含义与相互关系
- [ ] 能够画出 `build-test.yml` 中各 job 的 `needs` 依赖图，并说明 `test-done` 汇总 job 的作用
- [ ] 能够读懂 `.github/actions` 下 8 个复合 Action 的输入、步骤与复用方式
- [ ] 能够说明 `dorny/paths-filter` 如何实现"改了 Rust 才跑 Rust 测试"的按需构建
- [ ] 能够描述 Release Candidates 工作流从 `prepare` 到 `candidate` 再到 `release-submit.yml` 的发布链路
- [ ] 能够定位 Sentry sourcemap 上传、codecov 覆盖率上报、Windows 签名检查的相关配置
- [ ] 能够在本地用 `actionlint` 校验工作流，并为一个新增包设计合适的 CI 接入方式

## 知识地图

```mermaid
mindmap
  root((AFFiNE CI CD))
    GitHub Actions 基础
      workflow 与触发器
      job 与 runner
      step 与 uses
      matrix 与分片
      needs 与 DAG
      concurrency
      cache 与 artifact
      secrets 与 permissions
    CI 工作流
      build-test
        静态检查
        原生模块构建
        单元测试
        服务端测试
        E2E 测试
        移动端构建
        test-done 汇总
      pr-title-lint
      auto-labeler
      copilot-test
    CD 工作流
      release 计划
      build-images 镜像
      release-desktop 桌面
      release-mobile 移动
      release-submit 提交
    复合 Action
      setup-node
      build-rust
      server-test-env
      download-web
      setup-version
      setup-sentry
      prepare-release
      copilot-test
    周边配置
      actionlint
      labeler 与 renovate
      codecov
      render 预览部署
      codesandbox
```

## 26.1 GitHub Actions 基础速成

### 26.1.1 概念层级

```mermaid
flowchart TB
  E[事件 push pull_request schedule workflow_dispatch] --> W[workflow 一个 yml 文件]
  W --> J1[job A 运行在 runner 上]
  W --> J2[job B needs A]
  J1 --> S1[step 1 uses action]
  J1 --> S2[step 2 run shell]
  J2 --> S3[step ...]
  J1 -. upload-artifact .-> AR[(artifact)]
  AR -. download-artifact .-> J2
  J1 -. actions cache .-> C[(cache)]
```

| 概念 | 一句话解释 | AFFiNE 中的例子 |
| --- | --- | --- |
| workflow | `.github/workflows/*.yml`，由事件触发 | `build-test.yml` 在 push/PR/merge_group 时触发 |
| job | 一组 step，运行在一台独立 runner 上；默认并行 | `lint`、`typecheck`、`unit-test` |
| step | job 内顺序执行的单元，`run` 跑脚本，`uses` 调用 Action | `uses: ./.github/actions/setup-node` |
| runner | 执行机器 | `ubuntu-latest`、`ubuntu-24.04-arm`、`macos-15`、`windows-latest` |
| matrix | 用参数组合派生多个 job 实例 | `unit-test` 的 `shard: [1, 2, 3, 4, 5]` |
| needs | 声明 job 依赖，形成 DAG | `unit-test` needs `build-native-linux` |
| outputs | job/step 向下游传递字符串 | `rust-test-filter` 输出 `run-rust` |
| concurrency | 同组只保留一个运行 | `${{ github.workflow }}-${{ github.ref }}` 并取消旧运行 |
| artifact | job 之间传递文件（跨 runner） | `server-native.node`、`web` |
| cache | 跨运行复用文件（加速） | node_modules、yarn cache、cargo、Playwright、Electron |
| secrets | 加密变量，fork PR 中不可用 | `CODECOV_TOKEN`、`SENTRY_AUTH_TOKEN` |
| permissions | 收窄 `GITHUB_TOKEN` 权限 | `pr-title-lint.yml` 只有 `contents: read` |
| reusable workflow | `on: workflow_call`，被其他 workflow 用 `uses:` 调用 | `build-images.yml`、`release-desktop.yml` |
| composite action | `.github/actions/*/action.yml`，把多个 step 打包复用 | `setup-node`、`build-rust` |

### 26.1.2 artifact 与 cache 的区别

这是新手最容易混淆的一点：

| 维度 | artifact | cache |
| --- | --- | --- |
| 目的 | 同一次运行中 job 间传递"产物" | 不同运行之间复用"中间结果" |
| 可见性 | 运行页面可下载 | 不可直接下载 |
| 命中语义 | 按名字精确获取，缺失即失败（可配置） | 按 key 命中，未命中就当无缓存 |
| AFFiNE 用法 | `.node` 原生模块、`dist.tar.gz`、测试报告 | `node_modules`、`~/.cargo`、Playwright 浏览器 |

### 26.1.3 本章涉及的文件总览

```bash
ls .github/workflows .github/actions
```

| 类型 | 文件 | 触发方式 | 作用 |
| --- | --- | --- | --- |
| CI | `build-test.yml` | push 指定分支 / pull_request / merge_group | 主流水线，约 1700 行 |
| CI | `pr-title-lint.yml` | 针对 canary 的 PR | 校验 PR 标题符合约定式提交 |
| CI | `auto-labeler.yml` | `pull_request_target` | 按改动路径自动打标签 |
| CI | `copilot-test.yml` | `workflow_dispatch` | Copilot 全量测试并通知 Slack |
| CI | `copilot-test-automatically.yml` | canary tag / 每日 cron / 手动 | 派发 `copilot-test.yml` |
| CD | `release.yml` | 每日 cron / 手动 | 生成发布计划并构建候选 |
| CD | `build-images.yml` | `workflow_call` | 构建 web/admin/mobile/server 并推镜像 |
| CD | `release-desktop.yml` | `workflow_call` | 桌面候选：先生成 web 资源 |
| CD | `release-desktop-platform.yml` | `workflow_call` | 桌面候选：按平台矩阵打包 |
| CD | `release-mobile.yml` | `workflow_call` | 移动端 Web 资源候选 |
| CD | `release-submit.yml` | `workflow_run`（Release Candidates 完成） | 把候选提交到外部发布仓库 |

## 26.2 build-test.yml 总览：触发、环境与并发

```yaml
# 来源：.github/workflows/build-test.yml（节选）
name: Build & Test

on:
  push:
    branches:
      - canary
      - beta
      - stable
      - v[0-9]+.[0-9]+.x-staging
      - v[0-9]+.[0-9]+.x
    paths-ignore:
      - README.md
  pull_request:
  merge_group:

env:
  DEBUG: napi:*
  BUILD_TYPE: canary
  APP_NAME: affine
  AFFINE_ENV: dev
  COVERAGE: true
  MACOSX_DEPLOYMENT_TARGET: '11.6'
  DEPLOYMENT_TYPE: affine

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

要点：

1. **触发分支**与第 4 章的分支模型对应：`canary`（日常开发）、`beta`、`stable`，以及 `v0.x.x` 维护分支与其 `-staging`。改 `README.md` 不触发。
2. **merge_group**：支持 GitHub Merge Queue，PR 进入合并队列后会在"合并后的临时提交"上再跑一遍。
3. **全局 env**：`BUILD_TYPE: canary` 让构建配置走 canary 预设（第 20 章 `build-config.ts`）；`COVERAGE: true` 打开覆盖率；`DEBUG: napi:*` 打印 NAPI-RS 构建日志；`DEPLOYMENT_TYPE: affine` 是服务端的部署类型（第 27 章）。
4. **concurrency**：同一分支或同一 PR（`github.ref` 为 `refs/pull/N/merge`）连续推送时，自动取消上一次运行，节约大量 runner 时间。

## 26.3 build-test.yml 的 job 依赖 DAG

`build-test.yml` 一共 34 个 job。按依赖关系画出来：

```mermaid
flowchart LR
  subgraph 静态检查
    analyze
    lint
    typecheck
    check-yarn-binary
  end
  subgraph 路径过滤
    mobile-native-build-filter
    rust-test-filter
    copilot-test-filter
  end
  subgraph 原生构建
    build-native-linux
    build-native-macos
    build-native-windows
    build-server-native
    build-electron-renderer
  end
  mobile-native-build-filter --> build-android-app
  mobile-native-build-filter --> test-android-app
  mobile-native-build-filter --> build-ios-app
  rust-test-filter --> lint-rust
  rust-test-filter --> rust-test
  build-server-native --> check-git-status
  build-native-linux --> unit-test
  build-native-linux --> native-unit-test
  build-server-native --> server-test
  build-server-native --> server-test-elasticsearch
  build-server-native --> server-test-embedded
  build-server-native --> server-test-manticoresearch
  build-server-native --> server-e2e-test
  build-server-native --> copilot-api-test
  copilot-test-filter --> copilot-api-test
  build-server-native --> copilot-e2e-test
  copilot-test-filter --> copilot-e2e-test
  build-server-native --> cloud-e2e-test
  build-native-linux --> cloud-e2e-test
  build-electron-renderer --> desktop-test
  build-native-linux --> desktop-test
  build-native-macos --> desktop-test
  build-native-windows --> desktop-test
  subgraph 无依赖 E2E
    e2e-test
    e2e-blocksuite-test
    e2e-blocksuite-cross-browser-test
    e2e-mobile-test
  end
  desktop-test --> test-done
  cloud-e2e-test --> test-done
  server-test --> test-done
  unit-test --> test-done
  e2e-test --> test-done
  lint --> test-done
  typecheck --> test-done
  analyze --> test-done
```

> 为避免图过于拥挤，`test-done` 只画出部分入边；实际上它 `needs` 了**全部 34 个 job 中的其余 33 个**（见 26.8）。

把 job 按职责归类：

| 类别 | job | runner | 依赖 | 说明 |
| --- | --- | --- | --- | --- |
| 安全扫描 | `analyze` | ubuntu-latest | — | CodeQL，matrix `language × project`（affine / blocksuite） |
| 静态检查 | `lint` | ubuntu-24.04-arm | — | actionlint、oxlint、oxfmt、`yarn dedupe --check` |
| 静态检查 | `typecheck` | ubuntu-24.04-arm | — | i18n 生成物一致性、`yarn typecheck`、BlockSuite 文档构建一致性 |
| 工具链 | `check-yarn-binary` | ubuntu-latest | — | 确认 `.yarn/releases` 与 `packageManager` 版本一致 |
| 生成物一致性 | `check-git-status` | ubuntu-latest | `build-server-native` | 重跑 init/gql/i18n/genconfig，确认无未提交改动 |
| 过滤器 | `mobile-native-build-filter` | ubuntu-latest | — | 输出 `run-android`、`run-ios` |
| 移动端 | `build-android-app` | ubuntu-latest | 过滤器 | Gradle `assembleCanaryDebug` |
| 移动端 | `test-android-app` | ubuntu-latest | 过滤器 | 单测 + 模拟器 instrumentation 测试 |
| 移动端 | `build-ios-app` | macos-15 | 过滤器 | `xcodebuild` 模拟器构建 + `AFFiNETests` |
| 过滤器 | `rust-test-filter` | ubuntu-latest | — | 输出 `run-rust` |
| Rust | `lint-rust` | ubuntu-latest | 过滤器 | `cargo +nightly fmt --check`、`clippy -D warnings` |
| Rust | `rust-test` | ubuntu-latest | 过滤器 | `cargo nextest`，含 Postgres/Redis 服务 |
| 原生构建 | `build-native-linux` | ubuntu-24.04 | — | `@affine/native` Linux x64 |
| 原生构建 | `build-native-macos` | macos-latest | — | x64 与 arm64 两个 target |
| 原生构建 | `build-native-windows` | windows-latest | — | x64 与 arm64，使用 Dev Drive 加速 |
| 原生构建 | `build-server-native` | ubuntu-24.04 | — | `@affine/server-native` |
| 前端构建 | `build-electron-renderer` | ubuntu-latest | — | 产出 `web` artifact |
| 单测 | `unit-test` | ubuntu-24.04 | `build-native-linux` | Vitest 5 分片 + codecov |
| 单测 | `native-unit-test` | ubuntu-latest | `build-native-linux` | `yarn affine @affine/native test`（ava） |
| 服务端 | `server-test` | ubuntu-latest | `build-server-native` | 4 节点分片，带 pgvector/redis/mailhog |
| 服务端 | `server-test-elasticsearch` | ubuntu-latest | 同上 | 仅搜索相关 e2e，使用 ES 9.0.1 |
| 服务端 | `server-test-embedded` | ubuntu-latest | 同上 | 内置搜索 provider |
| 服务端 | `server-test-manticoresearch` | ubuntu-latest | 同上 | Manticore 29.0.2 |
| 服务端 | `server-e2e-test` | ubuntu-latest | 同上 | 服务端 e2e，关闭索引 |
| 过滤器 | `copilot-test-filter` | ubuntu-latest | — | 输出 `run-api`、`run-e2e` |
| AI | `copilot-api-test` | ubuntu-latest | server-native + 过滤器 | 需 `TEST_SERVER_CONFIG` secret |
| AI | `copilot-e2e-test` | ubuntu-24.04 | 同上 | 5 分片 |
| E2E | `e2e-test` | ubuntu-24.04-arm | — | 本地版 web E2E，5 分片 |
| E2E | `e2e-blocksuite-test` | ubuntu-24.04 | — | BlockSuite playground，5 分片 |
| E2E | `e2e-blocksuite-cross-browser-test` | ubuntu-24.04 | — | Chromium/Firefox/WebKit |
| E2E | `e2e-mobile-test` | ubuntu-24.04 | — | 移动 Web，2 分片 |
| E2E | `cloud-e2e-test` | ubuntu-24.04 | server-native + native-linux | 云端 E2E 两分片 + 桌面云端 E2E |
| 桌面 | `desktop-test` | 三平台 | renderer + 三个 native | 桌面单测、E2E、打包冒烟 |
| 汇总 | `test-done` | ubuntu-latest | 其余全部 | 名为 "3, 2, 1 Launch" |

**设计意图**：把"慢而通用"的产物（Rust 原生模块、Electron 渲染层）作为 DAG 的上游一次性构建，下游大量测试 job 通过 artifact 复用，而不是每个 job 都自己编译 Rust——一次 Rust release 构建往往要十几分钟。

## 26.4 静态检查类 job 详解

### 26.4.1 lint：从 workflow 本身开始检查

```yaml
# 来源：.github/workflows/build-test.yml（节选）
  lint:
    name: Lint
    runs-on: ubuntu-24.04-arm
    steps:
      - uses: actions/checkout@v7
      - name: Setup Go (for actionlint)
        uses: actions/setup-go@v7
        with:
          go-version: 'stable'
      - name: Install actionlint
        shell: bash
        run: |
          set -euo pipefail
          go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.11
      - name: Run actionlint
        shell: bash
        run: |
          set -euo pipefail
          "$(go env GOPATH)/bin/actionlint"
      - name: Setup Node.js
        uses: ./.github/actions/setup-node
        with:
          electron-install: false
          full-cache: true
      - name: Run oxlint
        run: yarn lint:ox
      - name: Run i18n codegen
        run: yarn affine @affine/i18n build
      - name: Run Oxfmt
        # Set nmMode in `actions/setup-node` will modify the .yarnrc.yml
        run: |
          git checkout .yarnrc.yml
          yarn lint:format
      - name: Yarn Dedupe
        run: yarn dedupe --check
```

- **actionlint** 会读取 `.github/actionlint.yaml`。其中声明了一个自托管 runner 标签 `win-signer`（避免 actionlint 把未知标签报错）以及 `config-variables: null`（不检查 `vars.*` 变量名）。当前仓库的工作流中并未出现 `win-signer` 标签的 job，它很可能是为签名相关流程预留的。
- 注释"Set nmMode in `actions/setup-node` will modify the .yarnrc.yml"揭示了一个细节：`setup-node` 复合 Action 可能执行 `yarn config set nmMode ...` 修改 `.yarnrc.yml`，所以格式检查前先 `git checkout .yarnrc.yml` 还原，避免误报。
- `yarn dedupe --check` 防止 `yarn.lock` 中同一包出现多个可合并的版本。

### 26.4.2 typecheck 与 check-git-status：生成物必须提交

AFFiNE 有大量"生成代码"：i18n 资源类型、GraphQL 类型、服务端配置 schema、BlockSuite 文档。CI 的策略是**重新生成一遍，然后 `git status --porcelain`，有差异就失败**：

```yaml
# 来源：.github/workflows/build-test.yml（节选，check-git-status）
      - name: Run Check
        run: |
          yarn affine init
          yarn affine gql build
          yarn affine i18n build
          yarn affine server genconfig
          git checkout packages/frontend/i18n/src/i18n-completenesses.json
          if git status --porcelain | grep -q .; then
            echo "Run 'yarn affine init && yarn affine gql build && yarn affine i18n build && yarn affine server genconfig' and make sure all changes are submitted"
            exit 1
          else
            echo "All changes are submitted"
          fi
```

为什么 `check-git-status` 依赖 `build-server-native`？因为 `yarn affine server genconfig`（生成 `config.example.json` / `schema.json`，第 27 章）需要加载服务端代码，而服务端会 require `server-native.node`。

`i18n-completenesses.json` 被显式 `git checkout` 还原——翻译完成度统计会随翻译平台变化，不应因此阻塞 PR。

### 26.4.3 analyze：CodeQL

`analyze` 用 `github/codeql-action` 对 `javascript`、`typescript` 做静态安全分析，并通过 `project` 维度把 `blocksuite` 子树单独扫描（扫 affine 时先 `rm -rf blocksuite` 避免重复）。它需要 `security-events: write` 权限才能把结果上传到仓库的 Security 页。

### 26.4.4 check-yarn-binary

```yaml
# 来源：.github/workflows/build-test.yml（节选）
      - name: Run check
        run: |
          set -euo pipefail
          yarn_version="$(node -e "console.log(require('./package.json').packageManager.split('@')[1])")"
          yarn set version "$yarn_version"
          git diff --exit-code
```

根 `package.json` 声明 `"packageManager": "yarn@4.18.0"`，`.yarnrc.yml` 的 `yarnPath` 指向 `.yarn/releases/yarn-4.18.0.cjs`。这个 job 防止有人只改了其中之一，或提交了被篡改的 yarn 二进制——这也是一项供应链安全措施（第 28 章）。

## 26.5 路径过滤与按需构建

移动端原生构建（Gradle、Xcode）与 Rust 测试都很慢。AFFiNE 用 `dorny/paths-filter@v3` 在一个轻量 job 中计算"本次改动是否涉及某些路径"，再通过 `outputs` + `if` 跳过下游 job。

```yaml
# 来源：.github/workflows/build-test.yml（节选）
  rust-test-filter:
    name: Rust test filter
    runs-on: ubuntu-latest
    outputs:
      run-rust: ${{ steps.rust-filter.outputs.rust }}
    steps:
      - uses: actions/checkout@v7

      - uses: dorny/paths-filter@v3
        id: rust-filter
        with:
          filters: |
            rust:
              - '**/*.rs'
              - '**/Cargo.toml'
              - '**/Cargo.lock'
              - '.cargo/**'
              - 'rust-toolchain*'
              - '.github/actions/build-rust/**'
              - '.github/workflows/build-test.yml'

  lint-rust:
    name: Lint Rust
    if: ${{ needs.rust-test-filter.outputs.run-rust == 'true' }}
    runs-on: ubuntu-latest
    needs:
      - rust-test-filter
```

三个过滤器对照：

| 过滤 job | 输出 | 关注路径 | 控制的下游 |
| --- | --- | --- | --- |
| `mobile-native-build-filter` | `run-android` / `run-ios` | `packages/frontend/apps/android/**` 或 `apps/ios/**`、`packages/frontend/mobile-native/**`、`.cargo/**`、`Cargo.*`、`rust-toolchain*`、本 workflow 文件 | `build-android-app`、`test-android-app`、`build-ios-app` |
| `rust-test-filter` | `run-rust` | 所有 `.rs`、`Cargo.toml/lock`、`.cargo/**`、`rust-toolchain*`、`build-rust` action、本 workflow 文件 | `lint-rust`、`rust-test` |
| `copilot-test-filter` | `run-api` / `run-e2e` | `packages/backend/server/src/plugins/copilot/**`、`packages/backend/server/tests/copilot.*`；e2e 额外包括 `packages/frontend/core/src/blocksuite/ai/**`、`core/src/modules/workspace-indexer-embedding/**`、`tests/affine-cloud-copilot/**` | `copilot-api-test`、`copilot-e2e-test` |

两个细节值得学习：

1. **过滤规则包含 workflow 文件本身**（`.github/workflows/build-test.yml`），修改 CI 配置时会强制触发对应 job，避免"改坏了 CI 却没被验证"。
2. 被 `if` 跳过的 job 结果是 `skipped`，而 `test-done` 只在 `failure` / `cancelled` 时失败（26.8），所以跳过不会让 PR 变红。

> 注意：`build-native-*`、`unit-test` 等 job 并没有路径过滤——前端代码几乎处处依赖 `@affine/native`，所以每次都跑。

## 26.6 原生模块构建与产物传递

### 26.6.1 build-native-* 的统一模式

三个平台的原生构建 job 结构几乎一致：

```yaml
# 来源：.github/workflows/build-test.yml（节选，build-native-linux）
  build-native-linux:
    name: Build AFFiNE native (x86_64-unknown-linux-gnu)
    runs-on: ubuntu-24.04
    env:
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '16'
      CARGO_PROFILE_RELEASE_DEBUG: '1'
      CARGO_PROFILE_RELEASE_LTO: 'thin'
    steps:
      - uses: actions/checkout@v7
      - name: Setup Node.js
        uses: ./.github/actions/setup-node
        with:
          extra-flags: workspaces focus @affine/native
          electron-install: false
      - name: Setup filename
        id: filename
        working-directory: ${{ github.workspace }}
        shell: bash
        run: |
          PLATFORM_ARCH_ABI="$(node -e "console.log(require('@napi-rs/cli').parseTriple('x86_64-unknown-linux-gnu').platformArchABI)")"
          echo "filename=affine.$PLATFORM_ARCH_ABI.node" >> "$GITHUB_OUTPUT"
      - name: Build AFFiNE native
        uses: ./.github/actions/build-rust
        with:
          target: x86_64-unknown-linux-gnu
          package: '@affine/native'
      - name: Upload ${{ steps.filename.outputs.filename }}
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ${{ steps.filename.outputs.filename }}
          path: ${{ github.workspace }}/packages/frontend/native/${{ steps.filename.outputs.filename }}
          if-no-files-found: error
```

几个工程技巧：

- **`yarn workspaces focus @affine/native`**：只安装这一个 workspace 的依赖，比全量安装快得多。几乎所有 job 都通过 `setup-node` 的 `extra-flags` 做"聚焦安装"。
- **`CARGO_PROFILE_RELEASE_*` 覆盖**：CI 中把 release profile 改为 `codegen-units=16`、`lto=thin`、带 debug 信息，在"编译速度"与"接近生产性能"之间折中；正式发布时不使用这些覆盖。
- **文件名由 `@napi-rs/cli` 的 `parseTriple` 计算**：例如 `x86_64-unknown-linux-gnu` 映射为 `affine.linux-x64-gnu.node`，下游用同名 artifact 下载，保证一致。
- **Windows 使用 Dev Drive**：`samypr100/setup-dev-drive@v3` 创建 8GB NTFS 虚拟盘并把 `CARGO_HOME`、`RUSTUP_HOME` 映射过去，注释写明 "Split Windows build because it's too slow"。

### 26.6.2 artifact 流转图

```mermaid
flowchart LR
  BNL[build-native-linux] -->|affine.linux-x64-gnu.node| UT[unit-test]
  BNL --> NUT[native-unit-test]
  BNL --> CE[cloud-e2e-test]
  BNL --> DT[desktop-test]
  BNM[build-native-macos] -->|affine.darwin-x64 与 arm64 .node| DT
  BNW[build-native-windows] -->|affine.win32-x64 与 arm64 .node| DT
  BSN[build-server-native] -->|server-native.node| ST[server-test 系列]
  BSN --> CGS[check-git-status]
  BSN --> CP[copilot 测试]
  BSN --> CE
  BER[build-electron-renderer] -->|web 即 dist.tar.gz| DT
```

`build-electron-renderer` 把 `packages/frontend/apps/electron-renderer/dist` 打成 `dist.tar.gz` 上传为 `web` artifact；`desktop-test` 通过复合 Action `download-web` 下载并解压到 `packages/frontend/apps/electron/resources/web-static`——正是第 20 章 `protocol.ts` 读取静态资源的目录。

## 26.7 测试类 job 详解

### 26.7.1 unit-test 与 codecov

```yaml
# 来源：.github/workflows/build-test.yml（节选）
  unit-test:
    name: Unit Test
    runs-on: ubuntu-24.04
    needs:
      - build-native-linux
    env:
      DISTRIBUTION: web
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4, 5]
    steps:
      # ... checkout、setup-node（electron-install: true、playwright-install: true）
      - name: Download affine.linux-x64-gnu.node
        uses: actions/download-artifact@v4
        with:
          name: affine.linux-x64-gnu.node
          path: ./packages/frontend/native

      - name: Unit Test
        run: yarn test:coverage --shard=${{ matrix.shard }}/${{ strategy.job-total }}

      - name: Upload unit test coverage results
        uses: codecov/codecov-action@v5
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./.coverage/store/lcov.info
          flags: unittest
          name: affine
          fail_ci_if_error: false
```

- `${{ strategy.job-total }}` 自动等于 matrix 实例数（5），改分片数时不必同步改命令。
- `fail-fast: false`：一个分片失败不取消其他分片，便于一次看到所有失败。
- codecov 上传使用 `flags` 区分 `unittest` 与 `server-test`；根目录 `codecov.yml` 中 `status.project: false`、`status.patch: false`，即**覆盖率下降不会让 PR 失败**，只做可视化参考。`fail_ci_if_error: false` 保证 codecov 服务故障不会阻塞 CI。

### 26.7.2 server-test 系列：services 容器

服务端测试需要真实的 PostgreSQL（带 pgvector 扩展）、Redis 和 SMTP：

```yaml
# 来源：.github/workflows/build-test.yml（节选，server-test）
    env:
      NODE_ENV: test
      DATABASE_URL: postgresql://affine:affine@localhost:5432/affine
      REDIS_SERVER_HOST: localhost
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_PASSWORD: affine
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      redis:
        image: redis
        ports:
          - 6379:6379
      mailer:
        image: mailhog/mailhog
        ports:
          - 1025:1025
          - 8025:8025
```

`services` 会在 job 开始前启动容器并等待健康检查通过。`server-test` 用 `node_index: [0, 1, 2, 3]` + `total_nodes: [4]` 两个维度，并以 `CI_NODE_INDEX`、`CI_NODE_TOTAL` 环境变量传给测试框架实现分片。

四个搜索相关 job 的差异仅在于 `server-test-env` 的 `indexer-provider` 输入与测试文件范围：

| job | `indexer-provider` | 额外服务 | 测试范围 |
| --- | --- | --- | --- |
| `server-test` | 默认 `embedded` | — | 全部服务端单测（`test:coverage`） |
| `server-test-elasticsearch` | `elasticsearch` | `elastic/elastic-github-actions` 启动 ES 9.0.1 | `src/__tests__/e2e/indexer/search-docs.spec.ts` |
| `server-test-embedded` | `embedded` | — | indexer 下的 `aggregate`、`search-docs`、`search` 三个 spec |
| `server-test-manticoresearch` | `manticoresearch` | `manticoresearch/manticore:29.0.2` 服务 | `src/__tests__/e2e/indexer/manticore-provider.spec.ts` |
| `server-e2e-test` | `disabled` | — | 全部服务端 e2e（`e2e:coverage`） |

### 26.7.3 rust-test

```yaml
# 来源：.github/workflows/build-test.yml（节选）
      - name: Run workspace Rust tests
        run: cargo nextest run --workspace --exclude affine_server_native --features use-as-lib --no-fail-fast

      - name: Run server-native Rust tests with PostgreSQL and Redis
        run: cargo nextest run -p affine_server_native --no-fail-fast --test-threads=1

      - name: Run native storage cleanup integration tests
        run: cargo test -p affine_server_native blob_cleanup_projection_ -- --ignored --nocapture
```

注意 `--features use-as-lib`——呼应第 20 章，让 `affine_nbstore` 以普通库形式编译，避免在纯 Rust 测试中链接 NAPI 符号。`affine_server_native` 的测试需要数据库，所以先用 `yarn affine @affine/server prisma migrate deploy` 建表，并串行执行（`--test-threads=1`）。

### 26.7.4 E2E 与桌面测试

- `e2e-test` 跑 `@affine-test/affine-local`（不需要服务端的本地模式 web），设置 `DISTRIBUTION: web`、`IN_CI_TEST: true`；
- `cloud-e2e-test` 用 matrix 的 `tests` 对象列表直接携带 `name` 与 `script`，其中 "Cloud Desktop E2E Test" 会 `yarn affine @affine/electron build:dev` 后在 `xvfb-run` 虚拟显示中跑 `@affine-test/affine-desktop-cloud`；
- `desktop-test` 在 macOS（x64 仅打包、arm64 测试）、Linux x64、Windows x64 上：跑 `yarn affine @affine/electron vitest` 单测、下载 web 产物、`yarn affine @affine/electron build`、跑 `@affine-test/affine-desktop` E2E，最后以 `SKIP_BUNDLE`、`SKIP_WEB_BUILD`、`HOIST_NODE_MODULES` 做一次打包冒烟（Linux 走 `make`，含 flatpak），macOS arm64 还会执行 `scripts/macos-arm64-output-check.ts` 检查产物。

Ubuntu 24.04 上运行 Electron 的一个坑在 workflow 注释里写得很清楚：

```yaml
# 来源：.github/workflows/build-test.yml（节选，desktop-test）
      - name: Run desktop tests
        if: ${{ matrix.spec.os == 'ubuntu-24.04' }}
        run: |
          # Workaround for Electron apps failing to initialize on Ubuntu 24.04 due to AppArmor restrictions
          # Disables unprivileged user namespaces restriction to allow Electron apps to run
          # Reference: https://github.com/electron/electron/issues/42510
          sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
          xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" -- yarn affine @affine-test/affine-desktop e2e
```

所有 E2E job 都用 `if: always()` 上传 `./test-results`（Playwright trace、截图），失败时可在运行页面下载排查。

### 26.7.5 移动端构建

`build-android-app` 的流程：聚焦安装 `@affine/android` → `actions/setup-java@v5`（Temurin 21，Gradle 缓存）→ `build-rust`（`no-build: 'true'`，只装工具链与 target `aarch64-linux-android`）→ `yarn affine @affine/android build` → 写入一个**占位** `google-services.json`（CI 不持有真实 Firebase 配置）→ `cap sync` → `./gradlew :app:assembleCanaryDebug`。`test-android-app` 还通过 `reactivecircus/android-emulator-runner@v2` 启动 API 35 的 x86_64 模拟器跑 instrumentation 测试，并用 `AFFINE_ANDROID_NATIVE_TARGET: x86_64` 让 Rust 编译与模拟器架构一致。

`build-ios-app` 在 `macos-15` 上用 `maxim-lobanov/setup-xcode@v1` 固定 Xcode 版本，`CODE_SIGNING_ALLOWED=NO` 构建模拟器包，并用 Ruby 一行脚本挑选可用的 iPhone 模拟器跑 `AFFiNETests` scheme。

## 26.8 test-done：一个"必需检查"顶替几十个

```yaml
# 来源：.github/workflows/build-test.yml（节选）
  test-done:
    needs:
      - analyze
      - lint
      - typecheck
      # ... 共 33 个 job
      - desktop-test
      - cloud-e2e-test
    if: always()
    runs-on: ubuntu-latest
    name: 3, 2, 1 Launch
    steps:
      - run: exit 1
        # Thank you, next https://github.com/vercel/next.js/blob/canary/.github/workflows/build_and_test.yml#L379
        if: ${{ always() && (contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')) }}
```

**为什么需要它？** 分支保护规则（Required status checks）要求逐一列出必需检查的名字。job 数量与 matrix 分片经常变化，维护这个列表非常痛苦。于是只把 "3, 2, 1 Launch" 设为必需检查：

- `if: always()` 保证即使上游失败它也会运行；
- `needs.*.result` 是所有上游结果的数组，包含 `failure` 或 `cancelled` 就 `exit 1`；
- `skipped`（被路径过滤跳过）与 `success` 都视为通过。

注释说明这个技巧借鉴自 Next.js 仓库。

## 26.9 复合 Action 逐个解读

`.github/actions` 下 8 个复合 Action：

| Action | 主要输入 | 做什么 | 被谁使用 |
| --- | --- | --- | --- |
| `setup-node` | `extra-flags`、`playwright-install`、`playwright-platform`、`electron-install`、`hard-link-nm`、`nmHoistingLimits`、`enableScripts`、`full-cache`、`corepack-install`、`package-install` | 安装 Node（版本取自 `.nvmrc`）、配置 yarn、多级缓存、安装依赖、Playwright 浏览器、Electron 二进制 | 几乎所有 job |
| `build-rust` | `target`、`package`、`no-build`、`cache-key` | 读取 `rust-toolchain.toml` 版本安装工具链、设置 CC、`Swatinem/rust-cache`、执行 `yarn workspace <pkg> build --target` | 原生构建、Rust 测试、移动端 |
| `server-test-env` | `indexer-provider` | 建库建用户、生成 `packages/backend/server/config.json`、prisma generate/migrate、data-migration | 服务端与 E2E 测试 |
| `download-web` | `path` | 下载 `web` artifact 并解压 | `desktop-test` |
| `setup-version` | `app-version`、`ios-app-version` | 执行 `./scripts/set-version.sh` 改写所有 workspace 的 `package.json` 版本 | 发布类 workflow |
| `setup-sentry` | — | macOS 用 brew、其他平台用 npm 安装 `@sentry/cli` | 发布类 workflow |
| `prepare-release` | `targets`、`created-at`、`tool-image` | 拉取发布工具镜像并生成 `release-plan.json`，输出版本、渠道、矩阵 | `release.yml` |
| `copilot-test` | `script` | 以 `COPILOT: true`、`DEV_SERVER_URL` 运行 Copilot E2E，失败时上传报告 | `copilot-e2e-test` |

### 26.9.1 setup-node：缓存策略

```yaml
# 来源：.github/actions/setup-node/action.yml（节选）
    - name: Cache non-full yarn cache on Linux
      uses: actions/cache@v6
      if: ${{ inputs.full-cache != 'true' && runner.os == 'Linux' }}
      with:
        path: |
          ${{ steps.workspace-path.outputs.workspace_path }}/node_modules
          ${{ steps.yarn-cache.outputs.yarn_global_cache }}
        key: node_modules-cache-${{ github.job }}-${{ runner.os }}-${{ runner.arch }}-${{ steps.system-info.outputs.name }}-${{ steps.system-info.outputs.release }}-${{ steps.system-info.outputs.version }}

    # The network performance on macOS is very poor
    # and the decompression performance on Windows is very terrible
    # so we reduce the number of cached files on non-Linux systems by remove node_modules from cache path.
    - name: Cache non-full yarn cache on non-Linux
      uses: actions/cache@v6
      if: ${{ inputs.full-cache != 'true' && runner.os != 'Linux' }}
      with:
        path: |
          ${{ steps.yarn-cache.outputs.yarn_global_cache }}
        key: node_modules-cache-${{ github.job }}-${{ runner.os }}-${{ runner.arch }}-...
```

策略可以总结为一张表：

| 组合 | 缓存内容 | key 维度 | 场景 |
| --- | --- | --- | --- |
| 非 full + Linux | `node_modules` + yarn 全局缓存 | job 名 + OS + 架构 + 系统版本 | 聚焦安装的 job，各自一份 |
| 非 full + 非 Linux | 仅 yarn 全局缓存 | 同上 | macOS 网络差、Windows 解压慢 |
| full + Linux | `node_modules` + yarn 全局缓存 | 不含 job 名，全局共享 | 需要全量依赖的 job（lint、typecheck、unit-test…） |
| full + 非 Linux | 仅 yarn 全局缓存 | 同上 | — |

此外还有 Playwright 浏览器缓存（key 含 Playwright 版本，带 `restore-keys` 前缀回退）与 Electron 二进制缓存（key 含 Electron 版本）。安装依赖时设置 `HUSKY: '0'`、`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'`、`SENTRYCLI_SKIP_DOWNLOAD: '1'`，避免在 install 阶段做无关下载。

一个值得注意的点：key 里**没有 `yarn.lock` 的哈希**。这意味着缓存只按"job + 系统"维度命中，依赖变化后由 `yarn install` 自行增量修正。这样换取了极高的命中率，代价是缓存可能偏大。

`setup-node` 还设置了 `registry-url: https://npm.pkg.github.com` 与 `scope: '@toeverything'`，用于从 GitHub Packages 拉取 `@toeverything` 作用域的私有/内部包。

### 26.9.2 build-rust：工具链与缓存

```yaml
# 来源：.github/actions/build-rust/action.yml（节选）
    - name: Print rustup toolchain version
      shell: bash
      id: rustup-version
      working-directory: ${{ env.DEV_DRIVE_WORKSPACE || github.workspace }}
      run: |
        export RUST_TOOLCHAIN_VERSION="$(grep 'channel' rust-toolchain.toml | head -1 | awk -F '"' '{print $2}')"
        echo "Rust toolchain version: $RUST_TOOLCHAIN_VERSION"
        echo "RUST_TOOLCHAIN_VERSION=$RUST_TOOLCHAIN_VERSION" >> "$GITHUB_OUTPUT"
    # ...
    - name: Cache cargo
      uses: Swatinem/rust-cache@v2
      if: ${{ runner.os != 'Windows' }}
      with:
        save-if: ${{ github.ref_name == 'canary' }}
        shared-key: ${{ steps.cache-key.outputs.shared-key }}
        key: ${{ inputs.cache-key }}

    - name: Build
      shell: bash
      if: ${{ runner.os != 'Windows' && inputs.no-build != 'true' }}
      run: |
        if [[ "${{ inputs.target }}" == "x86_64-unknown-linux-gnu" ]] || [[ "${{ inputs.target }}" == "aarch64-unknown-linux-gnu" && "$(uname -m)" == "aarch64" ]]; then
          yarn workspace ${{ inputs.package }} build --target ${{ inputs.target }}
        else
          yarn workspace ${{ inputs.package }} build --target ${{ inputs.target }} --use-napi-cross
        fi
```

- 工具链版本单一来源：`rust-toolchain.toml` 的 `channel = "1.97.1"`；
- **`save-if: github.ref_name == 'canary'`**：只有 canary 分支的运行才写缓存，PR 只读。这防止大量 PR 污染缓存、挤占 10GB 配额，也降低了"恶意 PR 投毒缓存"的风险；
- 交叉编译时使用 `--use-napi-cross`（NAPI-RS 提供的交叉工具链）；Linux 下设置 `CC=clang -D_BSD_SOURCE`，源码注释指向 tree-sitter 的构建问题；
- `no-build: 'true'` 用于只要工具链、不需要构建的场景（`lint-rust`、`rust-test`、移动端 job 交给 Gradle/Xcode 调用 cargo）。

### 26.9.3 server-test-env：用 jq 生成配置

```yaml
# 来源：.github/actions/server-test-env/action.yml（节选）
    - name: Import config
      shell: bash
      run: |
        case '${{ inputs.indexer-provider }}' in
          disabled)
            default_indexer='{"enabled":false,"provider":{"type":"embedded","endpoint":""}}'
            ;;
          embedded)
            default_indexer='{"enabled":true,"provider":{"type":"embedded","endpoint":""}}'
            ;;
          elasticsearch)
            default_indexer='{"enabled":true,"provider":{"type":"elasticsearch","endpoint":"http://localhost:9200"}}'
            ;;
          manticoresearch)
            default_indexer='{"enabled":true,"provider":{"type":"manticoresearch","endpoint":"http://localhost:9308"}}'
            ;;
          # ...
        esac
        if [[ -n "${SERVER_CONFIG:-}" ]]; then
          jq --argjson indexer "$default_indexer" '.indexer = $indexer' <<<"$SERVER_CONFIG" > ./packages/backend/server/config.json
        else
          jq -n --argjson indexer "$default_indexer" '{indexer: $indexer}' > ./packages/backend/server/config.json
        fi

    - name: Run init-db script
      shell: bash
      env:
        NODE_ENV: test
      run: |
        yarn affine @affine/server prisma generate
        yarn affine @affine/server prisma migrate deploy
        yarn affine @affine/server data-migration run
```

这里直接体现了第 27 章要讲的**配置体系**：服务端读取 `packages/backend/server/config.json`，`indexer.provider.type` 决定搜索后端。Copilot 测试通过 `SERVER_CONFIG: ${{ secrets.TEST_SERVER_CONFIG }}` 注入包含 AI 供应商密钥的完整配置，再由 jq 合并 indexer 段。

## 26.10 PR 辅助工作流：标题、标签、Copilot

### 26.10.1 pr-title-lint.yml

```yaml
# 来源：.github/workflows/pr-title-lint.yml（节选）
jobs:
  check-pull-request-title:
    name: Check pull request title
    runs-on: ubuntu-latest
    if: ${{ github.event.action != 'edited' || github.event.changes.title != null }}
    steps:
      - uses: actions/checkout@v7
      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          cache: 'yarn'
          node-version-file: '.nvmrc'
      - name: Install dependencies
        run: yarn workspaces focus @affine/commitlint-config
      - name: Check PR title
        env:
          TITLE: ${{ github.event.pull_request.title }}
        run: echo "$TITLE" | yarn workspace @affine/commitlint-config commitlint -g ./.commitlintrc.json
```

- `if` 条件：编辑 PR 但没改标题（只改描述）时不运行；
- 标题通过 `env: TITLE` 传入再 `echo "$TITLE"`，而**不是**直接 `run: echo "${{ github.event.pull_request.title }}"`——后者会把用户可控文本插入脚本，构成脚本注入（第 28 章）；
- 规则来自 `tools/commitlint/.commitlintrc.json`：继承 `@commitlint/config-conventional`，`scope-enum` 限定 scope 为 `admin`、`electron`、`server`、`core`、`web`、`mobile`、`ios`、`android`、`mobile-native`、`docs`、`component`、`env`、`graphql`、`hooks`、`i18n`、`native`、`templates`、`debug`、`nbstore`、`infra`、`editor`、`tools`、`y-octo`、`client`。所以合法标题形如 `feat(electron): add tray menu`。

### 26.10.2 auto-labeler.yml

```yaml
# 来源：.github/workflows/auto-labeler.yml
name: 'Pull Request Labeler'
on:
  pull_request_target:
    types:
      - opened
      - reopened
      - synchronize

jobs:
  triage:
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/labeler@v7
```

`actions/labeler` 读取 `.github/labeler.yml`，按改动文件路径打标签，例如 `packages/frontend/apps/electron/**` → `app:electron`、`**/*.rs` → `rust`、`packages/backend/server/**` → `app:server`。

为什么用 `pull_request_target` 而不是 `pull_request`？fork 仓库发起的 PR 在 `pull_request` 事件下拿到的是只读 token，无法打标签；`pull_request_target` 在**基础仓库上下文**运行，有写权限。代价是它很危险——绝不能在其中 checkout 并执行 PR 的代码。这里 `actions/checkout@v7` 默认检出的是基础分支，labeler 只读取改动文件列表，权限也收窄为 `pull-requests: write`，是安全用法。

### 26.10.3 Copilot 测试的两种入口

```mermaid
flowchart LR
  A[canary tag 推送] --> D[copilot-test-automatically.yml]
  B[每日 UTC 八点 cron] --> D
  C[手动 workflow_dispatch] --> D
  D -->|benc-uk workflow-dispatch| E[copilot-test.yml]
  E --> F[build-server-native]
  F --> G[copilot-api-test]
  F --> H[copilot-e2e-test 10 分片]
  G --> I[test-done 发送 Slack]
  H --> I
  P[PR 中改动 copilot 相关路径] --> Q[build-test.yml 内 copilot-test-filter]
  Q --> R[copilot-api-test 与 copilot-e2e-test 5 分片]
```

- PR 场景：`build-test.yml` 中只在相关路径改动时运行（节省调用 AI 接口的费用）；
- 定时/打 tag 场景：`copilot-test-automatically.yml` 通过 `benc-uk/workflow-dispatch@v1` 派发 `copilot-test.yml`（需要 `actions: write` 权限），后者的 E2E 分为 10 片，结束后用 `tools/copilot-result/index.js` 把成功/失败/取消结果发到 Slack（`SLACK_BOT_TOKEN`、`RELEASE_SLACK_CHNNEL_ID` secret）。

## 26.11 发布链路：Release Candidates

### 26.11.1 整体流程

```mermaid
sequenceDiagram
  autonumber
  participant Cron as 每日 UTC 九点或手动
  participant R as release.yml
  participant P as prepare-release action
  participant BI as build-images.yml
  participant RD as release-desktop.yml
  participant RM as release-mobile.yml
  participant RS as release-submit.yml
  participant Ext as 外部 affine-native 仓库
  Cron->>R: 触发 targets 默认 server desktop-macos desktop-windows desktop-linux 可选
  R->>R: 读取历史 Release 中 affine-release-completed.json
  R->>P: docker run affine-release plan
  P-->>R: APP_VERSION BUILD_TYPE SKIP SERVER 与矩阵
  par 并行
    R->>BI: server 为 true 时调用
    R->>RD: desktop 矩阵非空时调用
    R->>RM: mobile 矩阵非空时调用
  end
  R->>R: candidate job 合并产物并写 request.json
  R-->>RS: workflow_run completed
  RS->>Ext: 以 GitHub App token 派发 affine-release.yml apply
```

关键设计：

1. **计划与执行分离**：版本号、渠道、要构建哪些平台，全部由一个外部发布工具镜像（默认 `ghcr.io/toeverything/affine-release:latest`，可用仓库变量 `vars.AFFINE_RELEASE_TOOL_IMAGE` 覆盖）计算，输出 `release-plan.json`。工作流只是"执行者"。
2. **幂等与跳过**：`prepare` 会读取历史 Release 中的 `affine-release-completed.json` 作为 `--previous`，如果同一源码与目标集合已经完成，`SKIP` 为 true，后续全部跳过。
3. **候选不可变**：`prepare` 与 `candidate` 中都有检查——同一运行如果之前的 attempt 已成功提交过 `release-candidate`，重跑会直接报错 "Submitted candidates are immutable"。
4. **可选平台**：targets 中带 `?` 的（如 `desktop-linux?`）表示可选，对应矩阵项 `required: false`，job 以 `continue-on-error: ${{ !matrix.required }}` 运行，失败不阻断整体发布。
5. **未签名候选 + 外部签名**：`release-desktop-platform.yml` 中设置 `AFFINE_UNSIGNED_PACKAGE: '1'`（对应第 20 章 `forge.config.mjs` 跳过 `osxSign`），产物 stage 记为 `unsigned`；签名、公证、上传等由 `release-submit.yml` 派发到 `toeverything/affine-native` 仓库的 `affine-release.yml` 完成。这使主仓库的工作流**不需要持有签名私钥**。

### 26.11.2 prepare-release 的输出

```yaml
# 来源：.github/actions/prepare-release/action.yml（节选）
        docker run --rm --user "$(id -u):$(id -g)" -v "$GITHUB_WORKSPACE:/work" "$TOOL_IMAGE" plan \
          --ref "$GITHUB_REF" --sha "$GITHUB_SHA" --targets "$TARGETS" \
          --request-id "$GITHUB_REPOSITORY_ID-$GITHUB_RUN_ID" --created-at "$RUN_CREATED_AT" --out /work/release-plan.json "${previous[@]}"
        {
          echo "APP_VERSION=$(jq -r .version release-plan.json)"
          echo "GIT_SHORT_HASH=${GITHUB_SHA:0:9}"
          echo "BUILD_TYPE=$(jq -r .channel release-plan.json)"
          echo "SKIP=$(jq -r ' .skip // false' release-plan.json)"
          echo "SERVER=$(jq 'any(.targets[]; .name == "server")' release-plan.json)"
          echo "DESKTOP_MATRIX=$(jq -c '{include: [.buildMatrix.include[] | select(.target | startswith("desktop-"))]}' release-plan.json)"
          echo "MOBILE_MATRIX=$(jq -c '{include: [.buildMatrix.include[] | select(.target | startswith("mobile-"))]}' release-plan.json)"
        } >> "$GITHUB_OUTPUT"
```

矩阵以 JSON 字符串形式输出，下游用 `matrix: ${{ fromJSON(inputs.matrix) }}` 还原——这是"动态矩阵"的标准写法。

### 26.11.3 build-images.yml：服务端镜像候选

```mermaid
flowchart LR
  W[build-web] --> I[build-images]
  A[build-admin] --> I
  M[build-mobile] --> I
  N[build-server-native 三架构] --> S[build-server]
  S --> I
  I -->|docker build-push| G[ghcr.io toeverything affine candidate 镜像]
```

- `build-server-native` 的 matrix 覆盖 `x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`、`armv7-unknown-linux-gnueabihf`，分别重命名为 `server-native.x64.node`、`server-native.arm64.node`、`server-native.armv7.node`，并注入 `AFFINE_PRO_PUBLIC_KEY`、`AFFINE_PRO_LICENSE_AES_KEY`（自托管许可证校验相关）。
- `build-images` 下载所有 dist，`yarn workspaces focus @affine/server --production` 安装生产依赖（`supportedArchitectures` 设置为 x64/arm64/arm + glibc，让 yarn 一次下载所有架构的预编译包），`prisma generate` 后用 `docker/build-push-action@v6` 构建 `linux/amd64,linux/arm64,linux/arm/v7` 多架构镜像，`provenance: true` 生成构建来源证明。
- 镜像标签是 `candidate-${{ github.run_id }}-${{ github.run_attempt }}`，job 输出的是**按 digest 引用**的不可变地址 `ghcr.io/toeverything/affine@sha256:...`。
- 镜像所用的 `.github/deployment/node/Dockerfile` 第 27 章详解。

### 26.11.4 桌面与移动候选

- `release-desktop.yml` 的 `before-make`：`setup-version` → `setup-sentry` → `yarn affine @affine/electron generate-assets`（构建渲染层并上传 sourcemap）→ 上传 `desktop-web` artifact；
- `release-desktop-platform.yml` 的 `build`：按矩阵（`runner`、`rustTarget`、`platform`、`arch`、`required`）构建 `@affine/native`、下载 `desktop-web`、`yarn affine @affine/electron build`、`package` 未签名应用；Linux 还会逐个 `require` `app.asar.unpacked/dist/*.node` 验证原生模块可加载；最后打包为 `candidate-desktop-<platform>-<arch>`；
- `release.yml` 的 `candidate` job 用 `actions/upload-artifact/merge@v4` 把同平台不同架构合并成 `candidate-desktop-macos` 等；
- `release-mobile.yml` 只构建移动端 **Web 资源**（`yarn affine bundle -p <platform>`），上传 `candidate-mobile-<platform>`，原生 App 的打包签名不在本仓库工作流中。

## 26.12 Sentry sourcemap、签名与版本号

### 26.12.1 Sentry sourcemap 上传

上传逻辑不在 workflow 中硬编码，而是在构建工具里"检测到环境变量就启用"：

| 产物 | 插件位置 | 触发条件 | `SENTRY_PROJECT` |
| --- | --- | --- | --- |
| web / admin / mobile（rspack） | `tools/cli/src/rspack/index.ts` 中 `@sentry/webpack-plugin` | 设置了 `SENTRY_AUTH_TOKEN` 等 | `affine-web`、`affine-admin`、`affine-mobile` |
| Electron main/preload/helper（esbuild） | `packages/frontend/apps/electron/scripts/common.ts` 中 `sentryEsbuildPlugin` | 同时有 `SENTRY_AUTH_TOKEN`、`SENTRY_ORG`、`SENTRY_PROJECT` | `affine` |

workflow 只负责把 `secrets.SENTRY_ORG`、`secrets.SENTRY_AUTH_TOKEN`、`secrets.SENTRY_DSN` 与 `SENTRY_RELEASE: ${{ inputs.app-version }}` 注入。PR 构建拿不到这些 secret，插件自然不启用——**同一份构建脚本在 PR 与发布中行为不同，但不需要任何 if 分支**。`setup-sentry` 负责安装 `sentry-cli`。另外 web 构建还注入了 `PERFSEE_TOKEN`（性能分析平台）。

### 26.12.2 签名

- macOS：第 20 章 `forge.config.mjs` 中的 `osxSign`/`osxNotarize` 依赖 `APPLE_ID` 等变量；主仓库发布工作流设置 `AFFINE_UNSIGNED_PACKAGE: '1'` 跳过。
- Windows：`packages/frontend/apps/electron/scripts/sign-windows.ts` 需要 `AFFINE_SIGNER_ADDR`、`AFFINE_SIGNER_TOKEN`、`AFFINE_SIGN_CLIENT_HASH`、`WINDOWS_SIGNER_PUBLIC_CERT_BASE64`。仓库根还有一个检查脚本：

```js
// 来源：scripts/check-windows-signer.mjs（节选）
const buildType = process.env.BUILD_TYPE;
const requireSigner =
  process.env.REQUIRE_SIGNER === 'true' ||
  ['beta', 'stable'].includes(buildType);
const outputPath = process.env.GITHUB_OUTPUT;

const missing = [
  'AFFINE_SIGN_CLIENT_HASH',
  'AFFINE_SIGNER_ADDR',
  'AFFINE_SIGNER_TOKEN',
  'AFFINE_SIGNER_TS_AUTH_KEY',
  'WINDOWS_SIGNER_PUBLIC_CERT_BASE64',
].filter(name => !process.env[name]);

if (missing.length === 0) {
  setOutput('signer_available', 'true');
} else {
  setOutput('signer_available', 'false');
  const message = `Missing remote Windows signer configuration: ${missing.join(', ')}.`;
  if (requireSigner) {
    fail(message);
  } else {
    console.warn(
      `::warning::${message} Windows installer executables will be skipped.`
    );
  }
}
```

逻辑是：beta/stable 渠道（或显式 `REQUIRE_SIGNER=true`）缺任何签名配置就失败；canary 则只发警告并输出 `signer_available=false`，让后续步骤跳过生成 Windows 安装器 exe。注意它比 `sign-windows.ts` 多检查了一个 `AFFINE_SIGNER_TS_AUTH_KEY`（时间戳服务鉴权）。在当前版本的 `.github/workflows` 中**没有直接调用**这个脚本——结合 26.11 可知签名阶段已移到外部发布仓库，它更可能在那里或手动流程中使用。

### 26.12.3 版本号

`setup-version` 调用 `scripts/set-version.sh <version>`：遍历 `yarn workspaces list --json` 的每个 workspace，用 `jq` 改写 `package.json` 的 `version`，并更新 Linux AppStream 元数据中的版本与日期。仓库中所有包版本统一（本书写作时为 0.27.5），正是这个脚本保证的。第 20 章 `generate-assets.ts` 中"`RELEASE_VERSION` 与 package.json 版本不一致就报错"的检查与之呼应。

## 26.13 周边配置：Renovate、render.yaml、CodeSandbox 等

### 26.13.1 renovate.json

`.github/renovate.json` 配置依赖自动升级机器人：

- 继承 `config:recommended`，统一打 `dependencies` 标签，提交信息前缀 `chore: `、动作 `bump up`；
- 分组：所有 npm 非主版本更新合并为 "all non-major npm dependencies"（排除 `@blocksuite/` 与 `oxlint`），cargo 同理；`@nestjs/*`、`@opentelemetry/*` 各自成组；Dockerfile、GitHub Actions、Gradle、CocoaPods 等合为一组；
- `postUpdateOptions: ["yarnDedupeHighest"]` 与 lint job 中的 `yarn dedupe --check` 配合；
- `lockFileMaintenance` 每周一次；
- 自定义 regex manager 解析 `rust-toolchain.toml` 的 `channel`，让 Rust 工具链也能被自动升级。

### 26.13.2 其他 .github 文件

| 文件 | 作用 |
| --- | --- |
| `.github/CODEOWNERS` | `/blocksuite/` 与 `/packages/frontend/core/src/blocksuite` 归 `@toeverything/blocksuite-core` 审核 |
| `.github/auto_assign.yml` | 自动把 PR 作者设为 assignee（`addAssignees: author`） |
| `.github/PULL_REQUEST_TEMPLATE.md`、`.github/ISSUE_TEMPLATE/` | PR 与 Issue 模板（第 3 章） |
| `.github/CLA.md` | 贡献者许可协议 |
| `.github/deployment/node/Dockerfile` | 服务端镜像（第 27 章） |

### 26.13.3 render.yaml 与 .render/：一键部署到 Render

`render.yaml` 是 Render 平台的 Blueprint（基础设施即代码）：

```yaml
# 来源：render.yaml（节选）
projects:
  - name: affine
    environments:
      - name: production
        services:
          - type: web
            name: affine
            runtime: docker
            plan: standard
            # The Dockerfile adds a start script to ghcr.io/toeverything/affine:stable. It runs migrations and the server
            dockerfilePath: ./.render/Dockerfile
            dockerContext: ./.render
            healthCheckPath: /info
            disk:
              # Uploaded blobs (~/.affine/storage) and the generated private key
              # (~/.affine/config/private.key) must survive restarts.
              name: affine-data
              mountPath: /root/.affine
              sizeGB: 10
            envVars:
              - key: AFFINE_SERVER_PORT
                value: 10000
              - key: AFFINE_SERVER_HTTPS
                value: true
              - key: DATABASE_URL
                fromDatabase:
                  name: affine-postgres
                  property: connectionString
              # ... REDIS_SERVER_HOST / REDIS_SERVER_PORT 来自 keyvalue 服务
```

它声明了 web 服务（Docker）、keyvalue（Redis 兼容，`maxmemoryPolicy: noeviction`）、Postgres 16 数据库，`ipAllowList: []` 表示仅内网访问。`.render/Dockerfile` 只是在 `ghcr.io/toeverything/affine:stable` 之上加了一个启动脚本 `.render/start.sh`：

```sh
# 来源：.render/start.sh
#!/bin/sh
set -eu

# Use the hostname Render assigns, unless AFFINE_SERVER_HOST is already set to a
# custom domain.
export AFFINE_SERVER_HOST="${AFFINE_SERVER_HOST:-${RENDER_EXTERNAL_HOSTNAME:-localhost}}"

# Generates the server private key on first boot, then runs the Prisma and data
# migrations. Safe to run on every boot.
node ./scripts/self-host-predeploy.js

exec node ./dist/main.js
```

> 严格说这是"一键自托管模板"而非 PR 预览环境：它部署的是已发布的 `stable` 镜像，不会构建 PR 代码。`self-host-predeploy.js` 的细节见第 27 章。

### 26.13.4 .codesandbox/task.json

```json
// 来源：.codesandbox/task.json
{
  "$schema": "https://codesandbox.io/schemas/tasks.json",
  "setupTasks": [
    {
      "name": "Install Dependencies",
      "command": "yarn install"
    }
  ],

  "tasks": {
    "start-web": {
      "name": "Start Web",
      "command": "yarn dev-core",
      "runAtStart": true,
      "preview": {
        "port": 8080
      }
    }
  }
}
```

它让 CodeSandbox 云端开发环境自动安装依赖并启动预览（端口 8080）。注意：当前根 `package.json` 的 scripts 中只有 `dev`（`yarn affine dev`），**没有 `dev-core`**，这份配置看起来已经过时，如需使用应改为 `yarn dev`。

### 26.13.5 关于 .kuai.yaml

仓库根目录下可以看到 `.kuai.yaml`，但它是一个 **0 字节的空文件，且未被 git 跟踪**（`git status` 显示为 `??`），说明它是本地工具生成的文件，并非 AFFiNE 项目配置的一部分，学习时可以忽略；也不要把它误提交。

## 26.14 小结：AFFiNE CI 的设计取舍

| 取舍 | 做法 | 收益 | 代价 |
| --- | --- | --- | --- |
| 单一大 workflow vs 多个小 workflow | 主流水线集中在 `build-test.yml` | DAG 清晰，产物复用方便，一个必需检查 | 文件很长（约 1700 行） |
| 全量 vs 按需 | 前端全量，Rust/移动/Copilot 路径过滤 | 节省最慢的部分 | 过滤规则需维护 |
| 聚焦安装 | `yarn workspaces focus` | 安装时间大幅缩短 | 每个 job 需手工列出依赖的 workspace |
| 缓存写入权 | Rust 缓存只在 canary 写 | 防污染、防配额溢出 | PR 首次构建可能较慢 |
| 签名位置 | 主仓库只出未签名候选 | 主仓库无签名密钥，攻击面小 | 发布链路跨仓库，理解成本高 |
| 覆盖率 | codecov 仅展示不阻断 | 不因覆盖率波动卡 PR | 需要人为关注趋势 |

## 源码导读清单

| 优先级 | 路径 | 阅读重点 |
| --- | --- | --- |
| P0 | `.github/workflows/build-test.yml` | 触发器、并发、全部 job 的 needs 与 test-done |
| P0 | `.github/actions/setup-node/action.yml` | 输入参数、四种缓存组合、Playwright 与 Electron 缓存 |
| P0 | `.github/actions/build-rust/action.yml` | 工具链版本来源、rust-cache 的 save-if、交叉编译 |
| P1 | `.github/actions/server-test-env/action.yml` | 用 jq 生成 config.json、prisma 迁移 |
| P1 | `.github/workflows/release.yml` | prepare、动态矩阵、candidate 不可变 |
| P1 | `.github/actions/prepare-release/action.yml` | 发布工具镜像与输出 |
| P1 | `.github/workflows/build-images.yml` | 多架构 server-native 与镜像构建 |
| P1 | `.github/workflows/release-desktop-platform.yml` | 未签名打包、Linux 原生模块验证 |
| P1 | `.github/workflows/pr-title-lint.yml` | 安全传参与 commitlint |
| P2 | `.github/workflows/auto-labeler.yml` 与 `.github/labeler.yml` | `pull_request_target` 的安全使用 |
| P2 | `.github/workflows/copilot-test-automatically.yml` | workflow 派发 |
| P2 | `.github/workflows/release-submit.yml` | `workflow_run` 与 GitHub App token |
| P2 | `.github/actionlint.yaml` | 自托管 runner 标签声明 |
| P2 | `scripts/check-windows-signer.mjs` | 按渠道决定签名配置是否必需 |
| P2 | `render.yaml`、`.render/start.sh` | Render Blueprint 与启动脚本 |

## 动手实践

### 练习 1：本地运行 actionlint（入门）

- **目标**：熟悉工作流静态检查。
- **步骤**：
  1. 安装 actionlint：`go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.11`（或用 Homebrew `brew install actionlint`）。
  2. 在仓库根执行 `actionlint`。
  3. 临时复制一份 `.github/workflows/pr-title-lint.yml` 到 `/tmp`，把 `runs-on: ubuntu-latest` 改成 `runs-on: win-signerx`，用 `actionlint -config-file .github/actionlint.yaml /tmp/pr-title-lint.yml` 检查，观察报错；再改成 `win-signer` 观察差异。
- **验收标准**：能解释 `.github/actionlint.yaml` 中 `self-hosted-runner.labels` 的作用。

### 练习 2：画出完整 DAG（入门）

- **目标**：亲手核对 job 依赖。
- **步骤**：
  1. 执行下面的命令列出每个 job 的 needs：
     ```bash
     node -e "const Y=require('yaml');const d=Y.parse(require('fs').readFileSync('.github/workflows/build-test.yml','utf8'));for(const[k,j]of Object.entries(d.jobs))console.log(k,'<-',JSON.stringify(j.needs||[]))"
     ```
  2. 与 26.3 的图对照，找出哪些 job 没有任何依赖（可以最早开始）。
- **验收标准**：列出"关键路径"——从开始到 `test-done` 最长的链条（提示：`build-native-windows` → `desktop-test` → `test-done`）。

### 练习 3：模拟路径过滤（进阶）

- **目标**：理解按需构建。
- **步骤**：
  1. 在本地新建分支，只修改 `packages/frontend/native/src/hashcash.rs` 的注释。
  2. 对照 26.5 的表格，推断哪些过滤器输出为 true，哪些 job 会被跳过。
  3. 再只修改 `packages/frontend/apps/ios/src/app.tsx`，重复推断。
  4. 用 `git diff --name-only canary...HEAD` 列出改动文件，与过滤规则逐条匹配。完成后丢弃分支。
- **验收标准**：写出两次改动分别会运行和跳过的 job 列表。

### 练习 4：在 fork 中跑一次 CI（进阶）

- **目标**：观察真实运行、缓存与 artifact。
- **步骤**：
  1. Fork 仓库，在 fork 的 Actions 页面启用工作流。
  2. 推送一个只改 `docs/` 的提交，观察 `Build & Test` 运行；进入 `build-native-linux` 查看 `Cache cargo` 步骤是否命中、是否保存（提示：`save-if` 只在 canary 为 true）。
  3. 在运行汇总页下载 `affine.linux-x64-gnu.node` artifact。
  4. 观察 `unit-test` 中 codecov 步骤在没有 `CODECOV_TOKEN` 时的表现。
- **验收标准**：能说出哪些 job 因缺少 secrets 而行为不同。

### 练习 5：为新包设计 CI 接入（综合）

- **目标**：把本章知识用于设计。
- **步骤**：
  1. 假设新增了一个 Rust crate `packages/common/foo`（被 `@affine/server-native` 依赖）和对应的 TS 包。
  2. 回答：它的 Rust 测试会被哪个 job 覆盖？是否需要修改 `rust-test-filter`？
  3. 如果它需要一个新的外部服务（例如 MinIO），参考 `server-test-manticoresearch` 写出 `services` 片段与健康检查。
  4. 思考如何让它不影响 `test-done` 的必需检查配置。
- **验收标准**：给出一份不超过 40 行的 job YAML 草稿，并说明为何不需要修改分支保护规则。

## 自测题

1. `build-test.yml` 的 `concurrency` 配置对同一 PR 的连续推送有什么效果？
2. artifact 与 cache 有什么区别？各举一个 AFFiNE 中的例子。
3. 为什么 `check-git-status` 依赖 `build-server-native`？
4. 被路径过滤跳过的 job 会让 "3, 2, 1 Launch" 失败吗？为什么？
5. `build-rust` 中 `save-if: ${{ github.ref_name == 'canary' }}` 的目的是什么？
6. `pr-title-lint.yml` 为什么通过 `env: TITLE` 而不是直接在 `run` 中插值 PR 标题？
7. `auto-labeler.yml` 使用 `pull_request_target` 有什么风险？它如何规避？
8. 发布工作流中的动态矩阵是如何从 `prepare` 传到 `release-desktop-platform.yml` 的？
9. 为什么主仓库的桌面候选是未签名的？签名在哪里完成？
10. Sentry sourcemap 在 PR 构建中会上传吗？为什么？

<details><summary>参考答案</summary>

1. 同一 PR 的 `github.ref` 相同，因此属于同一 concurrency 组；`cancel-in-progress: true` 会取消正在运行的旧运行，只保留最新一次。
2. artifact 用于同一次运行中 job 之间传文件，例如 `build-native-linux` 上传 `affine.linux-x64-gnu.node` 供 `unit-test` 下载；cache 用于跨运行复用，例如 `setup-node` 缓存 `node_modules` 与 yarn 全局缓存、`build-rust` 用 `Swatinem/rust-cache` 缓存 cargo。
3. 它要运行 `yarn affine server genconfig` 重新生成服务端配置文件，这需要加载服务端代码，而服务端依赖 `server-native.node` 原生模块。
4. 不会。`test-done` 只在 `needs.*.result` 包含 `failure` 或 `cancelled` 时 `exit 1`，`skipped` 不在其中。
5. 只允许 canary 分支写入 Rust 缓存，PR 只读取。避免大量 PR 缓存挤占配额、互相覆盖，同时防止不可信 PR 污染缓存。
6. 直接插值会把用户可控的标题文本拼进 shell 脚本，构成脚本注入；通过环境变量传入后，shell 将其作为数据而非代码处理。
7. `pull_request_target` 在基础仓库上下文中运行并拥有写权限与 secrets，若 checkout 并执行 PR 代码将导致提权。这里默认检出基础分支，labeler 只读取改动文件列表，且 permissions 仅为 `contents: read` 和 `pull-requests: write`。
8. `prepare-release` 用 jq 生成 `DESKTOP_MATRIX` 等 JSON 字符串写入 `GITHUB_OUTPUT`，`prepare` job 将其作为 outputs，`release.yml` 通过 `with: matrix:` 传给 reusable workflow，最终在 `strategy.matrix: ${{ fromJSON(inputs.matrix) }}` 中还原。
9. 为了让主仓库不持有签名私钥、缩小攻击面。`release-desktop-platform.yml` 设置 `AFFINE_UNSIGNED_PACKAGE: '1'`，候选标记为 `unsigned`，由 `release-submit.yml` 派发到 `toeverything/affine-native` 仓库的 `affine-release.yml` 完成后续处理。
10. 不会。上传插件只在检测到 `SENTRY_AUTH_TOKEN` 等环境变量时启用，PR 构建（尤其 fork PR）拿不到这些 secrets。

</details>

## 常见坑与排错

| 现象 | 可能原因 | 解决 |
| --- | --- | --- |
| `typecheck` 或 `check-git-status` 报 "make sure all changes are submitted" | 修改了 GraphQL、i18n、服务端配置定义但未提交生成物 | 本地执行提示中的命令（`yarn affine init && yarn affine gql build && yarn affine i18n build && yarn affine server genconfig`）并提交 |
| `lint` 中 `yarn dedupe --check` 失败 | `yarn.lock` 中存在可合并版本 | 本地 `yarn dedupe` 后提交 |
| `lint` 中 oxfmt 报 `.yarnrc.yml` 格式问题 | 本地 setup 修改了 `.yarnrc.yml` | 不要提交被工具修改的 `.yarnrc.yml` |
| PR Title Lint 失败 | 标题不符合 `type(scope): subject` 或 scope 不在白名单 | 参考 `tools/commitlint/.commitlintrc.json` 的 `scope-enum` |
| fork PR 中 Copilot 测试失败 | 缺少 `TEST_SERVER_CONFIG` secret | 属预期行为，由维护者在主仓库触发 |
| `desktop-test` 在 Ubuntu 上 Electron 无法启动 | AppArmor 限制非特权 user namespace | 参考 workflow 中的 `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` 与 `xvfb-run` |
| `unit-test` 报找不到 `affine.linux-x64-gnu.node` | 上游 `build-native-linux` 失败 | 先排查上游 Rust 构建日志 |
| Rust 构建每次都很慢 | PR 不写缓存，只能读取 canary 缓存；或 `Cargo.lock` 变化导致缓存失效 | 属预期；本地可用 `sccache` 等工具 |
| Windows 构建路径过长或磁盘不足 | 默认 C 盘性能与空间问题 | workflow 已使用 Dev Drive；自建 runner 时参考 |
| CodeSandbox 启动失败 | `.codesandbox/task.json` 中 `yarn dev-core` 脚本已不存在 | 改为 `yarn dev` |

## 延伸阅读

- GitHub Docs：Workflow syntax、Reusing workflows、Creating a composite action、Security hardening for GitHub Actions（脚本注入、`pull_request_target`）。
- `dorny/paths-filter`、`Swatinem/rust-cache`、`docker/build-push-action` 的 README。
- actionlint 文档（规则与配置文件）。
- Conventional Commits 规范与 commitlint。
- Renovate 文档：packageRules、customManagers。
- Render Blueprint（`render.yaml`）规范。
- 本书第 4 章（分支与发布节奏）、第 25 章（测试体系）、第 27 章（镜像与部署）、第 28 章（供应链安全）。

## 学时拆分

| 内容 | 建议时长 |
| --- | --- |
| 26.1–26.2 Actions 基础与 build-test 总览 | 0.75 小时 |
| 26.3–26.8 DAG、静态检查、路径过滤、原生构建、测试、test-done | 2 小时 |
| 26.9 复合 Action | 0.75 小时 |
| 26.10–26.12 PR 辅助、发布链路、Sentry 签名版本 | 1 小时 |
| 26.13–26.14 周边配置与取舍 | 0.5 小时 |
| 动手实践与自测 | 1 小时 |
| **合计** | **6 小时** |

---
上一章：[第 25 章 测试体系](../08-质量保障/25-测试体系.md) ｜ 下一章：[第 27 章 部署与运维](./27-部署与运维.md) ｜ [返回目录](../README.md)
