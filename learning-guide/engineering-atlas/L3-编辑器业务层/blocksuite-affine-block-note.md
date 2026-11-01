# `@blocksuite/affine-block-note`

> 一句话定位：AFFiNE 的**容器块（hub）**——它不承载文本，而是"装内容块的盒子"。同一个 `affine:note` flavour 在**页面模式**里是承载正文的内容容器（`<affine-note>`，几乎透明），在**白板模式**里是一张可拖拽、可缩放、可折叠、带边框阴影的**便签**（`<affine-edgeless-note>`，GFX 图元）。它独有的核心是**"一块两视图"的双角色装配**、**`displayMode` 控制在页面/白板的可见性**、以及作为容器块所承担的**整块结构性键盘操作**（块选区上下移动、缩进、Enter 新建、Mod-a 全选）。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/note`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 所属层    | L3 · 编辑器业务层（内容块 / 容器块）                                                                                                                                                                                                                                                                                                                                                                                                                |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 关键依赖  | `@blocksuite/std`（`BlockComponent`/`toGfxBlockComponent`/`KeymapExtension`）、`@blocksuite/std/gfx`（`GfxViewInteractionExtension`）、`@blocksuite/affine-model`（`NoteBlockModel`/`NoteDisplayMode`）、`@blocksuite/affine-block-surface`（`EdgelessLegacySlotIdentifier`）、`@blocksuite/affine-fragment-doc-title`、`@blocksuite/affine-gfx-turbo-renderer`、`@blocksuite/global/gfx`（`Bound`）、`@blocksuite/affine-widget-slash-menu`、`lit` |
| 被谁依赖  | `@blocksuite/affine-block-root`（根块把 note 当文档内容容器）、编辑器预设、`@affine/core`                                                                                                                                                                                                                                                                                                                                                           |
| 对外入口  | `.`、`./store`、`./view`、`./turbo-painter`                                                                                                                                                                                                                                                                                                                                                                                                         |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | note 实现                                                                                                                                          | 独有之处                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| schema/model                      | 复用 `affine-model` 的 `NoteBlockSchema`/`NoteBlockModel`（`role: 'hub'`，`parent:['@root']`，`children:['@content',database,data-view,callout]`） | 用 `GfxCompatible(BlockModel)` 混入，带 `xywh`/`index`/`displayMode`/`edgeless` 等图元属性 |
| `*-block.ts`                      | **两个**组件：`note-block.ts`→`NoteBlockComponent`（页面）；`note-edgeless-block.ts`→`EdgelessNoteBlockComponent`（白板）                          | 同 flavour 双视图，见 3.2                                                                  |
| service                           | 无独立 service                                                                                                                                     | —                                                                                          |
| inline                            | 无（容器块无文本）                                                                                                                                 | —                                                                                          |
| keymap                            | `note-keymap.ts`→`NoteKeymapExtension`（块选区结构操作）                                                                                           | 针对"选中整块后"的操作，非文本编辑                                                         |
| commands                          | `commands/`：indent/dedent(-to-root)、block-type、change-display-mode、align、select-block(s)                                                      | 容器级结构命令                                                                             |
| widgets/configs                   | `configs/`：slash-menu、toolbar（仅白板）、tooltips；`components/`：背景/遮罩/折叠/样式面板等白板 UI                                               | 白板便签特有的大量 UI                                                                      |
| adapters                          | `adapters/`：html/markdown/plain-text，且分 `DocNote*` 与 `EdgelessNote*` 两套                                                                     | 按 doc/edgeless 模式注册不同 adapter                                                       |
| turbo                             | `turbo/note-layout-handler` + painter worker                                                                                                       | 白板缩放快照                                                                               |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define`（注册 8 个自定义元素）+ `NoteViewExtension`/`NoteStoreExtension`（都按 scope/mode 分支）                                   | 装配本身就按模式二分                                                                       |

### 便签/容器双角色的独有问题

