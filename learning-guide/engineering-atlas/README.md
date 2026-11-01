# AFFiNE 工程图谱 · 分层详解（Engineering Atlas）

> 对 `toeverything/AFFiNE` monorepo 中全部子包与子工程的**逐包深度解析**。
> 基线：v0.27.5（canary）。所有路径以仓库根目录为基准。

本文档集与 [学习指南](../README.md)（35 章系统教程）互补：教程按"主题/能力"组织、循序渐进；**本图谱按"包/工程"组织，逐个拆解**——每个包一篇，讲清它的设计逻辑、实现细节、语法特色与设计亮点。

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

## 重点包精讲

分层文档对每个包篇幅相近，但少数关键包需要讲得更深。[重点包精讲](./重点包精讲/00-总览.md)按依赖枢纽、体量复杂度、关键链路、范式定义者 4 条标准选出 12 个重点包，说明入选理由，并逐篇深入运行机制、关键流程、设计取舍、易错点和扩展方法。

---

## 分层包索引（共 112 篇，点击包名进入详解）

### L0 · 工具链与类型基座 — `tools/*`、`tools/@types/*`

构建、脚手架、提交规范、类型声明底座。所有包的"元层"。

| 包                                                           | 目录                        | 一句话                                                |
| ------------------------------------------------------------ | --------------------------- | ----------------------------------------------------- |
| [`@affine-tools/cli`](./L0-工具链/affine-tools-cli.md) | `tools/cli`                 | 统一开发命令入口 `yarn affine`，注入 SWC 装饰器加载器 |
| [`@affine-tools/utils`](./L0-工具链/affine-tools-utils.md) | `tools/utils`               | CLI 与脚本共享的工作区/路径工具                       |
| [`@affine/commitlint-config`](./L0-工具链/affine-commitlint-config.md) | `tools/commitlint`          | Conventional Commits 规则                             |
| [`@affine/changelog`](./L0-工具链/affine-changelog.md) | `tools/changelog`           | 变更日志生成                                          |
| [`@affine/doc-diff`](./L0-工具链/affine-doc-diff.md) | `tools/doc-diff`            | 文档快照 diff 工具                                    |
| [`@affine/copilot-result`](./L0-工具链/affine-copilot-result.md) | `tools/copilot-result`      | Copilot 测试结果处理                                  |
| [`@affine/playstore-auto-bump`](./L0-工具链/affine-playstore-auto-bump.md) | `tools/playstore-auto-bump` | Play Store 版本号自增                                 |
| [`@affine/revert-update`](./L0-工具链/affine-revert-update.md) | `tools/revert-update`       | 回滚更新脚本工程                                      |
| [`@types/affine__env`、`@types/assets`、`@types/build-config`](./L0-工具链/types-base.md) | `tools/@types/*`            | 全局类型声明                                          |

### L1 · 通用基础设施 — `packages/common/*`

跨前后端/跨端复用的底座。本层是全工程的"地基"，尤其 `@toeverything/infra` 与 `nbstore`。

| 包                    | 目录                        | 一句话                                                |
| --------------------- | --------------------------- | ----------------------------------------------------- |
| [`@affine/env`](./L1-通用基础设施/affine-env.md) | `packages/common/env`       | 构建期常量 `BUILD_CONFIG` 与运行环境判定              |
| [`@affine/debug`](./L1-通用基础设施/affine-debug.md) | `packages/common/debug`     | 统一日志/调试开关                                     |
| [`@affine/error`](./L1-通用基础设施/affine-error.md) | `packages/common/error`     | 错误类型与用户友好错误                                |
| [`@affine/theme`](./L1-通用基础设施/affine-theme.md) | `packages/common/theme`     | 设计令牌与 CSS 变量                                   |
| [`@affine/auth`](./L1-通用基础设施/affine-auth.md) | `packages/common/auth`      | 认证相关共享逻辑                                      |
| [`@toeverything/infra`](./L1-通用基础设施/toeverything-infra.md) | `packages/common/infra`     | **核心**：DI 容器 Framework、LiveData、ORM、Op Worker |
| [`@affine/nbstore`](./L1-通用基础设施/affine-nbstore.md) | `packages/common/nbstore`   | **核心**：文档/Blob/Awareness 的存储与同步引擎        |
| [`@affine/graphql`](./L1-通用基础设施/affine-graphql.md) | `packages/common/graphql`   | GraphQL 客户端 + codegen 产物                         |
| [`@affine/realtime`](./L1-通用基础设施/affine-realtime.md) | `packages/common/realtime`  | 实时通道封装                                          |
| [`@affine/reader`](./L1-通用基础设施/affine-reader.md) | `packages/common/reader`    | 文档解析/读取                                         |
| [`@affine/s3-compat`](./L1-通用基础设施/affine-s3-compat.md) | `packages/common/s3-compat` | S3 兼容存储抽象                                       |
| [`@affine/native`](./L1-通用基础设施/affine-common-native.md) | `packages/common/native`    | 前端侧 Rust 原生模块（napi-rs）                       |

