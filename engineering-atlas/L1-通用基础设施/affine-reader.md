# `@affine/reader`

> 一句话定位：AFFiNE 的**无编辑器文档读取/解析器**——不启动完整 BlockSuite 编辑器，直接从 Yjs 二进制（YDoc）里把一篇文档的块结构、标题、摘要抽出来，并能把块内容转成 Markdown 预览。它让服务端、Worker、索引器等"无 DOM"环境也能理解文档内容。

| 项        | 值                                                                               |
| --------- | -------------------------------------------------------------------------------- |
| 目录      | `packages/common/reader`                                                         |
| 所属层    | L1 · 通用基础设施                                                                |
| 语言/形态 | TypeScript 库（可单独 bundle 成 `./dist`）                                       |
| 关键依赖  | `yjs`、`lodash-es`；peer：`@blocksuite/affine`（schema/adapter/transformer）     |
| 被谁依赖  | `@affine/nbstore`（`crawlDocData` 索引）、后端/Worker 的全文索引与摘要、链接预览 |
| 对外入口  | `.`（源码）、`./dist`（预打包产物）                                              |

## 1. 设计逻辑

AFFiNE 的文档以 BlockSuite 的块模型存在 YDoc 里（`blocks` 这个 `Y.Map`，每块是一个 `Y.Map`，带 `sys:flavour`/`sys:children`/`prop:*` 等字段）。要"读懂"一篇文档，最直接的办法是启动 BlockSuite 编辑器——但这需要完整的浏览器 DOM 环境、代价高、无法在服务端/Worker/索引器里跑。

`@affine/reader` 的立场是：**绕开编辑器，直接在 Yjs 数据结构上解析文档**。它解决的核心问题是"在无 DOM 环境中把 YDoc → 结构化信息（块列表 / 标题 / 摘要 / Markdown）"。典型消费场景：

- **全文索引**：nbstore 的 `crawlDocData`（见 affine-nbstore.md 3.2 的 `crawlDocData?` 接口）调用它抽出每个块的文本与引用，喂给索引器。
- **摘要/预览**：生成文档摘要、链接预览卡片、AI 上下文。
- **导出**：把块转成 Markdown。

**为何可单独 bundle（`./dist`）**：它依赖较重的 `@blocksuite/affine`（schema、MarkdownAdapter、Transformer），但消费方（如后端、Worker）往往不想拉入整个 BlockSuite 构建链。`affine bundle -p @affine/reader` 把它预打包成独立 `dist/index.js`，让这些环境直接用成品、不必自行编译 blocksuite。这是本包 `exports` 同时暴露 `.`（源码）与 `./dist`（产物）的原因。

## 2. 目录与关键文件

```text
packages/common/reader/
├── package.json            # build = affine bundle；peer: @blocksuite/affine；暴露 . 与 ./dist
└── src/
    ├── index.ts            # re-export ./reader
    ├── reader.ts           # 核心（1009 行）：readAllBlocksFromDoc / readAllDocsFromRootDoc / readAllDocIdsFromRootDoc
    ├── bs-store.ts         # getStoreManager()：单例 BlockSuite StoreExtensionManager
    └── doc-parser/
        ├── parser.ts       # parseBlock / parseBlockToMd / parsePageDoc：块树 → ParsedBlock/Markdown
        ├── types.ts        # Flavour 联合、BaseParsedBlock、ParsedDoc 等解析类型
        └── delta-to-md/    # 把 BlockSuite 的 Delta（富文本）转 Markdown
            ├── delta-to-md.ts     # deltaToMd()：通用 delta→md 引擎（移植自 quill-delta-to-markdown 思路）
            ├── delta-converters.ts# 各类 inline/block/embed 的转换规则
            └── utils/node.ts      # 渲染用的轻量树节点
```

## 3. 实现细节

### 3.1 `readAllBlocksFromDoc`：YDoc → 块信息 + 标题 + 摘要

核心入口（`reader.ts:513`）接收一个 `ydoc`（单篇文档）、可选 `rootYDoc`（工作区根文档，用于解析跨文档引用）、`spaceId` 与摘要长度上限，返回 `{ blocks, title, summary }`：

```ts
// 来源：reader.ts:513
export async function readAllBlocksFromDoc({
  ydoc,
  rootYDoc,
  spaceId,
  maxSummaryLength,
}): Promise<
  { blocks: BlockDocumentInfo[]; title: string; summary: string } | undefined
> {
  maxSummaryLength ??= 1000;
  const blocks = ydoc.getMap<any>('blocks'); // BlockSuite 把所有块存在名为 'blocks' 的 Y.Map
  if (blocks.size === 0) return undefined;
  // ...
}
```