1. **一块两视图**：同一份 `NoteBlockModel` 数据，在页面模式要渲染成"透明的内容流容器"，在白板模式要渲染成"有坐标、尺寸、边框、阴影、可交互的卡片"。两套视图差异巨大，却共享一个 flavour 与一份数据——这由 `view.ts` 按 scope 注册不同自定义元素解决。
2. **`displayMode` 三态可见性**：note 有 `DocOnly`/`EdgelessOnly`/`DocAndEdgeless` 三种显示模式，决定它在页面、白板、还是两处都可见——白板里 `DocOnly` 的 note 不渲染、不可框选。
3. **"页面块"的识别**：白板里第一个非 `EdgelessOnly` 的 note 被认定为"页面块"（`isPageBlock()`），它要显示文档标题、不显示折叠按钮——这是把"整篇文档"作为白板上一张特殊便签呈现的机制。
4. **白板交互**：拖拽、缩放（带 scale 与宽高约束）、折叠（collapse/collapsedHeight）、点击进入编辑、点击空白处自动在末尾建段落——全套图元交互。

## 2. 目录与关键文件

```text
src/
├── note-block.ts            # ★NoteBlockComponent：页面模式，几乎只有 renderChildren
├── note-edgeless-block.ts   # ★EdgelessNoteBlockComponent + EdgelessNoteInteraction：白板便签 + 图元交互
├── note-keymap.ts           # ★NoteKeymap：块选区的结构性键盘（上下移动/缩进/Enter/Mod-a/Esc）
├── note-edgeless-block.css.ts
├── config.ts                # NoteConfigExtension：edgelessNoteHeader/pageBlockTitle 注入点
├── edgeless-clipboard-config.ts
├── move-block.ts            # 块移动工具
├── quick-action.ts
├── commands/                # indent/dedent(-to-root)、display-mode、align、select-block(s)
├── components/              # 白板 UI：background/mask/shadow-menu/border/display-mode/style-panel/page-title
├── configs/                 # slash-menu、toolbar（白板）、tooltips
├── adapters/                # html/markdown/plain-text（Doc 与 Edgeless 两套）
├── turbo/                   # note-layout-handler + painter worker
├── view.ts store.ts effects.ts index.ts
```

## 3. 实现细节

### 3.1 model：用 GfxCompatible 把"块"变成"图元"

`NoteBlockModel`（`model/src/blocks/note/note-model.ts`）是理解双角色的钥匙——它用混入 `GfxCompatible<NoteProps>(BlockModel)` 让一个普通块同时具备图元几何能力：

```ts
export class NoteBlockModel
  extends GfxCompatible<NoteProps>(BlockModel)
  implements GfxElementGeometry { … }
```

- **schema 角色是 `hub`**（`metadata.role`）：note 是"枢纽"而非 `content`——它是内容块与根块之间的容器层。`parent:['@root']` 表示只能挂在根块下，`children` 白名单含 `@content`（所有内容块）、database、data-view、callout。
- **图元属性**：`xywh`（坐标尺寸）、`index`（fractional index 排序）、`displayMode`、`edgeless`（边框/圆角/阴影/collapse/scale）来自 `GfxCompatibleProps`——这些属性在页面模式几乎不用，在白板模式是便签的全部外观来源。
- **`displayMode` 决定可选中性**：`_isSelectable()` 判断 `displayMode !== DocOnly`，并以此 override `containsBound`/`includesPoint`/`intersectsBound`——`DocOnly` 的 note 在白板上对框选/命中测试完全"隐形"。
- **`isEmpty()`**：无子块，或唯一子块是空段落，即视为空（`:150-159`）——供删除空 note 等逻辑使用。
- **`isPageBlock()`**（`:158-166`）：在父级 children 里找第一个 `displayMode !== EdgelessOnly` 的 note，若就是自己则为页面块。这是"白板上代表整篇文档的那张特殊 note"的判定。

### 3.2 ★一块两视图：view.ts 按 scope 分支装配

note 最具代表性的设计是**同一 flavour 注册两个完全不同的自定义元素**，`NoteViewExtension.setup`（`view.ts:26-46`）：

