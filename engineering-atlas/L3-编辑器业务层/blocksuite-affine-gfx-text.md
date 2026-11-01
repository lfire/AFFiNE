# `@blocksuite/affine-gfx-text`

> 一句话定位：白板上的**画布原生文本图元**（`type === 'text'`，`TextElementModel`）的图形层——负责把一段 `Y.Text` 直接画在 canvas 上（自己做换行排版、字宽测量、RTL 混排、缩放改字号）、双击进编辑、以及"文本工具"的点击新建；同时它还是整个 edgeless 的**canvas 文字排版工具库**（`wrapText`/`measureTextInDOM`/`getFontString` 等被连接线标签、形状文字复用）。要点是分清它与**块式** `affine:edgeless-text`（`block-edgeless-text` 包）两条文本路径。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/text`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 关键依赖  | `@blocksuite/std`（`BaseTool`/`GfxElementModelView`/`GfxViewInteractionExtension`/`InteractivityExtension`/`deltaInsertsToChunks`）、`@blocksuite/affine-block-surface`（`ElementRendererExtension`/`TextUtils`/`EdgelessCRUDIdentifier`/`DefaultTool`）、`@blocksuite/affine-model`（`TextElementModel`/`EdgelessTextBlockModel`）、`@blocksuite/affine-rich-text`（`focusTextModel`）、`@blocksuite/global`（`Bound`/旋转几何）、`yjs`、`lit` |
| 被谁依赖  | edgeless 预设（`TextViewExtension`）；`affine-gfx-shape`（形状内文字复用排版工具）、`affine-gfx-connector`（标签文本复用 `wrapTextDeltas`）、`affine-gfx-mindmap`                                                                                                                                                                                                                                                                               |
| 对外入口  | `.`、`./view`（`TextViewExtension`）、`./store`（`TextStoreExtension`，Markdown/纯文本适配器）                                                                                                                                                                                                                                                                                                                                                  |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置：一个"纯 canvas 文字图元"

文本是画布原生图元，走 gfx 五件套：**模型** `TextElementModel`（在 affine-model，`type='text'`）、**工具** `TextTool`、**element-renderer** `text`（canvas 绘制）、**交互扩展** `TextInteraction`（缩放改字号）、**view 注册** `TextViewExtension`。它与画笔/连接线同属"把东西直接画在 canvas 上"的图元，但独有难点是**文字排版**——canvas 没有自动换行、没有行高、不懂 RTL，这些全得本包自己算。

### 1.2 两条"白板文本"路径，必须分清

AFFiNE 白板上输入文字其实有**两种底层形态**，本包是二者的交汇点：

- **画布文本图元 `TextElementModel`（`type='text'`）**：一段文字就是一个 canvas 图元，本包的 element-renderer 把它逐行 `fillText` 画出来。编辑时临时挂一个 `EdgelessTextEditor`（DOM）浮在上面。`edgeless-text-editor.ts:66` 的注释直言 **"Canvas Text has been deprecated"**——这是**旧路径**。
- **块式文本 `affine:edgeless-text`（`EdgelessTextBlockModel`）**：一个真正的块容器，里面装 `affine:paragraph` 等块，享有富文本全部能力（行内样式、列表…）。它的**模型与块组件在 `@blocksuite/affine-block-edgeless-text` 包**，不在本包。这是**新路径**，由 `enable_edgeless_text` 特性开关控制。

本包的 `TextTool`/双击/命令**同时服务两条路径**：开关开（`enable_edgeless_text`）就 `insertEdgelessTextCommand` 建**块式** `affine:edgeless-text`；开关关就 `addText` 建**画布** `TextElementModel`（`tool.ts:45-56`）。所以边界是：**块式文本的"块"在 block-edgeless-text，本包提供画布文本图元 + 新建两种文本的 gfx 工具 + 画布文字排版工具库**。

## 2. 目录与关键文件

```text
text/src/
├── index.ts                        # 聚合导出
├── view.ts                         # TextViewExtension：注册 view/renderer/tool/toolbar/交互/双击
├── store.ts                        # TextStoreExtension：Markdown/纯文本适配器
├── tool.ts                         # ★TextTool：点击新建（按 flag 分派块式/画布文本）
├── dblclick-add-edgeless-text.ts   # DblClickAddEdgelessText：空白处双击建文本（InteractivityExtension）
├── element-view.ts                 # TextElementView（双击编辑）+ TextInteraction（缩放改字号/拖宽换行）
├── edgeless-text-editor.ts         # EdgelessTextEditor：画布文本的浮层 DOM 编辑器 + mountTextElementEditor/addText
├── element-renderer/
│   ├── index.ts                    # ★text() element renderer：canvas 逐行 fillText + RTL 处理
│   └── utils.ts                    # ★排版工具库：wrapText/measureTextInDOM/getFontString/isRTL/normalizeTextBound...
├── commands/
│   └── insert-edgeless-text.ts     # insertEdgelessTextCommand：新建块式 affine:edgeless-text
├── toolbar/                        # 文本图元选中后的工具栏（字体/字号/颜色/对齐）
└── adapter/                        # text 图元 → markdown / plain-text 导出

