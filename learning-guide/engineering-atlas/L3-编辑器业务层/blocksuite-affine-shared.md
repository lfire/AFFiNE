# `@blocksuite/affine-shared`

> 本包是重点包，运行机制、关键流程和易错点见 [重点包精讲](../重点包精讲/07-blocksuite-affine-shared.md)。

> 一句话定位：AFFiNE 编辑器的**跨块共享工具箱**——把不属于任何单一块、却被所有块共用的东西集中成一个包：各类 services（主题/文档模式/特性开关/工具栏注册/链接预览…）、通用 commands（选区与模型增删改查）、序列化 adapters（Markdown/HTML/PlainText/Notion/剪贴板）、共享 consts/types、以及海量 utils。它是 model 之上、块实现之下的"公共设施层"。

| 项        | 值                                                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/shared`                                                                                                                                                                               |
| 所属层    | L3 · 编辑器业务层（基座）                                                                                                                                                                                |
| 语言/形态 | TypeScript 库                                                                                                                                                                                            |
| 关键依赖  | `@blocksuite/affine-model`、`@blocksuite/std`、`@blocksuite/store`、`@preact/signals-core`、`rxjs`、`lit`、`zod`、`unified`/`mdast`/`micromark`（Markdown）、`rehype`（HTML）、`dompurify`、`ts-pattern` |
| 被谁依赖  | 共 63 个，主要包括 `@blocksuite/affine-foundation`、`@blocksuite/affine-rich-text`、`@blocksuite/data-view`、`@blocksuite/affine-components`、所有 `affine-block-*`、widgets、gfx、inlines、fragments，以及 `@blocksuite/affine`、playground、`@affine/core` |
| 对外入口  | `./services`、`./commands`、`./adapters`、`./selection`、`./utils`、`./consts`、`./types`、`./theme`、`./styles`、`./test-utils`（`.` 为空）                                                             |

## 1. 设计逻辑

块化编辑器里有大量"横切关注点"：主题色怎么解析、当前文档是 page 还是 edgeless、某个特性开没开、选中了哪些 model、怎么把选区复制成 Markdown……这些既不该塞进 `affine-model`（那里只放数据），也不该让每个块各写一份（会漂移、会循环依赖）。

`affine-shared` 的立场是：**做一个"公共设施层"，承接所有跨块共享的服务、命令、适配器与工具**，让块包只依赖它、彼此不互相依赖。它的内容按职责切成多个子入口（`./services`、`./commands`、`./adapters`、`./utils`…），每个都能独立 `import`，兼顾内聚与摇树。

与相邻层的边界很清楚：

- 向下：依赖 `affine-model`（数据定义）与 `@blocksuite/std`（编辑器标准库：命令、选区、扩展机制）。
- 向上：被 `foundation`（装配这些 service/adapter）、`rich-text`、`data-view` 和所有块包消费。
- 分工：model 管"数据是什么"，shared 管"围绕数据的通用能力"，块包管"某种块的具体实现"。

## 2. 目录与关键文件

```text
src/
├── index.ts        # export {}（空；全部经子入口暴露）
├── services/       # ★ 跨块服务（多数是可注入 DI 的 Extension）
│   ├── doc-mode-service.ts        # DocModeProvider：page/edgeless 主模式
│   ├── theme-service.ts           # ThemeProvider/ThemeExtension：主题色解析
│   ├── feature-flag-service.ts    # FeatureFlagService：BlockSuiteFlags 开关
│   ├── toolbar-service/           # 工具栏注册表（action/registry/module/config）
│   ├── link-preview-service/ embed-iframe/ citation-service/ comment-service/
│   ├── font-loader/ user-service/ telemetry-service/ ...
├── commands/       # ★ 通用命令（std Command）
│   ├── block-crud/     # get-selected-blocks / get-next-block / get-block-index ...
│   ├── model-crud/     # get-selected-models / delete / duplicate / copy ...
│   └── selection/      # get-text/block/image/surface-selection ...
├── adapters/       # ★ 序列化适配器：markdown / html / plain-text / notion-html / clipboard / pdf
├── selection/      # 预定义扩展选区：HighlightSelection / ImageSelection
├── consts/         # 跨块常量：EMBED_CARD_WIDTH/HEIGHT、文本常量、括号对...
├── types/          # 共享类型：AffineTextAttributes、NoteChildrenFlavour、uni-component...
├── utils/          # 海量工具：dom / dnd / file / model / reference / url / zod-schema...
├── theme/ styles/  # 主题与样式
└── test-utils/     # 测试辅助
```

## 3. 实现细节

### 3.1 services：接口 + Identifier + Extension 三件套

shared 的服务遵循统一的可注入模式。以 `DocModeService`（`services/doc-mode-service.ts`）为例：

```ts
// 1) 定义能力接口
export interface DocModeProvider {
  setPrimaryMode(mode, docId): void;
  getPrimaryMode(docId): DocMode;
  togglePrimaryMode(docId): DocMode;
  onPrimaryModeChange(handler, docId): Subscription; // rxjs
  setEditorMode(mode): void;
  getEditorMode(): DocMode | null;
}
// 2) 生成 DI 标识符
export const DocModeProvider = createIdentifier<DocModeProvider>(
  'AffineDocModeService'
);
// 3) 默认实现（Extension + static setup 自注册）
export class DocModeService extends Extension implements DocModeProvider {
  static override setup(di: Container) {
    di.addImpl(DocModeProvider, DocModeService);
  }
  // ...用模块级 Map 存状态，用 rxjs Subject 发变更
}
// 4) 覆盖工厂：允许宿主替换实现
export function DocModeExtension(service: DocModeProvider): ExtensionType {
  return {
    setup: di => {
      di.override(DocModeProvider, () => service);
    },
  };
}
```

这套"接口 + 同名 Identifier + Extension 默认实现 + override 工厂"是 shared 服务的通用骨架：块代码只依赖 `DocModeProvider` 接口/标识符，运行时实现可被宿主替换（AFFiNE 主应用常把它接到自己的 LiveData 状态）。

`ThemeService`（`services/theme-service.ts`）类似，暴露 `ThemeProvider`/`ThemeExtensionIdentifier` 两个标识符（`ThemeExtension` 是接口名），用 `signal` 持有 `app$`/`edgeless$` 两套主题，并用 `isInsideEdgelessEditor(host)` 动态选择当前应生效的主题——`theme$` getter 据此在 page/edgeless 间切换。

`FeatureFlagService`（`services/feature-flag-service.ts`）继承 `StoreExtension`（挂在 store 层），用一个 `signal<BlockSuiteFlags>` 持有约二十个布尔开关（`enable_edgeless_text`、`enable_turbo_renderer`…），`setFlag`/`getFlag` 读写——特性开关做成响应式，UI 可随之显隐。

### 3.2 commands：基于 std 命令链的可组合操作

shared 的命令是 `@blocksuite/std` 的 `Command`，特点是**可 pipe 串联、可 tryAll 并联**。`getSelectedModelsCommand`（`commands/model-crud/get-selected-models.ts:39-66`）是经典样例：

```ts
ctx.std.command
  .chain()
  .tryAll(chain => [
    // 并联：四种选区任一成功
    chain.pipe(getTextSelectionCommand),
    chain.pipe(getBlockSelectionsCommand),
    chain.pipe(getImageSelectionsCommand),
    chain.pipe(getSurfaceSelectionCommand),
  ])
  .pipe(getSelectedBlocksCommand, { types, mode }) // 串联：取选中块
  .pipe(ctx => {
    selectedModels.push(...ctx.selectedBlocks.map(el => el.model));
  })
  .run();
