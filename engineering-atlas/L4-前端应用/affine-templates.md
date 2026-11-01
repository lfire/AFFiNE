# `@affine/templates`

> 一句话定位：AFFiNE 的**内置文档模板仓库**——把 edgeless 画布模板（SWOT、甘特图、看板…）、贴纸（stickers）与 onboarding 引导文档，从 BlockSuite 的 `.snapshot.json`/zip 快照离线构建成可直接 `import` 的 TS 数据模块，供编辑器"从模板新建"使用。

| 项        | 值                                                                                    |
| --------- | ------------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/templates`                                                         |
| 所属层    | L4 · 前端应用                                                                         |
| 语言/形态 | 资源 + 构建脚本（Node ESM）/ 生成的 TS 数据模块                                       |
| 关键依赖  | `jszip`（构建期解压快照）                                                             |
| 被谁依赖  | `@affine/core`（模板列表菜单、quickStart）、编辑器 onboarding                         |
| 对外入口  | `./edgeless`、`./stickers`、`./onboarding.zip`、`./build-edgeless`（见 package.json） |

## 1. 设计逻辑

模板的本质是"一份预制的 BlockSuite 文档快照"。难点在于：快照是编辑器导出的二进制 zip（含 `.snapshot.json` + `assets/` 图片），不能直接被前端 `import`。本包的设计思路是**离线预处理**：

1. **把资产外置、把结构内联**：构建脚本解压每个模板 zip，将 `assets/` 图片拷到 `core/public/static/templates/`（走 HTTP 静态资源），把 `.snapshot.json` 的 block 树里 `props.sourceId` 改写成 `/static/templates/<id><ext>` 的 URL，再连同预览 SVG 一起写成 `edgeless/<name>.json`。
2. **再生成一个聚合 TS 模块**：把所有模板 JSON `import` 进 `edgeless-templates.gen.ts`，按分类组织，并暴露统一的 `builtInTemplates`（`list/categories/search`）查询接口。
3. **贴纸同理但更轻**：`stickers-templates.gen.ts` 直接 import 各 SVG（cover/content 两种），附带 sha256 hash 以便去重/缓存。

**为什么单独成包**：模板是"数据"而非"逻辑"，把它与业务代码隔离，既能独立更新（`postinstall` 自动 `build`），又能让 `@affine/core` 以纯数据依赖的方式消费，避免把一堆大 JSON/SVG 混进业务源码。

## 2. 目录与关键文件

```text
templates/
├── package.json             # exports: ./edgeless ./stickers ./onboarding.zip ./build-edgeless
│                            # postinstall: yarn build（装包即重建生成物）
├── build-edgeless.mjs       # 解压 edgeless-snapshot/*.zip → 写 edgeless/*.json + 拷 assets → 生成 .gen.ts
├── build-stickers.mjs       # 遍历 stickers/<category>/{Cover,Content}/*.svg → 生成 stickers .gen.ts
├── edgeless-snapshot/       # 原始素材：Brainstorming / Marketing / Presentation / Project Management 下的 .zip + .svg 预览
├── edgeless/                # 【生成物】每模板一个 { name, type, preview(svg), content(snapshot) } JSON
├── edgeless-templates.gen.ts# 【生成物】import 所有 edgeless JSON + builtInTemplates 查询接口
├── stickers/                # 原始贴纸 SVG（按 category 分 Cover/Content）
├── stickers-templates.gen.ts# 【生成物，约 80KB】import 所有贴纸 SVG + builtInTemplates
└── onboarding/onboarding.zip# 引导文档快照（整体 zip 直接作为资源导出）
```

## 3. 实现细节

### 3.1 生成物的数据形态（`edgeless/<name>.json`）

每个 edgeless 模板是一份带预览图与完整 BlockSuite 快照的 JSON：

```jsonc
// 来源：edgeless/SWOT.json（节选）
{
  "name": "SWOT",
  "type": "template",
  "preview": "<svg width=\"135\" height=\"80\" ...>...</svg>",
  "content": {
    "type": "page",
    "meta": { "id": "page:izwljA6s_q", "title": "BlockSuite Playground", ... },
    "blocks": {
      "type": "block", "flavour": "affine:page",
      "props": { "title": { "$blocksuite:internal:text$": true, "delta": [...] } },
      "children": [ { "flavour": "affine:note", "props": { "xywh": "[...]", "background": "--affine-tag-purple" }, ... } ]
    }
  }
}
```

`content` 即 BlockSuite 的页面快照：block 树以 `flavour`（`affine:page`/`affine:note`/…）标识类型，富文本以 `{ "$blocksuite:internal:text$": true, "delta": [...] }` 编码，edgeless 元素带 `xywh` 坐标与 `background` token。

### 3.2 `build-edgeless.mjs`：快照 → 数据模块

关键步骤（`parseSnapshot` + `buildScript`）：

- **分类遍历**：`getZipFilesInCategroies()` 把 `edgeless-snapshot/` 下每个分类目录里的 `.zip` 列出。
- **解压分流**：用 `JSZip.loadAsync` 解压，忽略 `__MACOSX`，把 `assets/` 内文件归一类、`.snapshot.json` 归另一类。
- **资产外置**：资产写入 `core/public/static/templates/`，并记录 `sourceId → 扩展名` 映射 `assetsExtentionMap`。
- **改写 sourceId**：`convertSourceId(block, map)` 递归遍历 block 树，把 `block.props.sourceId` 改写为 `${ASSETS_PREFIX}/${sourceId}${ext}`（`ASSETS_PREFIX = /static/templates`）——让模板引用的图片变成运行时可取的 HTTP URL。

```js
// 来源：build-edgeless.mjs
const convertSourceId = (block, assetsExtMap) => {
  if (block.props?.sourceId) {
    const extname = assetsExtMap[block.props.sourceId];
    block.props.sourceId = `${ASSETS_PREFIX}/${block.props.sourceId}${extname ?? ''}`;
  }
  block.children?.forEach(b => convertSourceId(b, assetsExtMap));
};
```

- **预览 SVG 内联**：读同名 `.svg` 预览，压掉换行/空白并把 `fill="white"` 换成 `fill="currentColor"`（随主题变色），存进模板的 `preview` 字段。
- **代码生成**：`buildScript` 根据 `toVariableName`（把文件名里的数字转英文单词、首字母大写拼驼峰，如 `4P Marketing Matrix` → `FourPMarketingMatrix`）生成 import 语句与 `templates` 分类对象，最终写出 `edgeless-templates.gen.ts`。

### 3.3 统一查询接口 `builtInTemplates`

两个生成物都导出同形状的 `builtInTemplates`（`list/categories/search` 均为 async）：

```ts
// 来源：edgeless-templates.gen.ts（生成物）
export const builtInTemplates = {
  list: async category => templates[category] ?? [],
  categories: async () => Object.keys(templates),
  search: async query => {
    // 用最长公共子序列：query 作为 name 的子序列即命中（容错的模糊搜索）
    const candidates = [];
    for (const cate of Object.keys(templates))
      for (const temp of templates[cate])
        if (lcs(query.toLowerCase(), temp.name.toLowerCase()) === query.length)
          candidates.push(temp);
    return candidates;
  },
};
```

`search` 用一个标准 DP 实现的最长公共子序列 `lcs`：当 `lcs(query, name) === query.length`（即 query 是 name 的子序列）判为命中——比全等匹配宽松、比正则简单，适合模板名的模糊检索。

### 3.4 `build-stickers.mjs`：贴纸生成

遍历 `stickers/<category>/Cover` 与 `Content` 下成对 SVG，用 `Intl.Collator({numeric:true})` 自然排序（`arrow-2` 在 `arrow-10` 前），对每个贴纸算 `sha256` 并把 base64 的 `+//` 替换成 URL-safe 的 `-_`，生成形如 `buildStickerTemplate({ name, cover, content, hash })` 的条目。生成文件顶部带 `/* oxlint-disable */ // @ts-nocheck`（纯数据，跳过 lint/类型检查）。

