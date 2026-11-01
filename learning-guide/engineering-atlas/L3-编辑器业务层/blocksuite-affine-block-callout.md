# `@blocksuite/affine-block-callout`

> 一句话定位：AFFiNE 的**标注 / 提示块**（callout）——一个带 emoji/图标、背景色、可容纳多个子块（段落、列表）的"容器块"，用来突出提示、警告、备注等内容。它独有的部分是**图标选择器（emoji/AffineIcon）**、**容器型块的子块布局**，以及**在容器内外进出的键盘行为**（Enter 拆分、Backspace 退出/合并）。

| 项        | 值                                                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/blocks/callout`                                                                                                                                                                                                                                                         |
| 所属层    | L3 · 编辑器业务层（内容块 · 容器块）                                                                                                                                                                                                                                                       |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                      |
| 关键依赖  | `@blocksuite/std`、`@blocksuite/affine-model`、`@blocksuite/affine-components`（caption/context-menu）、`@blocksuite/affine-rich-text`（`focusTextModel`/inline）、`@blocksuite/affine-inline-preset`、`@blocksuite/affine-shared`（`IconPickerServiceIdentifier`）、`@toeverything/theme` |
| 被谁依赖  | 编辑器预设、`@affine/core`                                                                                                                                                                                                                                                                 |
| 对外入口  | `.`、`./store`、`./view`                                                                                                                                                                                                                                                                   |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件             | callout 实现                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| schema               | 复用 `affine-model` 的 `CalloutBlockSchema`/`CalloutBlockModel`（`role: 'hub'`，可含 paragraph/list 子块） |
| `*-block.ts`         | `callout-block.ts` → `CalloutBlockComponent`                                                               |
| `commands`           | `commands/split-callout.ts`、`commands/callout-to-paragraph.ts`                                            |
| keymap               | `callout-keymap.ts`（Enter / Backspace）                                                                   |
| `adapters`           | `adapters/markdown.ts`（callout ↔ GFM admonition `:::`）                                                   |
| configs              | `configs/slash-menu.ts`、`configs/toolbar.ts`                                                              |
| `effects.ts`         | 注册 `affine-callout` / `icon-picker-wrapper`                                                              |
| `view.ts`/`store.ts` | `CalloutViewExtension` / `CalloutStoreExtension`                                                           |

### callout 的独有问题

与附件/书签这类"叶子媒体块"不同，callout 是**容器块**（schema 的 `metadata.role` 为 `'hub'`、`children: ['affine:paragraph','affine:list']`），这决定了它的独有命题：

1. **渲染子块而非自身内容**：callout 本身不承载富文本，它用 `renderChildren` 把内部段落/列表渲染进一个带背景的容器，左侧配一个可点击的图标。
2. **图标选择（emoji + AffineIcon）**：`icon` 属性是一个联合类型 `IconData`，既可以是 emoji unicode、也可以是内置矢量图标；点击图标弹出图标选择器（由上层以 `UniComponent` 注入）。
3. **进出容器的键盘语义**：在 callout 内按 Enter 要在容器内新建段落（而非退出），按 Backspace 在段首要么合并到上一段、要么把段落"降级"出容器变回普通段落——这是容器块最易出错的交互，需专门的命令处理。
4. **背景色主题化**：`backgroundColorName` 映射到 `@toeverything/theme` 的 `cssVarV2.block.callout.background` 色板。

## 2. 目录与关键文件

```text
src/
├── index.ts
├── callout-block.ts            # CalloutBlockComponent（容器渲染 + 图标点击 + 新建段落）
├── callout-block-styles.ts     # 容器/子块/emoji 的 @emotion/css 样式（class 名）
├── callout-keymap.ts           # ★独有：Enter / Backspace 键盘行为
├── commands/
│   ├── split-callout.ts        # ★独有：Enter 在容器内拆分/新建段落
│   └── callout-to-paragraph.ts # ★独有：Backspace 把段落退出容器/合并
├── icon-picker-wrapper.ts      # ★独有：<icon-picker-wrapper> 包裹注入的图标选择器 UniComponent
├── adapters/markdown.ts        # callout ↔ GFM admonition（:::）
├── configs/ store.ts view.ts effects.ts
```

## 3. 实现细节

### 3.1 容器渲染：图标 + 子块

`CalloutBlockComponent`（`callout-block.ts:67`）继承 `CaptionedBlockComponent<CalloutBlockModel>`。`renderBlock()`（`:216-262`）先从模型取 `icon` 与 `backgroundColorName`，把颜色名归一（`default`/空 → `grey`）后映射到主题色板，再渲染"图标容器 + 子块容器"：

```ts
const backgroundColor = (
  cssVarV2.block.callout.background as Record<string, string>
)[normalizedBackgroundName ?? 'grey'];
const iconContent = getIcon(icon);
return html` <div
  class="${calloutBlockContainerStyles}"
  @click=${this._handleBlockClick}
  style=${styleMap({ backgroundColor: backgroundColor ?? 'transparent' })}
>
  ${
      iconContent
        ? html`<div
            @click=${this._toggleIconPicker}
            contenteditable="false"
            class="${calloutEmojiContainerStyles}"
            style=${styleMap({ marginTop: this._getEmojiMarginTop() })}
          >
            <span class="${calloutEmojiStyles}" data-testid="callout-emoji"
              >${iconContent}</span
            >
          </div>`
        : ''
    }
  <div class="${calloutChildrenStyles}">${this.renderChildren(this.model)}</div>
</div>`;
```

两个细节体现容器块的讲究：

- **图标对齐首行**：`_getEmojiMarginTop()`（`:75-102`）读第一个子块的 flavour/type，若是 h1~h6 标题则按标题字号给 emoji 设不同 `marginTop`（h1 为 `23px`…），让图标与首行文字基线对齐，而非顶死在容器上沿。
- **图标 `contenteditable="false"`**：图标不是富文本的一部分，禁止编辑，避免光标误入。

### 3.2 ★独有核心：图标渲染与选择器

`getIcon`（`:53-66`）把联合类型 `IconData` 分派到两种渲染：

```ts
if (icon.type === IconType.Emoji) return icon.unicode;                       // 直接返回 emoji 字符
if (icon.type === IconType.AffineIcon)
  return (icons as Record<string, ...>)[`${icon.name}Icon`]?.({ style: `color:${icon.color}` });  // 动态取内置图标
