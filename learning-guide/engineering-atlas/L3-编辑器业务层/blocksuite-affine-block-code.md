# `@blocksuite/affine-block-code`

> 一句话定位：AFFiNE 的**代码块**——带 shiki 语法高亮、语言切换、行号、自动换行、折叠、以及可选"预览"（如 mermaid 渲染）的代码编辑块。它独有的核心是**用 shiki 把代码 token 化并把高亮色绑进内联渲染**、**语言的懒加载与可搜索切换**、以及代码编辑特有的键盘行为（Tab 缩进、括号配对、行号渲染）。

| 项        | 值                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/blocks/code`                                                                                                                                                                                                                                                |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                    |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                          |
| 关键依赖  | `@blocksuite/std`（`BlockComponent`/`LifeCycleWatcher`/inline）、`@blocksuite/affine-model`、`@blocksuite/affine-components`（caption/filterable-list）、`@blocksuite/affine-rich-text`、`@blocksuite/affine-inline-preset`、`shiki`（+ `shiki/wasm`）、`@preact/signals-core` |
| 被谁依赖  | 编辑器预设、`@affine/core`                                                                                                                                                                                                                                                     |
| 对外入口  | `.`、`./store`、`./view`                                                                                                                                                                                                                                                       |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | code 实现                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| schema                            | 复用 `affine-model` 的 `CodeBlockSchema`/`CodeBlockModel`（`text`/`language`/`wrap`/`preview`/`lineNumber`/`collapsed`） |
| `*-block.ts`                      | `code-block.ts` → `CodeBlockComponent`                                                                                   |
| service                           | `code-block-service.ts` → `CodeBlockHighlighter`（`LifeCycleWatcher`，shiki 单例）                                       |
| inline                            | `code-block-inline.ts`（`InlineManagerExtension` + 自定义 `affine-code-unit` 内联 spec）                                 |
| keymap                            | `code-keymap.ts` + 组件内 `bindHotKey`（Tab/Backspace/Enter…）                                                           |
| widgets                           | `code-toolbar/`（语言按钮、换行、预览、更多菜单）                                                                        |
| `adapters`                        | `adapters/`、`markdown.ts`（` ``` ` 围栏 ↔ 代码块）                                                                      |
| clipboard                         | `clipboard/`（粘贴为纯代码，不解析 markdown）                                                                            |
| `effects.ts`/`view.ts`/`store.ts` | 注册元素 + `CodeBlockViewExtension`/`CodeBlockStoreExtension`                                                            |

它同样继承 `CaptionedBlockComponent`、同样用 `ViewExtensionProvider` 装配，是统一范式的又一实例。

### 代码块的独有问题

1. **语法高亮**：要把源码按语言 token 化、按主题着色，且高亮是**异步**的（语言语法/主题需按需加载），还要跟随明暗主题切换；渲染要落到富文本的每个内联片段上。
2. **高亮引擎昂贵**：shiki + Oniguruma WASM 很重，不能每个代码块各建一个——需**全局单例 + 引用计数**。
3. **语言切换**：几百种语言要可搜索选择、最近使用置顶、按需加载语法。
4. **代码专属编辑**：Tab/Shift-Tab 多行缩进、括号自动配对删除、禁用 markdown 快捷转换、每行左侧行号。

## 2. 目录与关键文件

````text
src/
├── code-block.ts              # CodeBlockComponent（渲染/高亮调度/键盘）
├── code-block-service.ts      # ★CodeBlockHighlighter：shiki 单例 + 引用计数 + 主题/语言加载
├── code-block-inline.ts       # CodeBlockInlineManagerExtension + affine-code-unit 内联 spec
├── code-block-config.ts       # CodeBlockConfig（theme/langs/showLineNumbers）
├── highlight/
│   ├── affine-code-unit.ts    # ★<affine-code-unit>：把 shiki token 的颜色切到每个内联片段
│   └── const.ts               # 默认明/暗主题 key
├── code-toolbar/              # 工具栏 widget：lang-button / preview-button / more-menu
│   └── components/lang-button.ts  # ★可搜索语言切换（最近使用置顶）
├── code-keymap.ts             # 代码块 keymap 扩展
├── clipboard/                 # 复制粘贴（纯代码）
├── adapters/ markdown.ts      # ``` 围栏 ↔ 代码块
├── code-preview-extension.ts  # CodeBlockPreviewIdentifier（按语言注入预览渲染器，如 mermaid）
├── styles.ts turbo/ view.ts store.ts effects.ts
````

## 3. 实现细节