### 3.5 onboarding

`onboarding/onboarding.zip` 是整份引导工作区的快照 zip，直接作为 `./onboarding.zip` 资源导出，由 `@affine/core` 在首次启动时用 BlockSuite 的 `ZipTransformer` 导入（更新方式见 README：开发态把 `ZipTransformer` 挂到 window，用脚本 `exportPages` 重新导出）。

## 4. 语法特色

- **构建期代码生成（codegen）**：产物 `.gen.ts` 不是手写而是由 `.mjs` 拼字符串 `fs.writeFile` 出来的——"数据即代码"，让大 JSON/SVG 以 ES module `import` 的形式被打包器静态分析与摇树。
- **Node ESM + 顶层 `await`**：脚本是 `.mjs`，`const templatesInGroup = await parseSnapshot()` 直接在模块顶层 await，无需包 IIFE。
- **JSDoc 类型标注 JS**：`build-edgeless.mjs` 用 `@typedef {object} Block` + `@param {Block}` 给纯 JS 加弱类型提示（无 TS 却有类型意图）。
- **递归树遍历改写**：`convertSourceId` 对 block 树递归下钻改写资产引用，是处理 BlockSuite 嵌套快照的通用姿势。
- **`@ts-nocheck`/`oxlint-disable` 头**：生成的大数据模块显式关闭类型检查与 lint，避免 80KB 生成文件拖慢工具链。
- **URL-safe base64**：`JSON.stringify(hash).replace(/\+/g,'-').replace(/\//g,'_')` 把 sha256 base64 变成可用于 URL/文件名的形式。

