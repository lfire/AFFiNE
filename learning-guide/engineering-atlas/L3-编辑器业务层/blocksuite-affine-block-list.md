# `@blocksuite/affine-block-list`

> 一句话定位：AFFiNE 的**列表块**——一个 flavour（`affine:list`）承载四种列表形态：无序（bulleted）、有序（numbered）、待办（todo）、折叠（toggle）。它独有的核心是**按 `type` 渲染不同前缀图标（且按嵌套深度轮换 bullet 样式）**、**有序列表 `order` 的自动续号与纠偏**、**todo 勾选与动画**、**toggle 折叠子块**、以及 **Tab/Shift-Tab 缩进、Enter 智能分裂、行首 Backspace 退回段落、markdown 前缀即时转列表**。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/list`                                                                                                                                                                                                                                                                                                                                                                                  |
| 所属层    | L3 · 编辑器业务层（内容块）                                                                                                                                                                                                                                                                                                                                                                                      |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                                            |
| 关键依赖  | `@blocksuite/affine-components`（`CaptionedBlockComponent`/`toggle-button`/`playCheckAnimation`）、`@blocksuite/affine-inline-preset`（`DefaultInlineManagerExtension`/`textKeymap`）、`@blocksuite/affine-rich-text`（`rich-text`/`focusTextModel`）、`@blocksuite/affine-model`（`ListBlockModel`）、`@blocksuite/std`（`KeymapExtension`/selection/命令/inline）、`@blocksuite/icons`、`@preact/signals-core` |
| 被谁依赖  | 编辑器预设、`@affine/core`                                                                                                                                                                                                                                                                                                                                                                                       |
| 对外入口  | `.`、`./view`、`./store`                                                                                                                                                                                                                                                                                                                                                                                         |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | list 实现                                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| schema                            | 复用 `affine-model` 的 `ListBlockSchema`/`ListBlockModel`（`type`/`text`/`checked`/`collapsed`/`order`/`textAlign`；`store.ts` 注册 `ListBlockSchemaExtension`） |
| model                             | `ListBlockModel extends BlockModel<ListProps>`——普通内容块（非 GFX），可嵌 note/paragraph/list/database/callout/edgeless-text                                    |
| `*-block.ts`                      | `list-block.ts` → `ListBlockComponent`（前缀图标 + rich-text + 折叠子块）                                                                                        |
| commands                          | `commands/`（`indent`/`dedent`/`split-list`/`list-to-paragraph`/`convert-to-numbered-list` + `utils` 续号纠偏）                                                  |
| keymap                            | `list-keymap.ts` → `ListKeymapExtension`（Enter/Tab/Backspace…）+ `ListTextKeymapExtension`（复用 `textKeymap`）                                                 |
| markdown（输入）                  | `markdown.ts` → `ListMarkdownExtension`（`InlineMarkdownExtension`，`- `/`1. `/`[] ` 前缀即时转列表）                                                            |
| adapters（序列化）                | `adapters/`（markdown/html/notion-html/plain-text 列表 ↔ 块）                                                                                                    |
| turbo                             | `turbo/list-layout-handler.ts` + `list-painter.worker.ts`（白板离屏绘制）                                                                                        |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define('affine-list', ...)` + `ListViewExtension`/`ListStoreExtension`                                                                           |

它继承 `CaptionedBlockComponent`、用 `rich-text` 承载协同文本、`BlockViewExtension('affine:list', literal`affine-list`)` 注册——与 paragraph/code 同为"富文本型内容块"的标准实例。独特处在于**一个 flavour 四态**：类型靠 `props.type` 字段区分，而非四个 flavour。

### 列表块的独有问题

1. **四态一体**：bulleted/numbered/todo/toggle 共用一个 flavour 与渲染骨架，仅前缀图标与少量行为不同——需按 `type` 分派渲染与交互。
2. **有序号的续号与纠偏**：numbered 列表的 `order` 是真实数字，插入/删除/缩进/转换后，**连续的编号列表必须自动重算**保持 1,2,3…；嵌套层级还要用不同进制前缀（`1.` / `a.` / `i.`）。
3. **嵌套缩进**：Tab/Shift-Tab 把列表项移进/移出上一兄弟，形成多级列表；bullet 图标按深度轮换四种样式。
4. **智能回车**：Enter 在列表里不是简单换行，而要按"空行/有无子块/光标位置/是否折叠"分裂出多种结果（含退出为段落、降级缩进）。
5. **markdown 即时转换**：在段落里输入 `- `/`1. `/`[] `/`[x] ` 应立即把段落变成对应类型的列表项。
6. **todo/toggle 的交互态**：todo 有勾选 + 动画；toggle 有折叠子块；只读态下折叠不写模型只写本地状态。