解析算法的要点：

- **先建父子映射**（`parentMap`，`reader.ts:549`）：遍历每个块的 `sys:children`，反向记录"子 → 父"，供后续 `nearest` 向上查找。
- **找根块**：扫描 `sys:flavour === 'affine:page'` 的块作为 `rootBlockId`。
- **DFS 遍历 + 防环**：用栈 + `visited: Set` 做深度优先遍历，`pushChildren` 逆序入栈以保持文档顺序（`reader.ts:594`）；`visited` 防止 Yjs 数据损坏导致的环。
- **`nearest`/`nearestByFlavour` 向上查找**（`reader.ts:560`）：对每个块找最近的祖先 note/database 等，用于填充 `parentFlavour`、`additional.noteBlockId` 等上下文。
- 产出 `BlockDocumentInfo[]`：每块含 `blockId`/`flavour`/`content`/`blob`（图片附件引用）/`refDocId`+`ref`（跨文档引用）/`markdownPreview` 等。

### 3.2 从 Yjs 结构里"挖"富文本：`getTextDeltasFromCellValue`

文档的富文本在 Yjs 里以多种形态存在（`Y.Text`、带 `$blocksuite:internal:text$` 标记的 `Y.Map`、已序列化的 delta 数组…）。`getTextDeltasFromCellValue`（`reader.ts:84`）穷举这些形态、统一取出 `DeltaInsert[]`：

```ts
// 来源：reader.ts:84
if (value instanceof YText) return value.toDelta() as DeltaInsert[];
if (value instanceof YMap) {
  const marker = value.get('$blocksuite:internal:text$'); // BlockSuite 内部文本标记
  const delta = value.get('delta');
  if (marker && delta instanceof YArray)
    return delta.toArray().map(e => (e instanceof YMap ? e.toJSON() : e));
  // ...
}
```

这段"脏活"反映了直接读 Yjs 的代价：没有编辑器的抽象，必须手动识别 BlockSuite 的各种内部编码。把它收敛到一个函数里，是对"无编辑器读取"复杂度的集中管理。

### 3.3 跨文档引用收集：`collectInlineReferences`

富文本 delta 里可能有 `reference`（如 `@某文档` 的双链）。`collectInlineReferences`（`reader.ts:61`）从 delta 的 `attributes.reference.pageId` 抽出被引文档 id，`uniqBy` 去重，产出 `{ refDocId, ref }`。这让索引器能建立文档间的引用图谱。

### 3.4 Markdown 预览：借 BlockSuite Transformer 但不启动编辑器

生成 Markdown 预览（`generateMarkdownPreviewBuilder`，`reader.ts:136`）时，reader 复用 BlockSuite 的 `Schema` + `MarkdownAdapter` + `Transformer`，但只做"数据转换"而非"渲染编辑器"：

- 模块加载时注册一次 schema：`blocksuiteSchema.register([...AffineSchemas])`（`reader.ts:31`）。
- `yblockToDraftModal` 把 `Y.Map` 块的 `prop:*` 字段用 `createYProxy` 还原成 BlockSuite 的 `DraftModel`。
- 再经 `MarkdownAdapter` 转 Markdown。
- `bs-store.ts` 提供单例 `StoreExtensionManager`（`getInternalStoreExtensions()`），复用 BlockSuite 的内部 store 扩展而不实例化编辑器。

### 3.5 `doc-parser`：另一条块树 → Markdown 路径

`doc-parser/parser.ts` 提供更结构化的解析：`parseBlock`（块 → `ParsedBlock` 树）、`parseBlockToMd`（块 → Markdown）、`parsePageDoc`（整篇 → `ParsedDoc { title, md, parsedBlock }`）。`types.ts` 用模板字面量类型约束 flavour：

```ts
// 来源：doc-parser/types.ts:14
export type BaseFlavour<T extends string> = `affine:${T}`;
export type Flavour = BaseFlavour<'page' | 'paragraph' | 'list' | 'code' | 'database' | 'table' | ...>;
```

底层富文本转换由 `delta-to-md/` 完成：`deltaToMd(delta, converters)`（`delta-to-md.ts:5`）是一个通用的 delta→Markdown 引擎（思路移植自 quill-delta-to-markdown），遍历 delta ops，按 `converters` 的 `inline`/`block`/`embed` 规则构建一棵轻量 `Node` 树再 `render()`。`delta-converters.ts` 定义具体规则（粗体、链接、代码、嵌入等）。该文件顶部 `@ts-nocheck` 表明这是一段注重运行时正确性的移植代码。

