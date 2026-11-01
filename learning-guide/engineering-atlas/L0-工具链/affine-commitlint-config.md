# `@affine/commitlint-config`

> 一句话定位：AFFiNE 的 **commit message 规范包**——以 Conventional Commits 为基准，额外把"scope"收窄到一份与 monorepo 分层对应的白名单；同时把 commitlint 全家桶的依赖集中在此包，便于 CI 以最小安装体积执行提交校验。

| 项        | 值                                                                  |
| --------- | ------------------------------------------------------------------- |
| 目录      | `tools/commitlint`                                                  |
| 所属层    | L0 · 工具链与类型基座                                               |
| 语言/形态 | 配置包（JSON 规则 + 依赖聚合，无源码）                              |
| 关键依赖  | `@commitlint/cli`、`@commitlint/config-conventional`、`commitlint`  |
| 被谁依赖  | 根工作区的 Git Hook / CI 提交校验流程                               |
| 对外入口  | `.commitlintrc.json`（规则）；`package.json` 仅聚合 devDependencies |

## 1. 设计逻辑

这个包存在的理由有两层，都写在它极简的产物里：

1. **统一提交信息格式**。AFFiNE 用 Conventional Commits（`type(scope): subject`）来驱动 changelog 生成与语义化版本判断（配合同层 `@affine/changelog`）。要让 `feat`/`fix`/`chore` 等类型、以及 scope 的写法在全仓一致，就需要一份可被 commitlint 读取的规则。
2. **压缩 CI 安装体积**。commitlint 全家桶（CLI + 规则集）本身不小。把它们**单独封进一个包**，CI 在"只需要校验提交"的流水线里只安装这一个 workspace 的依赖即可，而不必拉起整个仓库的依赖树——README 原话："so that it can be used in a CI pipeline to minimize the installation time."

因此它是一个"零源码、纯约定"的包：价值全部体现在 `.commitlintrc.json` 的规则与 `package.json` 的依赖边界上。

## 2. 目录与关键文件

```text
tools/commitlint/
├── .commitlintrc.json   # commitlint 规则：extends config-conventional + 自定义 scope-enum 白名单
├── package.json         # 仅聚合 @commitlint/cli、@commitlint/config-conventional、commitlint
└── README.md            # 说明"为什么单独成包"（压缩 CI 安装时间）
```

## 3. 实现细节

全部实现就是一份规则文件：

```jsonc
// tools/commitlint/.commitlintrc.json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "scope-enum": [
      2,
      "always",
      [
        "admin",
        "electron",
        "server",
        "core",
        "web",
        "mobile",
        "ios",
        "android",
        "mobile-native",
        "docs",
        "component",
        "env",
        "graphql",
        "hooks",
        "i18n",
        "native",
        "templates",
        "debug",
        "nbstore",
        "infra",
        "editor",
        "tools",
        "y-octo",
        "client",
      ],
    ],
  },
}
```

关键点：

- **`extends: ["@commitlint/config-conventional"]`**：直接继承社区标准，拿到 `type-enum`（`feat`/`fix`/`docs`/`refactor`/`chore`…）、`subject-empty`、`header-max-length` 等一整套默认规则，自身只做增量定制。
- **`scope-enum` 三元组 `[2, "always", [...]]`**：commitlint 规则的通用形态 `[level, applicable, value]`。
  - `2` = **error 级**（`0` 关闭、`1` warning、`2` error），即 scope 不在白名单直接判失败。
  - `"always"` = 该规则"始终"生效（相对的是 `"never"`，表示取反）。
  - 第三项是**允许的 scope 白名单**，逐项对应 monorepo 的模块/分层：既有产品端（`web`/`mobile`/`ios`/`android`/`electron`/`admin`）、后端（`server`/`graphql`/`nbstore`）、基础层（`infra`/`env`/`core`/`component`/`editor`），也有横切关注点（`i18n`/`docs`/`tools`/`hooks`/`debug`/`templates`）与 Rust 侧（`native`/`mobile-native`/`y-octo`）。

于是一条合法提交形如 `feat(infra): add live data operator`，而 `feat(unknown-scope): ...` 会被判 error。这份白名单实际上是"提交信息可见的 AFFiNE 模块地图"，也是 changelog 分组的基础。

## 4. 语法特色

本包无 TypeScript 源码，其"语法点"在于 commitlint/Conventional Commits 的**声明式配置语义**：

- **规则三元组 `[level, applicable, value]`**：commitlint 所有规则的统一形状；理解 `applicable` 的 `always`/`never` 取反语义是读懂配置的关键。
- **`extends` 组合**：配置以"继承基准 + 覆盖增量"的方式组织，等价于其它生态里的 preset 继承。
- **JSONC**：`.commitlintrc.json` 允许注释（本仓其它工具如 `cli` 用 `jsonc-parser` 处理同类文件）。
- **依赖即边界**：`package.json` 把 commitlint 依赖"圈"在本包，是用"包"这一单位做**依赖隔离/安装优化**的典型手法。

## 5. 设计 / 实现亮点

- **约定即文档**：`scope-enum` 白名单让"本仓有哪些模块、提交该归哪个 scope"一目了然，并通过 CI 强制执行，避免 scope 随意发散导致 changelog 噪声。
- **为 CI 体积而独立成包**：把校验工具与其依赖收进一个最小包，是 monorepo 里"按用途切分安装面"的务实优化。
- **站在社区标准肩上**：只定制 scope、其余全继承 `config-conventional`，维护成本极低且与生态工具（changelogithub 等）天然兼容。

## 6. 对外 API 与注意事项

- 本包不导出代码，交付物是 `.commitlintrc.json`；commitlint 运行时会沿目录向上查找该配置。
- **新增模块/包时需同步扩充 `scope-enum`**，否则该模块的规范提交会被判非法。
- 规则级别是 `2`（error），本地提交若接了 git hook 会直接拦截；排查失败信息应首先核对 `type` 与 `scope` 是否在允许集合内。

## 7. 延伸

- 同层：`@affine/changelog`（消费规范化的提交历史生成 changelog），二者是"写入约束 → 读取产出"的上下游。
- 对应教程：learning-guide 工具链章节《提交规范与自动化 changelog》。
