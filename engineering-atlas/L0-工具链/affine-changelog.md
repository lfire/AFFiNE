# `@affine/changelog`

> 一句话定位：发布流水线里的 **changelog 生成 + Slack 播报器**——直接读取 Git 仓库对象（用 `@napi-rs/simple-git`），从上一个发布点到当前 HEAD 生成 Conventional Commits changelog，额外侦测 BlockSuite 依赖版本变化并生成其子 changelog，最后把 Markdown 渲染成 Slack Block Kit 消息发到频道。

| 项        | 值                                                                               |
| --------- | -------------------------------------------------------------------------------- |
| 目录      | `tools/changelog`                                                                |
| 所属层    | L0 · 工具链与类型基座                                                            |
| 语言/形态 | Node 脚本（ESM，`.js`，`main: index.js`）                                        |
| 关键依赖  | `@napi-rs/simple-git`、`changelogithub`、`@slack/web-api`、`jsx-slack`、`marked` |
| 被谁依赖  | CI 发布流水线（通过一组环境变量驱动）                                            |
| 对外入口  | `index.js`（顶层即执行的脚本）                                                   |

## 1. 设计逻辑

每次 AFFiNE 客户端/服务端发布后，团队需要一份"这次发了什么"的可读变更摘要，并即时推到 Slack 让相关同学知晓。这个脚本把该需求做成一次性的"读 Git → 生成 → 播报"管道，设计上有三个考量：

1. **不依赖 GitHub API 拉提交，而是直接读本地 Git 对象**。用 `@napi-rs/simple-git`（Rust libgit2 的 N-API 绑定）在本地仓库遍历 commit、读取历史版本的文件内容，快且不受 API 限流影响。
2. **跨仓库追踪 BlockSuite 变更**。AFFiNE 以 `@blocksuite/affine` 作为核心编辑器依赖；当这次发布相比上次把该依赖版本 bump 了，用户其实也在吃 BlockSuite 的变更。脚本因此会打开 BlockSuite 仓库、按版本区间再生成一段子 changelog 一并播报。
3. **Markdown → Slack 结构化消息**。Slack 不吃原始 Markdown，脚本用 `marked` + 自定义 renderer + `jsx-slack` 把 Markdown 转成 Block Kit blocks。

整个脚本"顶层即逻辑"——没有导出函数，`import` 即运行，完全由环境变量配置，天然契合 CI step。

## 2. 目录与关键文件

```text
tools/changelog/
├── index.js      # 主流程：读 env → 遍历 Git 生成 changelog → 比对 blocksuite 版本 → 发 Slack
├── markdown.js   # render()：marked 自定义 renderer + jsx-slack，把 Markdown 转 Slack Blocks
└── package.json  # 依赖 simple-git / changelogithub / slack / jsx-slack / marked
```

## 3. 实现细节

### 3.1 输入：一组环境变量

脚本把所有配置从 `process.env` 解构，无命令行参数：

```js
// tools/changelog/index.js
const {
  DEPLOYED_URL,
  NAMESPACE,
  CHANNEL_ID,
  SLACK_BOT_TOKEN,
  PREV_VERSION,
  DEPLOYMENT,
  FLAVOR,
  BLOCKSUITE_REPO_PATH,
} = process.env;
```

`PREV_VERSION` 是上一个发布点（commit 或 tag），`DEPLOYMENT`（`server` 与否）决定消息抬头形态，`CHANNEL_ID`/`SLACK_BOT_TOKEN` 是 Slack 目标与凭据。

### 3.2 遍历 Git 生成 changelog

核心是 `getChangeLog(repo, previousCommit, currentCommit?)`：

- **定位起点**：`repo.findCommit(previousCommit)`，找不到就退回 `findTagByName`——后者用 `repo.tagForeach` 遍历所有 tag，匹配 `refs/tags/v<name>` 后 `findCommit`（返回 `false` 提前终止遍历）。
- **遍历提交**：用 `repo.revWalk()` 从 HEAD（或指定 `currentCommit`）往回走，`setSorting(Sort.Time & Sort.Topological)`，逐个收集 `message`/`body`/`shortHash`/`author`，**遇到起点 commit 即 break**，从而精确截出 `(prev, head]` 区间：

```js
// tools/changelog/index.js（节选）
for (const commitId of revWalk.setSorting(Sort.Time & Sort.Topological)) {
  const commit = repo.findCommit(commitId);
  commits.push({
    message: commit.message(),
    body: commit.body() ?? '',
    shortHash: commit.id().substring(0, 8),
    author: { name: commit.author().name(), email: commit.author().email() },
  });
  if (commitId === prevCommit.id()) break;
}
```

- **交给 changelogithub 解析/渲染**：`resolveConfig` 取配置（含 `GITHUB_TOKEN`），设 `from`/`to`，`parseCommits` 按 Conventional Commits 分类，`resolveAuthors` 补全作者，`generateMarkdown` 产出 Markdown。最后把 `&nbsp;`/`<samp>` 等 HTML 残留清掉，让输出更干净。

### 3.3 侦测 BlockSuite 版本变化

脚本读取当前 `packages/frontend/core/package.json` 里 `@blocksuite/affine` 的版本，再用 Git **读取上一个发布点那一刻同一文件的历史内容**做对比——这正是直接操作 Git 对象的价值所在：