### 3.6 根文档遍历：`readAllDocsFromRootDoc` / `readAllDocIdsFromRootDoc`

工作区的"根文档"（root YDoc）记录了所有子文档的元信息。`readAllDocIdsFromRootDoc`（`reader.ts:983`）从根文档抽出全部子文档 id，`readAllDocsFromRootDoc`（`reader.ts:950`）进一步读出 `WorkspacePage` 元信息（标题、创建时间、是否回收站/收藏、properties）。索引器据此知道"工作区里有哪些文档要爬"。

## 4. 语法特色

- **直接操作 Yjs 共享类型**：大量 `instanceof YText`/`YMap`/`YArray`、`.get('sys:flavour')`、`.toDelta()`、`.toJSON()`——绕过编辑器在 CRDT 原始结构上工作，是本包的根本特色。
- **模板字面量类型约束 flavour**：`BaseFlavour<T> = \`affine:${T}\``，把块类型字符串的前缀约定编译进类型。
- **类型守卫缩小 `unknown`**：`getTextDeltasFromCellValue` 对各种可能的文本编码逐一 `instanceof`/属性探测，安全地从 `unknown` 收窄。
- **`createYProxy` 还原 DraftModel**：用 BlockSuite 的 Y 代理把 Y.Map 字段映射成普通模型对象，复用其 adapter。
- **迭代式 DFS + `visited` 防环**：用显式栈而非递归遍历块树，对损坏/环状数据健壮。
- **`@ts-nocheck` 的务实移植**：delta-to-md 引擎牺牲类型检查换取与成熟算法一致的运行时行为。
- **单例扩展管理器**：`bs-store.ts` 用模块级单例避免重复初始化 BlockSuite store 扩展。

## 5. 设计 / 实现亮点

- **无编辑器读取**：在服务端/Worker/索引器等无 DOM 环境直接解析 YDoc，是全文索引、摘要、预览的使能前提——避免了"为读一篇文档而启动整个编辑器"的巨大开销。
- **可预打包为 `./dist`**：把重依赖 `@blocksuite/affine` 预编译成独立产物，让不想拉 BlockSuite 构建链的消费方（后端）直接用成品。
- **复用 BlockSuite 转换器而非渲染层**：Markdown 预览借 `MarkdownAdapter`/`Transformer` 做纯数据变换，既与编辑器导出结果一致，又不付渲染代价。
- **集中处理 Yjs 编码的脏活**：富文本的多种内部编码被 `getTextDeltasFromCellValue` 一处吸收，上层拿到统一的 delta。
- **构建引用图谱**：`collectInlineReferences` 让索引器能理解文档间双链关系，支撑反向链接/知识图谱。

## 6. 对外 API 与注意事项

- **主要导出**：`readAllBlocksFromDoc({ ydoc, rootYDoc?, spaceId, maxSummaryLength? })`（返回块列表+标题+摘要）、`readAllDocsFromRootDoc`、`readAllDocIdsFromRootDoc`、类型 `BlockDocumentInfo`；doc-parser 侧 `parseBlock`/`parseBlockToMd`/`parsePageDoc` 与 `ParsedDoc` 等类型。
- **使用约定**：输入是**已解码的 YDoc**（调用方负责从 nbstore 的二进制 `applyUpdate` 出 YDoc）；跨文档引用解析需同时传 `rootYDoc`。索引场景经 nbstore 的 `crawlDocData` 间接调用。
- **坑**：
  - 本包**强耦合 BlockSuite 的内部数据约定**（`blocks` map、`sys:*`/`prop:*` 字段、`$blocksuite:internal:text$` 标记）。BlockSuite 升级若改这些编码，reader 需同步跟进——这是"绕过编辑器直读数据"的固有维护成本。
  - 空文档（`blocks.size === 0`）或无 `affine:page` 根块时返回 `undefined`，调用方需处理。
  - 摘要默认截断到 1000 字符（`maxSummaryLength`）。
  - 用 `./dist` 时拿的是打包快照，升级 BlockSuite 后需重新 `affine bundle` 才会反映新行为。

## 7. 延伸

- 同层：`@affine/nbstore`（`crawlDocData` 调用 reader 做索引）。
- 外部：`@blocksuite/affine`（schema / MarkdownAdapter / Transformer / Delta 模型）、Yjs。
- 对应教程：learning-guide 关于"无编辑器文档解析与全文索引"的章节。
