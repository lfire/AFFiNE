# `@blocksuite/affine-fragment-outline`

> 一句话定位：文档**大纲 / 目录（Table of Contents）** fragment——扫描文档里的标题块（h1–h6）与 note，列成可点击跳转的目录；提供三种形态：完整的侧栏面板 `<affine-outline-panel>`、悬停展开的轻量 `<affine-outline-viewer>`、以及移动端菜单 `<affine-mobile-outline-menu>`；还支持滚动高亮当前标题、note 拖拽重排、显示模式切换。

| 项        | 值                                                                                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/fragments/outline`                                                                                                                                                                                                                                                          |
| 所属层    | L3 · 编辑器业务层（fragment UI）                                                                                                                                                                                                                                                               |
| 语言/形态 | TypeScript / Lit 组件库（样式用 vanilla-extract）                                                                                                                                                                                                                                              |
| 关键依赖  | `@blocksuite/affine-block-note`（`changeNoteDisplayMode`）、`@blocksuite/affine-fragment-doc-title`（`getDocTitleByEditorHost`）、`@blocksuite/affine-model`、`@blocksuite/affine-shared/services`（`DocModeProvider`）、`@lit/context`、`@preact/signals-core`、`@vanilla-extract/css`、`lit` |
| 被谁依赖  | 聚合包 `@blocksuite/affine`、宿主应用（侧栏/悬浮）                                                                                                                                                                                                                                             |
| 对外入口  | `.`（面板 / viewer / mobile 三组件）、`./view`（`OutlineViewExtension`）                                                                                                                                                                                                                       |

## 1. 设计逻辑

**先定位 fragment 的角色**：大纲是宿主挂载的、俯瞰整篇文档结构的导航面板。数据来源是"当前文档的标题块集合"——它只读地扫描块树、呈现层级，点击时命令编辑器滚动/聚焦，本身不持有编辑状态。

它要解决的独有问题，比其它 fragment 更"全景":

1. **多形态**：同一份目录数据要以三种 UI 呈现——桌面常驻面板（可排序、可改 note 显示模式）、悬停才展开的迷你 viewer（阅读态省空间）、移动端的扁平菜单。
2. **标题提取与层级**：从各 note 的子块里筛出 h1–h6 段落（忽略空标题），文档标题作为目录第 0 项。
3. **滚动高亮**：正文滚动时实时判定"当前视口中心所在的标题"并高亮对应目录项（scroll-spy）。
4. **跳转 + 高亮遮罩**：点目录项平滑滚动到对应块，并短暂打一层高亮遮罩引导视线。
5. **edgeless 联动**：白板模式下目录里的 note 可多选、拖拽重排、切换"在页面/白板/两者显示"的 displayMode，并与画布选区同步。

状态用一个 `TocContext`（signals + context）在面板的 header / body / card 间共享；工具函数（query / scroll / drag）独立成 utils。

## 2. 目录与关键文件

```text
src/
├── config.ts            # ★ TocContext、tocContext、标题图标/占位映射、headingKeys、settings key
├── outline-panel.ts     # ★ 桌面完整面板：provide TocContext，组合 header+body+notice
├── outline-viewer.ts    # 悬停展开的迷你目录（indicator 条 + 展开面板）
├── mobile-outline-panel.ts # 移动端扁平目录菜单
├── body/
│   ├── outline-panel-body.ts  # ★ 主体：note 卡列表、选区同步、拖拽重排、scroll-spy
│   └── outline-notice.ts      # 提示条（隐藏内容提醒等）
├── card/
│   ├── outline-card.ts        # note 卡：标题预览 + displayMode 切换 + 拖拽
│   └── outline-preview.ts     # 单个块的一行预览（图标 + 文本）
├── header/
│   ├── outline-panel-header.ts   # 顶部：标题 + 排序开关 + 设置入口
│   └── outline-setting-menu.ts   # 设置菜单（显示图标 / 排序）
├── utils/
│   ├── query.ts         # ★ getNotesFromStore / getHeadingBlocksFromDoc / isHeadingBlock
│   ├── scroll.ts        # ★ scroll-spy + scrollToBlockWithHighlight 高亮遮罩
│   ├── drag.ts          # note 拖拽数据类型
│   └── custom-events.ts # Select/FitView/ClickBlock/DisplayModeChange 事件类型
├── *.css.ts             # vanilla-extract 样式
├── view.ts              # OutlineViewExtension：仅注册 effects
├── effects.ts           # 定义 9 个自定义元素
└── index.ts             # 导出 panel / viewer / mobile
```

## 3. 实现细节

### 3.1 标题提取：query 工具

`utils/query.ts` 是数据源头。`isHeadingBlock` 判定一个块是否是标题——必须是段落块且 `type` 在 `headingKeys` 里（`query.ts:40-47`）：

```ts
export function isHeadingBlock(
  block: BlockModel
): block is ParagraphBlockModel {
  return (
    matchModels(block, [ParagraphBlockModel]) &&
    headingKeys.has(block.props.type$.value)
  );
}
```

`headingKeys` 来自 config：从占位映射里筛出 `h` 开头的 key（`config.ts:84-86`），即 h1–h6。`getHeadingBlocksFromDoc` 先按 displayMode 过滤出 note，再 `flatMap` 收集各 note 的标题块，可选忽略空标题（`query.ts:61-72`）。这套纯函数被三个组件和 scroll-spy 共用。

### 3.2 TocContext：面板内的状态总线

`config.ts:90-97` 定义共享状态并用 `createContext` 做成可注入：

```ts
export type TocContext = {
  editor$: Signal<EditorHost>;
  enableSorting$: Signal<boolean>;
  showIcons$: Signal<boolean>;
  fitPadding$: Signal<number[]>;
};
export const tocContext = createContext<TocContext>('tocContext');
```

`OutlinePanel` 在 `connectedCallback` 建 context 并 `@provide`（`outline-panel.ts:31-56,104-105`），body/header/card 用 `@consume` 取。`editor$` 用 signal 包裹是为了"编辑器可能被替换"——`willUpdate` 里 `editor` property 变化时写回 `editor$.value`（`outline-panel.ts:85-92`），下游 effect 自动跟随。

### 3.3 设置持久化到 localStorage

面板的"显示图标 / 启用排序"存 localStorage（key `outlinePanelSettings`）。`_setContext` 启动时读回，`_watchSettingsChange` 用 `effect` 在两值变化时写入（`outline-panel.ts:39-75`）。关键分支：**edgeless 模式强制 `enableSorting$ = true`**（`outline-panel.ts:48-53`）且不写 localStorage（`outline-panel.ts:61-62`）——白板下排序是必需能力，不受用户偏好影响。

### 3.4 scroll-spy：滚动高亮当前标题

`utils/scroll.ts` 的 `observeActiveHeadingDuringScroll`（`scroll.ts:55-82`）是目录高亮的核心：监听 window `scroll`（捕获阶段），每次遍历所有标题，用 `isBlockBeforeViewportCenter` 判断哪些已滚过视口中心，最后一个即"当前标题"：

```ts
let activeHeadingId = host.store.root?.id ?? null;
headings.forEach(heading => {
  if (isBlockBeforeViewportCenter(heading.id, host)) {
    activeHeadingId = heading.id;
  }
});
update(activeHeadingId);
```

`isBlockBeforeViewportCenter`（`scroll.ts:34-53`）用 `getBoundingClientRect` 与 `clamp` 过的编辑器中心线比较。body/viewer/mobile 三处都 `disposables.add(observeActiveHeadingDuringScroll(...))` 并写进各自的 `_activeHeadingId$` signal 驱动高亮（`outline-panel-body.ts:362-370`）。注意跳转时置 `_lockActiveHeadingId = true` 临时屏蔽 scroll-spy，避免跳转动画途中高亮乱跳。

### 3.5 跳转 + 高亮遮罩

点目录项走 `_scrollToBlock`（`outline-panel-body.ts:197-218`）：先设选区（文档标题特殊处理为 `focusTitle`，复用 doc-title 的 `getDocTitleByEditorHost`，见 `scroll.ts:16-24`），再 `scrollToBlockWithHighlight`。后者（`scroll.ts:156-201`）颇有讲究——因为 `scrollIntoView({behavior:'smooth'})` 是异步动画，它用 `setInterval(100)` **轮询块的 `top` 直到稳定**（连续两次相同），才认为滚动结束并打高亮遮罩：

```ts
if (top !== lastTop) {
  timeCount += 100;
  lastTop = top;
  return;
}
clearInterval(highlightIntervalId);
resolve(highlightBlock(host, blockId)); // :195-198
```

`highlightBlock`（`scroll.ts:87-152`）在根组件里绝对定位一个半透明 `div` 盖住目标块，1 秒后隐藏，返回清理函数。模块级单例 `highlightMask` / `highlightTimeoutId` 保证同时只有一层遮罩。

### 3.6 note 卡：displayMode 切换与拖拽

edgeless 文档里 note 有三种显示模式（DocOnly / DocAndEdgeless / EdgelessOnly）。`OutlineNoteCard` 展示 note 的标题子块预览，并提供一个弹出面板切 displayMode（`outline-card.ts:222-231`），切换派发 `displaymodechange` 事件，body 的 `_handleDisplayModeChange` 执行 `changeNoteDisplayMode` 命令；若改为 DocOnly 还要把它从画布选区移除（`outline-panel-body.ts:140-154`）。

拖拽用 `std.dnd`（BlockSuite 的拖拽服务）：卡片 `draggable`（`outline-card.ts:91-136`），body `dropTarget` + `monitor` + `autoScroll`（`outline-panel-body.ts:317-356`）。拖拽预览用 `ContextProvider` 手动把 `tocContext` 注入到 drag preview 容器（`outline-card.ts:112-134`）——因为 preview DOM 脱离了原组件树，拿不到 `@consume` 的 context，必须手动供给。重排落到 `_moveSelectedNotes`（`outline-panel-body.ts:156-195`）直接改根节点 children 顺序。

### 3.7 选区双向同步（edgeless）

body 用一组按 displayMode 分桶的 signal 存选中 note（`outline-panel-body.ts:62-77`），`_selectNote` 处理面板侧选择并写画布 gfx 选区（`outline-panel-body.ts:220-261`），`_watchSelectedNotes` 反向订阅画布 `SurfaceSelection` 回填面板（`outline-panel-body.ts:263-288`）。两者都只在 edgeless 模式生效（page 模式 note 不参与画布选区）。`batch(() => ...)` 把多个 signal 更新合并成一次通知（`outline-panel-body.ts:278-286`）。

### 3.8 OutlineViewer：悬停展开

`outline-viewer.ts` 是阅读态的轻量形态：平时在右侧显示一排短横 indicator（每个标题一条，当前标题的那条变长变深，`outline-viewer.ts:255-271`），hover 整个 root 时用纯 CSS `:hover` 展开出 200px 的目录面板（`outline-viewer.ts:133-148`）。它还提供"在侧栏打开"按钮，点了就 `toggleOutlinePanel()` 切到完整面板。edgeless 模式或无标题时 `render` 返回 `nothing` 不显示（`outline-viewer.ts:224-235`）。

## 4. 语法特色

- **vanilla-extract 零运行时 CSS**：样式写在 `*.css.ts`，`import * as styles from './outline-panel.css'` 后用 `class=${styles.outlineCard}`（`outline-card.ts:17,184`）。编译期生成原子类名、带类型，`@query(\`.${styles.displayModeButtonGroup}\`)`（`outline-card.ts:252`）还能把生成的类名反用于选择器——CSS 也享受 TS 类型安全。
- **`@requiredProperties` 装饰器**：`@requiredProperties({ editor: PropTypes.object })`（`outline-panel.ts:19-21`）在类级声明"editor 必传"，运行时校验，比 `!` 非空断言多一层保障。
- **computed 派生 signal**：`_allSelectedNotes$ = computed(() => [...三种 mode].flatMap(...))`（`outline-panel-body.ts:71-77`）把三个分桶 signal 派生成一个合集，自动随上游更新。
- **`batch` 批量更新**：`batch(() => { ...多个 signal 赋值 })`（`outline-panel-body.ts:278-286`）合并通知、避免中间态重渲。
- **Record 映射类型**：`_selectedNotes$: Record<NoteDisplayMode, Signal<NoteBlockModel[]>>`（`outline-panel-body.ts:62-69`）用枚举做 key 的强类型字典；`previewIconMap`/`placeholderMap` 用 `Record<ParagraphType, TemplateResult>` 把标题类型映射到图标（`config.ts:29-55`）。
- **`ContextProvider` 命令式注入**：drag preview 脱离组件树，用 `new ContextProvider(container, { context: tocContext, initialValue })` + `hostConnected()` 手动补上 context（`outline-card.ts:129-133`）——揭示了 `@consume` 背后的运行时机制。
- **Lit 指令 `when` / `repeat` / `classMap`**：`when(dragging, () => indicator)`（`outline-panel-body.ts:434-441`）、`repeat(notes, n=>n.id, ...)`（`:406-429`）声明式条件与列表。
- **模块级单例做全局遮罩**：`let highlightMask / highlightTimeoutId / highlightIntervalId`（`scroll.ts:84-85,155`）用模块作用域变量保证整个应用同时只有一层高亮，跨组件共享。

## 5. 设计 / 实现亮点

- **一套数据、三种形态**：query 纯函数产出目录数据，panel / viewer / mobile 各取所需渲染——复用数据层、分化表现层，是"同一信息多终端呈现"的范式。
- **轮询稳定再高亮**：`scrollToBlockWithHighlight` 用 `top` 连续相等判定 smooth-scroll 结束，解决了"异步滚动动画何时结束"这个没有原生事件的难题。
- **scroll-spy 的锁**：跳转期间 `_lockActiveHeadingId` 屏蔽滚动监听，避免程序化滚动与用户滚动的高亮打架。
- **拖拽预览的 context 补给**：意识到 drag preview DOM 在组件树之外，用 `ContextProvider` 命令式注入，细节到位。
- **edgeless 强制排序**：白板下 `enableSorting$` 恒真且不落盘，把"模式决定能力"与"用户偏好"正确分层。
- **note 卡与画布选区双向同步 + batch**：面板与画布互为镜像，signal 分桶 + computed + batch 把复杂多态选区管理得清晰高效。

## 6. 对外 API 与注意事项

- 主要导出（`.`）：`OutlinePanel`/`AFFINE_OUTLINE_PANEL`、`OutlineViewer`/`AFFINE_OUTLINE_VIEWER`、`MobileOutlineMenu`/`AFFINE_MOBILE_OUTLINE_MENU` 及内部组件；`./view` 导出 `OutlineViewExtension`。
- **用法**：装载 `OutlineViewExtension`（`effect()` → `effects()` 定义 9 个标签）后，桌面挂 `<affine-outline-panel .editor=${host} .fitPadding=${[...]}></affine-outline-panel>`，阅读态挂 `<affine-outline-viewer .editor=${host} .toggleOutlinePanel=${fn}>`；`editor`（`EditorHost`）必传（`@requiredProperties` 会校验）。
- **注意**：
  - 目录只认 **h1–h6 段落块**作为标题（`isHeadingBlock`），其它块不入目录；空标题默认被忽略（`ignoreEmpty`）。
  - 滚动高亮监听的是 **window `scroll`（捕获阶段）**，依赖正文在可滚动容器内；跳转高亮依赖根组件是 `affine-page-root` 且有 `viewport`（`scroll.ts:92-100`），edgeless 模式 viewer/mobile 直接不渲染。
  - 跨 fragment 依赖 `@blocksuite/affine-fragment-doc-title` 的 `getDocTitleByEditorHost` 来定位/滚动到文档标题项——两包有直接依赖关系。
  - 拖拽重排仅对**非 EdgelessOnly** 的 note 开放（`canDrag`/`canDrop`，`outline-card.ts:93-94,144-146`）。
  - `view.ts` 只注册 effects，组件挂载位置由宿主决定。

## 7. 延伸

- 机制依赖：`@blocksuite/affine-ext-loader`（`ViewExtensionProvider`，见 `blocksuite-affine-ext-loader.md`）。
- 协作 fragment：`@blocksuite/affine-fragment-doc-title`（标题定位，见 `blocksuite-affine-fragment-doc-title.md`）；`frame-panel`（同为卡片列表 + 拖拽 + 画布选区联动，可对照）。
- 数据来源：`@blocksuite/affine-model`（`ParagraphBlockModel`/`NoteBlockModel`/`NoteDisplayMode`）、`@blocksuite/affine-block-note`（`changeNoteDisplayMode`）、`@blocksuite/affine-shared/services`（`DocModeProvider`）。
- 上层聚合：`@blocksuite/affine` 把 `OutlineViewExtension` 收进 `getInternalViewExtensions()`（见 `blocksuite-affine.md`）。
