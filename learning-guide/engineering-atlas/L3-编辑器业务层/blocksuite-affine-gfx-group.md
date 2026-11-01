# `@blocksuite/affine-gfx-group`

> 一句话定位：白板上的**元素分组**图形层——把多个图元"打包"成一个 `GroupElementModel`，让它们能作为整体被选中、移动、缩放、嵌套；分组本身不存自己的几何尺寸，而是由子元素的联合包围盒**派生**出来，核心难点是"包含关系的响应式维护"与"点击分组该选谁"的层级穿透逻辑。

| 项        | 值                                                                                                                                                                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/group`                                                                                                                                                                                                                                                                                               |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                                             |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                                               |
| 关键依赖  | `@blocksuite/std`（`GfxElementModelView`/`GfxViewInteractionExtension`/`InteractivityExtension`/`GfxGroupLikeElementModel`）、`@blocksuite/affine-block-surface`（`SurfaceGroupLikeModel`/`SurfaceMiddleware`/CRUD）、`@blocksuite/affine-model`（`GroupElementModel`）、`fractional-indexing`、`@blocksuite/global`、`lit` |
| 被谁依赖  | edgeless 编辑器预设（通过 `GroupViewExtension` 注册）                                                                                                                                                                                                                                                                       |
| 对外入口  | `.`、`./view`（`GroupViewExtension`）、`./store`（`GroupStoreExtension`，含 watcher）                                                                                                                                                                                                                                       |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置：一种"容器型图元"

分组是画布原生图元（`type === 'group'`），但它和画笔、连接线有本质不同：**它自己几乎不画东西，也没有自己的尺寸**。它是一个"容器"——存一组子元素 id，提供"把这些元素当一个整体操作"的能力。在 gfx 的模型谱系里，它不继承普通的 `GfxPrimitiveElementModel`，而是继承 **`GfxGroupLikeElementModel`**（std 提供的"群组型"抽象基类，思维导图 `MindmapElementModel` 也继承它）。

与"块范式"类比：块树天然有父子（`store.getParent`），而**画布图元默认是扁平的**（都挂在 surface 下、靠 z-index 分层）。分组就是在扁平画布上**人为引入一层父子关系**。这带来三个独有问题，构成本包主线：

1. **几何从哪来**：分组的 `xywh` 必须是所有子元素的联合包围盒，子元素一动，分组框就得变。
2. **关系如何维护**：子元素被删、分组被清空、嵌套分组，都要保持 `children` 与 `childIds` 一致。
3. **交互如何穿透**：点一下分组里的某个元素，到底选中"整个分组"还是"那个元素"？取决于当前是否已"进入"该分组。

### 1.2 独有部分：分组模型与包含关系

本包真正自有的代码不多——因为大量能力在基类 `GfxGroupLikeElementModel`（std）和 `SurfaceGroupLikeModel`（surface）里。本包负责：`GroupElementModel` 的具体字段（`children`/`title`）、**分组/解组命令**（含 fractional index 的精细处理）、**交互扩展**（点击穿透、缩放代理到子元素）、**关系看护**（空分组自动删除）、以及标题渲染与编辑。

## 2. 目录与关键文件

```text
group/src/
├── index.ts                 # 聚合导出
├── view.ts                  # GroupViewExtension：注册渲染/视图/交互/工具栏
├── store.ts                 # GroupStoreExtension：注册 adapter + groupRelationWatcher
├── command/
│   └── group-api.ts         # ★createGroupCommand / createGroupFromSelectedCommand / ungroupCommand
├── element-view.ts          # GroupElementView（双击编标题）+ GroupInteraction（缩放代理到子元素）
├── interaction-ext.ts       # GroupInteractionExtension：点击命中时的层级穿透选择
├── group-watcher.ts         # SurfaceMiddleware：子节点清空时自动删除空分组
├── renderer/
│   ├── element-renderer.ts  # canvas 渲染：选中时画蓝框 + 标题
│   ├── utils.ts             # titleRenderParams：标题字体/位置计算
│   └── dom-renderer.ts      # DOM 备用渲染
├── text/                    # 分组标题编辑器（edgeless-group-title-editor）
├── toolbar/config.ts        # 工具栏（分组/解组按钮）
└── __tests__/group-api.unit.spec.ts  # 分组 API 单测