### 3.1 ★高亮引擎：shiki 单例 + 引用计数（LifeCycleWatcher）

`CodeBlockHighlighter`（`code-block-service.ts:20-122`）是个 `LifeCycleWatcher`（随编辑器生命周期启停的 std 扩展），但它把 shiki 实例做成**类级静态单例**，跨所有代码块、甚至跨多个编辑器共享：

```ts
export class CodeBlockHighlighter extends LifeCycleWatcher {
  static override key = 'code-block-highlighter';
  private static _sharedHighlighter: HighlighterCore | null = null;
  private static _highlighterPromise: Promise<HighlighterCore> | null = null;
  private static readonly _languagePromises = new Map<string, Promise<void>>();
  private static _refCount = 0;
  highlighter$: Signal<HighlighterCore | null> = signal(null);
```

- **单例创建**：`_getOrCreateHighlighter` 用 `createHighlighterCore({ engine: createOnigurumaEngine(() => getWasm) })` 建核心高亮器，promise 缓存防并发重复创建（`:81-96`）。只打包核心、WASM 与语言都按需加载，避免把全部语法塞进包。
- **引用计数**：`mounted` 时 `_refCount++`、`unmounted` 时 `_refCount--`；`_isHighlighterInUse` 判断是否还有人用——异步加载主题的回调里反复检查它，**编辑器已销毁就丢弃结果**，防止对已卸载实例写入（`:98-121`）。
- **主题跟随**：`themeKey` getter 读 `ThemeProvider.theme$`，在明/暗主题 key 间切换（`:34-39`）；`_loadTheme` 把明暗主题都 `loadTheme` 进去。
- **语言去重加载**：`loadLanguage(lang, input)` 用 `_languagePromises` Map 保证同一语言只加载一次（`:41-53`）。

### 3.2 ★高亮调度：从源码到 token

组件侧 `_updateHighlightTokens`（`code-block.ts:122-175`）是高亮的调度中枢，被包在 `effect()` 里，于是**文本或主题变化自动重算**：

```ts
this.disposables.add(
  effect(() => {
    this._updateHighlightTokens();
  })
);
this.disposables.add(
  effect(() => {
    noop(this.highlightTokens$.value); // 建立对 tokens 的依赖
    this._richTextElement?.inlineEditor?.render(); // tokens 变了就让内联编辑器重渲
  })
);
```

`_updateHighlightTokens` 的要点：

- 用自增 `_highlightRequestId` 做**竞态防护**——语言异步加载完成后，若 `requestId !== this._highlightRequestId` 说明有更新的请求，丢弃旧结果（`:123,157`）。
- `noop(this.model.props.text.deltas$.value)` **故意订阅** deltas Signal，让 effect 在文本变化时重跑；再 `text.toString()` 取整段源码。
- 语言未加载则先 `loadLanguage` 再 `codeToTokensBase(code, { lang, theme })`，否则直接 token 化，结果写入 `highlightTokens$`（一个 `ThemedToken[][]`，按行分组）。
- 语言名容错：按 `id`/`name`/`aliases` 匹配 `langs`，匹配到就把 `language$` 规范成 `id`，匹配不到清空高亮并置 `language = null`。

### 3.3 ★把高亮色切进内联片段（affine-code-unit）

代码块的富文本由 `rich-text` 渲染，但每个内联片段（`v-element`）的着色要来自 shiki token——这由自定义内联单元 `AffineCodeUnit`（`highlight/affine-code-unit.ts`）完成。它是 `code-block-inline.ts` 注册的 `CodeBlockUnitSpecExtension`（`match: () => true`，即接管所有内联片段）的渲染器。

`render()`（`:20-112`）的核心算法：拿到本片段所在行的 token 数组，按片段的 `startOffset`/`endOffset` 从行 token 里**切出覆盖区间的 token**，再把每个 token 的 `color` 通过 `styleMap` 施加到对应 `<v-text>`：

```ts
const tokens = codeBlock.highlightTokens$.value;
const line = tokens[vElement.lineIndex];
const lineTokens = structuredClone(line); // 拷贝，避免改到原始 token
// 按 startOffset/endOffset 收集与本片段重叠的 token → includedTokens
if (includedTokens.length === 1) {
  const content = token.content.slice(
    startOffset - token.offset,
    endOffset - token.offset
  );
  return html`<span style=${styleMap({ color: token.color, ...style })}
    ><v-text .str=${content}></v-text
  ></span>`;
}
// 多 token：切首尾、逐 token 上色
```

