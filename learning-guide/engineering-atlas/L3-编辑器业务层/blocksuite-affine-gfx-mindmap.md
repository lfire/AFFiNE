# `@blocksuite/affine-gfx-mindmap`

> 一句话定位：白板上的**思维导图**图形层——它不是一种"新图元"，而是一种**自动布局的容器型图元**（`MindmapElementModel`，继承 `GfxGroupLikeElementModel`）：节点本身是普通的**形状图元**（`ShapeElementModel`），节点间的连线是**自动生成的本地连接线**（`LocalConnectorElementModel`），而思维导图的全部价值在于一套**树形自动布局算法**（左/右/平衡三种方向，节点一增删就重排）、节点的**拖拽改接/跨图合并**、以及**折叠/展开**。核心难点正是这套布局算法与"拖一个节点到哪就成为谁的子/兄弟"的判定。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/gfx/mindmap`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 关键依赖  | `@blocksuite/std`（`GfxElementModelView`/`GfxViewInteractionExtension`/`InteractivityExtension`/`GfxGroupLikeElementModel`/`generateKeyBetween`）、`@blocksuite/affine-gfx-shape`（节点即形状、`fitContent`）、`@blocksuite/affine-gfx-connector`（渲染连线、`ConnectorPathGenerator`）、`@blocksuite/affine-gfx-text`/`pointer`、`@blocksuite/affine-model`（`MindmapElementModel`/`MindmapNode`/`LayoutType`）、`@blocksuite/affine-block-surface`、`fractional-indexing`、`lodash-es`、`yjs`、`lit` |
| 被谁依赖  | edgeless 预设（通过 `MindmapViewExtension` 注册）                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 对外入口  | `.`、`./view`（`MindmapViewExtension`）、`./store`（`MindmapStoreExtension`，适配器）                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置：一种"强结构约束的群组型图元"

思维导图是画布原生图元（`type==='mindmap'`），走 gfx 五件套，但它和分组（group）一样**不继承普通的 `GfxPrimitiveElementModel`，而是继承 `GfxGroupLikeElementModel`**（std 的"群组型"基类）——它是一个**容器**，`xywh` 由子节点联合包围盒派生，自己几乎不画东西。与 group 的关键差异是：**分组只是"把一堆元素打包"，思维导图却对成员强加了树形结构 + 自动布局**。连 group 包里多处都把 `MindmapElementModel` 当作"特殊群组"排除（不许对思维导图分组/解组）。

五件套在本包的落点：**模型** `MindmapElementModel`（affine-model）、**无独立工具**（新建走工具栏 `mindMapSeniorTool` + 命令）、**element-renderer** `mindmap`（只画连线）、**交互扩展** `MindMapView`/`MindMapInteraction`/`MindMapDragExtension`、**view 注册** `MindmapViewExtension`。

### 1.2 三个独有部件：节点=形状、连线=本地连接线、布局=算出来的

思维导图把已有图元"组装"成了新东西：

- **节点是形状**：每个节点其实是一个 `ShapeElementModel`（矩形等），复用 shape 包的渲染与 `fitContent`。思维导图不重新实现"节点长什么样"。
- **连线是本地连接线**：父子节点间的连线是 `LocalConnectorElementModel`（`@local`，不持久化、按需生成），复用 connector 包的 `ConnectorPathGenerator` 和渲染函数。思维导图的 element-renderer（`renderer/element-renderer.ts`）**只负责遍历树把这些连线画出来**，节点由 shape renderer 各自画。
- **布局是派生的**：模型里只存**拓扑结构**（`children: Y.Map<NodeDetail>`，每个 NodeDetail 含 `index`/`parent`/`collapsed`），每个节点摆在哪的 `xywh` 是**布局算法算出来写回去的**。节点一增删/折叠，就要重跑布局。

### 1.3 独有难点：自动布局 与 拖拽改接

- **自动布局**（`view/layout.ts`）：给定树，算出每个节点的坐标，使子节点在父节点一侧纵向排开、整棵子树垂直居中对齐父节点，且不重叠。三种方向 `LayoutType.LEFT/RIGHT/BALANCE`。
- **拖拽改接**（`interactivity/`）：拖一个节点，实时判定它应成为某节点的**子**还是**兄弟**、插在哪个位置，甚至**跨思维导图合并**，并用指示器预览——靠"响应区（responseArea）"与 fractional index 实现。

## 2. 目录与关键文件

```text
mindmap/src/
├── index.ts / view.ts / store.ts    # 导出 / MindmapViewExtension / 适配器
├── view/
│   ├── layout.ts                    # ★布局算法：calculateNodeSize + layoutTree + 左/右/平衡
│   ├── view.ts                      # ★MindMapView（折叠按钮/悬停/选中）+ MindMapInteraction（禁缩放）
│   ├── utils.ts                     # ★addNode/addTree/moveNode/detach/findTargetNode/determineInsertPosition...
│   └── style-svg.ts
├── renderer/
│   ├── element-renderer.ts          # ★mindmap renderer：遍历树画连线（复用 connector 渲染）
│   └── dom-renderer.ts
├── interactivity/
│   ├── mind-map-drag.ts             # ★MindMapDragExtension：拖节点改接/跨图合并
│   ├── drag-utils.ts                # calculateResponseArea：节点的"子/兄弟"响应区
│   └── index.ts
├── indicator-overlay/               # MindMapIndicatorOverlay：拖拽时的插入位置预览
├── toolbar/                         # senior-tool（新建）/ config / 导入（import-mindmap）/ 预设节点
├── adapter/                         # mindmap → markdown / plain-text（缩进层级）
└── utils/ + effects.ts