## 2. 目录与关键文件

```text
src/
├── list-block.ts             # ★ListBlockComponent：按 type 渲染前缀、todo 勾选、toggle 折叠、order 纠偏 effect
├── list-keymap.ts            # ★ListKeymapExtension：Enter/Mod-Enter/Tab/Shift-Tab/Backspace/Delete
├── markdown.ts               # ★ListMarkdownExtension：段落前缀即时转列表（InlineMarkdownExtension）
├── commands/
│   ├── indent-list.ts dedent-list.ts  # ★缩进/反缩进（can* 守卫 + 执行）
│   ├── split-list.ts         # ★Enter 分裂：6 种 case
│   ├── list-to-paragraph.ts  # 行首 Backspace 退回段落
│   ├── convert-to-numbered-list.ts
│   └── utils.ts              # ★correctNumberedListsOrderToPrev：续号纠偏
├── utils/
│   ├── get-list-icon.ts      # ★按 type + 深度生成前缀图标
│   └── forward-delete.ts
├── turbo/ (list-layout-handler + list-painter.worker)
├── styles.ts index.ts view.ts store.ts effects.ts
```

## 3. 实现细节

### 3.1 ★四态渲染：按 type 分派前缀图标

`renderBlock`（`list-block.ts:140-220`）的骨架对四态统一：前缀图标 + `rich-text` + 可折叠子块容器。差异全在 `getListIcon`（`utils/get-list-icon.ts:32-79`）：

```ts
switch (model.props.type) {
  case 'bulleted':
    return BulletIcons[deep % BulletIcons.length]; // ★按嵌套深度轮换 4 种 bullet
  case 'numbered':
    return model.props.order ? getNumberPrefix(order, deep) : '1.'; // 按深度切 1./a./i.
  case 'todo':
    return checked ? CheckBoxCheckSolidIcon : CheckBoxUnIcon;
  case 'toggle':
    return showChildren ? ToggleDownIcon : ToggleRightIcon;
}
```

`getListDeep`（`:15-23`）沿父链数同 flavour 的祖先得到嵌套深度，bullet 用 `deep % 4` 轮换四种圆点样式、numbered 用 `getNumberPrefix(order, deep)` 按层切换阿拉伯/字母/罗马数字——模仿传统文档的多级编号视觉。前缀 `<div contenteditable="false">` 不可编辑，`@click` 绑定到 `_onClickIcon`。

> 注：`ListType` 含 `'toggle'`，但 model 注释标注 toggle 已 deprecated（新折叠能力下沉到通用 toggle-button），渲染仍保留兼容。

### 3.2 ★前缀点击：todo 勾选 / toggle 折叠 / 普通选中

`_onClickIcon`（`list-block.ts:38-68`）按 type 分派：

- **toggle**：切 `collapsed`；只读态只改本地 `_readonlyCollapsed`、可写态 `captureSync` 后 `updateBlock({ collapsed })`——只读双路径（同 code/bookmark 的只读预览套路）。
- **todo**：切 `checked`，并在**勾选瞬间**对 `.affine-list-block__todo-prefix` 播 `playCheckAnimation`（`:59-63`）。
- **其它**：`_select()` 选中块。

折叠的渲染（`:158-167`）用 `display: collapsed ? 'none'` 隐藏子块容器；当有子块时额外渲染一个通用 `<blocksuite-toggle-button>`（`:180-198`）承载折叠箭头，`updateCollapsed` 同样走只读双路径。

### 3.3 ★有序列表的续号纠偏

numbered 的 `order` 是真实整数，任何结构变动都可能打乱编号，核心修复函数 `correctNumberedListsOrderToPrev`（`commands/utils.ts:14-63`）分两步：

```ts
// step 1：看前一个兄弟是不是编号列表，是则 order = 前者 + 1，否则 = 1
if (previousSibling?.type === 'numbered')
  model.props.order = (prev.order || 1) + 1;
else model.props.order = 1;
// step 2：从本项往后，所有"连续的编号列表"顺次续号
let base = model.props.order + 1;
getNextContinuousNumberedLists(doc, model).forEach(list => {
  list.props.order = base++;
});
```