```ts
context.register([
  FlavourExtension(flavour),
  NoteSlashMenuConfigExtension,
  NoteKeymapExtension,
]);
const isEdgeless = this.isEdgeless(context.scope);
if (isEdgeless) {
  context.register(BlockViewExtension(flavour, literal`affine-edgeless-note`));
  context.register(createBuiltinToolbarConfigExtension(flavour));
  context.register(EdgelessClipboardNoteConfig);
  context.register(EdgelessNoteInteraction);
} else {
  context.register(BlockViewExtension(flavour, literal`affine-note`));
}
```

- **页面 scope** → `affine:note` 绑定到 `<affine-note>`（`NoteBlockComponent`）。
- **白板 scope** → 绑定到 `<affine-edgeless-note>`（`EdgelessNoteBlockComponent`），并额外注册工具栏、剪贴板配置、GFX 交互扩展。
- 同理 `store.ts` 按 `options.mode` 注册 `DocNoteBlockAdapterExtensions` 或 `EdgelessNoteBlockAdapterExtensions`——连序列化都分模式。
- 这体现了范式里 **view/store 分离 + scope 差异化装配** 的威力：一份数据模型，运行期按"在哪个编辑器"装不同的视图与交互。

### 3.3 页面视图：极简的内容容器

`NoteBlockComponent`（`note-block.ts`）是全仓最简的容器之一——它继承**基础 `BlockComponent`**（注意：不是 `CaptionedBlockComponent`），`renderBlock` 只渲染子块容器：

```ts
override renderBlock() {
  return html`<div class="affine-note-block-container">
    <div class="affine-block-children-container">
      ${this.renderChildren(this.model)}
    </div>
  </div>`;
}
```

- 样式只有 `display: flow-root`（创建 BFC 容纳子块外边距）与选中态背景。页面模式的 note 对用户几乎不可见——它只是"正文从这里开始"的结构边界。

### 3.4 ★白板视图：toGfxBlockComponent 把页面组件升级为图元

`EdgelessNoteBlockComponent`（`note-edgeless-block.ts:32-34`）的关键一行：

```ts
export class EdgelessNoteBlockComponent extends toGfxBlockComponent(NoteBlockComponent) { … }
```

`toGfxBlockComponent` 是 std/gfx 的**高阶组件**：它接收一个普通 `BlockComponent` 子类，返回一个具备 GFX 能力（`renderGfxBlock`/`getRenderingRect`/`getCSSScaleVal`/视口感知）的新类——于是白板 note "免费"继承页面 note 的子块渲染（`renderPageContent()` 复用 `renderChildren`），再叠加卡片外观与交互。要点：

- **`getRenderingRect()`**（`:230-245`）：从 `xywh` 反序列化 `Bound`，按 `edgeless.scale` 换算真实宽高，返回给 GFX 层用于定位；折叠时高度取固定值、否则 `'unset'`（让内容撑开）。
- **`renderGfxBlock()`**（`:247-349`）：`DocOnly` 直接 `nothing` 不渲染；否则渲染背景（`<edgeless-note-background>`）、裁剪容器、页面标题（`<edgeless-page-block-title>`）、`contenteditable` 的内容区、遮罩（`<edgeless-note-mask>`）、折叠按钮、折叠内容预览。
- **折叠**：`edgeless.collapse`/`collapsedHeight` 控制；`_setCollapse`（`:130-150`）切换折叠并回写 `xywh.h`；`_collapsedContent()`（`:48-85`）在选中/悬停/编辑时渲染被折叠部分的半透明预览。
- **悬停/编辑态**：`_isHover`/`_editing`/`_isResizing` 三个 `@state accessor` 驱动；`_editing` 来自 `gfx.selection.editing`，`firstUpdated` 用 `MutationObserver` 监听内容高度变化以更新 `_noteFullHeight`（`:201-212`）。
- **`getCSSScaleVal()`**（`:224-228`）：在基类 scale 上再乘 `edgeless.scale`——便签整体可缩放。

### 3.5 ★白板交互：GfxViewInteractionExtension

`EdgelessNoteInteraction`（`note-edgeless-block.ts:383-531`）用 `GfxViewInteractionExtension(flavour, {...})` 声明 note 在白板上的交互策略，是"把块变成可操作图元"的配置中枢：