# 模型与基类：
#   affine/model/.../elements/mindmap/mindmap.ts  —— MindmapElementModel（children/tree/connectors）
#   affine/model/.../elements/mindmap/style.ts    —— 各风格的节点样式 getter
#   framework/std/.../surface/element-model.ts    —— GfxGroupLikeElementModel 基类
```

## 3. 实现细节

### 3.1 数据模型：存拓扑，不存坐标

`MindmapElementModel`（`model/.../mindmap.ts`）继承 `GfxGroupLikeElementModel`，核心持久字段是 `children: Y.Map<NodeDetail>`（`:93`）——**用 Map 存"节点 id → {index, parent, collapsed}"的扁平拓扑**，和 group 一样用 Y.Map 换协同友好。`NodeDetail`（`:31`）里 `index` 是 **fractional index**（决定同级顺序）、`parent` 指父节点 id、`collapsed` 记折叠。

扁平 Map 通过 `buildTree()` 组装成运行时的 `MindmapNode` 树（`:40`，含 `element`（对应的形状图元）、`children`、`parent`、`responseArea`、`overriddenDir`）。`observeChildren`（`:96`）监听 Y.Map 变化：`setChildIds` 同步索引、`buildTree` 重建树、`connectors.clear()` 让连线重算——这是"改拓扑 → 重建树 → 重算连线/布局"的响应链起点。`MindmapRoot`（`:64`）额外带 `left`/`right` 两个子集，专供平衡布局。

节点的 `element` 是 `GfxPrimitiveElementModel`（实为形状），连线存在 `connectors`（`LocalConnectorElementModel`，本地派生）——**思维导图 = 一组形状 + 一组本地连线 + 一套拓扑**。

### 3.2 布局算法：两趟 DFS（自底向上算尺寸，自顶向下定位）

`layout.ts` 是全包算法核心，经典的**两趟遍历**：

**第一趟 `calculateNodeSize`（`:36`，自底向上）**：递归算每棵子树的**整体包围盒** `TreeSize.bound`。叶子的 bound 就是自身；有子节点时，把所有子树 bound **纵向累加**（`pre.h += NODE_VERTICAL_SPACING + childSize.bound.h`，`:62`）求子树总高、取最宽子树求宽，再把"自身宽 + 水平间距 + 子树宽"作为本子树宽（`:72`）。第一层用 `NODE_FIRST_LEVEL_HORIZONTAL_SPACING=200`，其余层 `NODE_HORIZONTAL_SPACING=110`（`:74`）。`collapsed` 的节点不计子树（`:54`）。

**第二趟 `layoutTree`（`:83，自顶向下）**：已知每棵子树需要多高，就能定位。`currentX` 按方向在父节点左/右侧偏移一个水平间距（`:91`）；`currentY` 从"让整棵子树垂直居中对齐父节点"的位置开始（`tree.root.element.y + (父高 - 子树总高)/2`，`:102`）。然后遍历子节点：每个子节点放在 `currentY + (该子树高 - 子节点自身高)/2` 处（让子节点在它自己的子树高度里居中，`:114-116`），写回 `xywh`，递归布局该子树，`currentY += 子树高 + 纵向间距`（`:126`）往下堆叠。