```js
// tools/changelog/index.js（节选）
const previousPkgJsonBlob = prevCommit
  .tree()
  .getPath(pkgJsonPath)
  .toObject(repo)
  .peelToBlob();
const previousPkgJson = JSON.parse(
  Buffer.from(previousPkgJsonBlob.content()).toString('utf8')
);
const previousBlocksuiteVersion =
  previousPkgJson.dependencies['@blocksuite/affine'];
if (blocksuiteVersion !== previousBlocksuiteVersion) {
  const blockSuiteRepo = new Repository(
    BLOCKSUITE_REPO_PATH ?? join(rootDir, '..', 'blocksuite')
  );
  blockSuiteChangelog = await getChangeLog(
    blockSuiteRepo,
    previousBlocksuiteVersion,
    blocksuiteVersion
  );
}
```

`tree().getPath(...).peelToBlob()` 是 libgit2 的"剥壳"操作：从 commit 的树对象按路径取到条目，再层层 peel 到 blob 拿原始字节。于是无需 checkout 旧版本即可读到历史文件。若版本有变，就以两个版本号为区间在 BlockSuite 仓库再跑一遍 `getChangeLog`。

### 3.4 组装消息并发 Slack

抬头按部署类型分叉（server 显示命名空间与部署 URL，客户端显示 `AFFiNE Client <FLAVOR> released`），拼上主 changelog 与（可选的）BlockSuite changelog，经 `render()` 转成 blocks 后 `chat.postMessage`：

```js
// tools/changelog/index.js（尾部）
const { ok } = await slack.chat.postMessage({
  channel: CHANNEL_ID,
  text: `...deployed`,
  blocks: render(changelogMessage),
});
console.assert(ok, 'Failed to send a message to Slack');
```

### 3.5 `markdown.js`：Markdown → Slack Block Kit

`render` 用 `marked` 配一个继承 `Renderer` 的自定义 renderer，把 Markdown 结构重映射到 jsx-slack 的 JSX 文本，再用 `jsxslack` 模板标签解析成 blocks：

```js
// tools/changelog/markdown.js
export const render = markdown => {
  const rendered = marked(markdown, {
    renderer: new (class extends Renderer {
      heading({ tokens }) {
        return `<Fragment><Section><b>${tokens[0].text}</b></Section><Divider /></Fragment>`;
      }
      list(token) {
        return `<Section>${super.list(token)}</Section>`;
      }
      hr() {
        return `<Divider />`;
      }
    })(),
  });
  return jsxslack([`<Blocks>${rendered}</Blocks>`]);
};
```

标题被降级为"加粗 Section + 分隔线"，列表包进 Section，水平线变 Divider——因为 Slack 没有真正的标题级别，只能用这些原子块近似表达层级。

## 4. 语法特色

- **原生 Git 对象图操作**：`revWalk`/`setSorting`/`tagForeach`/`tree().getPath().peelToBlob()` 等是 libgit2 概念的 JS 映射；`Sort.Time & Sort.Topological` 用**位标志按位与**组合排序策略。
- **顶层 `await` 脚本**：ESM 顶层 `await`（`await getChangeLog(...)`、`await slack.chat.postMessage`）让脚本"读即跑"，无需 `main()` 包装。
- **继承内置类覆写方法**：`class extends Renderer` 只重写 `heading`/`list`/`hr`，其余 `super` 透传，是最小侵入的渲染定制。
- **JSDoc 类型标注**：`.js` 文件用 `@param {import('@napi-rs/simple-git').Repository}` 这类 JSDoc 引入外部类型，在不写 TS 的前提下获得类型提示。
- **标签模板**：`jsxslack([...])` 以模板字符串数组作为 JSX 输入，是 jsx-slack 的"无 JSX 构建也能用"的调用形态。

## 5. 设计 / 实现亮点

- **不走 GitHub API 走本地 Git**：用 Rust 绑定的 libgit2 直接读对象，既快又规避限流，还能读任意历史版本文件内容——这是"比对上次发布时的依赖版本"的关键能力。
- **跨仓库变更透明化**：自动把 BlockSuite 依赖 bump 翻译成用户可见的子 changelog，解决"核心能力其实来自子仓库"的信息断层。
- **发布即播报**：生成与分发合一，一个 CI step 完成"算变更 + 推 Slack"，并用 `console.assert` 兜底发送失败。
- **渲染层解耦**：Markdown→Slack 的转换单独放 `markdown.js`，与 `@affine/copilot-result` 共用同一套 renderer 思路（见该文档），复用度高。

## 6. 对外 API 与注意事项

- 本脚本无导出 API，仅以环境变量驱动；缺 `PREV_VERSION` 对应 commit 时会 `console.info` 后 `process.exit(0)` 优雅跳过。
- 依赖**本地存在 AFFiNE 与 BlockSuite 两个 Git 仓库**；BlockSuite 路径默认取 `../blocksuite`，可用 `BLOCKSUITE_REPO_PATH` 覆盖。
- `GITHUB_TOKEN` 影响 `changelogithub` 的作者解析等能力；`SLACK_BOT_TOKEN` 需有目标频道发消息权限。
- 提交信息质量直接决定 changelog 质量——这正是同层 `@affine/commitlint-config` 的意义所在。

## 7. 延伸

- 同层：`@affine/commitlint-config`（规范提交，changelog 的上游约束）、`@affine/copilot-result`（共享 Markdown→Slack 渲染套路）。
- 对应教程：learning-guide 工具链章节《发布流水线：从 Git 历史到 changelog 与播报》。
