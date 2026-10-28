# 学习演示（交互式学习模块）编写规范

> 本文件仅供编写者参考，不随站点发布（以 `_` 开头会被忽略）。
> 每章一套学习演示：`slides/decks/NN.md`（NN 为两位章号），在线地址 `/slides/NN.html`。
> 渲染引擎是自研的「场景式学习演示」`LearningDeck.vue`，**不是** reveal.js。
> 目标：吃透章节文档后**重新组织**为一套利于学习的交互演示——内容充实、讲解到位、图文并茂，而不是把 Markdown 要点拆成一页页 bullet。

## 0. 与旧版幻灯片的根本区别

| 维度 | 旧版（已废弃） | 新版（本规范） |
| --- | --- | --- |
| 单元 | 定高 1280×720 幻灯片 | **自适应高度的「场景」**，内容多时场景内部可滚动 |
| 内容 | 要点 bullet | **成段讲解 + 富组件**：卡片、标注代码、对比、步骤、时间线、数据块、自测 |
| 导航 | 仅左右翻页 | 左侧**场景目录**可跳转 + 键盘 + 进度；支持深链接 `#scene-3` |
| 交互 | fragment 分步 | 自测题点击揭晓、深入阅读折叠、代码分步高亮 |
| 定位 | 讲者演示 | **自学 + 分享兼顾**，重在"看得懂、学得会" |

## 1. 文件结构

一个 `.md` 文件 = 一套演示，由**场景分隔符**切分为多个场景：

- 分隔符：单独一行 `===`（三个及以上等号，前后各留一个空行）。
- **第 1 个场景**必须以一级标题 `# ` 开头 → 自动识别为**封面**。
- 需要章节过渡页时，在该场景顶部写注释 `<!-- section -->`，其标题用 `## `。
- 其余场景为**内容场景**，以 `## ` 作为场景标题（显示在左侧目录与场景顶部）。

> 封面三行之间**必须各空一行**（否则元信息会被并入引用块）。

```markdown
# 第 12 章 BlockSuite 架构与 Store 数据层

> 自底向上：先看清分层，再吃透存在 Yjs 里的 Block 树

第 5 部分 · 编辑器内核 BlockSuite ｜ 难度 ★★★★☆ ｜ 建议学时 10 小时

===

## 本章要解决的问题
...（内容场景）...

===

<!-- section -->
## 一、分层架构
（章节过渡页，只放一句话导语）

===

## framework 与 affine 两层
...
```

## 2. 一套演示的推荐结构（14–20 个场景）

1. **封面**（1）：章标题 + 一句副标题 + 元信息行。
2. **本章要解决的问题 / 为什么学**（1）：用真实场景或问题切入，讲清价值。
3. **知识地图**（1）：一张 Mermaid 总览图 + 一段导读。
4. **学习目标**（1）：`.goals` 清单。
5. **正文场景**（8–13）：每个核心知识点 1–2 个场景。按 **问题 → 原理 → 源码位置 → 标注代码/图 → 结论** 组织，务必有成段讲解文字，不要只堆 bullet。关键处配架构图或时序图。
6. **动手实践**（1）：`.steps` 列出练习与验收标准。
7. **自测**（1–2）：`.quiz` 点击揭晓答案。
8. **小结与延伸**（1）：`.takeaways` 关键结论 + 下一章预告。

> 内容必须忠实于对应章节文档（`learning-guide/<部分目录>/NN-*.md`）与源码；路径、类名、事件名原样摘取，不得编造。这是**提炼重构**，不是复制整段原文。

## 3. 富组件库（直接写 HTML，class 已在引擎中定义）

> HTML 块与其中的 Markdown 之间**必须空行**，否则 Markdown 不被解析。

### 3.1 导语 / 大字结论
```html
<p class="lead">BlockSuite 是构建编辑器的框架，不是某一个编辑器。</p>
```

### 3.2 卡片网格（2/3 列）
```html
<div class="cards cols-3">
  <div class="card">
    <div class="card__icon">🗂️</div>
    <h4>Workspace</h4>
    <p>一个 Y.Doc，持有若干 Doc 的元信息。</p>
  </div>
  <!-- 更多 card -->
</div>
```

### 3.3 左右分栏（讲解 + 代码/图）
````html
<div class="split">
<div class="split__main">

成段讲解文字，说清**为什么**这么设计……

</div>
<div class="split__aside">

```ts
// 代码或在此放 mermaid
```

</div>
</div>
````

### 3.4 标注代码（带编号说明）
````html
<div class="annotate">

```ts [2|5-7]
export class Store { /* … */ }
```

<ol class="annotate__notes">
  <li><b>第 2 行</b>：说明……</li>
  <li><b>第 5–7 行</b>：说明……</li>
</ol>
</div>
````

### 3.5 对比
```html
<div class="compare">
  <div class="compare__col"><h4>DocCollection（旧）</h4>

- 已废弃
- ……

  </div>
  <div class="compare__col compare__col--good"><h4>Workspace（现）</h4>

- 现用
- ……

  </div>
</div>
```

### 3.6 步骤流 / 时间线
```html
<ol class="steps">
  <li><h4>定义 Schema</h4><p>……</p></li>
  <li><h4>注册扩展</h4><p>……</p></li>
</ol>
```

### 3.7 数据块（关键数字）
```html
<div class="stats">
  <div class="stat"><b>122</b><span>个包</span></div>
  <div class="stat"><b>13.6.21</b><span>锁定的 yjs</span></div>
</div>
```

### 3.8 提示框
```html
<div class="note note--warn">

**易错**：`blocksuite/docs-site/guide` 多处落后于源码。

</div>
```
`note--info`（默认蓝）/ `note--tip`（绿）/ `note--warn`（橙）/ `note--danger`（红）。

### 3.9 自测题（点击揭晓）
```html
<details class="quiz">
<summary>Q1. store.addBlock() 到界面更新经过哪些环节？</summary>

写入 Yjs → observeDeep → SyncController → Signal → Lit 重渲染。

</details>
```

### 3.10 关键结论 / 要点
```html
<ul class="takeaways">
  <li>所有块最终是存在 Yjs 里的一棵 Block 树，视图只是投影。</li>
</ul>
```

### 3.11 行内零件
`<span class="tag">P0</span>`、`<code class="path">packages/common/nbstore</code>`、`<kbd>⌘</kbd>`。

## 4. Mermaid

- ```` ```mermaid ```` 围栏即可，引擎会预渲染并随明暗主题切换。
- 节点文本含 `@ : ( ) [ ] { } " ' #` 等须用引号：`A["@affine/native"]`。
- 不要用 `end`、`graph`、`subgraph`、`class`、`style` 作节点 ID；时序图参与者用简短英文 ID + 中文别名。
- 一个场景最多 1 张大图；复杂流程拆成多张或配步骤说明。
- 写完用 `node scripts/check-mermaid.mjs slides/decks/NN.md` 校验。

## 5. 容量与排版

- 场景标题 `##` ≤ 20 字。
- 每个内容场景聚焦**一个**知识点；信息多就拆成相邻两个场景，不要硬塞。
- 成段讲解优先，列表作为补充；避免整屏仅有 bullet。
- 代码块单块 ≤ 22 行、每行 ≤ 88 字符；超长用标注代码只展示关键行。
- 全部简体中文；路径、标识符保留英文并用行内代码。
- 不需要写"返回文档"链接，引擎会自动提供。
