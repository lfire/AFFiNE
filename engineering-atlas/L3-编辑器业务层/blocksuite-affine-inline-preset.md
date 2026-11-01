# `@blocksuite/affine-inline-preset`

> 一句话定位：AFFiNE 的**行内元素"总装包"**——它一方面定义 bold/italic/underline/strike/code/color/background 这 7 个**基础 marks** 的 InlineSpec（都渲染成同一个 `<affine-text>`），另一方面把这 7 个 mark 与另外 6 个独立成包的行内元素（latex/reference/link/footnote/mention/comment）用 `DefaultInlineManagerExtension` **统一注册成一张 spec 表**，再配齐它们的 Markdown 即时转换规则、格式快捷键（`Mod-b/i/u/e/k`…）、括号/反引号自动配对、格式命令（`toggleBold` 等）与序列化适配器。它是"一段富文本到底支持哪些行内格式"的唯一事实来源。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/inlines/preset`                                                                                                                                                                                                                                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（行内元素集成层）                                                                                                                                                                                                                                                                                                                                        |
| 语言/形态 | TypeScript 库（InlineSpec 集合 + InlineManager + Keymap + Command + Markdown + Adapter）                                                                                                                                                                                                                                                                                   |
| 关键依赖  | 全部 6 个兄弟 inline 包（`affine-inline-latex/reference/link/footnote/mention/comment`）、`@blocksuite/affine-rich-text`（`getInlineEditorByModel`/`focusTextModel`/`clearMarksOnDiscontinuousInput`）、`@blocksuite/std`（`InlineManagerExtension`/`InlineSpecExtension`/`InlineMarkdownExtension`/command）、`@blocksuite/affine-shared`（styles/commands/types）、`zod` |
| 被谁依赖  | `@blocksuite/affine-foundation`、所有含文本的块与编辑器预设（经 `<rich-text>` 消费 `DefaultInlineManager`）                                                                                                                                                                                                                                                                |
| 对外入口  | `.`（inline-spec + default-inline-manager + command + keymap + markdown + adapters）、`./view`（`InlinePresetViewExtension`）、`./store`（`InlinePresetStoreExtension`）                                                                                                                                                                                                   |

## 1. 设计逻辑

### 它在 inline 范式里的位置：范式的"收口处"

前面几篇（footnote/mention/link/reference/latex/comment）各自实现 inline 六要素中**自己那一份** spec/组件/markdown/adapter。但"一段 `<rich-text>` 到底认识哪些行内属性"必须有**唯一**答案——否则 bold 与 reference 的 schema 如何合并？渲染时谁先谁后？`Mod-b` 绑哪个命令？preset 就是把这些散落的碎片**收口**成一个可被 `<rich-text>` 直接消费的 `InlineManager` 的地方：

- **attribute schema（合并）**：`InlineManager.getSchema()`（`std/inline/extensions/inline-manager.ts:62-67`）把表里所有 spec 的 zod schema 用 `z.intersection` 累积成一个总 schema——preset 决定了"进表"的 13 个 spec，也就决定了 `AffineTextAttributes` 运行时校验的全集。
- **渲染组件（优先级）**：`getRenderer()`（`:30-60`）把 spec 列表 `toReversed()` 后分 wrapper / normal 两类，normal 命中即替换、wrapper 命中则层层包裹。preset 里 7 个基础 mark 都复用 `<affine-text>`，复杂元素各用自己的组件。
- **markdown 匹配**：`MarkdownExtensions`（`markdown.ts`）集中注册 bold/italic/strike/underline/code/latex 的即时转换规则。
- **keymap**：`textKeymap`（`keymap/index.ts`）合并"通用光标键 + 括号配对 + 格式快捷键"三组。
- **view/store 注册**：`InlinePresetViewExtension`（manager + 7 spec + markdown）与 `InlinePresetStoreExtension`（adapter 集合）。

一句话：**其余 inline 包是"零件"，preset 是"装配图 + 一批自带的基础零件"。**

### 为什么单独成包，核心抽象是什么

把"基础 marks 定义"与"全体 inline 装配"放进同一个包，是因为二者高度耦合于同一张清单：

1. **基础 marks 不值得各自成包**：bold/italic/underline/strike/code/color/background 的 spec 几乎同构——schema 是 `z.literal(true)`（布尔开关）或 `z.string()`（颜色值），`match` 看属性存在，`renderer` 一律 `<affine-text>`（`inline-spec.ts:12-118`）。它们共享 `<affine-text>` 一个组件（`nodes/affine-text.ts`），用 `affineTextStyles` 把属性翻译成 CSS。为七个近乎相同的东西各开一个包是过度拆分。
2. **装配表需要引用全部 spec**：`DefaultInlineManagerExtension`（`default-inline-manager.ts`）必须 `import` 所有 6 个兄弟包的 spec identifier 才能列表。这个"汇聚点"天然就该和基础 marks 住在一起——它们共同构成"默认行内能力集"。
3. **格式交互也绑在这张表上**：`Mod-b` 要调 `toggleBold`、格式栏要展示哪些按钮、括号配对、`[[` 转内链——这些跨越多个基础 mark 的交互逻辑，放在 preset 里统一维护最自然。

核心抽象因此是 **`InlineManager` 这张"行内能力清单"**，preset 负责填满并配好它的周边（快捷键/命令/markdown/序列化）。

### 与同层边界

preset 位于 inline 子树的**顶点**：它 `dependencies` 里列着全部 6 个兄弟 inline 包（`package.json:15-20`）与 `affine-rich-text`，是 inline 层唯一"向上汇聚"的包。其余 inline 包互不依赖（link 依赖 reference 是个例外，见对应文档），而都被 preset 收拢。再往上，`affine-foundation` / 编辑器预设只需装上 `InlinePresetViewExtension` + `InlinePresetStoreExtension`，就得到完整的行内编辑能力。

## 2. 目录与关键文件

```text
preset/src/
├── index.ts                     # 汇总导出；顶部用 declare type 强制 rich-text/effects 作为类型依赖
├── inline-spec.ts               # ★ 7 个基础 mark 的 InlineSpecExtension + InlineSpecExtensions[] 数组
├── default-inline-manager.ts    # ★ DefaultInlineManagerExtension：13 个 spec identifier 汇成一张表
├── nodes/affine-text.ts         # ★ <affine-text>：7 个基础 mark 共用的渲染组件（affineTextStyles → CSS）
├── markdown.ts                  # ★ MarkdownExtensions：***bold** / *italic* / ~~strike~~ / `code` 等即时转换
├── keymap/
│   ├── index.ts                 # textKeymap = 通用键 + 括号键 + 格式键
│   ├── basic.ts                 # ArrowUp/Down/Escape/Mod-a/Enter 的行内↔块选择切换
│   ├── bracket.ts               # 括号/引号自动配对；[[Selected]] → Linked doc；选中文字反引号转 code
│   └── format.ts                # textFormatKeymap：由 textFormatConfigs 的 hotkey 生成键表
├── command/
│   ├── config.ts                # ★ textFormatConfigs：bold/italic/underline/strike/code/link 的 UI+hotkey+action
│   ├── text-style.ts            # toggleTextStyleCommand + toggleBold/Italic/... + isTextAttributeActive
│   ├── format-text.ts / format-block.ts / format-native.ts  # 三种选区语境下的 formatText 实现
│   ├── consts.ts                # FORMAT_{TEXT,BLOCK,NATIVE}_SUPPORT_FLAVOURS
│   ├── delete-text.ts / utils.ts / index.ts
├── adapters/                    # 基础 mark 的 markdown/html/notion-html 双向 adapter 集合
│   ├── extensions.ts            # InlineAdapterExtensions：把各格式 adapter 摊平成一个数组
│   ├── markdown/*.ts  html/*.ts  notion-html/*.ts  （含 color-utils.ts 颜色换算）
├── effects.ts                   # customElements.define('affine-text', …)
└── view.ts / store.ts           # InlinePresetViewExtension / InlinePresetStoreExtension
```

## 3. 实现细节

### 3.1 七个基础 mark：同构 spec + 一个共用组件

`inline-spec.ts` 用**纯对象形态**的 `InlineSpecExtension`（不取 provider，因为 `<affine-text>` 不需要 std）定义 7 个 spec，形态高度一致。以 bold 为例（`:12-24`）：

```ts
export const BoldInlineSpecExtension =
  InlineSpecExtension<AffineTextAttributes>({
    name: 'bold',
    schema: z.object({
      bold: z.literal(true).optional().nullable().catch(undefined),
    }),
    match: delta => !!delta.attributes?.bold,
    renderer: ({ delta }) => html`<affine-text .delta=${delta}></affine-text>`,
  });
```

- bold/italic/underline/strike/code 的 schema 是 `z.literal(true)`——**开关型 mark**，值只能是 `true` 或无；
- color/background 的 schema 是 `z.string()`（`:82-108`）——**取值型 mark**，存颜色字符串；
- 全部 7 个的 `renderer` 都返回 `<affine-text>`，差异只在 delta 的属性。

末尾 `InlineSpecExtensions: ExtensionType[]`（`:110-118`）把 7 个打包成数组，供 `view.ts` 一次性 `context.register`。

`<affine-text>`（`nodes/affine-text.ts:10-35`）是它们共用的渲染体，核心是把属性翻译成内联样式：

```ts
override render() {
  const style = this.delta.attributes ? affineTextStyles(this.delta.attributes) : {};
  if (this.delta.attributes?.code) {
    return html`<code style=${styleMap(style)}><v-text .str=${this.delta.insert}></v-text></code>`;
  }
  return html`<span style=${styleMap(style)}><v-text .str=${this.delta.insert}></v-text></span>`;
}
```

`affineTextStyles`（`affine-shared/styles/text.ts:5-40`）把 `{bold,italic,underline,strike,code,color,background}` 一次性翻译成 `font-weight/font-style/text-decoration/background-color/color` 等 CSS——所以**一个 `<affine-text>` 能同时渲染多个叠加的 mark**（加粗+斜体+红色），不需要嵌套多层组件。模板里特意把 `<v-text>` 紧贴 `<span>`/`<code>` 不换行（源码注释 `:16-17`/`:24-25`），避免 HTML 折行产生意外空格。

### 3.2 DefaultInlineManagerExtension：13 个 spec 汇成一张表

这是全包的心脏（`default-inline-manager.ts:20-38`）：

```ts
export const DefaultInlineManagerExtension =
  InlineManagerExtension<AffineTextAttributes>({
    id: 'DefaultInlineManager',
    specs: [
      BoldInlineSpecExtension.identifier,
      ItalicInlineSpecExtension.identifier,
      UnderlineInlineSpecExtension.identifier,
      StrikeInlineSpecExtension.identifier,
      CodeInlineSpecExtension.identifier,
      BackgroundInlineSpecExtension.identifier,
      ColorInlineSpecExtension.identifier,
      LatexInlineSpecExtension.identifier, // ← 来自 affine-inline-latex
      ReferenceInlineSpecExtension.identifier, // ← affine-inline-reference
      LinkInlineSpecExtension.identifier, // ← affine-inline-link
      FootNoteInlineSpecExtension.identifier, // ← affine-inline-footnote
      MentionInlineSpecExtension.identifier, // ← affine-inline-mention
      CommentInlineSpecExtension.identifier, // ← affine-inline-comment
    ],
  });
```

它传的是**各 spec 的 `identifier`**（DI 服务标识）而非 spec 本身——`InlineManagerExtension`（`std/.../inline-manager.ts:102-124`）在 setup 时用 `provider.get(spec)` 把每个 identifier 解析成实例再 `new InlineManager(std, enableMarkdown, ...specs)`。这带来一个重要解耦：**preset 只声明"要用哪些 spec"，各 spec 的实际构造（含它们从 provider 取 std/config）由各自的 ViewExtension 注册、DI 延迟解析**。于是 preset 不必关心 reference 的 config、footnote 的 provider 等细节，只负责排定清单与顺序。

**顺序即优先级**：`getRenderer`（`:30-60`）渲染时 `specs.toReversed()`——即**列表越靠后优先级越高**。comment（wrapper）排在最后，于是它能包裹在其它渲染结果之外；normal spec 则"后者命中即胜出"。schema 则通过 `getSchema`（`:62-67`）用 `z.intersection` 把 13 个 schema 全交起来，任一属性都受对应 zod 校验。

### 3.3 Markdown 即时转换：删标记 + formatText 的精确索引运算

`markdown.ts` 为基础 mark 注册 `InlineMarkdownExtension`。每条规则是一个 `{ name, pattern, action }`，由 `<rich-text>` 在输入空格/回车时用当前行前缀文本去匹配（见 `blocksuite-affine-rich-text.md` 3.5）。以 bold（`:63-99`）为例，`pattern: /.*\*{2}([^\s][^*]*[^\s*])\*{2}\s$|.../`，`action` 的套路是：

1. `match` 取出被包裹文字 `targetText`；
2. 算出 `annotatedText`（含 `**` 标记的整段）与它在 yText 里的 `startIndex`；
3. `undoManager.stopCapturing()`——**切断撤销合并**，让"转格式"成为独立的一步可撤销操作；
4. 先 `formatText(整段, { bold: true })` 给整段（含标记）加粗；
5. 再用两次 `deleteText` 精确删掉尾部 `** ` 与首部 `**`；
6. `setInlineRange` 把光标落回正确位置。

注释（`:6-11`）还列了规则边界：`***test***` 转、`*** test***` 不转（标记后不能紧跟空格）。`BoldItalicMarkdown`（`:13-61`）处理 `***` 三星同时加粗斜体。所有规则 + `LatexExtension` 汇进 `MarkdownExtensions`（`:276-284`）。这里能看到 inline markdown 规则**全是基于字符索引的删改**，因为 yText 是线性文本，没有 AST——每个 action 都要自己算准 index/length，这是行内 markdown 最易错也最考验的部分。

### 3.4 格式命令：三语境分派的 toggleTextStyle

`text-style.ts` 的 `toggleTextStyleCommand`（`:16-51`）是 bold/italic/underline/strike/code 共用的核心命令。它先 `isTextAttributeActive` 查当前是否已有该格式（决定 toggle 成 `true` 还是 `null`），再用 `.try([...])` **依次尝试三种选区语境**：

```ts
.try(chain => [
  chain.pipe(getTextSelectionCommand).pipe(formatTextCommand, payload),    // 行内文字选区
  chain.pipe(getBlockSelectionsCommand).pipe(formatBlockCommand, payload), // 整块选区
  chain.pipe(formatNativeCommand, payload),                                // 原生选区(数据库/表格)
])
```

对应 `consts.ts` 的三张 flavour 白名单：`FORMAT_TEXT_SUPPORT_FLAVOURS`（paragraph/list/code）、`FORMAT_BLOCK_SUPPORT_FLAVOURS`、`FORMAT_NATIVE_SUPPORT_FLAVOURS`（database/table）。`toggleBold = toggleTextStyleCommandWrapper('bold')`（`:69-73`）等是五个薄封装。

`formatTextCommand`（`format-text.ts`）里有个精细处理：当选区**折叠**（`inlineRange.length === 0`）时不能直接 formatText，而是改调 `inlineEditor.setMarks(...)` 设置"下次输入将带的格式"，并用 `clearMarksOnDiscontinuousInput`（来自 rich-text）保证光标一旦移动/断开输入就清掉这个待定 mark（`:52-75`）——这正是"把光标停在某处按 `Mod-b`，接着打字才变粗"的行为实现。

### 3.5 格式快捷键：从配置表数据化生成键表

`command/config.ts` 的 `textFormatConfigs`（`:32-138`）是**格式能力的数据化清单**，每项含 `id/name/icon/hotkey/activeWhen/action`（link 项还多一个 `textChecker`）：

```ts
{ id: 'bold', name: 'Bold', icon: BoldIcon, hotkey: 'Mod-b',
  activeWhen: host => { const [r] = host.std.command.chain().pipe(isTextAttributeActive, {key:'bold'}).run(); return r; },
  action: host => { host.std.command.chain().pipe(toggleBold).run(); } }
```

- 格式栏/工具栏读这张表渲染按钮（`icon` + `activeWhen` 高亮）；
- `keymap/format.ts` 的 `textFormatKeymap`（`:5-29`）则 `.filter(c => c.hotkey).reduce(...)` 把每个 `hotkey` 映射成一个 UIEventHandler：只读则跳过、跑 `textChecker` 校验（link 要求选区非折叠，`config.ts:129-136`）、`stopPropagation + preventDefault` 后执行 `action`。

**一张表同时喂养 UI 和快捷键**——新增一种格式只改表，不碰键盘注册逻辑。link 项的 `action` 调的是 `toggleLink`（来自 `affine-inline-link`），即 `Mod-k` 的归属，印证 preset "把兄弟包能力接到快捷键上"的集成角色。

### 3.6 括号/引号自动配对与 `[[` 转内链

`keymap/bracket.ts` 的 `bracketKeymap`（`:13-125`）遍历 `BRACKET_PAIRS` 为每个左/右括号注册 handler：

- 输入**右括号**且光标后正好是配对右括号 → 只移动光标跳过（`:38-44`），即"输入 `)` 时越过已自动补的 `)`"；
- 输入**左括号**：选区非折叠时用 `pair.left + selectedText + pair.right` 包裹选中文字（`:78-81`）；代码块内折叠光标也触发配对；
- **`[[Selected]]` 转 Linked doc**（`:72-77` → `tryConvertToLinkedDoc :127-162`）：选中文字输入 `[` 补成 `[[...]]` 时，若存在 `affine-linked-doc-widget`，就删掉方括号、`createDefaultDoc({title: docName})` 新建文档、再调 `insertLinkedNode`（来自 `affine-inline-reference`）插入一个 reference 节点。这是"双链"最轻的入口。
- 末尾单独注册 `` ` ``（`:97-123`）：对选中文字按反引号直接 `formatText(range, { code: true })` 转行内代码。

`basic.ts` 的 `textCommonKeymap` 则处理行内与块选择的边界切换：`ArrowUp/Down` 在首/末行时让出控制、`Escape` 从文字选区回到块选择、`Mod-a` 首次全选本块文字再次全选块、块选择下 `Enter` 聚焦进文字末尾（`:16-71`）。

### 3.7 序列化：基础 mark 的 adapter 集合

`adapters/extensions.ts` 把 markdown/html/notion-html 的 inline-delta（导出）与 inline-to-delta（导入）adapter 全 `.flat()` 成 `InlineAdapterExtensions`，由 `InlinePresetStoreExtension` 注册。以 markdown 导出为例（`adapters/markdown/inline-delta.ts`）：bold→mdast `strong`、italic→`emphasis`、strike→`delete`、code→`inlineCode`（`:3-50`），都用"包住 `context.current`"的方式嵌套 mdast。`html/color-utils.ts` 另处理 color/background 在 HTML 导入导出时的颜色值换算。

## 4. 语法特色

- **纯对象 vs 工厂两种 InlineSpecExtension**：7 个基础 mark 用**纯对象**形态（`inline-spec.ts:12`，无需 provider）；link/reference 等用**工厂**形态（要注入 std/config）。同一个 `InlineSpecExtension` 的函数重载（`std/inline/extensions/inline-spec.ts`）兼容两种签名——preset 把两类混装进同一张 manager 表。
- **`z.intersection` 累积 schema**：`getSchema`（`inline-manager.ts:62-67`）用 `reduce` + `z.intersection` 把 13 个 spec 的 zod schema 交成一个总 schema，preset 的 specs 清单即决定了行内属性的运行时校验全集。
- **`z.literal(true)` 表达开关型 mark**：bold 等 schema 用 `z.literal(true).optional().nullable()`（`:16`）——值要么 `true` 要么不存在，杜绝 `bold: false` 这种无意义中间态。
- **`命令链 .try([...])` 做语境分派**：`toggleTextStyleCommand`（`text-style.ts:38-43`）用 `.try` 依次尝试文字/块/原生三种 formatText，命中即止——命令组合子代替 if-else 分支。
- **配置表 `.filter().reduce()` 生成键表**：`textFormatKeymap`（`format.ts:6-29`）把数据化的 `textFormatConfigs` 动态编译成 keymap，UI 与快捷键同源。
- **`toReversed()` 表达渲染优先级**：`getRenderer`（`inline-manager.ts:35`）用数组反转让"后注册者优先"，wrapper/normal 分流渲染。
- **`undoManager.stopCapturing()` 切撤销粒度**：每条 markdown action（如 `markdown.ts:74`）在改写前切断撤销合并，使"转格式"成为单步可撤销。
- **折叠选区用 `setMarks` 延迟生效**：`formatTextCommand`（`format-text.ts:52-75`）区分折叠/非折叠，折叠时设 marks 而非 formatText，配 `clearMarksOnDiscontinuousInput` 自动失效。
- **`declare type _GLOBAL_` 强制副作用依赖**：`index.ts:1-3` 用 `declare type _GLOBAL_ = typeof RichTextEffects` 把 `affine-rich-text/effects` 纳入类型图，确保 `<affine-text>` 依赖的 `<v-text>` 等已定义。

## 5. 设计 / 实现亮点

- **"一张清单定义行内能力"**：`DefaultInlineManagerExtension` 用 identifier 列表声明 13 个 spec，schema 自动交集、渲染按序分派、各 spec 构造延迟到 DI——preset 只排清单，不耦合各元素内部，新增/删减一种行内元素只改一行。
- **基础 marks 的极致同构**：7 个 mark 共用 `<affine-text>` + `affineTextStyles`，一个组件渲染任意叠加组合，避免七套近似代码与多层组件嵌套。
- **UI / 快捷键 / 命令同源**：`textFormatConfigs` 一张表喂养格式栏按钮、`Mod-*` 键表与 toggle 命令，三者永不漂移。
- **行内 markdown 的索引级精确改写**：在无 AST 的线性 yText 上，用 pattern + 精确 `deleteText/formatText/setInlineRange` 完成即时转换，并以 `stopCapturing` 守住撤销粒度，是行内编辑最硬核的一环。
- **折叠光标格式的"待定 mark"模型**：`setMarks` + `clearMarksOnDiscontinuousInput` 优雅实现"先按 Mod-b 再打字才变粗、挪动光标即取消"的直觉行为。
- **`[[ ]]` 即建即链**：括号配对里内建"选中文字 `[[` → 新建文档 + 插入 reference"，把双链创建压进一个最自然的输入手势。
- **集成而不侵入**：preset 把 link 的 `toggleLink`、reference 的 `insertLinkedNode` 接到快捷键/括号逻辑上，却不反向修改这些兄弟包——依赖方向始终单向向上汇聚。

## 6. 对外 API 与注意事项

- 主要导出：7 个基础 mark 的 `*InlineSpecExtension` 与 `InlineSpecExtensions[]`；`DefaultInlineManagerExtension`（及 `AffineInlineRootElement` 类型）；`MarkdownExtensions`；命令 `toggleBold/Italic/Underline/Strike/Code`、`toggleTextStyleCommand`、`isTextAttributeActive`、`getTextAttributes`、`formatText/Block/NativeCommand`、`deleteTextCommand`、`isFormatSupported`；`textFormatConfigs` / `TextFormatConfig`；keymap `textKeymap`；`InlineAdapterExtensions` 与各 adapter；`./view` 的 `InlinePresetViewExtension`、`./store` 的 `InlinePresetStoreExtension`。
- **约定**：
  - 要获得完整行内能力，宿主需装 `InlinePresetViewExtension`（注册 manager + 7 spec + markdown + 定义 `<affine-text>`）与 `InlinePresetStoreExtension`（adapter）；**但 6 个兄弟 inline 元素（latex/reference/link/footnote/mention/comment）各自的 ViewExtension/StoreExtension 仍需单独注册**——preset 只在 manager 里列了它们的 identifier，不代为注册其组件与 adapter。
  - `<rich-text>` 通过 `DefaultInlineManager` 的 `getSchema/getRenderer/embedChecker/markdownMatches` 消费本包；它们是行内编辑的实际入口。
- **注意**：
  - manager specs 的**顺序即渲染优先级**（`toReversed` 后后者优先，comment 居末以便外层包裹）；调整顺序会改变叠加渲染结果。
  - 格式命令受 `FORMAT_*_SUPPORT_FLAVOURS` 白名单约束，非白名单 flavour（如非文本块）不响应 toggle。
  - markdown action 依赖精确字符索引，改写 pattern 时需同步校准 `deleteText` 的 index/length，否则会删错字符。
  - `[[ ]]` 转内链依赖 `affine-linked-doc-widget` 存在；无此 widget 时仅做普通括号配对。

## 7. 延伸

- 底层机制：`@blocksuite/std/inline` 的 `InlineManagerExtension`（`getSchema`/`getRenderer`/`embedChecker`）、`InlineSpecExtension`（纯对象/工厂两重载）、`InlineMarkdownExtension`（`MarkdownMatcherIdentifier`）。
- 消费方：`@blocksuite/affine-rich-text` 的 `<rich-text>`（用 manager 的 schema/renderer/markdownMatches）——见 `blocksuite-affine-rich-text.md`。
- 被集成的兄弟包：`blocksuite-affine-inline-link.md`（`toggleLink`/`Mod-k`）、`blocksuite-affine-inline-reference.md`（`insertLinkedNode`/`[[ ]]`）、`blocksuite-affine-inline-footnote.md`、`blocksuite-affine-inline-mention.md`，以及 latex/comment。
- 样式：`@blocksuite/affine-shared/styles` 的 `affineTextStyles`（属性→CSS 的唯一翻译器）。