# 相关但不在本包：
#   affine/model/.../text —— TextElementModel（画布文本模型）
#   blocksuite/affine/blocks/edgeless-text —— EdgelessTextBlockModel + 块组件（块式文本，新路径）
```

## 3. 实现细节

### 3.1 element-renderer：把 `Y.Text` 画到 canvas

`text` renderer（`element-renderer/index.ts:16`）是 `ElementRenderer<TextElementModel>`，核心步骤：

1. **旋转变换**：`ctx.setTransform(matrix.translateSelf(cx,cy).rotateSelf(rotate).translateSelf(-cx,-cy))`（`:28`）——绕图元中心旋转，所有文字随之转。
2. **排版**：`wrapTextDeltas(model.text, font, w)`（`:39`）按宽度 `w` 对每个 delta 做软换行，再 `deltaInsertsToChunks` 切成行。行高用 `getLineHeight`（`:41`，经 DOM 测量得到）。
3. **逐行逐 delta 绘制**：外层遍历行、内层遍历 delta，`ctx.fillText(str, x, (lineIndex+1)*lineHeightPx)`（`:74`）。水平偏移按 `textAlign`（left/center/right）算（`:42`）。`textBaseline='ideographic'`（`:54`）保证 CJK 对齐。
4. **颜色**：`renderer.getColorValue(model.color, DefaultTheme.textColor, true)` 走主题色解析。

### 3.2 RTL 混排的 canvas 陷阱与解法

canvas 的 `fillText` 对从右到左文字（阿拉伯/希伯来）与 LTR 混排时方向会错。本包的解法（`element-renderer/index.ts:61-69`）很"物理"：检测到 `isRTL(str)` 且**当前 canvas 不在 DOM 里**（`!ctx.canvas.isConnected`），就**临时 `document.body.append(ctx.canvas)`**，并设 `canvas.setAttribute('dir', 'rtl')`，画完再 `remove()`。因为浏览器只有在 canvas 挂载进 DOM 后才会按 `dir` 正确处理双向文本——这是绕开 canvas RTL bug 的实战技巧。

### 3.3 换行算法：`wrapText`（CSS word-wrap 的 canvas 复刻）

canvas 不会自动换行，本包在 `utils.ts:430` 手写了一套**对齐 CSS `word-wrap` 语义**的折行算法：

- 先按 `\n` 拆硬换行；每行若宽度 `≤ maxWidth` 直接保留。
- 否则用 `parseTokens`（`:383`）按空格切词，**连字符 `-` 特殊处理**：`non-profit` 切成 `non-` + `profit`（`:386-398`），因为 CSS 允许在连字符后断行。
- 逐词累加，超宽则换行；**单个词超过整行宽**时进入逐字符拆分（`:487`），用 `charWidth.calculate`（带缓存，`:401`）逐字累计。
- 行尾空格、连字符结尾不补空格等细节都对齐 CSS，保证"画布里的换行"与"编辑器 DOM 里的换行"视觉一致。

### 3.4 文字测量与缓存：`measureTextInDOM` / `charWidth`

canvas `measureText` 测不准行高，本包用**隐藏 DOM 实测**：`measureTextInDOM`（`utils.ts:46`）造一个隐藏 `<div><span>x</span></div>`，读 `getBoundingClientRect().height` 得行高与行间距，结果按 `字体+字重` 缓存，不同字号按比例缩放（`:60-64`）——一次测量全字号复用。字宽则用离屏 canvas 的 `measureText`，`charWidth` 做**逐字符、按字体缓存**（`:401`）避免重复测量。`getFontMetrics`（`:139`）还会校验 `ctx.font` 没被回退字体改写才缓存，防止测错。

### 3.5 交互：缩放的两种语义

`TextInteraction = GfxViewInteractionExtension(...)`（`element-view.ts:34`）区分了**角拖**与**边拖**两种缩放（`onResizeMove`，`:53`）：

- **左/右边中点拖（handle='left'|'right'）**：改的是**文本框宽度**→触发重新换行。`normalizeTextBound(..., dragging=true)`（`utils.ts:285`）按新宽度重排，并置 `model.hasMaxWidth=true`（`:80`，标记"用户手动限宽，之后按此宽度 wrap"）。
- **四角拖**：等比缩放，改的是**字号** `fontSize = initialFontSize * (newBound.w / originalBound.w)`（`:83`），`resizeConstraint.lockRatio` 锁定四角比例（`:38`）——即"角拖放大字、边拖改排版宽度"。

`stash`/`pop`（`:49`/`:89`）在缩放期间临时冻结 `fontSize`/`hasMaxWidth`，保证一次缩放是一个可撤销的原子操作。

### 3.6 新建文本：工具、双击、命令三入口

- **`TextTool.click`**（`tool.ts:45`）：点击画布。`enable_edgeless_text` 开 → `insertEdgelessTextCommand` 建块式文本并切回 `DefaultTool`；关 → `addText` 建画布 `TextElementModel`。
- **`DblClickAddEdgelessText`**（`dblclick-add-edgeless-text.ts:13`，`InteractivityExtension`）：在**空白处**双击（`getElementByPoint` 无命中）建文本，分派逻辑同上。
- **`insertEdgelessTextCommand`**（`commands/insert-edgeless-text.ts:16`）：用 `EdgelessCRUDIdentifier.addBlock('affine:edgeless-text', ...)` 建块容器，再 `addBlock('affine:paragraph', ...)` 塞一个段落子块，`focusTextModel` 聚焦。精彩处是**"空文本自动清理"**（`:78-108`）：新建后监听 `focusout`，若用户没输入任何字（段落 text 为空）就 `deleteBlock` 删掉空壳；一旦 `beforeinput`（开始打字）则 `abort` 取消清理——避免"点一下留下一堆空文本框"。

### 3.7 画布文本编辑器：`EdgelessTextEditor`

`mountTextElementEditor`（`edgeless-text-editor.ts:32`）给 `TextElementModel` 临时挂一个 `EdgelessTextEditor`（`ShadowlessElement`）浮层，用 `inlineEditor.focusIndex(cursorIndex)` 把光标定到双击处——光标位置由 `getCursorByCoord`（`utils.ts:253`）按点击坐标反算行号与字符偏移（含旋转还原 `rotatePoints`）。编辑完成即销毁浮层、文字回到 canvas 绘制。

## 4. 语法特色

- **`ElementRenderer<T>` 函数式渲染器**：renderer 是纯函数 `(model, ctx, matrix, renderer) => void`，用 `ElementRendererExtension('text', text)` 注册——与类式块组件不同，canvas 图元渲染是无状态函数。
- **`DOMMatrix` 链式变换**：`matrix.translateSelf(cx,cy).rotateSelf(rotate).translateSelf(-cx,-cy)` 用原生 `DOMMatrix` 的可变链式 API 表达"绕中心旋转"。
- **IIFE + 闭包缓存**：`charWidth`（`:401`）、`getMeasureCtx`（`:23`）用立即执行函数封装私有缓存 `Map`，对外只暴露 `calculate`/`getCache`——模块级单例缓存的经典写法。
- **`Writeable<T>` 映射类型**：`type Writeable<T> = { -readonly [P in keyof T]: T[P] }`（`:128`）去掉 `TextMetrics` 的 `readonly`，以便按比例缩放后重建一个可写副本。
- **`Command<Input, Output>` 泛型命令**：`insertEdgelessTextCommand` 声明入参 `{x,y}` 与输出 `{textId}`，`(ctx, next) => next({textId})` 的中间件式命令。
- **`stash`/`pop` 事务冻结**：交互期间冻结模型字段，配合 undo 系统把"一次拖拽"做成原子操作。
- **特性开关分派**：`FeatureFlagService.getFlag('enable_edgeless_text')` 在运行时在新旧两条文本路径间切换——渐进式迁移的典型手法。

## 5. 设计 / 实现亮点

- **canvas 文字排版自成体系**：在没有浏览器排版引擎的 canvas 上复刻 CSS `word-wrap`（含连字符断行、超长词拆字），还对齐了 DOM 编辑器的换行结果——"所见即所画"。
- **DOM 实测 + 多级缓存测量**：行高用隐藏 DOM 测、字宽用离屏 canvas 测，均按字体缓存且按字号比例缩放，兼顾准确与性能。
- **RTL 的务实绕坑**：临时把 canvas 挂进 DOM 借浏览器的双向文本算法，解决 canvas RTL 渲染错误——不优雅但有效。
- **缩放双语义**：角拖改字号、边拖改排版宽，符合用户直觉且各自触发不同的重排逻辑。
- **空文本自清理**：新建即监听，没输入就回收，杜绝空文本框污染画布。
- **一包两用**：既是画布文本图元的实现，又是全 edgeless 的 canvas 文字排版工具库（连接线标签、形状文字都依赖它），复用度极高。

## 6. 对外 API 与注意事项

- 主要导出：`TextTool`、`TextElementView`/`TextInteraction`、`TextElementRendererExtension`、`insertEdgelessTextCommand`、`mountTextElementEditor`、以及**排版工具** `wrapText`/`wrapTextDeltas`/`measureTextInDOM`/`getFontString`/`getLineHeight`/`getTextWidth`/`isRTL`/`normalizeTextBound`/`getCursorByCoord` 等；`./view` 的 `TextViewExtension`、`./store` 的 `TextStoreExtension`。
- **画布文本 `TextElementModel` 已废弃**：`edgeless-text-editor.ts:66` 明确标注 `@deprecated`。新内容应走块式 `affine:edgeless-text`（需 `enable_edgeless_text` 开关）。
- **块式文本模型不在本包**：`EdgelessTextBlockModel` 与块组件在 `@blocksuite/affine-block-edgeless-text`；本包只负责"新建它"的 gfx 工具与命令。
- **排版工具被多包复用**：改 `wrapText`/`measureTextInDOM` 会同时影响连接线标签、形状文字渲染，谨慎。
- **RTL 渲染可能短暂挂载 canvas 到 body**：若 canvas 本不在 DOM 中，RTL 文本绘制会临时 append/remove，极端场景需注意副作用。
- **`hasMaxWidth` 的含义**：true 表示"用户手动限过宽、按此宽 wrap"；边拖会置 true，不要误清。

## 7. 延伸

- 基础设施：`@blocksuite/std/gfx` 的 `GfxElementModelView`/`GfxViewInteractionExtension`/`InteractivityExtension`、`@blocksuite/std/inline` 的 `deltaInsertsToChunks`。
- 画布层：`@blocksuite/affine-block-surface` 的 `ElementRendererExtension`/`TextUtils`/`EdgelessCRUDIdentifier`/`DefaultTool`。
- 新路径：`@blocksuite/affine-block-edgeless-text`（块式 `affine:edgeless-text`，与本包画布文本并存）。
- 复用方：`@blocksuite/affine-gfx-connector`（标签 `wrapTextDeltas`）、`@blocksuite/affine-gfx-shape`（形状内文字排版）。