### L2 · 编辑器内核框架 — `blocksuite/framework/*`

BlockSuite 自身的"基础设施层"，与具体业务块无关。

| 包                   | 目录                          | 一句话                                          |
| -------------------- | ----------------------------- | ----------------------------------------------- |
| [`@blocksuite/global`](./L2-编辑器内核框架/blocksuite-global.md) | `blocksuite/framework/global` | 全局工具、异常、环境                            |
| [`@blocksuite/store`](./L2-编辑器内核框架/blocksuite-store.md) | `blocksuite/framework/store`  | 文档数据层：Yjs 绑定、Block Schema、Transformer |
| [`@blocksuite/sync`](./L2-编辑器内核框架/blocksuite-sync.md) | `blocksuite/framework/sync`   | 文档/Blob 同步抽象                              |
| [`@blocksuite/std`](./L2-编辑器内核框架/blocksuite-std.md) | `blocksuite/framework/std`    | 视图、扩展、命令、事件、选择、gfx 基础          |

### L3 · 编辑器业务层 — `blocksuite/affine/*`（66 包）

在内核框架之上实现具体的块、图形、行内元素、控件。

- **基座（7）**：[`@blocksuite/affine-model`](./L3-编辑器业务层/blocksuite-affine-model.md)、[`-shared`](./L3-编辑器业务层/blocksuite-affine-shared.md)、[`-foundation`](./L3-编辑器业务层/blocksuite-affine-foundation.md)、[`-ext-loader`](./L3-编辑器业务层/blocksuite-affine-ext-loader.md)、[`-components`](./L3-编辑器业务层/blocksuite-affine-components.md)、[`-rich-text`](./L3-编辑器业务层/blocksuite-affine-rich-text.md)、[`@blocksuite/data-view`](./L3-编辑器业务层/blocksuite-data-view.md)
- **内容块 `blocks/*`（20）**：[attachment](./L3-编辑器业务层/blocksuite-affine-block-attachment.md)、[bookmark](./L3-编辑器业务层/blocksuite-affine-block-bookmark.md)、[callout](./L3-编辑器业务层/blocksuite-affine-block-callout.md)、[code](./L3-编辑器业务层/blocksuite-affine-block-code.md)、[data-view](./L3-编辑器业务层/blocksuite-affine-block-data-view.md)、[database](./L3-编辑器业务层/blocksuite-affine-block-database.md)、[divider](./L3-编辑器业务层/blocksuite-affine-block-divider.md)、[edgeless-text](./L3-编辑器业务层/blocksuite-affine-block-edgeless-text.md)、[embed](./L3-编辑器业务层/blocksuite-affine-block-embed.md)、[embed-doc](./L3-编辑器业务层/blocksuite-affine-block-embed-doc.md)、[frame](./L3-编辑器业务层/blocksuite-affine-block-frame.md)、[image](./L3-编辑器业务层/blocksuite-affine-block-image.md)、[latex](./L3-编辑器业务层/blocksuite-affine-block-latex.md)、[list](./L3-编辑器业务层/blocksuite-affine-block-list.md)、[note](./L3-编辑器业务层/blocksuite-affine-block-note.md)、[paragraph](./L3-编辑器业务层/blocksuite-affine-block-paragraph.md)、[root](./L3-编辑器业务层/blocksuite-affine-block-root.md)、[surface](./L3-编辑器业务层/blocksuite-affine-block-surface.md)、[surface-ref](./L3-编辑器业务层/blocksuite-affine-block-surface-ref.md)、[table](./L3-编辑器业务层/blocksuite-affine-block-table.md)
- **图形 `gfx/*`（11）**：[brush](./L3-编辑器业务层/blocksuite-affine-gfx-brush.md)、[connector](./L3-编辑器业务层/blocksuite-affine-gfx-connector.md)、[group](./L3-编辑器业务层/blocksuite-affine-gfx-group.md)、[link](./L3-编辑器业务层/blocksuite-affine-gfx-link.md)、[mindmap](./L3-编辑器业务层/blocksuite-affine-gfx-mindmap.md)、[note](./L3-编辑器业务层/blocksuite-affine-gfx-note.md)、[pointer](./L3-编辑器业务层/blocksuite-affine-gfx-pointer.md)、[shape](./L3-编辑器业务层/blocksuite-affine-gfx-shape.md)、[template](./L3-编辑器业务层/blocksuite-affine-gfx-template.md)、[text](./L3-编辑器业务层/blocksuite-affine-gfx-text.md)、[turbo-renderer](./L3-编辑器业务层/blocksuite-affine-gfx-turbo-renderer.md)
- **行内 `inlines/*`（7）**：[comment](./L3-编辑器业务层/blocksuite-affine-inline-comment.md)、[footnote](./L3-编辑器业务层/blocksuite-affine-inline-footnote.md)、[latex](./L3-编辑器业务层/blocksuite-affine-inline-latex.md)、[link](./L3-编辑器业务层/blocksuite-affine-inline-link.md)、[mention](./L3-编辑器业务层/blocksuite-affine-inline-mention.md)、[preset](./L3-编辑器业务层/blocksuite-affine-inline-preset.md)、[reference](./L3-编辑器业务层/blocksuite-affine-inline-reference.md)
- **控件 `widgets/*`（16）**：[drag-handle](./L3-编辑器业务层/blocksuite-affine-widget-drag-handle.md)、[edgeless-auto-connect](./L3-编辑器业务层/blocksuite-affine-widget-edgeless-auto-connect.md)、[edgeless-dragging-area](./L3-编辑器业务层/blocksuite-affine-widget-edgeless-dragging-area.md)、[edgeless-selected-rect](./L3-编辑器业务层/blocksuite-affine-widget-edgeless-selected-rect.md)、[edgeless-toolbar](./L3-编辑器业务层/blocksuite-affine-widget-edgeless-toolbar.md)、[edgeless-zoom-toolbar](./L3-编辑器业务层/blocksuite-affine-widget-edgeless-zoom-toolbar.md)、[frame-title](./L3-编辑器业务层/blocksuite-affine-widget-frame-title.md)、[keyboard-toolbar](./L3-编辑器业务层/blocksuite-affine-widget-keyboard-toolbar.md)、[linked-doc](./L3-编辑器业务层/blocksuite-affine-widget-linked-doc.md)、[note-slicer](./L3-编辑器业务层/blocksuite-affine-widget-note-slicer.md)、[page-dragging-area](./L3-编辑器业务层/blocksuite-affine-widget-page-dragging-area.md)、[remote-selection](./L3-编辑器业务层/blocksuite-affine-widget-remote-selection.md)、[scroll-anchoring](./L3-编辑器业务层/blocksuite-affine-widget-scroll-anchoring.md)、[slash-menu](./L3-编辑器业务层/blocksuite-affine-widget-slash-menu.md)、[toolbar](./L3-编辑器业务层/blocksuite-affine-widget-toolbar.md)、[viewport-overlay](./L3-编辑器业务层/blocksuite-affine-widget-viewport-overlay.md)
- **片段 `fragments/*`（4）**：[adapter-panel](./L3-编辑器业务层/blocksuite-affine-fragment-adapter-panel.md)、[doc-title](./L3-编辑器业务层/blocksuite-affine-fragment-doc-title.md)、[frame-panel](./L3-编辑器业务层/blocksuite-affine-fragment-frame-panel.md)、[outline](./L3-编辑器业务层/blocksuite-affine-fragment-outline.md)
- **聚合（1）**：[`@blocksuite/affine`（all）](./L3-编辑器业务层/blocksuite-affine.md)