# 模型与基类：
#   affine/model/src/elements/group/group.ts              —— GroupElementModel（children/title）
#   framework/std/src/gfx/model/surface/element-model.ts  —— GfxGroupLikeElementModel 抽象基类
```

## 3. 实现细节

### 3.1 数据模型：`children` 是 `Y.Map<boolean>`，`xywh` 是派生的

`GroupElementModel`（`affine/model/.../group/group.ts:27`）只有两个持久字段：

```ts
@observe((_, instance, transaction) => {
  if (instance.children.doc) {
    instance.setChildIds(Array.from(instance.children.keys()), transaction?.local ?? false);
  }
})
@field()
accessor children: Y.Map<boolean> = new Y.Map<boolean>();   // 子元素 id 集合（值恒为 true）

@field()
accessor title: Y.Text = new Y.Text();
```

用 `Y.Map<boolean>`（而非数组）存子 id 是为了**协同友好**：两个用户同时往同一分组加不同元素，Map 的键级合并天然无冲突，数组则会打架。值永远是 `true`，只用键当集合。

`rotate` 被硬编码为 `0`（`:28-32`，getter 返回 0、setter 空实现）——**分组不可旋转**，因为旋转一个"联合包围盒"语义不清。

关键在基类 `GfxGroupLikeElementModel`（`std/.../element-model.ts:382`）：

- **`xywh` getter（`:424`）是派生 + 缓存**：`_getXYWH()`（`:437`）遍历 `childElements`，把每个（非隐藏）子元素的 `elementBound` 用 `bound.unite(...)` 联合起来。结果缓存在 `_local`，由 `_xywhDirty` 脏标记控制失效。`set xywh(_) {}` 是空的——**你不能直接设分组尺寸，只能改子元素**。
- **`childIds` 与 `setChildIds`（`:510`）**：`children`（Y.Map）是"持久真相"，`_childIds`（数组）是"运行时索引"。模型的 `@observe` 装饰器监听 Y.Map 变化，调 `setChildIds` 同步数组，并 `invalidateXYWH()` 标脏——于是**加/删子元素 → childIds 更新 → xywh 自动重算**，形成响应链。
- **`descendantElements`/`hasDescendant`（`:420`/`:496`）**：支持嵌套分组的递归后代查询。

`addChildren`（`group.ts:60`）加子元素前用 `canSafeAddToContainer` 过滤——防止把分组加进自己或形成环（嵌套分组的安全约束）。

### 3.2 分组：`createGroupFromSelectedCommand`

分组是一条命令（`command/group-api.ts`）。`createGroupCommand`（`:82`）是底层：用 `EdgelessCRUDIdentifier.addElement('group', { children, title })` 建分组，`children` 由选中元素 id `reduce` 成 `{ id: true }` 映射，标题默认 `Group N`。

`createGroupFromSelectedCommand`（`:111`）是面向交互的完整版，关键约束（`:124-133`）：**所有选中元素必须同属一个父分组，且父不能是思维导图**（`MindmapElementModel` 有自己的结构管理，不能随意分组）。核心逻辑在一个 `transact` 事务里（`:137-153`）：建分组后，如果这些元素原本在某个父分组 `parent` 里，要把它们从 `parent` 移除、再把**新分组**加进 `parent`——即"在原父分组内就地打包"，维持嵌套结构。最后选中新分组。`measureOperation` 包裹用于性能埋点。

### 3.3 解组：`ungroupCommand` 与 fractional index 的讲究

解组（`:168`）的难点不在"拆开"，而在**保持子元素的 z-order（层级顺序）**。画布图元用 **fractional index**（分数索引，`fractional-indexing` 库）表达前后顺序——两个元素间总能插入一个新 key。解组时，子元素要"占据原分组在兄弟中的那个位置区间"，否则层级会乱跳。

`buildUngroupIndexes`（`:35`）为此做了**多级降级**（`:68-78`）：优先 `generateNKeysBetween(afterIndex, beforeIndex, count)` 在分组原来的前后兄弟索引之间生成 N 个新 key；若区间非法（历史脏数据导致左右反了）则忽略上界重试；再不行用分组自身 index 当锚点；最后 `generateNKeysBetween(null, null)`（总是合法）；仍失败则逐个 `generateKeyBetween` 兜底。这种"层层 try/catch 降级"是面对"可能损坏的协同历史数据"的防御式编程。

拆开动作在事务里（`:203-221`）：把分组从父移除、把子元素从分组移除、按算出的 `nextIndexes` 重排子元素 index、再把子元素挂回父（若有）。`batchAddChildren`/`batchRemoveChildren` 是 std 提供的批量工具。思维导图分组直接 `return` 不允许解组（`:179`）。

### 3.4 包含关系看护：空分组自动删除

`groupRelationWatcher`（`group-watcher.ts:8`）是一个 `SurfaceMiddleware`，只订阅一件事：当某个 `SurfaceGroupLikeModel` 的 `childIds` 变成空（`:18-24`），就 `surface.deleteElement(id)` 删掉它。这保证"把分组里最后一个元素拖出去/删掉"后，空壳分组不会残留。注意 `if (!local) return`——只响应本地操作，远端的删除会通过协同同步自然到达，避免重复删除冲突。

### 3.5 交互一：点击穿透的层级选择

这是分组最精妙的交互。`GroupInteractionExtension`（`interaction-ext.ts:4`，一个 `InteractivityExtension`）挂在 `onElementSelect` 上，决定"命中某元素时实际该选谁"（`:7-43`）：

- 维护一个"当前进入的分组"`activeGroup`（双击分组进入）。
- **若已进入 activeGroup 且命中的是它的后代**：从命中元素的祖先链 `target.groups` 里，取 `activeGroup` **之下**那一层的分组（`slice(0, activeGroupIdx)` 里 `findLast` 一个候选分组）——即"进入分组后，点击只在这一层内选择，不会跳出去选到整个大分组"。
- **否则（未进入）**：从祖先链里 `findLast` 一个候选分组当选择目标——即"默认点任何子元素，选中的是它最外层的分组"。

通过 `suggest({ id })` 把修正后的目标回传给选择系统。一句话概括：**没进分组时点谁都选整组，进了分组后点谁只选这一层**——这正是所有图形软件（Figma/PPT）的分组手感。

### 3.6 交互二：缩放代理到子元素

`GroupInteraction = GfxViewInteractionExtension(...)`（`element-view.ts:36`）接管分组的缩放。它的 `handleResize`（`:39`）做了一件反直觉的事：把分组自己从缩放上下文里 `delete`，转而把所有（非分组的）`descendantElements` `add` 进去（`:41-48`）。于是"缩放分组框"实际变成"同时缩放所有叶子子元素"——因为分组自己没有独立几何，缩放它就是缩放它的内容。缩放回调本身全是空函数（`empty`），真正的变换由被代理进来的子元素各自处理。

`GroupElementView`（`:9`）还提供双击进入标题编辑（`mountGroupTitleEditor`，`:30`）。

### 3.6 渲染：只在相关时画框和标题

`group` 渲染器（`renderer/element-renderer.ts:11`）体现"分组平时不可见"：只有当**分组被选中**、或**某个子元素被选中**时才画边框（`:26-40`）——选中分组画蓝框（`--affine-blue`）、子元素被选画浅蓝框（`#8FD1FF`）。标题通过 `renderTitle`（`:48`）用 `fillText` 画在框左上方，位置由 `titleRenderParams` 按 zoom 算出，并把标题包围盒写回 `model.externalXYWH`（供命中测试用）。平时（无选中）分组完全透明，只是一个逻辑容器。

