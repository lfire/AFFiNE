# `@affine/copilot-result`

> 一句话定位：CI 里的 **Copilot 测试结果 Slack 播报器**——把一次 AFFiNE Copilot（AI 能力）自动化测试的成败结果，连同分支/提交链接，渲染成 Slack Block Kit 消息发到指定频道。是 `@affine/changelog` 的"轻量同胞"，共享同一套 Markdown→Slack 渲染方案。

| 项        | 值                                           |
| --------- | -------------------------------------------- |
| 目录      | `tools/copilot-result`                       |
| 所属层    | L0 · 工具链与类型基座                        |
| 语言/形态 | Node 脚本（ESM，`.js`，`main: index.js`）    |
| 关键依赖  | `@slack/web-api`、`jsx-slack`、`marked`      |
| 被谁依赖  | CI 的 Copilot 测试流水线（通过环境变量驱动） |
| 对外入口  | `index.js`（顶层即执行）                     |

## 1. 设计逻辑

AFFiNE 的 Copilot（AI 问答/生成）有一套端到端自动化测试在 CI 跑。团队希望每次跑完无论成败都能即时在 Slack 看到结果与对应的代码位置（分支或 commit），方便快速跟进回归。

这个需求本质上和"发布后播报 changelog"是同一类——**"把一段 Markdown 结果推到 Slack"**，因此本包做得极薄：只负责"读结果 → 拼一小段 Markdown → 发 Slack"，并直接复用与 `@affine/changelog` 完全一致的 `markdown.js` 渲染器。它刻意不做结果判定/聚合（那是测试框架与 CI 的职责），只做"最后一公里"的通知。

设计取舍很清晰：**单一职责 + 零配置源码 + 环境变量驱动**，一个 CI step 即可挂载。

## 2. 目录与关键文件

```text
tools/copilot-result/
├── index.js      # 主流程：读 env → 拼 Markdown → render → chat.postMessage
├── markdown.js   # render()：与 @affine/changelog 相同的 marked + jsx-slack 渲染器
└── package.json  # 依赖 @slack/web-api / jsx-slack / marked
```

## 3. 实现细节

### 3.1 全部主流程

`index.js` 从头到尾就是一次"读变量 → 渲染 → 发送"，无函数封装、无分支：

```js
// tools/copilot-result/index.js
import { WebClient } from '@slack/web-api';
import { render } from './markdown.js';

const { CHANNEL_ID, SLACK_BOT_TOKEN, COPILOT_RESULT, BRANCH_SHA, BRANCH_NAME } =
  process.env;

const { ok } = await new WebClient(SLACK_BOT_TOKEN).chat.postMessage({
  channel: CHANNEL_ID,
  text: `AFFiNE Copilot Test ${COPILOT_RESULT}`,
  blocks: render(
    `# AFFiNE Copilot Test ${COPILOT_RESULT}

- [${BRANCH_NAME?.replace('refs/heads/', '') || BRANCH_SHA}](https://github.com/toeverything/AFFiNE/commit/${BRANCH_SHA})
`
  ),
});

console.assert(ok, 'Failed to send a message to Slack');
```

要点：

- **输入全来自环境变量**：`COPILOT_RESULT`（结果文案，如 `Passed`/`Failed`）、`BRANCH_SHA`/`BRANCH_NAME`（代码位置）、`CHANNEL_ID`/`SLACK_BOT_TOKEN`（Slack 目标与凭据）。
- **Markdown 现拼现发**：标题行放结果，列表项放一个指向该 commit 的 GitHub 链接。`BRANCH_NAME?.replace('refs/heads/', '')` 把 ref 全名裁成短分支名，取不到则回退到 `BRANCH_SHA`——用可选链 + `||` 做优雅降级。
- **`text` 与 `blocks` 并存**：`text` 作为通知预览/无富文本客户端的回退，`blocks` 是真正渲染的结构化内容。
- **`console.assert` 兜底**：发送失败不抛异常，只断言告警，避免 CI 因通知失败而误判主流程。

### 3.2 `markdown.js`：与 changelog 同款渲染器

渲染逻辑与 `@affine/changelog/markdown.js` 一字不差——`marked` 配自定义 `Renderer`，把标题转成"加粗 Section + Divider"、列表包进 Section、水平线转 Divider，最后 `jsxslack` 包成 `<Blocks>`：

```js
// tools/copilot-result/markdown.js
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

两处保持同款是刻意的：Slack 消息外观统一，且维护者改渲染规则时心智一致（代价是这段代码在两个包各存一份，属可接受的"小重复换零耦合"）。

## 4. 语法特色

- **顶层 `await`**：`await new WebClient(...).chat.postMessage(...)`，ESM 脚本直接执行，无需 `main()`。
- **可选链 + 短路回退**：`BRANCH_NAME?.replace(...) || BRANCH_SHA` 一行表达"有分支名用分支名、否则用 SHA"。
- **模板字符串拼 Markdown**：用多行模板直接写 Markdown，再交给渲染层，是"数据与展示分离"的最小实现。
- **继承 `marked.Renderer` 覆写法**：只重写 `heading`/`list`/`hr`，`super.list` 透传其余，最小侵入定制。
- **标签模板 `jsxslack([...])`**：无 JSX 构建环境也能生成 Block Kit。

## 5. 设计 / 实现亮点

- **极致单一职责**：整个包不到 20 行主逻辑，只做"通知"，边界干净、几乎无维护负担。
- **渲染方案复用**：与 `@affine/changelog` 共享同款 Markdown→Slack 套路，Slack 消息风格在不同通知间保持一致。
- **失败不阻断**：用 `console.assert` 而非 `throw`，把"通知失败"与"被通知的任务成败"解耦，CI 更稳健。
- **代码位置可追溯**：消息里直接给出指向 commit 的 GitHub 链接，收到通知即可一键定位。

## 6. 对外 API 与注意事项

- 无导出 API，纯环境变量驱动的一次性脚本。
- 必备变量：`SLACK_BOT_TOKEN`、`CHANNEL_ID`、`COPILOT_RESULT`、`BRANCH_SHA`（`BRANCH_NAME` 可选）。缺失不会报错，但会发出"内容残缺"的消息，需在 CI 侧保证注入。
- 链接固定指向 `toeverything/AFFiNE` 仓库的 commit 路径。
- 与 `@affine/changelog` 的 `markdown.js` 是两份独立副本，改渲染规则时注意两边同步。

## 7. 延伸

- 同层：`@affine/changelog`（同款渲染器、同类"推 Slack"职责，但面向发布 changelog）。
- 对应教程：learning-guide 工具链章节《CI 结果通知与 Slack 消息渲染》。