### L4 · 前端应用框架与业务 — `packages/frontend/*`

把编辑器内核装进真正的产品。

| 包                      | 目录                              | 一句话                                       |
| ----------------------- | --------------------------------- | -------------------------------------------- |
| [`@affine/core`](./L4-前端应用/affine-core.md) | `packages/frontend/core`          | **核心**：60+ 业务模块、路由、Workbench 总成 |
| [`@affine/component`](./L4-前端应用/affine-component.md) | `packages/frontend/component`     | 通用 UI 组件库                               |
| [`@affine/i18n`](./L4-前端应用/affine-i18n.md) | `packages/frontend/i18n`          | 国际化与 Tolgee 协作                         |
| [`@affine/track`](./L4-前端应用/affine-track.md) | `packages/frontend/track`         | 埋点/分析                                    |
| [`@affine/templates`](./L4-前端应用/affine-templates.md) | `packages/frontend/templates`     | 内置文档模板                                 |
| [`@affine/routes`](./L4-前端应用/affine-routes.md) | `packages/frontend/routes`        | 路由常量/定义                                |
| [`@affine/native`](./L4-前端应用/affine-native.md) | `packages/frontend/native`        | 前端原生桥                                   |
| [`@affine/electron-api`](./L4-前端应用/affine-electron-api.md) | `packages/frontend/electron-api`  | 渲染层调用主进程的类型化桥                   |
| [`@affine/mobile-native`](./L4-前端应用/affine-mobile-native.md) | `packages/frontend/mobile-native` | 移动端原生桥（UniFFI 生成）                  |

