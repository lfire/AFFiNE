# AFFiNE 工程图谱 · 分层详解（Engineering Atlas）

> 对 `toeverything/AFFiNE` monorepo 中全部子包与子工程的**逐包深度解析**。
> 基线：v0.27.5（canary）。所有路径以仓库根目录为基准。

本文档集与 `learning-guide/`（35 章系统教程）互补：教程按"主题/能力"组织、循序渐进；**本图谱按"包/工程"组织，逐个拆解**——每个包一篇，讲清它的设计逻辑、实现细节、语法特色与设计亮点。

## 怎么读

阅读顺序**严格自底向上**，体现工程的分层递进：先基础设施（谁都依赖它），再逐层向业务靠拢。每层目录下一个包一篇文档，文件名 = 包名去 `@`、`/` 换 `-`（如 `@toeverything/infra` → `toeverything-infra.md`），保证全局唯一。

```text
L0 工具链与类型基座  →  L1 通用基础设施  →  L2 编辑器内核框架
                                              ↓
L7 管理端与质量  ←  L6 后端服务  ←  L5 多端外壳  ←  L4 前端应用  ←  L3 编辑器业务层
```

依赖方向：**上层依赖下层，下层不反向依赖上层**。L2/L3（BlockSuite）与 L4（前端应用）都建立在 L1（`@toeverything/infra` 等）之上；L5 多端外壳最薄，复用 L4 的 `@affine/core`；L6 后端独立成树，仅通过协议（GraphQL/WebSocket）与前端交互。

## 每篇文档的统一结构

1. **一句话定位**：这个包是什么、解决什么问题
2. **在依赖图中的位置**：被谁依赖、依赖谁
3. **设计逻辑**：为什么这样拆分、核心抽象是什么
4. **目录与关键文件**：入口、核心模块
5. **实现细节**：关键数据结构、算法、流程
6. **语法特色**：用到的 TypeScript / Rust 语法点（装饰器、泛型、trait、宏等）及其作用
7. **设计/实现亮点**：值得学习的巧思
8. **对外 API 与注意事项**

详见 [`TEMPLATE.md`](./TEMPLATE.md)。

---

## 分层包索引（共约 114 个工作区包）

### L0 · 工具链与类型基座 — `tools/*`、`tools/@types/*`

构建、脚手架、提交规范、类型声明底座。所有包的"元层"。

| 包                                                           | 目录                        | 一句话                                                |
| ------------------------------------------------------------ | --------------------------- | ----------------------------------------------------- |
| `@affine-tools/cli`                                          | `tools/cli`                 | 统一开发命令入口 `yarn affine`，注入 SWC 装饰器加载器 |
| `@affine-tools/utils`                                        | `tools/utils`               | CLI 与脚本共享的工作区/路径工具                       |
| `@affine/commitlint-config`                                  | `tools/commitlint`          | Conventional Commits 规则                             |
| `@affine/changelog`                                          | `tools/changelog`           | 变更日志生成                                          |
| `@affine/doc-diff`                                           | `tools/doc-diff`            | 文档快照 diff 工具                                    |
| `@affine/copilot-result`                                     | `tools/copilot-result`      | Copilot 测试结果处理                                  |
| `@affine/playstore-auto-bump`                                | `tools/playstore-auto-bump` | Play Store 版本号自增                                 |
| `@affine/revert-update`                                      | `tools/revert-update`       | 回滚更新脚本工程                                      |
| `@types/affine__env`、`@types/assets`、`@types/build-config` | `tools/@types/*`            | 全局类型声明                                          |

### L1 · 通用基础设施 — `packages/common/*`

跨前后端/跨端复用的底座。本层是全工程的"地基"，尤其 `@toeverything/infra` 与 `nbstore`。

| 包                    | 目录                        | 一句话                                                |
| --------------------- | --------------------------- | ----------------------------------------------------- |
| `@affine/env`         | `packages/common/env`       | 构建期常量 `BUILD_CONFIG` 与运行环境判定              |
| `@affine/debug`       | `packages/common/debug`     | 统一日志/调试开关                                     |
| `@affine/error`       | `packages/common/error`     | 错误类型与用户友好错误                                |
| `@affine/theme`       | `packages/common/theme`     | 设计令牌与 CSS 变量                                   |
| `@affine/auth`        | `packages/common/auth`      | 认证相关共享逻辑                                      |
| `@toeverything/infra` | `packages/common/infra`     | **核心**：DI 容器 Framework、LiveData、ORM、Op Worker |
| `@affine/nbstore`     | `packages/common/nbstore`   | **核心**：文档/Blob/Awareness 的存储与同步引擎        |
| `@affine/graphql`     | `packages/common/graphql`   | GraphQL 客户端 + codegen 产物                         |
| `@affine/realtime`    | `packages/common/realtime`  | 实时通道封装                                          |
| `@affine/reader`      | `packages/common/reader`    | 文档解析/读取                                         |
| `@affine/s3-compat`   | `packages/common/s3-compat` | S3 兼容存储抽象                                       |
| `@affine/native`      | `packages/common/native`    | 前端侧 Rust 原生模块（napi-rs）                       |

### L2 · 编辑器内核框架 — `blocksuite/framework/*`

BlockSuite 自身的"基础设施层"，与具体业务块无关。

