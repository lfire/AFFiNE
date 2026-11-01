# `@blocksuite/affine-widget-edgeless-auto-connect`

> 一句话定位：白板上为 note 显示**"页面可见性 / 页面顺序"指示标签**的浮层 widget——给在页面模式可见的 note 标上带序号的圆角徽标（并挂一个上/下导航器在它们之间跳转）、给"仅白板可见"的 note 标上"隐藏于页面"图标。它把"这个白板 note 在正式文档里排第几 / 是否出现"这层跨模式信息，直观地叠加到画布上。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/edgeless-auto-connect`                                                                                                                                                                                                                                                                                                                                                                                                  |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 语言/形态 | TypeScript / Lit widget 包（单文件 `index.ts`）                                                                                                                                                                                                                                                                                                                                                                                                    |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`WidgetViewExtension`/`std.event`）、`@blocksuite/std/gfx`（`GfxController`/`viewport`/`selection`）、`@blocksuite/affine-block-surface`（`EdgelessCRUDIdentifier`/`EdgelessLegacySlotIdentifier`/`isNoteBlock`）、`@blocksuite/affine-model`（`NoteBlockModel`/`FrameBlockModel`/`SurfaceRefBlockModel`/`NoteDisplayMode`）、`@blocksuite/affine-shared`（`FeatureFlagService`）、`@blocksuite/icons`、`lit` |
| 被谁依赖  | 编辑器预设（通过 `EdgelessAutoConnectViewExtension` 注册，仅白板 scope）                                                                                                                                                                                                                                                                                                                                                                           |
| 对外入口  | `.`（`EdgelessAutoConnectWidget`/`autoConnectWidget`/`AFFINE_EDGELESS_AUTO_CONNECT_WIDGET`）、`./view`                                                                                                                                                                                                                                                                                                                                             |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

与所有 `widgets/*` 一致：`EdgelessAutoConnectWidget extends WidgetComponent<RootBlockModel>`（`src/index.ts:117`），用 Shadow DOM（`` static styles = css`…` ``）把徽标绝对定位覆盖在白板之上；`autoConnectWidget = WidgetViewExtension('affine:page', …)`（`:626`）注册到 root；`EdgelessAutoConnectViewExtension`（`src/view.ts`）是装配入口，且**只在白板 scope 注册**——`if (this.isEdgeless(context.scope)) context.register(autoConnectWidget)`（`view.ts:19`），这是白板专属 widget 的标准写法。它监听的"host 状态"是 `gfx.viewport`（视口变换）与 `gfx.selection`（选中变化）。

### 独有的问题：把"跨模式可见性"可视化

AFFiNE 的 note 有 `displayMode`：`DocAndEdgeless`（页面与白板都显示）、`EdgelessOnly`（只白板显示）、`DocOnly`。在白板里，用户看不出"哪个 note 会进正式文档、按什么顺序"。本 widget 解决的正是这个认知缺口：

1. **页面可见索引标签**：对 `DocAndEdgeless` 的 note、以及被 `surface-ref` 引用的 note/frame，在其下方画一个带**序号**的徽标，序号即它在"页面流"里的出现次序。
2. **引用计数的扇形排布**：同一个白板元素可能被**多个** `surface-ref` 引用（即在页面里出现多次），于是一个元素下可能叠放多个序号徽标，用 `calculatePosition` 把它们扇形展开。
3. **白板专属标记**：`EdgelessOnly` 的 note 标一个"隐藏于页面"的 `InvisibleIcon`，提示它不会进文档。
4. **导航器**：选中某个页面可见 note 时，浮现一个 `< | >` 导航条，按页面顺序在这些元素间跳转（`setViewportByBound` 平滑聚焦）。

整个功能受 feature flag `enable_advanced_block_visibility` 开关控制（`render` 开头判定，`:588`），属于高级可见性特性。

## 2. 目录与关键文件

```text
src/
├── index.ts    # ★全部逻辑：EdgelessAutoConnectWidget + 布局算法 + 注册（636 行）
├── view.ts     # EdgelessAutoConnectViewExtension：仅 edgeless scope 注册
└── effects.ts  # customElements.define('affine-edgeless-auto-connect-widget', …)
```

本包是"单文件 widget"的典型——逻辑、样式、几何算法、ViewExtension 片段全在 `index.ts`。

## 3. 实现细节

### 3.1 数据收集：`_updateLabels`

`_updateLabels`（`index.ts:190`）在每次 `render` 前重算两张表（`:596`）：

- 遍历 root 的 note children：`displayMode === EdgelessOnly` 的进 `_edgelessOnlyNotesSet`；`DocAndEdgeless` 的进 `_pageVisibleElementsMap`（计数置 1）。
- 遍历每个 note 的 children，找 `SurfaceRefBlockModel`，用 `_crud.getElementById(reference)` 取出被引用的白板元素（note/frame）；每被引用一次，`_pageVisibleElementsMap` 里该元素计数 +1。

于是 `_pageVisibleElementsMap: Map<AutoConnectElement, number>` 的 value 就是"该元素在页面流里出现的次数"，决定其下要画几个序号徽标。`AutoConnectElement = NoteBlockModel | FrameBlockModel`（`:106`），`isAutoConnectElement` 做类型守卫。

### 3.2 ★序号徽标与扇形布局：`calculatePosition`

`_PageVisibleIndexLabels`（`:433`）对每个页面可见元素：用 `viewport.toViewCoord(bound.x, bound.y)` 把模型坐标换算成视口像素，把徽标容器定位到元素正下方（`transform: translate(... , right + height + INDEX_LABEL_OFFSET)`）。容器内按 `count` 放 `count` 个序号 div，`index` 是跨所有元素累加的全局序号（保证整个画布里序号连续递增）。

多徽标的横向排布由 `calculatePosition(gap, count, iconWidth)`（`:39`）计算——这是本包唯一的"算法"。它要把 `count` 个 24px 徽标以中心对称方式摊开：

```ts
const middleIndex = (count - 1) / 2; // 中心索引（可能是 .5）
const isEven = count % 2 === 0;
const middleOffset = (gap + iconWidth) / 2;
// 偶数：中间两个各偏 ±middleOffset，其余按 (ceil(距中心)-1)*(gap+24)+middleOffset 递推
// 奇数：正中一个在 0，其余按 ceil(距中心)*(gap+iconWidth) 递推
```

`getSign` 决定每个徽标在中心左侧还是右侧。奇偶分开处理，是为了让偶数个徽标时中心落在两徽标之间、奇数个时中心落在正中徽标上，视觉对称。

**悬停展开**：容器 `@mouseenter` 时用 `gap=5` 重算 positions 把徽标间距拉大、`@mouseleave` 恢复 `initGap`（`initGap = 24/count - 24`，负值表示默认重叠收拢）。于是默认叠在一起、悬停时扇形散开——`updateChildrenPosition` 直接改子元素 `style.top/left`，配合 CSS `transition: all 0.1s linear` 产生动画。

### 3.3 白板专属标记：`_EdgelessOnlyLabels`

`_EdgelessOnlyLabels`（`:234`）对 `_edgelessOnlyNotesSet` 每个 note 画一个圆形灰底徽标，内含 `InvisibleIcon`，`affine-tooltip` 提示 "Hidden on page"。定位同样走 `toViewCoord` + 元素下方偏移。它表达"此 note 仅存在于白板"。

### 3.4 导航器：按页面顺序跳转

`_NavigatorComponent`（`:387`）渲染 `< span >` 三段式导航条，定位到当前 `_index` 对应元素下方。`_navigateToPrev/Next`（`:361`/`:374`）在 `_getElementsAndCounts()` 给出的元素数组里移动 `_index`，对新元素：`_selection.set({ elements:[id], editing:false })` 选中它，并 `viewport.setViewportByBound(bound, [80,80,80,80], true)` 带 80px padding 平滑聚焦。导航条的显隐由 class `navigator show/hidden` + CSS `opacity` 过渡控制。

点击某序号徽标会 `this._index = this._index === i ? -1 : i`（`:484`）——再次点击同一个则收起导航器（置 -1）。

### 3.5 ★显隐与刷新：响应 gfx 信号

`_initLabels`（`:287`）在 `connectedCallback` 里建立可见性逻辑 `getVisibility`：**选中且仅选中一个元素、非编辑态、且该元素是 note 或某 surface-ref 的引用目标**时 `_show=true`，否则 false。它订阅：

- `_selection.slots.updated` → 重算可见性；
- `store.slots.blockUpdated`（flavour `affine:surface-ref`）→ 增删引用、或 reference 变化时 `requestUpdate`；
- `surface.elementUpdated` → 被引用元素的 `xywh` 变（移动/缩放）时 `requestUpdate`，让徽标跟随。

`firstUpdated`（`:543`）再订阅 `viewport.viewportUpdated`（平移缩放 → `requestUpdate` 重算所有 `toViewCoord`）、以及一组"拖拽/缩放进行中就隐藏"的信号：`std.event.add('dragStart'/'dragEnd')` 与 `slots.elementResizeStart/End` 切换 `_dragging`。`render`（`:587`）开头即 `if (!this._show || this._dragging || !advancedVisibilityEnabled) return nothing`——拖拽时不画徽标，避免跟手抖动。

`_setHostStyle`（`:529`）把 widget 自身设为 `position:absolute; top/left:0; z-index:1`，作为覆盖整个白板的定位参照系。

## 4. 语法特色

- **`WidgetComponent<RootBlockModel>` + `static styles`**：widget 用 Shadow DOM 承载徽标样式（`.page-visible-index-label`/`.navigator`），与无 Shadow DOM 的块组件（`ShadowlessElement`）形成对比——徽标是独立浮层，样式隔离反而合适。
- **`@state() accessor` 驱动重渲**：`_show`/`_dragging`/`_index`/`_pageVisibleElementsMap`/`_edgelessOnlyNotesSet` 全是 `@state accessor`，任一变化触发 Lit 重渲（`:609-623`）。
- **`repeat(items, keyFn, tmplFn)`**：徽标列表用 Lit 的 `repeat` 指令并以 `element.id`/`note.id` 为 key，保证元素增删时 DOM 复用正确（`:239`/`:441`）。
- **`styleMap` 动态定位**：所有徽标的位置都是 `` styleMap({ transform: `translate(${x}px, ${y}px)` }) `` 运行时算出——浮层 widget 的定位几乎都靠内联 transform。
- **`toViewCoord` 坐标换算 + `zoom` 缩放**：`viewport.toViewCoord(bound.x, bound.y)` 把模型坐标映射到屏幕，`bound.w * zoom` 得到屏幕尺寸——徽标尺寸本身不随缩放变（固定 px），但位置随视口走。
- **类型守卫函数**：`isAutoConnectElement(element): element is AutoConnectElement`（`:108`）用 `instanceof` 做 TS 类型收窄，使 `_crud.getElementById` 返回的宽类型安全地窄化为 note/frame。
- **feature flag 条件渲染**：`store.get(FeatureFlagService).getFlag('enable_advanced_block_visibility')`（`:588`）在 render 内判定，未开启直接 `nothing`——特性开关落到视图层。

## 5. 设计 / 实现亮点

- **把不可见的跨模式语义画成可见徽标**：note 的 `displayMode`、surface-ref 的引用关系本是数据层概念，widget 把它翻译成"序号 / 隐藏图标 / 导航器"，让用户在白板上直接看懂"进不进文档、排第几、出现几次"。
- **引用计数 → 扇形徽标**：一个元素被多个 surface-ref 引用时叠放多个序号，`calculatePosition` 用奇偶对称的几何把它们默认收拢、悬停散开，既省空间又可展开查看，是小而精的交互设计。
- **全局连续序号**：`_PageVisibleIndexLabels` 用一个跨 `repeat` 累加的 `index`，保证整个画布的序号按页面顺序连续，而非每个元素内部重新计数——与"页面流顺序"语义对齐。
- **纯浮层、零侵入**：widget 只读 note/surface-ref 数据并叠加 UI，不改任何块；拖拽/缩放时自动隐藏，视口变化时整体重算——典型的"观察 + 覆盖"型 widget。
- **feature flag 收口**：高级可见性是渐进特性，整个 widget 用一个 flag 在 render 层开关，未启用时零渲染开销。

## 6. 对外 API 与注意事项

- **主要导出**：`EdgelessAutoConnectWidget`、`AFFINE_EDGELESS_AUTO_CONNECT_WIDGET`、`autoConnectWidget`（ViewExtension 片段）、`EdgelessAutoConnectViewExtension`（`./view`）。
- **装配**：只在白板 scope 注册；页面编辑器里不存在本 widget。
- **注意**：
  - 整个功能受 `enable_advanced_block_visibility` flag 门控，未开启则完全不渲染。
  - 徽标**仅在选中单个相关元素且非编辑/非拖拽**时显示（`getVisibility` 规则），不是常驻；这是刻意的"按需提示"而非持续标注。
  - 序号反映的是"页面可见顺序 / 被引用次数"，`DocOnly` 的 note（不在白板）自然不在此列；`EdgelessOnly` 走的是另一套"隐藏"标记而非序号。
  - 包名 `auto-connect` 偏历史命名，当前实现是"页面可见性索引标签 + 导航"，并非几何连线。
  - 徽标位置依赖 `viewport.toViewCoord`，视口未就绪或 bound 非法时位置可能异常；它靠订阅 `viewportUpdated` 持续重算跟随。

## 7. 延伸

- 底层：`@blocksuite/std`（`WidgetComponent`/`std.event`）、`@blocksuite/std/gfx`（`viewport.toViewCoord`/`setViewportByBound`/`GfxSelection`）。
- 宿主与数据：`@blocksuite/affine-block-root`（白板根，widget 挂载宿主）、`@blocksuite/affine-block-surface`（`EdgelessCRUDIdentifier` 取元素、surface-ref 引用）、`@blocksuite/affine-block-note`（note 的 `displayMode`）、`@blocksuite/affine-model`（`NoteDisplayMode`/`SurfaceRefBlockModel`）。
- 对照阅读：`blocksuite-affine-widget-edgeless-selected-rect.md`（同为白板选中态浮层，但做变换手柄）、`blocksuite-affine-block-root.md` §3.4（白板视口与坐标体系）、`toeverything-infra.md`（signal 响应式）。