它在多处被调用：split-list、indent/dedent、markdown 转换后。组件里还有一个**兜底 effect**（`list-block.ts:118-131`）：监听 `type$`/`order$`，若是 numbered 却无合法 order（旧数据）就纠偏，若非 numbered 却残留 order 就清 `null`——保证数据自愈。

### 3.4 ★Enter 分裂：六种 case

`splitListCommand`（`commands/split-list.ts`）是列表里 Enter 的大脑，按"文本是否为空 / 有无子块 / 是否折叠 / 光标位置"分六种情形：

- **空文本 + 顶层**（case 1）：转成段落（退出列表），并重置后续连续编号列表的 order 从 1 开始。
- **空文本 + 非顶层**（case 2）：`dedent`（反缩进一级）而非新建项。
- **有子块未折叠 + 行首**（case 3）：在前面插一个空项、原项连同子树下移。
- **有子块未折叠 + 行中**（case 4）：把光标后文本切成**第一个子项**。
- **折叠 / 无子块**（case 5/6）：在后面插一个同类型新项，`correctNumberedListsOrderToPrev` 续号。

每种都精心处理了 numbered 的 `order` 传递与后继续号，并在 `host.updateComplete` 后 `focusTextModel` 把光标落到新项。`Enter` 与 `Mod-Enter`（`list-keymap.ts:22-49`）都走此命令。

### 3.5 ★缩进：can 守卫 + 执行 + 续号

`canIndentListCommand`（`commands/indent-list.ts:11-87`）先做**可行性校验**：必须有上一个兄弟、且 schema 允许该列表成为它的子块、非只读——通过才产出 `indentContext`。`indentListCommand`（`:89-147`）执行 `moveBlocks([model], previousSibling)` 把当前项移为上一兄弟的子块，然后对自己与原后继各 `correctNumberedListsOrderToPrev` 续号；还顺带处理"缩进到折叠标题下方要展开标题"的边角。Tab/Shift-Tab（`list-keymap.ts:50-97`）先 `getSelectedModelsCommand` 确认只选中单块，再跑 `can*` + 执行命令链——**守卫与执行分离**是 BlockSuite 命令的通用模式。

### 3.6 ★行首 Backspace 退回段落

`Backspace`（`list-keymap.ts:98-113`）仅当光标折叠且在行首（`index === 0`）时触发 `listToParagraphCommand`（`commands/list-to-paragraph.ts`）：删掉列表块、在原位以相同 text/children 新建 `affine:paragraph`、聚焦——即"列表项首退格变普通段落"。Delete / Control-d（Mac）走 `forwardDelete` 处理向后删除与跨块合并。

### 3.7 ★markdown 前缀即时转列表

`ListMarkdownExtension`（`markdown.ts`）是个 `InlineMarkdownExtension`，用正则 `/^((\d+\.)|(-)|(\*)|(\[ ?\])|(\[x\]))\s$/` 匹配段落开头的列表前缀（分组区分 numbered/bulleted/todo/todo-checked）。命中后（`action`，`:22-90`）：删掉前缀文本、把当前 `ParagraphBlockModel` 替换成对应 type 的列表块（numbered 走 `toNumberedList` 并解析起始序号、todo 带 checked），再 `focusTextModel` 保持光标——于是输入 `- `/`1. `/`[] `/`[x] ` 空格即变列表。

### 3.8 rich-text 接线

`rich-text`（`list-block.ts:200-214`）绑定 `model.props.text.yText`、`DefaultInlineManagerExtension` 的 schema/renderer/markdownMatches/embedChecker，`enableClipboard=false`/`enableUndoRedo=false`（剪贴板/撤销交块与 store 统管），并经 `getInlineRangeProvider(this)` 提供内联区间。`topContenteditableElement`（`:86-93`）按 page/edgeless 返回不同的可编辑根，适配白板内编辑。

## 4. 语法特色