- **`resizeConstraint`**：`minWidth: 170+48`、`minHeight: 92`——便签不能缩到比内容更小。
- **`handleRotate`**：`beforeRotate` 里 `set({ rotatable: false })`——note 禁止旋转。
- **`handleResize`**（`:400-438`）：`onResizeStart` 先 `model.stash('edgeless')`（把 edgeless 属性压栈，便于撤销），`onResizeMove` 里按 `lockRatio` 决定是等比缩放（改 `scale`）还是自由改宽高（超过 minHeight 则自动开启 `collapse` 并记 `collapsedHeight`），`onResizeEnd` `model.pop('edgeless')`。
- **`handleSelection`**（`:439-529`）：最精巧的部分——单击已选中/编辑态的 note 进入编辑 `gfx.selection.set({editing:true})`，然后根据点击位置决定落点：点在标题上 → `handleNativeRangeAtPoint` 聚焦标题；note 无子块 → 自动 `addBlock('affine:paragraph')` 并聚焦；否则在内容区内 `clamp` 坐标后把光标落到最近位置。这解决了"点击一张空白便签该怎么开始打字"的体验问题。

### 3.6 ★容器级键盘：NoteKeymap

`NoteKeymap`（`note-keymap.ts`）绑定在 `affine:note` flavour 上，但它处理的是**块选区**（选中整块后）而非文本编辑——与 paragraph 的文本键盘互补：

- **ArrowUp/Down**（`_onArrowUp`/`_onArrowDown`）：在块选区间上下移动，用 `selectBlock` 命令切换选中块。
- **Shift-ArrowUp/Down**：扩展块选区（`selectBlocksBetween`）。
- **Enter**（`_onEnter`，`:469-520`）：选中某块时回车，在其后插入一个空段落并把选区转为该段落的 `TextSelection`——"选中块→回车→在下面开始打字"。
- **Tab/Shift-Tab/Mod-Backspace**（`:606-629`）：对选中块执行 `indentBlocks`/`dedentBlocks`/`dedentBlocksToRoot`——整块缩进/反缩进/提到根层。
- **Mod-a**（`_onSelectAll`，`:543-565`）：先选中块所在 note 的全部直接子块（再按一次通常是全文）。
- **Esc**（`_onEsc`）：清除块选区。
- `hotKeys` getter 还合并了移动块、快捷动作、文本类型转换、文本对齐四组热键（`_bindMoveBlockHotKey` 等，`:600-605`）。

### 3.7 displayMode 与"页面块"

`NoteDisplayMode` 三态贯穿全包：`renderGfxBlock` 对 `DocOnly` 返回 `nothing`；`onBoxSelected` 对 `DocOnly` 返回 `false`（不参与框选，`:351-353`）；model 的命中测试对 `DocOnly` 全部拒绝。`isPageBlock()` 的 note 由 `<edgeless-page-block-title>` 渲染文档标题（`components/edgeless-page-block-title.ts`），且折叠按钮对页面块隐藏（`:328`）——白板上那张"承载正文的大 note"就是整篇文档的化身。

## 4. 语法特色

- **混入（mixin）类**：`GfxCompatible<NoteProps>(BlockModel)` 与 `toGfxBlockComponent(NoteBlockComponent)` 都是"类工厂"——接收一个基类、返回增强后的子类，用 TypeScript 的高阶类型保留泛型信息。这是 BlockSuite 在"普通块"与"图元块"之间复用代码的核心手法，note 同时用在 model 层与 view 层。
- **`@state() accessor`**：`_editing`/`_isHover`/`_isResizing`/`_noteFullHeight` 用 Lit 的 `@state` + `accessor` 声明内部响应式状态，变化触发重渲。
- **`@query` 绑 DOM**：`@query('doc-title') accessor _docTitle`、`@query('.clipContainer > div') accessor _noteContent` 把模板里的元素引用绑定到字段。
- **`literal` 静态标签 + scope 分支**：`` BlockViewExtension(flavour, literal`affine-edgeless-note`) ``vs`` literal`affine-note` ``——同一 flavour 在不同 scope 注册不同标签名，是"一块两视图"的语法落点。
- **`model.stash` / `model.pop`**：图元属性的"快照压栈/出栈"，用于 resize 过程中的临时修改与撤销边界。
- **`Bound.deserialize(xywh)` / `.serialize()`**：`xywh` 字符串 `[x,y,w,h]` 与 `Bound` 对象互转，是白板坐标系的统一表示。
- **zod schema 默认值**：`NoteZodSchema` 用 `.default({...})` 为 note 的外观属性声明运行时默认——弥补类型擦除后的默认值需求。