## 4. 语法特色

- **`GfxGroupLikeElementModel` 抽象基类 + 模板方法**：基类定义 `xywh` 派生、`childIds` 索引、`setChildIds`，把 `children`/`addChild`/`removeChild` 声明为 `abstract` 留给子类——经典模板方法模式，group 与 mindmap 共享骨架。
- **`@observe` 装饰器桥接 Yjs**：`children` 上的 `@observe` 在 Y.Map 变化时调 `setChildIds` 同步运行时索引，是"持久数据 → 派生状态"的声明式绑定；装饰器注释特意说明"用 `GroupElementModel` 类型会导致 playwright 报错"故用基类型（`group.ts:123`）。
- **`Y.Map<boolean>` 当集合**：利用 CRDT Map 的键级无冲突合并，比数组更适合并发增删子元素。
- **fractional indexing**：用字符串分数索引表达可无限细分的顺序，`generateNKeysBetween`/`generateKeyBetween` 在两 key 间插值；配合多级 try 降级应对脏数据。
- **脏标记 + mutex 缓存**：`xywh` getter 用 `_xywhDirty` + `createMutex()` 保护派生计算，避免递归/并发重入（`element-model.ts:424-433`）。
- **`InteractivityExtension` 的 `suggest` 回调**：交互扩展不直接改选择，而是 `suggest` 一个建议目标，解耦"命中"与"选择决策"。