**三种方向**：`layoutRight`/`layoutLeft`（`:131`/`:141`）直接按方向跑；`layoutBalance`（`:151`）把根的 `left`/`right` 两个子集**各算一次尺寸、各朝一侧布局**（用 mockRoot 包一层），实现"左右对称展开"。

这套算法保证：**任意增删节点、折叠展开，只需重跑 `layout` 就得到不重叠、对齐美观的布局**——无需手工摆放。

### 3.3 渲染：只画连线，节点交给 shape

`mindmap` renderer（`renderer/element-renderer.ts:15`）遍历树（`traverse`，`:30`），对每个节点取 `model.getConnectors(node)` 拿到它与子节点的连线，若连线 `outdated` 就用 **`ConnectorPathGenerator.updatePath`**（来自 connector 包，`:40`）重算路径，再调 connector 包的 `renderConnector`（`:53`）画出来。连线透明度 = `connector.opacity * mindmapOpacity`。**节点形状本身不在这里画**——它们是独立的形状图元，由 shape 的 element-renderer 各自渲染。折叠节点不再递归其子（`:68`）。这体现了思维导图"组装既有图元"的本质：它只补上"连线"这层关系的绘制。

### 3.4 新增/移动节点：fractional index 保序

`view/utils.ts` 提供一组结构操作，关键都在**用 fractional index 维持同级顺序**：

- **`addNode`（`:178`）**：把一个游离节点挂到父下。算插入位置的前后兄弟，用 `generateKeyBetween(before.index, after.index)` 在两者间生成新 index（`:205`），写进 `children` Map，递归把子孙也登记进 Map，最后 `mindmap.layout()` 重排。
- **`addTree`（`:239`）**：挂整棵子树（支持从 `{text, children}` 的纯数据或已有 `MindmapNode`），递归 `addNode`。
- **`moveNodePosition`（`:80`）**：同图内改接/重排——把节点从兄弟列表移到新位置，`generateKeyBetween` 重算 index，写回。
- **`detachMindmap`（`:309`）**：从 Map 删除子树但**不删图元**，使其可用于新建另一张思维导图或合并到别处。
- **`moveNode`（`:404`）**：同图走 `moveNodePosition`，跨图则 `detachMindmap` + `addNode`——**跨思维导图搬运节点**。
- **`createFromTree`（`:360`）**：从一棵 `MindmapNode` 建一张全新思维导图（写 children Map、addElement、首次 layout）。

### 3.5 拖拽改接：响应区 + 子/兄弟判定

拖节点交互由 `MindMapDragExtension`（`interactivity/mind-map-drag.ts:47`，`InteractivityExtension`）驱动，难点是"拖到哪 = 成为谁的什么"：