- **一 flavour 多态 + `switch(type)` 分派**：列表不开四个 flavour，而用 `props.type` 字段区分，渲染与交互按 `switch` 分流——减少 schema 爆炸，共享骨架。
- **`effect()` 响应式自愈**：`@preact/signals-core` 的 `effect` 订阅 `type$`/`order$`/`collapsed$`，结构或类型变化时自动纠偏 order、同步只读折叠态——数据一致性由响应式兜底，无需到处手动调用。
- **命令链 can+do 分离**：`canIndentListCommand` 产出 `indentContext`、`indentListCommand` 消费它；`std.command.chain().pipe(canX).pipe(X).run()` 把"能否做"与"怎么做"解耦，守卫失败即短路。
- **`Command<Params, Result>` 泛型**：命令的入参与产出都用泛型声明（如 `splitListCommand: Command<{blockId, inlineIndex}>`），在管道中类型安全地传递上下文。
- **`InlineMarkdownExtension` + 分组正则**：用捕获分组区分前缀种类，`action` 回调拿 `inlineEditor`/`inlineRange`/`prefixText` 原地改块——内联级 markdown 的标准扩展形态。
- **Lit 指令**：`repeat`（widgets/children）、`classMap`（`affine-list--checked` 等）、`styleMap`（textAlign/折叠 display）、`@query`/`@state`/`nothing`。
- **`literal` 静态标签 + `customElements.define`**：标准块注册。

## 5. 设计 / 实现亮点

- **四态共享骨架、差异下沉到前缀与少量交互**：用单 flavour + `type` 字段承载 bulleted/numbered/todo/toggle，渲染/键盘/序列化大部分复用，仅前缀图标与点击行为分派——是"相似块合并"的范例。
- **有序号的自动续号与自愈**：`correctNumberedListsOrderToPrev` 两步算法 + 组件 effect 兜底，让插入/删除/缩进/转换后的编号永远连续，旧数据也能自动修复。
- **Enter 六态分裂**：把列表回车的所有语义（退出为段落、降级缩进、切子项、续号新项）穷举处理，交互贴合用户直觉，是本块最有含量的逻辑。
- **缩进 can/do 分离 + 续号联动**：可行性校验独立成命令、执行后对自己与后继双向续号，并处理折叠标题展开等边角。
- **深度感知的多级前缀**：bullet 按深度轮换四样式、numbered 按深度切进制，还原传统文档的多级编号观感。
- **markdown 前缀即时转换 + 只读折叠双路径**：输入即变列表、只读下折叠不写模型——输入与只读语义都处理细致。

## 6. 对外 API 与注意事项

- 主要导出：`ListBlockComponent`、`ListKeymapExtension`/`ListTextKeymapExtension`、`ListMarkdownExtension`、`indentListCommand`/`dedentListCommand`/`splitListCommand`/`listToParagraphCommand`/`correctNumberedListsOrderToPrev` 等命令；装配入口 `ListViewExtension`（`./view`）、`ListStoreExtension`（`./store`）。
- **约定**：列表类型靠 `model.props.type` 切换（非 flavour）；numbered 的 `order` 必须维护连续，结构变动后调 `correctNumberedListsOrderToPrev`。
- **注意**：
  - numbered 的 `order` 是真实整数且需续号，非 numbered 必须置 `null`（组件 effect 会自愈）。
  - `type: 'toggle'` 已 deprecated，折叠能力由通用 `blocksuite-toggle-button` 承载；新代码勿新建 toggle 类型。
  - 只读态下折叠/勾选的本地态写在 `_readonlyCollapsed` 等，不改模型。
  - rich-text 的 clipboard/undo 关闭，统一走块层；缩进/分裂等结构操作一律经命令而非直接改模型。
  - markdown 转换只在段落（`ParagraphBlockModel`）里触发，且前缀后需紧跟空格。
  - Tab/Shift-Tab 仅在单块文本选区下生效（多块选区不处理）。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`ListBlockModel`/`ListBlockSchema`/`ListType`）、`@blocksuite/std`（`KeymapExtension`/selection/命令/inline）、`@blocksuite/affine-rich-text`（`rich-text`/`focusTextModel`）、`@blocksuite/affine-shared`（`getNextContinuousNumberedLists`/`toNumberedList`/`getNumberPrefix`）。
- 同层协作：`@blocksuite/affine-components`（`CaptionedBlockComponent`/`toggle-button`/`playCheckAnimation`）、`@blocksuite/affine-inline-preset`（`DefaultInlineManagerExtension`/`textKeymap`）、`@blocksuite/affine-gfx-turbo-renderer`（离屏渲染）。
- 相关文档：`blocksuite-affine-block-paragraph.md`（同款 rich-text 型块、互转）、`blocksuite-affine-block-code.md`（Tab 缩进/只读双路径对照）、`blocksuite-affine-components.md`（toggle-button/caption）、`blocksuite-std.md`（命令 can/do、inline markdown、keymap）。