next({ selectedModels });
```

`mode` 支持 `all`/`flat`/`highest` 三种"选区→模型"的展开策略（文档注释 `:24-34` 给出直观示例）。README（`commands/README.md`）明确约束：**只放通用命令，块专属命令不许进来**——保持该层的"共享"纯度。

### 3.3 adapters：unified 生态驱动的双向转换

`adapters/` 是最重的子系统，负责文档与各种外部格式的互转。它建立在 `unified` 生态上：Markdown 用 `remark`/`mdast`/`micromark`（含 gfm 表格、脚注、删除线、任务列表等扩展），HTML 用 `rehype`，并用 `dompurify` 净化。每种格式提供一个 `XxxAdapterFactoryExtension`（如 `MarkdownAdapterFactoryExtension`）和一组可注册的 matcher（`BlockMarkdownAdapterMatcher`、`InlineDeltaToMarkdownAdapterMatcher` 等，见 `adapters/index.ts`）。

转换是**块级 + 行内级**双层 matcher：块 matcher 处理块到 AST 节点的映射，inline-delta matcher 处理行内样式（delta）到 AST 的映射。`foundation` 的 store 扩展正是把这些 Factory 注册进去（见 `foundation/src/store.ts`）；剪贴板则由 std 的 `Clipboard` 按 `blocksuite/affine/foundation/src/clipboard.ts` 里的 MIME 优先级表依次调用各 adapter 类。

### 3.4 selection：扩展编辑器的选区种类

`@blocksuite/std` 内置 Block/Text/Surface/Cursor 四种选区，shared 补充了两种业务选区：`HighlightSelection`（高亮/评论定位）与 `ImageSelection`（`selection/index.ts`），各自带一个 `XxxSelectionExtension` 供注册。这样块命令里 `getImageSelectionsCommand` 才能取到图片选区。

### 3.5 consts / types / utils：共享词汇表

- `consts/`（`consts/index.ts`）集中跨块常量，典型是 `EMBED_CARD_WIDTH`/`EMBED_CARD_HEIGHT`——以 `EmbedCardStyle` 为键给每种卡片样式定尺寸（`:23-53`），值引用自 `affine-model`。
- `types/`（`types/index.ts`）定义 `AffineTextAttributes`（bold/italic/link/reference/latex/footnote/mention…，`:48`）这类被 rich-text 和所有文本块共用的核心类型，以及 `NoteChildrenFlavour`、`UniComponent`。
- `utils/`（`utils/index.ts`）汇出三十余个工具域：`dom`、`dnd`（拖拽）、`file`、`model`（`isFixedProperty` 之外的块模型操作 `block-props`/`checker`/`transform-model` 等）、`reference`、`url`、`fractional-indexing`、`zod-schema`、`signal` 等，连 `bytes` 库都重导出成 `formatSize`。

### 3.6 为何主入口为空

`index.ts` 仅 `export {}`。所有能力必须经 `./services`、`./commands` 等子入口导入。配合 `sideEffects: false`，子路径之间能做到"用谁引谁"，不导入 `./adapters` 就不会拉入 Markdown/HTML 解析器；但子路径内部互相引用，`./adapters` 还会转出 `PdfAdapter`（详见 [精讲](../重点包精讲/07-blocksuite-affine-shared.md)）——对一个被所有块依赖的基础包，摇树友好至关重要。

## 4. 语法特色

- **接口与常量同名的 Identifier 技巧**：`export interface DocModeProvider` 与 `export const DocModeProvider = createIdentifier<DocModeProvider>(...)` 同名（`doc-mode-service.ts:11,59`）。TS 的"类型空间/值空间分离"允许同名，调用处既能当类型又能当注入 token，极简洁。
- **`static override setup(di)` 自注册**：服务类用静态 `setup` 把自己绑进 DI 容器（`doc-mode-service.ts:67-69`），`override` 声明它覆写基类 `Extension.setup`。
- **泛型 Command 类型**：`Command<Input, Output>`（`get-selected-models.ts:39-46`）用两个类型参数声明命令的入参扩展与产出，`.pipe` 链在类型层累积上下文。
- **rxjs 与 signal 混用**：服务变更通知有的用 `Subject`/`Subscription`（doc-mode 的 `onPrimaryModeChange`），有的用 `@preact/signals-core` 的 `signal`（theme/feature-flag）——按"事件流"还是"状态值"选型。
- **`as const` 常量列表**：`EMBED_BLOCK_FLAVOUR_LIST`/`CANVAS_EXPORT_IGNORE_TAGS`（`consts/index.ts`）用 `as const` 固化成字面量元组。
- **`Record<K, V>` 键约束**：`EMBED_CARD_WIDTH: Record<EmbedCardStyle, number>`（`consts/index.ts:23`）强制每种卡片样式都必须给出尺寸，漏一个即编译报错。
- **重导出重命名**：`export { getSvgPath as getFigmaSquircleSvgPath }`、`export { default as formatSize } from 'bytes'`（`utils/index.ts`），聚合第三方能力到统一命名空间。

## 5. 设计 / 实现亮点

- **公共设施层消除块间耦合**：把横切能力集中到 shared，使几十个块包形成"都依赖 shared、彼此不依赖"的星形结构，从根上避免循环依赖与能力漂移。
- **服务可替换**：接口 + Identifier + `override` 工厂的组合，让 BlockSuite 的默认实现能被 AFFiNE 主应用无缝替换（如把 DocMode 接到真实的用户设置），框架与产品解耦。
- **命令可组合**：`tryAll` + `pipe` 的命令链把"多选区兜底 + 统一取模型"这类复杂流程写成声明式管线，复用性与可读性俱佳，且严格限定只收通用命令。
- **unified 生态的双层 matcher 适配**：块级/行内级分离的 matcher 设计，让新增一种块的 Markdown/HTML 支持只需补一个 matcher，而非改解析器主干。
- **子入口 + 零副作用主包**：十余个 exports 子路径 + 空主入口 + `sideEffects:false`，把"被所有块依赖"的基础包的体积风险降到最低。

## 6. 对外 API 与注意事项

- 主要导出（按子入口）：`./services`（`DocModeProvider`/`DocModeService`/`DocModeExtension`、`ThemeProvider`/`ThemeService`、`FeatureFlagService`、`ToolbarRegistryExtension` 等）、`./commands`（`getSelectedModelsCommand` 等）、`./adapters`（各 `XxxAdapterFactoryExtension` 与 matcher 标识符）、`./selection`、`./consts`、`./types`、`./utils`。
- **约定**：新增跨块服务照抄"接口 + 同名 Identifier + Extension(static setup) + override 工厂"模式；命令只放通用逻辑（见 `commands/README.md`）；都从子入口导入，勿期待 `.` 主入口有导出。
- **注意**：`DocModeService` 等默认实现用**模块级 `Map`** 存状态（`doc-mode-service.ts:63-64`），是跨实例共享的全局态，测试时需留意；服务既有 rxjs 又有 signal 两种响应式出口，订阅方式不同；adapters 依赖较重（Markdown/HTML 解析器），仅在真正需要导入导出/剪贴板时才引入对应子路径。

## 7. 延伸

- 向下依赖：`@blocksuite/affine-model`（常量/类型来源）、`@blocksuite/std`（Command/Selection/Extension/DI）。
- 向上消费：`@blocksuite/affine-foundation`（把 shared 的 service/adapter/selection 注册进编辑器）、`@blocksuite/affine-rich-text`（用 `AffineTextAttributes`、`blocksuite/affine/shared/src/utils/model/checker.ts` 里的 `matchModels`）、各 `affine-block-*`。
- 对照：L1 `@toeverything/infra` 的 DI 思路——shared 的服务注册用的是 `@blocksuite/std`/`@blocksuite/global` 的 DI（`createIdentifier`/`Container`），与 infra 的 `Framework` 同源异流。