## 5. 设计 / 实现亮点

- **分组尺寸全派生**：不存 `xywh`，而由子元素联合包围盒算出 + 脏标记缓存——子元素一动分组框自动跟随，无需任何手工同步。
- **持久真相与运行时索引分离**：`children`（Y.Map，协同真相）与 `childIds`（数组，快速遍历）由 `@observe` 自动对齐，兼顾协同正确性与访问效率。
- **层级穿透选择**：用"activeGroup + 祖先链 findLast"把"点谁选谁"建模成一层层进入/退出，精准复刻主流设计软件手感。
- **缩放代理**：缩放容器即缩放其所有叶子，优雅处理"容器无自身几何"的本质。
- **解组保序的降级链**：用 fractional index 多级 try 保证 z-order 稳定，且对损坏的历史数据极其鲁棒。
- **空分组自愈**：watcher 在子节点清空时自动回收，杜绝悬空容器。

## 6. 对外 API 与注意事项

- 主要导出：`createGroupCommand`/`createGroupFromSelectedCommand`/`ungroupCommand`、`GroupElementView`/`GroupInteraction`、`GroupElementRendererExtension`/`GroupDomRendererExtension`、工具栏配置；`./view` 的 `GroupViewExtension`、`./store` 的 `GroupStoreExtension`。
- **`GroupStoreExtension` 必须装**：它注册的 `groupRelationWatcher` 负责空分组回收。
- **分组不能旋转**：`rotate` 恒为 0，设置无效。
- **不能对思维导图分组/解组**：命令对 `MindmapElementModel` 直接返回失败。
- **分组几何只读**：不要尝试 `group.xywh = ...`（setter 为空），改变分组大小只能改子元素。
- **跨父分组不能一起打包**：`createGroupFromSelectedCommand` 要求选中元素同父，否则静默失败。
- **嵌套安全**：`addChildren` 会用 `canSafeAddToContainer` 拒绝形成环的添加。

## 7. 延伸

- 基础设施：`@blocksuite/std` gfx 的 `GfxGroupLikeElementModel`（抽象基类）、`GfxElementModelView`/`GfxViewInteractionExtension`/`InteractivityExtension`、`batchAddChildren`/`fractional-indexing` 工具。
- 画布层：`@blocksuite/affine-block-surface` 的 `SurfaceGroupLikeModel`、`SurfaceMiddleware`、`EdgelessCRUDIdentifier`。
- 同类：`mindmap`（也继承 `GfxGroupLikeElementModel`，但有强结构约束），本包多处以 `MindmapElementModel` 作为"特殊群组"排除。
- 同层 gfx：`@blocksuite/affine-gfx-connector`（连接线把 Group 作为可连接目标处理）。
