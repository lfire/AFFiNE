# `@blocksuite/affine-block-surface-ref`

> 一句话定位：AFFiNE 的**白板引用块**——在页面（文档）里嵌入白板某个局部（一个 frame、group、mindmap 或任意 edgeless 元素）的只读快照。它独有的核心是**在页面内启动一个独立的只读 edgeless 子编辑器**、**把子编辑器的视口精确对准被引用元素的包围盒**、以及**跨 doc 查找被引用元素并实时跟随其几何/增删变化**。一句话：它是"文档里开一扇只读窗口，望向白板的一角"。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/blocks/surface-ref`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 所属层    | L3 · 编辑器业务层（内容块 / 引用块）                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 语言/形态 | TypeScript / Lit 块包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 关键依赖  | `@blocksuite/std`（`BlockComponent`/`BlockStdScope`/`LifeCycleWatcher`/`BlockSelection`/`TextSelection`）、`@blocksuite/std/gfx`（`GfxControllerIdentifier`/`GfxBlockElementModel`/`GfxPrimitiveElementModel`）、`@blocksuite/affine-block-surface`（`getSurfaceBlock`/`EdgelessCRUDIdentifier`）、`@blocksuite/affine-block-frame`、`@blocksuite/affine-inline-reference`（`RefNodeSlotsProvider`）、`@blocksuite/affine-components`（caption/hover/peek）、`@blocksuite/global/gfx`（`Bound`）、`lit` |
| 被谁依赖  | 编辑器预设、`@affine/core`（文档里引用白板）                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 对外入口  | `.`、`./store`、`./view`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 1. 设计逻辑

### 在"块包统一范式"中的位置

| 范式部件                          | surface-ref 实现                                                                                                                                                                | 独有之处                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| schema/model                      | 复用 `affine-model` 的 `SurfaceRefBlockSchema`/`SurfaceRefBlockModel`（props：`reference`/`refFlavour`/`caption`/`comments`，`role:'content'`，`parent:[note,paragraph,list]`） | 核心只有 `reference`（被引元素 id）与 `refFlavour`（类型） |
| `*-block.ts`                      | **两个**组件：`surface-ref-block.ts`→`SurfaceRefBlockComponent`（页面，渲染真快照）；`surface-ref-block-edgeless.ts`→`EdgelessSurfaceRefBlockComponent`（白板，只占位）         | 同 flavour 双视图，但只有页面视图渲染内容                  |
| service                           | 无（用 `LifeCycleWatcher` 做运行期视口 watcher）                                                                                                                                | 内联定义 `SurfaceRefViewportWatcher`                       |
| inline/keymap                     | 仅 `bindHotKey` 的 Enter（在后面插段落）                                                                                                                                        | 无文本编辑                                                 |
| commands                          | `commands.ts`→`insertSurfaceRefBlockCommand`                                                                                                                                    | 从选区插入引用块                                           |
| widgets/configs                   | `configs/`：slash-menu、toolbar；`components/`：placeholder、toolbar-title；`portal/`：note/generic-block                                                                       | hover 工具栏、空引用占位                                   |
| adapters                          | 无（引用块不做富序列化，只存 `reference` id）                                                                                                                                   | —                                                          |
| `effects.ts`/`view.ts`/`store.ts` | `customElements.define`（6 个元素）+ `SurfaceRefViewExtension`/`SurfaceRefStoreExtension`（按 scope 分视图）                                                                    | 装配按 scope 二分                                          |

### 引用块的独有问题

1. **跨 doc 的引用解析**：`reference` 只是一个元素 id，被引元素可能在当前 doc 的 surface 里、也可能在工作区另一个 doc 里；要能"先本 doc、再遍历全部 doc"地找到它（`_initReferencedModel`）。
2. **如何渲染白板的一角**：不能把整张白板搬进文档，而是**在块内 new 一个独立的只读 `BlockStdScope`（迷你 edgeless 编辑器）**，加载 `preview-edgeless` 扩展，再把它的视口 `setViewportByBound` 到被引元素的包围盒——只显示那一块。
3. **实时跟随**：被引元素在白板里被移动/缩放/删除时，页面里的快照要同步——需订阅元素的 `xywh$`、surface 的 `elementUpdated`/`elementRemoved`、block 的 `blockUpdated`。
4. **防自引用递归**：若引用块本身又出现在某个 surface-ref 预览里，会无限嵌套渲染——需 `_shouldRender` 守卫。

## 2. 目录与关键文件

```text
src/
├── surface-ref-block.ts          # ★SurfaceRefBlockComponent：页面视图，启动只读子编辑器 + 视口对齐
├── surface-ref-block-edgeless.ts # EdgelessSurfaceRefBlockComponent：白板视图，只渲染占位
├── commands.ts                   # insertSurfaceRefBlockCommand：从选区旁插入引用块
├── utils.ts                      # getReferenceModelTitle / TYPE_ICON_MAP / 空引用 SVG
├── icons.ts                      # 图标
├── components/                   # placeholder（空引用占位）、toolbar-title
├── portal/                       # note / generic-block：被引内容的 portal 渲染
├── configs/                      # slash-menu、toolbar、tooltips
├── view.ts store.ts effects.ts index.ts
```

## 3. 实现细节

### 3.1 model：只存一个引用 id

`SurfaceRefBlockModel`（`model/src/blocks/surface-ref/surface-ref-model.ts`）是空类，props 极简：

```ts
export type SurfaceRefProps = {
  reference: string; // 被引 edgeless 元素的 id
  caption: string;
  refFlavour: string; // 被引元素类型：affine:frame / group / mindmap / …
  comments?: Record<string, boolean>;
};
// role:'content'，parent: ['affine:note','affine:paragraph','affine:list']
```

- `reference` 是全部——它指向白板里的一个 `GfxBlockElementModel`（如 frame）或 `GfxPrimitiveElementModel`（如 shape/group/mindmap）。
- `refFlavour` 冗余存了类型，用于空引用时显示正确的占位图标/文案，无需先解析元素。

### 3.2 ★跨 doc 查找被引元素

`_initReferencedModel`（`surface-ref-block.ts:199-272`）负责把 `reference` id 解析成真正的模型。`findReferencedModel` 的查找顺序很关键：

```ts
const find = (doc: Store): [GfxModel | null, string] => {
  const block = doc.getBlock(referenceId)?.model;
  if (block instanceof GfxBlockElementModel) return [block, doc.id]; // 先当 block 找（如 frame）
  const surfaceBlock = getSurfaceBlock(doc);
  const element = surfaceBlock?.getElementById(referenceId); // 再当 surface 元素找
  if (element) return [element, doc.id];
  return [null, doc.id];
};
let result = find(this.store); // ① 先查当前 doc
if (result[0]) return result;
for (const doc of this.std.workspace.docs.values()) {
  // ② 再遍历工作区所有 doc
  result = find(doc.getStore());
  if (result[0]) return result;
}
```

- 找到后 `_previewDoc = doc.getStore({ readonly: true })`——拿到被引元素所在 doc 的**只读** store，作为迷你编辑器的数据源。
- 订阅变化：`model.propsUpdated` 监听 `reference` 改变时重新 `init`；若被引是 `GfxPrimitiveElementModel`，订阅其 surface 的 `elementRemoved`；若是 `GfxBlockElementModel`，订阅 `blockUpdated` 的 delete——元素被删时清空引用。

### 3.3 ★在块内启动只读 edgeless 子编辑器

页面视图不复用主编辑器，而是**在块的 DOM 里实例化一个全新的 `BlockStdScope`**——`_renderRefContent`（`:385-411`）：

```ts
const _previewSpec = this._previewSpec.concat(this._runtimePreviewExt);
return html`<div class="ref-content">
  <div
    class="ref-viewport"
    style=${styleMap({ aspectRatio })}
    data-theme=${edgelessTheme}
  >
    ${guard(this._previewDoc, () =>
      this._previewDoc
        ? new BlockStdScope({
            store: this._previewDoc,
            extensions: _previewSpec,
          }).render()
        : nothing
    )}
    <div class="ref-viewport-event-mask"></div>
  </div>
</div>`;
```

- **`_previewSpec`**（`:121-126`）= `viewExtensionManager.get('preview-edgeless')` + `ViewportElementExtension('.ref-viewport')`——加载一整套"预览版白板"扩展（只读、无工具），并把视口元素指向本块的 `.ref-viewport`。
- **`guard(this._previewDoc, …)`**：Lit 的 `guard` 指令——只有 `_previewDoc` 变化时才重建子编辑器，避免每次渲染都 new 一个 `BlockStdScope`（昂贵）。
- **`aspectRatio`**（`:387-388`）：按被引元素 `w/h` 设定预览区宽高比，让快照不变形。
- **`.ref-viewport-event-mask`**：一层覆盖的事件遮罩——子编辑器虽是完整编辑器，但引用块是**只读快照**，遮罩拦截交互，避免用户在页面里误编辑白板内容。

### 3.4 ★视口对齐：把子编辑器望向被引元素

光有子编辑器还不够，必须让它的视口正好框住被引元素。`_initViewport`（`:274-360`）是本块最精巧的部分：

- **`refreshViewport`**（`:277-291`）：从子编辑器取 `GfxController.viewport`，`viewport.setViewportByBound(Bound.deserialize(xywh), padding)`——把视口设为被引元素的包围盒；frame 用无 padding（frame 自带边界），其它元素用 `[20,20,20,20]` 留白。包在 `effect()` 里，于是 `_referenceXYWH$` 变化自动重对齐。
- **`_referenceXYWH$` signal**（`:131`）：注释点明动机——"edgeless 元素的 xywh 不是 signal，所以用一个 signal 存它"。这样把非响应式的几何值桥接成响应式，驱动 `effect`。
- **运行期 `SurfaceRefViewportWatcher`**（`:295-357`）：一个**内联定义的 `LifeCycleWatcher`**，作为扩展塞进子编辑器的 `_runtimePreviewExt`。它在子编辑器 `mounted` 时：用 `EdgelessCRUDIdentifier` 找到被引元素、首次对齐视口、订阅 `viewport.sizeUpdated`（容器尺寸变）与元素的 `xywh$`/`surface.elementUpdated`（元素几何变）持续刷新；并监听 `view.viewUpdated`，当被引 frame 的视图挂载时把 `showBorder = false`（引用里不显示 frame 边框）。
- 这套"外层块订阅 + 内层 watcher 订阅"双保险，保证无论几何怎么变，页面快照都实时跟随。

### 3.5 一块两视图：页面渲真、白板占位

与 note 类似，`view.ts` 按 scope 注册不同元素：

- **页面 scope** → `<affine-surface-ref>`（`SurfaceRefBlockComponent`），渲染完整快照，还注册 `ToolbarModuleExtension`（hover 工具栏）。
- **白板 scope** → `<affine-edgeless-surface-ref>`（`EdgelessSurfaceRefBlockComponent`），只渲染 `<surface-ref-placeholder>` 占位——因为在白板里本来就能直接看到元素本身，无需再嵌套渲染。
- 空引用（元素找不到或无 xywh）时，页面视图也渲染 `<surface-ref-placeholder>`，按 `refFlavour` 显示类型图标与标题（`utils.ts` 的 `TYPE_ICON_MAP`/`getReferenceModelTitle`/`noContentPlaceholder` SVG）。

### 3.6 交互：只读但可跳转

- **`@Peekable`** 装饰器（`:51-53`）：`enableOn: block => !!block.referenceModel`——有被引元素时支持"快速预览"（peek）。
- **`open`**（`:413-433`）：通过 `RefNodeSlotsProvider.docLinkClicked` 发出跳转信号，带 `mode:'edgeless'` 与 `elementIds:[reference]`——点击可跳到白板并定位该元素。
- **`viewInEdgeless`**（`:485-495`）：把视口存进 `EditPropsStore` 再 `setEditorMode('edgeless')`，在当前编辑器切到白板并对准该区域。
- **Enter 热键**（`_initHotkey`，`:159-197`）：选中引用块时回车，在其后插入空段落并聚焦——与其它原子块一致的"跳出"出口。
- **click**（`_handleClick`）：整块进入 `BlockSelection`（原子块通用交互）。
- **hover 工具栏**（`_initHover`，`:362-383`）：`whenHover` + `ToolbarRegistryIdentifier.message$`，悬停 500ms 弹出工具栏（含 open/viewInEdgeless/caption 等）。

### 3.7 防自引用递归

`_shouldRender`（`:133-139`）：`isConnected && !this.parentComponent?.closest('affine-surface-ref')`——若本块的祖先里已有一个 `affine-surface-ref`，说明它正被另一个引用块的预览子编辑器渲染，此时**不再渲染**，否则会无限递归。`connectedCallback`/`firstUpdated`/`render` 开头都用它短路。

### 3.8 插入命令

`insertSurfaceRefBlockCommand`（`commands.ts`）从当前选区插入引用块：取选区首/尾块为锚点，用 `EdgelessCRUDExtension` 按 `reference` 查元素以确定 `refFlavour`（primitive 用 `element.type`、block 用 `element.flavour`），再 `addSiblingBlocks` 插在锚点前/后，可选删除空行。

## 4. 语法特色

- **运行期动态构造编辑器**：`new BlockStdScope({ store, extensions }).render()` 在模板里即时创建一个嵌套编辑器实例——BlockSuite 把"编辑器"本身做成可嵌套、可复用的单元，这是 surface-ref 能"文档里开白板窗口"的语法基础。
- **`guard` 指令**：`guard(dep, () => expensiveTemplate)` 只在依赖变化时重算模板，避免昂贵的子编辑器被反复重建——Lit 性能优化的典型用法。
- **内联类扩展**：`SurfaceRefViewportWatcher` 直接在 `_initViewport` 方法体内 `class … extends LifeCycleWatcher` 定义，闭包捕获 `referenceId`/`referenceXYWH$`——把"只为这个块服务的生命周期逻辑"就地封装为扩展，再注入子编辑器。
- **signal 桥接非响应式值**：`_referenceXYWH$ = signal<SerializedXYWH|null>(null)` 把"edgeless 元素的 xywh 不是 signal"这一事实手动桥接成响应式，`effect(refreshViewport)` 据此自动重对齐。
- **`instanceof` 类型收窄**：`GfxBlockElementModel` vs `GfxPrimitiveElementModel` 的分支决定查找方式、订阅哪种变化事件、取 `type` 还是 `flavour`——用运行时类型判断区分"块元素"与"图元元素"两类白板对象。
- **`@Peekable` 装饰器 + `@query accessor`**：类装饰器声明可预览能力；`@query('editor-host') accessor previewEditor` 把子编辑器的 host 绑定到字段供视口操作。
- **`literal` + scope 分支**：同一 flavour 注册 `affine-surface-ref` / `affine-edgeless-surface-ref` 两个标签。

## 5. 设计 / 实现亮点

- **"文档里的只读白板窗口"**：用一个嵌套的 `BlockStdScope` + `preview-edgeless` 扩展 + `setViewportByBound`，把"引用白板一角"抽象成"开一个对准该区域的只读子编辑器"——复用整套 edgeless 渲染而非另写一套快照绘制，架构上极其经济。
- **几何实时跟随的双层订阅**：外层块订阅 `propsUpdated`/`elementRemoved`/`blockUpdated`，内层 watcher 订阅 `viewport.sizeUpdated`/`xywh$`/`elementUpdated`，用 `_referenceXYWH$` signal 串起来，保证被引元素在白板里任何变化都即时反映到文档快照。
- **跨 doc 解析**：先本 doc 后全工作区的查找策略，支持"在 A 文档引用 B 文档白板里的 frame"这类跨文档引用。
- **防递归守卫**：`_shouldRender` 一行解决"引用块出现在自己预览里导致无限嵌套"的隐患——嵌套编辑器架构的必备防护。
- **只读语义贯彻**：事件遮罩层 + 只读 store + preview 扩展三重保证引用是只读快照，用户不会在文档里误改白板。

## 6. 对外 API 与注意事项

- 主要导出：`SurfaceRefBlockComponent`、`EdgelessSurfaceRefBlockComponent`、`insertSurfaceRefBlockCommand`、`getReferenceModelTitle`/`TYPE_ICON_MAP`；装配入口 `SurfaceRefViewExtension`（`./view`）、`SurfaceRefStoreExtension`（`./store`）。
- **约定**：插入引用块用 `insertSurfaceRefBlockCommand`（需提供 `reference` 元素 id 与选区锚点）；预览靠 `preview-edgeless` 扩展集，由 `ViewExtensionManager` 提供。
- **注意**：
  - 引用块是**只读快照**，内部虽是完整子编辑器但被遮罩拦截交互；要编辑请 `open`/`viewInEdgeless` 跳到真白板。
  - `reference` 指向的元素被删除后，块会回退到占位状态（按 `refFlavour` 显示图标）；`refFlavour` 是冗余字段，用于空引用展示。
  - 嵌套渲染有递归风险，`_shouldRender` 必须保留；在 surface-ref 预览里再放 surface-ref 会被守卫短路不渲染。
  - 子编辑器用 `guard` 缓存，只在 `_previewDoc` 变化时重建——不要移除 guard，否则每帧重建编辑器性能灾难。
  - 被引元素的 `xywh` 不是 signal，依赖 `_referenceXYWH$` 桥接；若新增几何来源，记得同步更新这个 signal。

## 7. 延伸

- 底层：`@blocksuite/affine-model`（`SurfaceRefBlockModel`）、`@blocksuite/std`（`BlockStdScope`/`LifeCycleWatcher`/`BlockComponent`）、`@blocksuite/std/gfx`（`GfxController`/`GfxBlockElementModel`/`GfxPrimitiveElementModel`）、`@blocksuite/global/gfx`（`Bound`）。
- 同层协作：`@blocksuite/affine-block-surface`（被引元素所在画布、`getSurfaceBlock`/`EdgelessCRUDIdentifier`，见 `blocksuite-affine-block-surface.md`）、`@blocksuite/affine-block-frame`（最常被引用的 frame）、`@blocksuite/affine-inline-reference`（跳转 slots）、`@blocksuite/affine-components`（caption/hover/peek）。
- 对照阅读：`blocksuite-affine-block-surface.md`（引用的目标——白板画布与 ElementModel）、`blocksuite-affine-block-note.md`（同为"一块两视图"按 scope 装配的样本）。