```

AffineIcon 分支用 `` `${icon.name}Icon` `` 在 `@blocksuite/icons/lit` 命名空间里**动态索引**出对应的图标函数——避免为每个图标写 switch。

点击图标弹选择器 `_toggleIconPicker`（`:111-157`）：图标选择器 UI 本身**不在块包里**，而是通过 `IconPickerServiceIdentifier` 从 DI 取一个 `UniComponent`（跨框架组件抽象），用 `IconPickerWrapper`（一个 `ShadowlessElement`）包裹后，经 `affine-components/context-menu` 的 `createPopup` 弹出。选中回调直接写模型 Signal：

```ts
const props = { onSelect: (iconData?) => { this.model.props.icon$.value = iconData; this._closeIconPicker(); },
                onClose: () => this._closeIconPicker() };
const wrapper = new IconPickerWrapper();
wrapper.iconPickerComponent = iconPickerService.iconPickerComponent;
this._popupCloseHandler = createPopup(popupTargetFromElement(event.currentTarget), wrapper, { onClose: ... });
```

这又是"块只声明需求、具体 UI 由上层注入"的解耦模式（同 peek 的 `PeekViewProvider`）——`getOptional` 取不到服务时静默降级。`_handleBlockClick`（`:159-189`）还处理"无图标时点击打开选择器""空容器点击新建段落并聚焦"等边界。

### 3.3 ★独有核心：进出容器的键盘行为

`CalloutKeymapExtension`（`callout-keymap.ts`）用 `KeymapExtension(std => ({...}))` 注册两个键，均返回 `true` 表示消费：

**Enter**（`:17-47`）：定位当前 `TextSelection` 所在块，判断它或其父是否 callout，是则 `preventDefault` 并跑 `splitCalloutCommand`：

```ts
std.command
  .chain()
  .pipe(splitCalloutCommand, {
    blockId: calloutBlock.model.id,
    inlineIndex: text.from.index,
    currentBlockId: text.from.blockId,
  })
  .run();