- **响应区** `calculateResponseArea`（`drag-utils.ts`）给每个节点算一块 `responseArea`（`MindmapNode.responseArea`）——拖进节点主体附近成为**兄弟**、拖进节点正后方的小区域成为**子**（注释见模型 `:49-55`）。拖拽开始时一次性算好（`_responseAreaUpdated` 去重，`:53`）。
- **`findTargetNode`（`utils.ts:420`）**：按鼠标位置自树根向下找命中的节点，按布局方向剪枝（右布局只往右找等，`:431`）。
- **`determineInsertPosition`（`:451`）**：判定插入是 `child` 还是 `sibling`、朝哪个 `layoutDir`、`prev` 还是 `next`。平衡布局下按鼠标在节点中线左/右决定进左树还是右树（`:475`），第二层节点还特殊处理前后插（`:494`）。
- **`tryMoveNode`/`showMergeIndicator`（`:625`/`:520`）**：算出目标路径后，返回 `{abort, merge}` 两个函数——拖拽中显示指示器预览（`MindMapIndicatorOverlay`）并隐藏原连线（`hideNodeConnector`，`:44`），松手 `merge` 真正 `moveNode`、取消则 `abort`。`merge` 里若目标路径与原路径相同则跳过（`:602`）。

### 3.6 折叠/展开按钮

`MindMapView`（`view/view.ts:20`，`GfxElementModelView`）管折叠 UI。它为每个有子节点的节点创建一个 **`LocalShapeElementModel` 折叠按钮**（`_updateCollapseButton`，`:208`），摆在节点左/右侧（按布局方向，`:238`），折叠时显示子节点数、展开时为空。按钮可见性由一套**悬停 + 选中**状态机控制（`_updateButtonVisibility`，`:175`：有子节点 && 未隐藏 && （折叠 || 选中 || 悬停）才显形）。点击按钮 `toggleCollapse(node, {layout:true})`（`:316`）切折叠并重排。按钮样式随风格/布局/折叠态用 `cache` key 判定是否需更新（`_needToUpdateButtonStyle`，`:101`），避免重复刷新。

### 3.7 交互约束：不可自由缩放/选择

`MindMapInteraction = GfxViewInteractionExtension(...)`（`view/view.ts:358`）对思维导图加了强约束：`resizeConstraint.allowedHandlers: []`（`:362`）——**整张思维导图不可手动缩放**（尺寸全由布局算法派生）；`handleSelection.onSelect`（`:364`）除非锁定否则 `return false`——**点击不选中整张图**，让点击穿透到具体节点。这与"思维导图是自动管理的强结构"一致。

### 3.8 导出适配器：树 → 缩进文本

`MindmapStoreExtension`（`store.ts`）注册 markdown/plain-text 适配器，把思维导图树**按层级转成缩进的列表/标题**——导出到文档时思维导图变成嵌套大纲，符合"思维导图≈大纲"的语义。

## 4. 语法特色

- **`GfxGroupLikeElementModel` 模板方法**：与 group 共享"xywh 派生 + childIds 索引 + setChildIds"骨架，思维导图补上 `buildTree`/`connectors` 等强结构逻辑——同一抽象基类支撑两种容器。
- **`@field`/`@observe`/`@watch`/`@convert` 装饰器**：`children` 用 `@field` 持久化、`@observe(observeChildren)` 在 Y.Map 变化时重建树、`@watch(watchLayoutType)` 在布局方向变时重排——声明式响应模型。
- **fractional indexing**：`generateKeyBetween(a, b)` 在两 index 间插值表达同级顺序，增删移动节点都靠它，免去整体重排序。
- **`z.lazy` 递归 zod schema**：`nodeSchema` 用 `z.lazy(() => nodeSchema.array())`（`mindmap.ts:78`）定义递归的节点类型校验——导入外部思维导图数据时运行时校验树结构。
- **两趟 DFS 布局**：自底向上求尺寸、自顶向下定位，是树布局的经典范式，时间复杂度线性。
- **判别联合描述插入意图**：`determineInsertPosition` 返回 `{type:'child'|'sibling', layoutDir, position?}` 判别联合，精确表达"拖到哪"。
- **`LocalShapeElementModel`/`LocalConnectorElementModel`**：折叠按钮与连线都用"本地元素"（不入 Yjs），`surface.addLocalElement`/`deleteLocalElement` 管理——派生 UI 不污染协同文档。
- **`requestThrottledConnectedFrame`**：折叠按钮更新用节流 rAF（`view.ts:44`），避免拓扑频繁变动时过度刷新。
- **跨包复用**：节点复用 shape（`fitContent`）、连线复用 connector（`ConnectorPathGenerator`/`renderConnector`）、文字复用 text——思维导图几乎不造新轮子，只做"编排"。