这样"富文本内联编辑"与"语法高亮"两套机制被缝合在一起：文本仍是可编辑的协同 `Y.Text`，着色只是渲染期按 token 叠加的样式。片段若带 `link` 属性则改渲 `<affine-link>`，`code` 属性再追加内联代码样式。

`code-block-inline.ts` 的 `CodeBlockInlineManagerExtension` 还有个关键设置 `enableMarkdown: false`——代码块里**禁用** markdown 快捷输入（输入 `# ` 不该变标题），并只启用 bold/italic/link/latex 等有限内联 spec。

### 3.4 渲染：rich-text + 行号 + 预览 + 折叠

`renderBlock()`（`code-block.ts:450-513`）组织四部分：

- **rich-text**：绑定 `model.props.text.yText`、inline schema/renderer、`enableClipboard=false`/`enableUndoRedo=false`（剪贴板/撤销交由块与 store 统一管）。关键是 `vLineRenderer`——在每行前插入一个 `contenteditable="false"` 的行号 `<span class="line-number">${vLine.index + 1}</span>`（`:486-493`）。
- **行号开关** `showLineNumbers`（`:104-112`）三级决策：feature flag（`CodeBlockConfigExtension.showLineNumbers`，移动端可硬关）→ 单块 `model.props.lineNumber` → 全局设置 `_showLineNumbersGlobal$`（由 `EditorSettingProvider` 经 `effect` 同步，`:185-201`）。
- **预览**：`CodeBlockPreviewIdentifier(language)` 按语言取可选预览渲染器（如 mermaid/PlantUML），`preview$` 为真且存在渲染器时隐藏 rich-text、显示预览容器（`:453-457, 501-509`）。只读态下预览开关只写本地 Signal `_localPreview$`（`setPreviewState`，`:534-540`），同 bookmark 的只读双路径。
- **折叠**：`collapsed` 加遮罩渐隐。

### 3.5 ★代码专属键盘行为

组件 `connectedCallback` 里 `bindHotKey`（`:240-417`）实现代码编辑手感：

- **Tab / Shift-Tab**：对选区覆盖的每一行行首插入/删除两空格 `'  '`。实现用 `allIndexOf` 找出区间内所有换行位置、`reverse()` 从后往前改（避免索引漂移），并精确重算 `setInlineRange` 以保持选区（`:281-384`）。
- **Backspace**：行首且空选区时退出为块选区；否则检测**括号配对**——若光标左右恰为 `BRACKET_PAIRS` 的一对（如 `()`），一次删掉两个字符（`:241-280`）。
- **Enter**：`captureSync()` 后返回 `true`，即代码块内回车是换行、不退出块（`:392-395`）。
- **Mod-Enter**：仅当光标在代码末尾时，在块后新建段落并聚焦——提供"跳出代码块"的出口（`:396-416`）。
- **Delete / Control-d**：按平台拦截默认行为。

### 3.6 ★可搜索的语言切换

`code-toolbar/components/lang-button.ts` 的 `LanguageListButton` 用 `affine-components/filterable-list` 的 `showPopFilterableList` 弹出可搜索语言列表（`placeholder: 'Search for a language'`）。选中后把该语言从列表移到最前（**最近使用置顶**），并在 `store.transact` 内写 `model.props.language$`（纯文本写 `null`），同时埋点 `codeBlockLanguageSelect`（`:70-91`）。语言清单来自 `CodeBlockConfigExtension.langs` 或 shiki 的 `bundledLanguagesInfo`（`code-block.ts:92-97`）。

### 3.7 装配：widget 形式的工具栏

`CodeBlockViewExtension`（`view.ts`）注册 `FlavourExtension` + `CodeBlockHighlighter`（服务）+ `` BlockViewExtension('affine:code', literal`affine-code`) ``+ 斜杠菜单 + keymap + markdown + 剪贴板 + inline manager；工具栏用`` WidgetViewExtension('affine:code', AFFINE_CODE_TOOLBAR_WIDGET, literal`${unsafeStatic(...)}`) ``注册成**挂件**（而非附件/书签那样的 toolbar config）。移动端分支改为`showLineNumbers:false` 并不注册工具栏——同一块按 scope 差异化装配。

## 4. 语法特色