```

`splitCalloutCommand`（`commands/split-callout.ts`）在光标处 `text.split(inlineIndex)` 把后半段文字切出，删掉当前段尾部，在 callout 内 `currentIndex+1` 处**新建一个段落**承接后半段，并在 `host.updateComplete` 后 `focusTextModel` 聚焦——于是在 callout 里回车是"容器内换段"而非"跳出容器"。

**Backspace**（`:48-84`）：仅当光标在段首（`isCollapsed && index === 0`）且父为 callout 时介入。若当前是 callout 里的段落，跑 `calloutToParagraphCommand`；否则兜底选中整个 callout 块。

`calloutToParagraphCommand`（`commands/callout-to-paragraph.ts`）分三种情形删当前段：有上一段且有文字 → `previousText.join(currentText)` **保留格式地合并**再删本段、聚焦合并点；有上一段无文字 → 删本段、光标移到上一段末；无上一段 → 删本段并选中整个 callout。`deleteBlock(model, { deleteChildren: false })` 保证不误删子级。它声明了输出 `{ success: boolean }`，失败路径 `return false`（不调 `next`），符合 std 命令约定。

### 3.4 富文本能力复用

callout 的子段落是富文本，组件通过 `DefaultInlineManagerExtension` 暴露 `attributeRenderer`/`attributesSchema`/`embedChecker`（`:191-205`），把内联编辑能力下发给子块。`topContenteditableElement`（`:207-214`）按模式返回 edgeless 顶层可编辑元素或 `rootComponent`，保证选区/输入在白板与文档流中都正确归属。

### 3.5 adapters：callout ↔ GFM admonition

`adapters/markdown.ts` 把 callout 与 Markdown 的 admonition 语法（`:::` 围栏，GFM 风格）互转：`toBlockSnapshot` 识别 `isCalloutNode` 并只接纳 `paragraph/list/heading/blockquote` 类子节点，`getCalloutEmoji` 还原图标；导出选项由 `calloutMarkdownExportOptionsSchema`（zod）从 configs 解析，支持 GFM 等风格。这让 callout 在 Markdown 往返中尽量无损。

## 4. 语法特色

- **联合类型 + 判别渲染**：`IconData` 按 `type`（`Emoji`/`AffineIcon`）判别，`getIcon` 用 `if` 分派；AffineIcon 用模板字符串 `` `${name}Icon` `` 动态索引图标函数。
- **`KeymapExtension(std => ({...}))` 工厂**：返回"键名 → handler"映射，handler 签名 `(ctx) => boolean`，`true` 消费、`false` 放行——与 std 事件"返回 truthy 即停止传播"一致。
- **命令链 `chain().pipe(cmd, input).run()`**：Enter/Backspace 都把逻辑封进 `Command`，用链式执行；命令内 `return`（不调 `next`）即失败。
- **Yjs `Text` 的 `split`/`join`/`delete`**：`text.split(index)`、`previousText.join(currentText)` 在协同文本上做"保格式"的拆分与合并，而非字符串拼接。
- **`UniComponent` 跨框架组件**：图标选择器用 `UniComponent<Props, Expose>` 抽象，`<uni-lit>` 桥接，使块层不绑定选择器的具体实现框架。
- **`@emotion/css` 原子类名样式**：`calloutBlockContainerStyles` 等是生成的 class 字符串（非 Lit `css`），配合 ShadowlessElement 的 light DOM 使用。
- **`matchModels(model, [CalloutBlockModel])`**：类型守卫式的模型匹配，替代 `flavour` 字符串比较并收窄类型。

## 5. 设计 / 实现亮点

- **容器块交互的完整建模**：Enter 容器内换段、Backspace 段首退出/合并、空容器点击建段——这些"进出容器"的边界是容器块最难做对的部分，callout 用两个专用命令 + keymap 把它们声明式地收口，且全程 `captureSync` 正确分段 undo、保格式合并。
- **图标系统的开放设计**：`IconData` 联合 emoji 与矢量图标，选择器 UI 以 `UniComponent` 由上层注入、`getOptional` 降级——块层零 UI 依赖，产品层可替换整套图标面板。
- **图标与首行基线对齐**：`_getEmojiMarginTop` 按首个子块的标题级别微调 marginTop，是容易被忽略却显著影响观感的排版细节。
- **主题色板驱动背景**：颜色名→`cssVarV2` 映射并归一兜底，换肤/暗色自动生效。
- **Markdown admonition 双向适配**：与通用 `:::` 语法对齐，保证跨工具复制粘贴与导入导出的兼容。

## 6. 对外 API 与注意事项

- 主要导出：`CalloutBlockComponent`、`splitCalloutCommand` / `calloutToParagraphCommand`、`CalloutKeymapExtension`；装配入口 `CalloutViewExtension`（`./view`）、`CalloutStoreExtension`（`./store`）。
- **约定**：图标选择器 UI 由上层通过 `IconPickerServiceIdentifier` 注入 `UniComponent`，块包不自带；子块类型受 schema 限制（仅 paragraph/list）。
- **注意**：
  - callout 是容器块（`role:'hub'`），自身不存富文本，内容全在子块；渲染用 `renderChildren`。
  - 键盘命令只在 `TextSelection` 且块/父块为 callout 时介入，返回 `true` 阻断默认行为——改键位要同步 keymap。
  - 退出/合并走 `calloutToParagraphCommand`，务必 `deleteChildren:false` 且保格式 `join`，否则会丢格式或误删。
  - 背景色名须存在于 `cssVarV2.block.callout.background` 色板，否则回退 `grey`/`transparent`。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`CalloutBlockSchema`/`CalloutProps`/`IconData`）、`@blocksuite/std`（`KeymapExtension`/命令/选择）、`@blocksuite/store`（`Text.split/join`）。
- 同层协作：`@blocksuite/affine-components`（`CaptionedBlockComponent`/`context-menu` 的 `createPopup`）、`@blocksuite/affine-rich-text`（`focusTextModel`/inline manager）、`@blocksuite/affine-shared`（`IconPickerServiceIdentifier`/admonition adapter 工具）。
- 相关文档：`blocksuite-affine-components.md`、`blocksuite-affine-model.md`、`blocksuite-std.md`（命令链/keymap/选择）。