| 包                   | 目录                          | 一句话                                          |
| -------------------- | ----------------------------- | ----------------------------------------------- |
| `@blocksuite/global` | `blocksuite/framework/global` | 全局工具、异常、环境                            |
| `@blocksuite/store`  | `blocksuite/framework/store`  | 文档数据层：Yjs 绑定、Block Schema、Transformer |
| `@blocksuite/sync`   | `blocksuite/framework/sync`   | 文档/Blob 同步抽象                              |
| `@blocksuite/std`    | `blocksuite/framework/std`    | 视图、扩展、命令、事件、选择、gfx 基础          |

### L3 · 编辑器业务层 — `blocksuite/affine/*`（约 70 包）

在内核框架之上实现具体的块、图形、行内元素、控件。

- **基座**：`@blocksuite/affine-model`、`-shared`、`-foundation`、`-ext-loader`、`-components`、`-rich-text`、`@blocksuite/data-view`
- **内容块 `blocks/*`（21）**：attachment、bookmark、callout、code、data-view、database、divider、edgeless-text、embed、embed-doc、frame、image、latex、list、note、paragraph、root、surface、surface-ref、table
- **图形 `gfx/*`（11）**：brush、connector、group、link、mindmap、note、pointer、shape、template、text、turbo-renderer
- **行内 `inlines/*`（7）**：comment、footnote、latex、link、mention、preset、reference
- **控件 `widgets/*`（16）**：drag-handle、edgeless-auto-connect、edgeless-dragging-area、edgeless-selected-rect、edgeless-toolbar、edgeless-zoom-toolbar、frame-title、keyboard-toolbar、linked-doc、note-slicer、page-dragging-area、remote-selection、scroll-anchoring、slash-menu、toolbar、viewport-overlay
- **片段 `fragments/*`（4）**：adapter-panel、doc-title、frame-panel、outline
- **聚合**：`@blocksuite/affine`（all）

### L4 · 前端应用框架与业务 — `packages/frontend/*`

把编辑器内核装进真正的产品。

| 包                      | 目录                              | 一句话                                       |
| ----------------------- | --------------------------------- | -------------------------------------------- |
| `@affine/core`          | `packages/frontend/core`          | **核心**：60+ 业务模块、路由、Workbench 总成 |
| `@affine/component`     | `packages/frontend/component`     | 通用 UI 组件库                               |
| `@affine/i18n`          | `packages/frontend/i18n`          | 国际化与 Tolgee 协作                         |
| `@affine/track`         | `packages/frontend/track`         | 埋点/分析                                    |
| `@affine/templates`     | `packages/frontend/templates`     | 内置文档模板                                 |
| `@affine/routes`        | `packages/frontend/routes`        | 路由常量/定义                                |
| `@affine/native`        | `packages/frontend/native`        | 前端原生桥                                   |
| `@affine/electron-api`  | `packages/frontend/electron-api`  | 渲染层调用主进程的类型化桥                   |
| `@affine/mobile-native` | `packages/frontend/mobile-native` | 移动端原生桥（UniFFI 生成）                  |

### L5 · 多端外壳 — `packages/frontend/apps/*`

各平台的入口壳，薄而专一。

| 包                          | 目录                     | 一句话                             |
| --------------------------- | ------------------------ | ---------------------------------- |
| `@affine/web`               | `apps/web`               | Web 入口                           |
| `@affine/electron`          | `apps/electron`          | 桌面主进程（Forge 打包）           |
| `@affine/electron-renderer` | `apps/electron-renderer` | 桌面渲染层入口                     |
| `@affine/ios`               | `apps/ios`               | iOS 壳（Capacitor + Swift + Rust） |
| `@affine/android`           | `apps/android`           | Android 壳                         |
| `@affine/mobile`            | `apps/mobile`            | 移动端 Web 入口                    |
| `@affine/mobile-shared`     | `apps/mobile-shared`     | 移动端共享逻辑                     |

### L6 · 后端服务 — `packages/backend/*`

独立成树，按 Flavor 动态装配。

| 包                      | 目录                      | 一句话                                    |
| ----------------------- | ------------------------- | ----------------------------------------- |
| `@affine/server`        | `packages/backend/server` | NestJS 服务：GraphQL/WS、数据层、业务插件 |
| `@affine/server-native` | `packages/backend/native` | 后端 Rust 核心（权限、存储、搜索等）      |

### L7 · 管理端与质量

| 包               | 目录                      | 一句话                |
| ---------------- | ------------------------- | --------------------- |
| `@affine/admin`  | `packages/frontend/admin` | 自托管管理后台        |
| `@affine-test/*` | `tests/*`                 | 7 套 E2E/集成测试工程 |

---

## 实现进度

- [x] P0 骨架与总览
- [x] P1 L0 工具链（9 篇）
- [x] P2 L1 通用基础设施（12 篇，含 infra/nbstore 深入）
- [x] P3 L2 编辑器内核框架（4 篇）
- [x] P4 L3 编辑器业务层（66 篇：基座 7 + 内容块 20 + gfx 11 + inlines 7 + widgets 16 + fragments 4 + 聚合 1）
- [x] P5 L4 前端应用（9 篇：core 深入 + component/i18n/track/templates/routes/native/electron-api/mobile-native）
- [x] P6 L5 多端外壳（7 篇：web/electron/electron-renderer/mobile/ios/android/mobile-shared）
- [x] P7 L6/L7 后端与质量（5 篇：server 深入 + server-native + admin + test-kit + test-suites）

> 本图谱逐层产出，**八层全部完成（112 篇、约 1.99 万行）**。每篇文档力求忠实源码，路径/类名/宏/trait 均摘自真实代码。
