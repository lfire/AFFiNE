# `@blocksuite/affine-gfx-link`

> 一句话定位：白板上的**链接元素**入口层——它是 gfx 包里最"轻"的一个，不定义任何图形模型/渲染器，而是往 edgeless 工具栏注册一个"链接"快捷工具：点击后拉起全局快速搜索（Quick Search），让用户把一个**已有文档链接**或**外部 URL** 以卡片形式（书签 / 内嵌文档 / iframe 嵌入）插到画布上，并按编辑器偏好选择卡片形态。

| 项        | 值                                                                                                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/link`                                                                                                                                                                                                                                                                                |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                             |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                               |
| 关键依赖  | `@blocksuite/affine-widget-edgeless-toolbar`（`QuickToolExtension`/`QuickToolMixin`）、`@blocksuite/affine-block-bookmark`（`insertLinkByQuickSearchCommand`）、`@blocksuite/affine-block-embed`（`insertEmbedCard`/iframe）、`@blocksuite/affine-block-surface`（`DefaultTool`）、`@blocksuite/std`、`lit` |
| 被谁依赖  | edgeless 编辑器预设（通过 `LinkViewExtension` 注册）                                                                                                                                                                                                                                                        |
| 对外入口  | `.`（空导出）、`./view`（`LinkViewExtension`）                                                                                                                                                                                                                                                              |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置：一个"反例"

前面三个包（brush/connector/group）都严格走 gfx 五件套：ElementModel + Tool + element-renderer + 交互扩展 + 注册。**本包几乎什么都没有**——没有 `LinkElementModel`、没有 `element-renderer`、没有 `BaseTool` 子类、`index.ts` 甚至是 `export {}`（空导出，`index.ts:1`）。这恰恰是理解 gfx 范式边界的最好反例：

**"白板上的链接"并不是一种新的 canvas 图元**。AFFiNE 里，画布上的链接最终落地为**已有的块**——书签块（`affine:bookmark`）、内嵌链接文档卡（`affine:embed-linked-doc`）、同步文档卡（`affine:embed-synced-doc`）、或 iframe 嵌入块（`affine:embed-iframe`）。这些块早已由各自的 `affine-block-*` 包实现了模型、渲染、edgeless 布局。所以"链接 gfx 包"**无需再造图元**，它的唯一职责是：**在 edgeless 工具栏放一个按钮，把"插入链接"这件事接起来**。

于是本包的形态是：**一个 `QuickTool`（工具栏快捷工具）+ 一个按钮 Lit 组件 + 复用书签/嵌入块的插入命令**。它是 gfx 层里"组合既有能力"而非"新增图元"的典型。

### 1.2 独有部分：链接元素与跳转

既然不造图元，本包的"独有"就落在**链接的语义分流**上——用户给的一个输入（搜索结果），要根据它是"内部文档"还是"外部 URL"、以及当前编辑器偏好，决定插入哪一种卡片。这段分流逻辑其实在依赖的 `insertLinkByQuickSearchCommand` 里，本包负责触发它并处理失败兜底（弹输入框建书签）与埋点。

## 2. 目录与关键文件

```text
link/src/
├── index.ts        # export {}（空；本包无运行时导出，能力全在 view）
├── view.ts         # LinkViewExtension：edgeless 场景下注册 linkQuickTool
├── link-tool.ts    # linkQuickTool = QuickToolExtension('link', ...)：工具栏快捷工具定义
├── effects.ts      # 注册自定义元素 <edgeless-link-tool-button>
└── toolbar/
    ├── link-tool-button.ts  # EdgelessLinkToolButton：工具栏按钮（点击触发插入）
    └── link-dense-menu.ts   # buildLinkDenseMenu：紧凑工具栏下的菜单项