### L5 · 多端外壳 — `packages/frontend/apps/*`

各平台的入口壳，薄而专一。

| 包                          | 目录                     | 一句话                             |
| --------------------------- | ------------------------ | ---------------------------------- |
| [`@affine/web`](./L5-多端外壳/affine-web.md) | `apps/web`               | Web 入口                           |
| [`@affine/electron`](./L5-多端外壳/affine-electron.md) | `apps/electron`          | 桌面主进程（Forge 打包）           |
| [`@affine/electron-renderer`](./L5-多端外壳/affine-electron-renderer.md) | `apps/electron-renderer` | 桌面渲染层入口                     |
| [`@affine/ios`](./L5-多端外壳/affine-ios.md) | `apps/ios`               | iOS 壳（Capacitor + Swift + Rust） |
| [`@affine/android`](./L5-多端外壳/affine-android.md) | `apps/android`           | Android 壳                         |
| [`@affine/mobile`](./L5-多端外壳/affine-mobile.md) | `apps/mobile`            | 移动端 Web 入口                    |
| [`@affine/mobile-shared`](./L5-多端外壳/affine-mobile-shared.md) | `apps/mobile-shared`     | 移动端共享逻辑                     |

### L6 · 后端服务 — `packages/backend/*`

独立成树，按 Flavor 动态装配。

| 包                      | 目录                      | 一句话                                    |
| ----------------------- | ------------------------- | ----------------------------------------- |
| [`@affine/server`](./L6-后端/affine-server.md) | `packages/backend/server` | NestJS 服务：GraphQL/WS、数据层、业务插件 |
| [`@affine/server-native`](./L6-后端/affine-server-native.md) | `packages/backend/native` | 后端 Rust 核心（权限、存储、搜索等）      |

### L7 · 管理端与质量

| 包               | 目录                      | 一句话                |
| ---------------- | ------------------------- | --------------------- |
| [`@affine/admin`](./L7-管理端与质量/affine-admin.md) | `packages/frontend/admin` | 自托管管理后台        |
| [`@affine-test/kit`](./L7-管理端与质量/affine-test-kit.md) | `tests/kit` | E2E 共享工具包（Playwright fixtures） |
| [`@affine-test/*`](./L7-管理端与质量/affine-test-suites.md) | `tests/*`                 | 7 套 E2E/集成测试工程 |

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