## 5. 设计 / 实现亮点

- **"组装"而非"新建"**：节点=形状、连线=本地连接线、结构=拓扑 Map，思维导图把三个既有能力编排成新图元，复用度极高、维护面极小。
- **结构与坐标分离**：模型只存拓扑（parent/index/collapsed），坐标全由两趟 DFS 布局算出——增删折叠只需重跑布局，天然保证美观无重叠。
- **三种布局统一框架**：左/右用同一 `layoutTree`、平衡用 mockRoot 拆左右两次复用——一套算法覆盖三种形态。
- **响应区驱动的拖拽语义**：用 responseArea + 子/兄弟判定 + 指示器预览，把"拖到哪成为谁的什么"做得精准可预期，还支持跨图合并。
- **折叠按钮的状态机**：悬停/选中/折叠/隐藏多因素决定可见性，用缓存 key 避免重复刷新，交互细腻且高效。
- **强约束交互**：禁手动缩放、点击穿透到节点，忠实表达"思维导图是自动管理的结构"。
- **导出即大纲**：树→缩进文本的适配器让思维导图与文档大纲互通。

## 6. 对外 API 与注意事项

- 主要导出：`MindmapElementRendererExtension`/`MindmapDomRendererExtension`、`MindMapView`/`MindMapInteraction`、`MindMapDragExtension`、`MindMapIndicatorOverlay`、布局常量与 `layout`、结构操作 `addNode`/`addTree`/`moveNode`/`detachMindmap`/`createFromTree`/`findTargetNode`、工具栏/适配器；`./view` 的 `MindmapViewExtension`、`./store` 的 `MindmapStoreExtension`。
- **思维导图不可分组/解组、不可手动缩放**：group 命令对它直接失败；`resizeConstraint.allowedHandlers` 为空。
- **节点坐标是派生的**：不要手动设节点 `xywh` 期望持久——下次 `layout()` 会覆盖。改结构应通过 `addNode`/`moveNode` 等 API。
- **连线是本地派生元素**：`LocalConnectorElementModel` 不入文档、随拓扑重算，不要当持久连接线持有。
- **折叠按钮是 LocalShapeElement**：由 `MindMapView` 管理生命周期，随节点增删自动增删。
- **改拓扑后需 `layout()`**：结构 API 内部已调 layout；若直接改 `children` Map 要记得触发重排（`@observe` 会重建树但布局需显式跑）。
- **平衡布局依赖 `MindmapRoot.left/right`**：直接操作 children 时要维持左右子集一致，否则平衡布局会错乱。

## 7. 延伸

- 基础设施：`@blocksuite/std` 的 `GfxGroupLikeElementModel`（与 group 共享的群组基类）、`GfxElementModelView`/`GfxViewInteractionExtension`/`InteractivityExtension`、`generateKeyBetween`（fractional-indexing）。
- 复用的 gfx 包：`@blocksuite/affine-gfx-shape`（节点形状、`fitContent`）、`@blocksuite/affine-gfx-connector`（连线渲染、`ConnectorPathGenerator`）、`@blocksuite/affine-gfx-text`、`@blocksuite/affine-gfx-pointer`。
- 同类容器：`@blocksuite/affine-gfx-group`（同为 `GfxGroupLikeElementModel`，但无强结构/自动布局；group 包多处把 mindmap 当"特殊群组"排除）。
- 画布层：`@blocksuite/affine-block-surface`（`SurfaceBlockModel`/本地元素/Overlay）。