# 真正的"链接元素"（卡片块）不在本包，而在：
#   affine/blocks/bookmark      —— affine:bookmark + insertLinkByQuickSearchCommand
#   affine/blocks/embed-doc     —— affine:embed-linked-doc / affine:embed-synced-doc
#   affine/blocks/embed         —— affine:embed-iframe + insertEmbedCard
# 工具栏基座在：
#   affine/widgets/edgeless-toolbar —— QuickToolExtension / QuickToolMixin / QuickTool
```

## 3. 实现细节

### 3.1 注册：只在 edgeless 下挂一个快捷工具

`LinkViewExtension`（`view.ts:9`）的 `setup` 只做一件事（`:17-22`）：

```ts
override setup(context: ViewExtensionContext) {
  super.setup(context);
  if (this.isEdgeless(context.scope)) {   // 仅白板场景
    context.register(linkQuickTool);
  }
}
```

`isEdgeless` 守卫保证这个工具只在白板里出现（文档流模式不需要）。`effect()`（`:12`）调 `effects()` 注册按钮自定义元素 `<edgeless-link-tool-button>`（`effects.ts:4`）。

### 3.2 `QuickTool`：工具栏的声明式扩展点

`linkQuickTool`（`link-tool.ts:6`）用 `QuickToolExtension('link', builder)` 定义。`QuickToolExtension`（`widgets/edgeless-toolbar/.../extension/index.ts:41`）本质是个 DI 注册器：

```ts
export const QuickToolExtension = (id, builder): ExtensionType => ({
  setup: di => {
    di.addImpl(QuickToolIdentifier(id), () => builder);
  },
});
```

它把一个 `ToolBuilder<QuickTool>` 注册到带 variant 的 `QuickToolIdentifier(id)` 标识符下。工具栏组件启动时 `getAll(QuickToolIdentifier)` 拿到所有快捷工具并渲染。`builder` 收到 `{ block, gfx, toolbarContainer }`，返回一个 `QuickTool`：`content`（按钮模板）+ `menu`（紧凑模式下的菜单项）。本包的 builder（`link-tool.ts:7-12`）返回按钮模板 `<edgeless-link-tool-button>` 和 `buildLinkDenseMenu(block, gfx)`。

这体现了 gfx/工具栏"一切皆 DI 扩展"的一致范式：加一个工具栏按钮不改工具栏源码，只注册一个标识符实现。

### 3.3 插入链接：语义分流与卡片形态选择

点击按钮走 `EdgelessLinkToolButton._onClick`（`toolbar/link-tool-button.ts:22`）：

```ts
const [success, { insertedLinkType }] = this.edgeless.std.command.exec(
  insertLinkByQuickSearchCommand
);
if (!success) {
  /* 回退：弹输入框建书签 */
}
```

核心命令 `insertLinkByQuickSearchCommand`（来自 `affine-block-bookmark`，`insert-link-by-quick-search.ts:17`）是链接语义分流的中枢：

1. 取 `QuickSearchProvider`，`openQuickSearch()` 拉起全局搜索浮层，返回一个 `Promise<result>`。
2. **结果是内部文档**（`'docId' in result`，`:33`）：默认插 `affine:embed-linked-doc`（链接卡）；但若当前是 edgeless 且用户设置了 `docCanvasPreferView`（如偏好"同步视图"），则改用 `affine:embed-synced-doc`——于是走 `insertEmbedLinkedDocCommand` 或 `insertEmbedSyncedDocCommand`（`:42-50`）。
3. **结果是外部 URL**（`'externalUrl' in result`，`:58`）：用命令链 `.try([iframe, bookmark])` **优先尝试 iframe 嵌入块**（能嵌则嵌，如 YouTube/Figma），失败回退到普通书签卡（`:60-68`）——这正是 std 命令链 `try` "取第一个成功分支"语义的实际应用。
4. 返回 `{ flavour }` 供上层埋点。

回到按钮：若 `insertLinkByQuickSearchCommand` 整体失败（如没有 QuickSearch 服务），`_onClick` 回退到 `toggleEmbedCardCreateModal`（`link-tool-button.ts:29`）弹一个"粘贴 URL"的输入框，保存时用 `insertEmbedCard` 建书签块。成功后用 `insertedLinkType.then(...)` 做遥测埋点（`CanvasElementAdded`/`LinkedDocCreated`，`:53-78`）。

### 3.4 "跳转"在哪

本包不处理链接的**点击跳转**——那由插入的卡片块自己负责。书签块点击打开外链、内嵌文档卡点击跳转到对应 doc，都是 `affine-block-bookmark`/`affine-block-embed-doc` 的行为。本包只管"把正确形态的卡片放到画布上"，跳转交给卡片块。这是职责分离：**gfx-link 是"创建入口"，卡片块是"承载与跳转"**。

### 3.5 紧凑菜单

当工具栏空间不足进入 dense 模式时，`buildLinkDenseMenu`（`toolbar/link-dense-menu.ts:7`）提供一个 `menu.action`（名为 `Link`、带 `LinkIcon`），`select` 回调同样执行 `insertLinkByQuickSearchCommand` 并埋点。与按钮逻辑一致，只是 UI 载体从图标按钮变成菜单项。

## 4. 语法特色

- **`QuickToolExtension(id, builder)` 工厂 + DI variant 标识符**：用 `createIdentifier(...)(id)` 生成带 variant 的标识符，让"每个工具一个 id"成立，工具栏 `getAll` 聚合——与 std 的 `BlockViewIdentifier(flavour)` 同源手法。
- **`QuickToolMixin(LitElement)`**：按钮类用 Mixin 继承工具栏按钮的通用能力（访问 `this.edgeless` 等），再叠加自己的 `render`/`_onClick`——Lit 常见的能力叠加模式。
- **命令链 `.try([...])` 分支短路**：`insertLinkByQuickSearchCommand` 里 `chain().try([iframe, bookmark]).run()` 取第一个成功的插入策略，是 std `CommandManager.try` 语义的教科书用例。
- **`Promise<InsertedLinkType>` 透传**：命令同步返回一个仍在 pending 的 Promise（搜索是异步的），调用方 `.then` 接续埋点——命令体内不 await，保持命令同步签名。
- **结构化联合判别**：用 `'docId' in result` / `'externalUrl' in result` 对搜索结果做类型窄化分流（discriminated by property presence）。
- **`isEdgeless(scope)` 作用域守卫**：按编辑器模式条件注册扩展，同一套扩展体系适配文档/白板两种 scope。

## 5. 设计 / 实现亮点

- **"链接不是新图元，而是复用既有卡片块"**：避免重复造轮子——白板链接直接落到 bookmark/embed 块，渲染、协同、跳转全部复用，本包只做极薄的入口胶水。这是识别"该不该新建 gfx 包"的好范例。
- **多形态自适应**：同一个"插入链接"动作，按"内部文档/外部 URL × 编辑器偏好"自动选 linked-doc / synced-doc / iframe / bookmark 四种卡片，用户无需预先选类型。
- **优雅降级链**：QuickSearch → (iframe 优先 → bookmark 兜底) → 整体失败再弹输入框建书签，每一步都有后备，保证"总能插入一个链接卡"。
- **工具栏的 DI 扩展模型**：加一个工具栏工具只需注册一个标识符实现，零侵入——印证 BlockSuite "一切皆可插拔扩展"的主张。

## 6. 对外 API 与注意事项

- 主要导出：`./view` 的 `LinkViewExtension`（唯一入口）；`.` 为空导出。按钮元素 `<edgeless-link-tool-button>` 由 `effects()` 注册。
- **本包无 ElementModel / renderer / store**：别去找 `LinkElementModel`——白板链接的"元素"是 bookmark/embed 块，模型与渲染在那些块包里。
- **依赖 `QuickSearchProvider`**：没有该服务时，`insertLinkByQuickSearchCommand` 返回失败，按钮会回退到手动输入 URL 的弹窗；菜单项则无兜底。
- **仅 edgeless 注册**：`isEdgeless` 守卫使该工具不出现在文档流模式。
- **卡片形态受 `EditorSettingProvider.docCanvasPreferView` 影响**：同一个链接文档在不同偏好下会插成 linked-doc 或 synced-doc。
- **跳转行为不在本包**：点击链接卡的跳转/打开逻辑属于 bookmark/embed 块。

## 7. 延伸

- 承载块：`@blocksuite/affine-block-bookmark`（书签 + `insertLinkByQuickSearchCommand`）、`@blocksuite/affine-block-embed-doc`（`embed-linked-doc`/`embed-synced-doc`）、`@blocksuite/affine-block-embed`（iframe 嵌入 + `insertEmbedCard`）。对应已有文档 `blocksuite-affine-block-bookmark.md`、`blocksuite-affine-block-embed-doc.md`、`blocksuite-affine-block-embed.md`。
- 工具栏基座：`@blocksuite/affine-widget-edgeless-toolbar`（`QuickToolExtension`/`QuickToolMixin`/`SeniorToolExtension`）。
- 基础设施：`@blocksuite/std` 的 `CommandManager`（`.try` 分支）、DI 标识符工厂；`QuickSearchProvider`/`EditorSettingProvider`/`DocModeProvider`（`affine-shared/services`）。
- 同层 gfx：`brush`/`connector`/`group` 作为"标准 gfx 五件套"的对照，本包是"组合既有能力"的轻量形态。