## 5. 设计 / 实现亮点

- **"一块两视图"的彻底落地**：同一份数据、同一 flavour，页面模式是透明容器、白板模式是富交互卡片，靠 `view.ts` 按 scope 注册不同自定义元素 + `toGfxBlockComponent` 复用渲染逻辑实现。这是 BlockSuite "doc/edgeless 双模式共享文档模型"架构的最典型样本。
- **mixin 跨维度复用**：model 用 `GfxCompatible` 混入几何能力、view 用 `toGfxBlockComponent` 混入 GFX 渲染——同一组能力通过类工厂注入到数据层与视图层，避免为"白板块"重写一套。
- **`displayMode` 统一可见性语义**：三态显示模式在 model 命中测试、view 渲染、框选、adapter 注册四处联动，一个字段贯穿表现与持久化。
- **便签交互的细腻**：resize 自动折叠、点击空白便签自动建段落并精确落点、页面块显示标题且禁折叠——把"白板上的内容卡片"该有的手感做全。
- **容器键盘与文本键盘分层**：NoteKeymap 管块选区结构操作、ParagraphKeymap 管文本编辑，两者绑在不同 flavour、各司其职，组合出完整的键盘模型。

## 6. 对外 API 与注意事项

- 主要导出：`NoteBlockComponent`、`EdgelessNoteBlockComponent`、`EdgelessNoteInteraction`、`NoteConfigExtension`（注入 `edgelessNoteHeader`/`pageBlockTitle`/`pageBlockViewportFitAnimation`）、各容器命令、turbo handler；装配入口 `NoteViewExtension`（`./view`）、`NoteStoreExtension`（`./store`，带 `mode` 选项）。
- **约定**：白板便签的页眉与页面标题通过 `NoteConfigExtension` 注入；`NoteStoreExtension` 需按编辑器模式传 `mode:'doc'|'edgeless'` 以注册对应 adapter。
- **注意**：
  - note 是容器块（`role:'hub'`），不可编辑、无 caption/inline；交互是整块级（选区、拖拽、折叠），不要给它加文本逻辑。
  - `displayMode === DocOnly` 的 note 在白板上既不渲染也不可框选/命中——调试"白板上看不到 note"先查 displayMode。
  - "页面块"是推导量（`isPageBlock()` 实时从兄弟中算第一个可见 note），不要缓存；它影响标题显示与折叠按钮。
  - resize/折叠会回写 `xywh` 与 `edgeless.scale/collapse/collapsedHeight`；改这些属性经 `stash/pop` 以保证撤销边界正确。
  - 页面与白板用不同自定义元素（`affine-note` vs `affine-edgeless-note`），同一 flavour 两套视图——改渲染时注意改对分支。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`NoteBlockModel`/`NoteDisplayMode`/`GfxCompatible`）、`@blocksuite/std`（`BlockComponent`/`toGfxBlockComponent`/`KeymapExtension`）、`@blocksuite/std/gfx`（`GfxViewInteractionExtension`）、`@blocksuite/global/gfx`（`Bound`）。
- 同层协作：`@blocksuite/affine-block-surface`（白板画布与图元渲染，note 作为 GFX 块挂在 surface 之上；`EdgelessLegacySlotIdentifier`）、`@blocksuite/affine-block-root`（根块把 note 当文档内容容器，见 `blocksuite-affine-block-root.md`）、`@blocksuite/affine-fragment-doc-title`（文档标题）、`@blocksuite/affine-gfx-turbo-renderer`（缩放快照）。
- 对照阅读：`blocksuite-affine-block-paragraph.md`（note 的典型子块）、`blocksuite-affine-block-surface.md`（note 在白板上的宿主画布）、`blocksuite-affine-block-root.md`（note 之上的根块与双模式）。