- **类级静态单例 + 实例生命周期**：`CodeBlockHighlighter` 既是 per-editor 的 `LifeCycleWatcher`，又用 `static _sharedHighlighter`/`_refCount` 做进程级共享——"实例管生命周期、静态管共享资源"的组合。
- **`effect()` 响应式副作用**：高亮重算、全局行号同步、tokens→重渲都用 `@preact/signals-core` 的 `effect`，依赖自动追踪；`noop(signal.value)` 是"仅为建立依赖而读取"的惯用法。
- **请求号竞态防护**：`++this._highlightRequestId` 配合异步回调里的 `requestId !== current` 判断，是异步渲染防旧结果覆盖的标准模式（与 bookmark 的 AbortController 异曲同工）。
- **shiki 类型**：`ThemedToken[][]`（按行的着色 token）、`BundledLanguageInfo`、`ThemeInput`、`LanguageInput`、`HighlighterCore` 贯穿服务与渲染。
- **`structuredClone` 防突变**：切割 token 前深拷贝该行，避免修改 shiki 返回的共享结构。
- **自定义内联 spec**：`InlineSpecExtension({ name, schema: z.object({...}), match: () => true, renderer })` + `InlineManagerExtension({ specs, enableMarkdown:false })`，用 zod 声明属性、`match` 决定接管范围。
- **`vLineRenderer` 注入行号**：rich-text 暴露按行渲染钩子，把行号作为不可编辑 `<span>` 插在 `renderVElements()` 之前。
- **`literal` / `unsafeStatic`**：块与 widget 的标签名运行期注入静态模板。

## 5. 设计 / 实现亮点

- **昂贵引擎的单例 + 引用计数 + 在用性校验**：shiki/WASM 全局只建一次、按语言/主题懒加载、用 `_refCount`+`_isHighlighterInUse` 在异步回调里反复确认实例仍被使用——把"重资源 + 异步 + 可随时卸载"这组最棘手的约束处理得干净，是本块最有含量的工程。
- **高亮与协同富文本的缝合**：代码仍是可协同可撤销的 `Y.Text`，高亮只在渲染期由 `affine-code-unit` 按 token 的 offset 区间切片上色——既不破坏编辑/协同，又实现逐字符精确着色。
- **响应式高亮管道**：文本 deltas、语言、主题任一变化经 `effect` 自动触发重 token 化并重渲内联，无需手动失效；请求号防竞态。
- **三级行号/只读预览双路径**：行号 feature-flag→单块→全局，预览只读写本地——配置优先级与只读语义处理细致。
- **代码编辑手感**：多行 Tab 缩进（从后往前改防漂移）、括号配对删除、禁用 markdown、Mod-Enter 出块，贴近专业编辑器。
- **可搜索 + 最近置顶的语言选择**：复用 `filterable-list`，交互与几百语言规模匹配。

## 6. 对外 API 与注意事项

- 主要导出：`CodeBlockComponent`、`CodeBlockHighlighter`、`CodeBlockConfigExtension`（`theme`/`langs`/`showLineNumbers`）、`CodeBlockInlineManagerExtension`、`CodeBlockPreviewIdentifier`；装配入口 `CodeBlockViewExtension`（`./view`）、`CodeBlockStoreExtension`（`./store`）。
- **约定**：自定义主题/语言/行号默认值通过 `CodeBlockConfigExtension({...})` 注入；按语言的预览渲染器通过 `CodeBlockPreviewIdentifier(lang)` 注册。
- **注意**：
  - 高亮是异步的——语言首次使用要等语法加载，期间无色是正常现象；主题切换会整体重算。
  - 高亮器是全局单例，`unmounted` 只减引用计数、不销毁实例；异步结果写入前务必经 `requestId`/`_isHighlighterInUse` 校验（改相关逻辑要保持）。
  - 代码块内禁用 markdown 快捷输入（`enableMarkdown:false`），且 rich-text 的 clipboard/undo 关闭，统一走块层。
  - 行号由三级开关决定，单块 `lineNumber` 覆盖全局；只读下预览开关不写模型。
  - 语言名以 shiki 的 `id` 存储，`null` 表示 Plain Text。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`CodeBlockSchema`/`CodeBlockModel`）、`@blocksuite/std`（`LifeCycleWatcher`/`BlockViewExtension`/`WidgetViewExtension`/inline）、`shiki`（高亮引擎）。
- 同层协作：`@blocksuite/affine-components`（`CaptionedBlockComponent`/`filterable-list`）、`@blocksuite/affine-rich-text`（`rich-text`/`focusTextModel`）、`@blocksuite/affine-inline-preset`（内联 spec）、`@blocksuite/affine-shared`（`ThemeProvider`/`EditorSettingProvider`）。
- 相关文档：`blocksuite-affine-components.md`、`blocksuite-affine-model.md`、`blocksuite-std.md`（`LifeCycleWatcher`/inline/命令）。
