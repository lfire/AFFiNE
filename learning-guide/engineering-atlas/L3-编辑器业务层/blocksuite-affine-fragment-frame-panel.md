# `@blocksuite/affine-fragment-frame-panel`

> 一句话定位：白板（edgeless）模式下的**画框（Frame）管理面板** fragment——把画布里所有 `affine:frame` 以缩略卡片列成一栏，支持点选、双击定位、拖拽重排"演示序"，并提供一键进入演示（Presentation）模式及其播放设置。

| 项        | 值                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/fragments/frame-panel`                                                                                                                                                                                                                                                                                 |
| 所属层    | L3 · 编辑器业务层（fragment UI）                                                                                                                                                                                                                                                                                          |
| 语言/形态 | TypeScript / Lit 组件库                                                                                                                                                                                                                                                                                                   |
| 关键依赖  | `@blocksuite/affine-block-frame`（`EdgelessFrameManager` / `PresentTool`）、`@blocksuite/affine-block-surface`（`EdgelessLegacySlotIdentifier`）、`@blocksuite/affine-ext-loader`（`ViewExtensionManagerIdentifier`）、`@blocksuite/std/gfx`（`GfxControllerIdentifier`）、`@blocksuite/affine-model`、`lodash-es`、`lit` |
| 被谁依赖  | 聚合包 `@blocksuite/affine`、宿主应用（侧栏挂 `<affine-frame-panel>`）                                                                                                                                                                                                                                                    |
| 对外入口  | `.`（全部组件）、`./view`（`FramePanelViewExtension`）                                                                                                                                                                                                                                                                    |

## 1. 设计逻辑

**先定位 fragment 的角色**：frame-panel 是宿主在白板侧栏挂载的大号面板，数据来源是"当前 edgeless 文档里的所有 frame 块"。它与画布是**双向联动**的两套视图：面板里选中一张卡 → 画布里选中该 frame；画布里拖动 frame 顺序或增删 → 面板列表刷新。它不属于画布内部（那是 widget 的地盘），而是独立于画布之外、俯瞰全局的"frame 目录 + 演示控制台"。

它要解决的独有问题：

1. **frame 列表的实时镜像**：从 `store.getBlocksByFlavour('affine:frame')` 取 frame，按"演示序"排序展示，并随文档块增删实时更新。
2. **缩略图**：每张卡要显示 frame 区域的真实渲染缩略——这需要在卡片里跑一个**只读的微型 edgeless 编辑器**，把视口对准该 frame 的 bound。
3. **拖拽重排演示序**：用户拖动卡片改变 frame 的 `presentationIndex`（用分数索引 `generateKeyBetweenV2` 避免整体重排）。
4. **进入演示**：一键切到 edgeless + 激活 `PresentTool`，并暴露 Fill Screen / Dark background / Hide toolbar 等播放设置。

组件分三层：`FramePanel`（壳）→ `FramePanelHeader`（演示入口 + 设置）+ `FramePanelBody`（列表 + 拖拽）；卡片再细分 `FrameCard`（卡壳 + 拖拽事件）→ `FramePreview`（缩略渲染）+ `FrameCardTitle`（标题）。

## 2. 目录与关键文件

```text
src/
├── frame-panel.ts         # ★ FramePanel 壳：组合 header + body，透传 host / fitPadding
├── body/
│   └── frame-panel-body.ts  # ★ 列表主体：frame 收集/排序、选区联动、拖拽重排、空态
├── header/
│   ├── frame-panel-header.ts   # 顶部：All frames 设置入口 + Presentation 按钮
│   └── frames-setting-menu.ts  # 播放设置菜单（Fill Screen/Dark background/Hide toolbar）
├── card/
│   ├── frame-card.ts            # 单卡：选中/双击定位/拖拽的事件派发
│   ├── frame-preview.ts         # ★ 缩略图：只读微型 edgeless，视口对准 frame bound
│   ├── frame-card-title.ts      # 卡片标题展示
│   └── frame-card-title-editor.ts # 卡片标题就地编辑
├── utils/drag.ts          # startDragging：拖拽排序的底层交互
├── view.ts                # FramePanelViewExtension：仅注册 effects
├── effects.ts             # 定义 8 个自定义元素
└── index.ts               # 汇总导出
```

## 3. 实现细节

### 3.1 frame 收集与"演示序"排序

body 的 `frames` getter 从 store 取所有 `affine:frame` 并用 `EdgelessFrameManager.framePresentationComparator` 排序（`frame-panel-body.ts:29,158-163`）：

```ts
const compare = EdgelessFrameManager.framePresentationComparator; // :29
get frames() {
  const frames = this.editorHost.store
    .getBlocksByFlavour('affine:frame')
    .map(block => block.model as FrameBlockModel);
  return frames.sort(compare);
}
```

每个 frame 映射成 `FrameListItem { frame, frameIndex, cardIndex }`，其中 `frameIndex = presentationIndex ?? index`（`frame-panel-body.ts:150-156`）——演示序优先用 `presentationIndex`（用户拖出来的），缺省回落到几何 `index`。

### 3.2 面板 ↔ 画布选区双向同步

**面板→画布**：`_selectFrame` 处理卡片派发的 `select` 事件，维护 `_selected: string[]`（支持 shift 多选），再写进画布的 gfx 选区（`frame-panel-body.ts:132-148`）：

```ts
this._gfx.selection.set({ elements: this._selected, editing: false });
```

`_gfx` 即 `editorHost.std.get(GfxControllerIdentifier)`（`frame-panel-body.ts:128-130`）——画布的图形控制器。点击空白处 `_clickBlank` 清空选区（`frame-panel-body.ts:101-116`）。

**文档变更→面板**：`_setDocDisposables` 订阅 `doc.slots.blockUpdated`，当 `affine:frame` 有非 update 变更（增删）时 `requestAnimationFrame` 批量刷新列表（`frame-panel-body.ts:330-342`）。切换文档（`editorHost` 变）时在 `updated` 里重建订阅并同步选区（`frame-panel-body.ts:399-413`）。

### 3.3 缩略图：卡片里的只读微型编辑器

`FramePreview` 是最精巧的部分。它要在一张 280×166 的卡里渲染 frame 区域的真实内容，做法是**新建一个只读、隐藏 frame 自身、复用 preview-edgeless 扩展集的 `BlockStdScope` 并 `render()`**：

```ts
// frame-preview.ts:90-96,173,188-194
private get _previewSpec() {
  return this._viewExtensionManager.get('preview-edgeless');
}
// render:
return new BlockStdScope({
  store: this._previewDoc,
  extensions: _previewSpec,   // preview-edgeless 扩展 + 运行时追加
}).render();
```

几个关键点：

- **扩展从哪来**：`this.std.get(ViewExtensionManagerIdentifier).get('preview-edgeless')`（`frame-preview.ts:90-96`）——通过 ext-loader 的 Manager 自注入（见 `blocksuite-affine-ext-loader.md` §3.5），拿到"预览画布"这个 scope 的扩展集。这正是 fragment 复用整套编辑器装配能力的证据。
- **只读 + 隐藏 frame**：`_initPreviewDoc` 用 `getStore({ readonly: true, query: this._docFilter })`，而 `_docFilter` 把 `affine:frame` 标为 `viewType: 'hidden'`（`frame-preview.ts:74-82,118-125`）——预览里不画 frame 边框本身，只画它圈住的内容。
- **视口对准 frame**：运行时追加三个扩展 `ViewportElementExtension('.frame-preview-viewport')`、一个 `FramePreviewWatcher`（`LifeCycleWatcher` 子类，在 page 块挂载后把视口 `setViewportByBound(frameBound)`）、`DocModeExtension`（`frame-preview.ts:127-158,160-168`）。
- **缩放**：`_updateFrameViewportWH` 按 fill/fit 算 `scale`（`frame-preview.ts:98-112`），frame 尺寸变化经 `debounce(10)` 刷新（`frame-preview.ts:199-207`）。

### 3.4 拖拽重排与分数索引

拖拽由 `FrameCard` 发起（鼠标移动超 5px 阈值才算拖拽，`frame-card.ts:110-142`），body 的 `_drag` 收集被拖卡片、调 `startDragging`，拖放结束回调 `_reorderFrames`（`frame-panel-body.ts:173-226`）。重排核心是**在相邻两 frame 的 presentationIndex 之间插入一个新分数键**：

```ts
// frame-panel-body.ts:315-323
let before = frames[insertIndex - 1]?.props.presentationIndex || null;
const after = frames[insertIndex]?.props.presentationIndex || null;
selectedFrames.forEach(frame => {
  const newIndex = generateKeyBetweenV2(before, after);
  frame.store.updateBlock(frame, { presentationIndex: newIndex });
  before = newIndex;
});
```

`generateKeyBetweenV2` 生成一个字典序介于 before/after 之间的字符串键——于是重排**只改被拖的几张卡**的索引，不触动其余 frame，是协同友好的"分数索引"经典手法。拖动时用绝对定位的 `.insert-indicator` 蓝线提示落点（`frame-panel-body.ts:285-296`）。

### 3.5 进入演示模式

header 的 `_enterPresentationMode`（`frame-panel-header.ts:123-134`）：若不在 edgeless 先切 mode，再 `setTimeout(100)` 后 `gfx.tool.setTool(PresentTool, { mode })`——延时是等 edgeless 画布渲染就绪。演示的 fit/fill 由 `_navigatorMode` 决定，它从 `EditPropsStore` 读本地记录或订阅 `EdgelessLegacySlotIdentifier.navigatorSettingUpdated`（`frame-panel-header.ts:142-160`）。设置菜单 `FramesSettingMenu` 把三个开关写回 `EditPropsStore` 并广播到 slot（`frames-setting-menu.ts:83-104`），画布与面板共享这份偏好。

### 3.6 列表渲染：repeat + keyed

`_renderFrameList` 用 Lit 的 `repeat` + `keyed` 以 frame 对象为 key 渲染卡片（`frame-panel-body.ts:259-297`），卡片 `status` 根据选中/拖拽态取 `'selected' | 'placeholder' | 'none'`。`keyed(frame, ...)` 确保 frame 身份变化时强制重建对应卡片 DOM（缩略图的微型编辑器不能错位复用）。

## 4. 语法特色

- **三重 Mixin**：`class FramePanelBody extends SignalWatcher(WithDisposable(ShadowlessElement))`（`frame-panel-body.ts:88-90`）——signal 监听 + 自动清理 + light DOM 三能力叠加。
- **DI 取服务的 getter 模式**：`private get _gfx() { return this.editorHost.std.get(GfxControllerIdentifier); }`（`frame-panel-body.ts:128-130`），用 getter 惰性从 std 容器取服务，避免缓存失效。
- **运行时定义 `LifeCycleWatcher` 子类**：`_initSpec` 里 `class FramePreviewWatcher extends LifeCycleWatcher { static override key = ...; override mounted() {...} }`（`frame-preview.ts:129-150`）——在方法内就地定义一个扩展类闭包捕获 `refreshViewport`，作为临时扩展塞进预览编辑器。这是 BlockSuite "用类当扩展单元"的灵活用法。
- **`CustomEvent` 泛型别名**：`export type SelectEvent = CustomEvent<{ id: string; selected: boolean; ... }>`（`frame-card.ts:15-20`），给原生事件 detail 定类型，派发/接收两端共享。
- **Lit 指令组合**：`repeat` + `keyed`（`frame-panel-body.ts:261-283`）、`guard([deps], fn)`（`frame-preview.ts:188`，依赖不变就不重算昂贵的编辑器渲染）、`styleMap`（动态位移）、`nothing`（条件不渲染）。
- **`lodash-es/debounce` 按需引入**：`import debounce from 'lodash-es/debounce'`（`frame-preview.ts:23`）走子路径导入利于摇树，`{ leading: true }` 让首次立即执行。
- **分数索引 `generateKeyBetweenV2`**：返回字符串键而非数字，天生规避并发重排冲突（`frame-panel-body.ts:318`）。

## 5. 设计 / 实现亮点

- **缩略图即"迷你编辑器"**：不自己画缩略图，而是复用 `preview-edgeless` 扩展集跑一个只读、隐藏 frame、视口锁定的 `BlockStdScope`——所见即真实渲染，且随内容/主题自动一致。这是整个 BlockSuite "扩展可按 scope 任意组装"的最佳展示。
- **分数索引重排**：拖拽只改被拖项的 `presentationIndex`，O(选中数) 而非 O(全部)，协同无冲突。
- **双向选区同步**：面板与画布通过 gfx 选区 + slot 订阅保持一致，用户在任一侧操作另一侧即时响应。
- **演示偏好集中存储**：fill/dark/hideToolbar 存 `EditPropsStore` 并广播，面板、画布、演示工具三方共享同一真相源。
- **拖拽阈值**：移动超 5px 才判为拖拽（`frame-card.ts:116-121`），区分"点击选中"与"拖动重排"，交互不误触。

## 6. 对外 API 与注意事项

- 主要导出（`.`）：`FramePanel`/`FramePanelBody`/`FramePanelHeader`/`FramesSettingMenu`/`FrameCard`/`FramePreview`/`FrameCardTitle`/`FrameCardTitleEditor` 及标签常量、各 `*Event` 类型；`./view` 导出 `FramePanelViewExtension`。
- **用法**：装载 `FramePanelViewExtension`（`effect()` → `effects()` 定义 8 个标签）后挂 `<affine-frame-panel .host=${editorHost} .fitPadding=${[50,380,50,50]}></affine-frame-panel>`；`host`（`EditorHost`）必传。
- **注意**：
  - 面板强依赖 **edgeless/gfx 环境**——`_gfx`、`GfxControllerIdentifier`、`PresentTool`、`EdgelessLegacySlotIdentifier` 都是画布专属；在纯 page 模式下点卡片会先把编辑器切到 edgeless（`_fitToElement` / `_enterPresentationMode`）。
  - 缩略图 `FramePreview` 依赖容器里能取到 `ViewExtensionManagerIdentifier` 且该 Manager 支持 `'preview-edgeless'` scope——脱离完整装配（聚合包）单独用会取不到预览扩展集。
  - `_navigatorMode` 的 `setTimeout(100)` 是等画布就绪的经验值，不是任意延时。
  - `view.ts` 的 extension 只 `customElements.define`，不注册 scope 扩展，挂载位置由宿主决定。

## 7. 延伸

- 机制依赖：`@blocksuite/affine-ext-loader`（`ViewExtensionProvider` / `ViewExtensionManagerIdentifier`，见 `blocksuite-affine-ext-loader.md` §3.5 自注入）。
- 画布能力来源：`@blocksuite/affine-block-frame`（`EdgelessFrameManager` / `PresentTool`）、`@blocksuite/affine-block-surface`、`@blocksuite/std/gfx`。
- 同层并列 fragment：`outline`（同样有卡片列表 + 拖拽重排 + 画布选区联动，可对照阅读）、`doc-title`、`adapter-panel`。
- 上层聚合：`@blocksuite/affine` 把 `FramePanelViewExtension` 收进 `getInternalViewExtensions()`（见 `blocksuite-affine.md`）。