## 5. 设计 / 实现亮点

- **资产外置 + 结构内联**：把图片放 HTTP 静态目录、把结构与 sourceId URL 内联进 JSON，兼顾包体积与运行时可取性，是处理"带二进制资产的快照"的干净方案。
- **构建即数据管道**：`postinstall → build` 让模板随依赖安装自动重建，源素材（zip/svg）与消费数据（.gen.ts）解耦，更新模板无需改业务代码。
- **统一 `builtInTemplates` 抽象**：edgeless 与 stickers 两类异构资源对外提供同一套 `list/categories/search`，消费端无需区分。
- **子序列模糊搜索**：用 LCS 实现轻量容错搜索，既不像全等那样死板，又比引入搜索库廉价。
- **预览图主题自适应**：把预览 SVG 的 `fill="white"` 改成 `currentColor`，让模板缩略图跟随明暗主题，细节到位。

## 6. 对外 API 与注意事项

- 消费：`import { builtInTemplates } from '@affine/templates/edgeless'`（或 `/stickers`），调用 `categories()/list(cate)/search(q)`。
- onboarding：`import onboardingUrl from '@affine/templates/onboarding.zip'`，交给 BlockSuite `ZipTransformer` 导入。
- **生成物勿手改**：`edgeless/*.json`、`*-templates.gen.ts` 都是构建产物；改模板要动 `edgeless-snapshot/`/`stickers/` 素材后重跑 `yarn build`。
- 资产依赖路径：edgeless 模板图片依赖 `core/public/static/templates/`，构建脚本会写入该目录——脱离 `@affine/core` 的目录结构运行会找不到资产落点。
- `search` 的 `query` 是"子序列"语义而非全文，命中规则见 §3.3。

## 7. 延伸

- 数据格式来源：BlockSuite 快照 / `ZipTransformer`（`@blocksuite/affine`）。
- 消费方：`@affine/core` 的模板菜单、`quickStart`（见 affine-track.md 的 `quickStart`/`openTemplateListMenu` 事件）。
- 构建期依赖：`jszip`。
