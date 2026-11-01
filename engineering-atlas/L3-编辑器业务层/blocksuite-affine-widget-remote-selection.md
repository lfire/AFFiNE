# `@blocksuite/affine-widget-remote-selection`

> 一句话定位：多人协作时，把**别人**的光标、选区、框选画在你屏幕上的 widget——它读取 Yjs awareness 里其它客户端广播的选择状态（文本选区 / 块选区 / 白板图元选区 / 白板游标坐标），为每个协作者分配一种稳定颜色，在页面模式与白板模式各用一套浮层把"张三正选着这段话""李四的光标在这""王五框住了这三个图元"实时渲染出来。它是协作 awareness 的**可视化终端**，本身不产生任何选择、只被动投影远端状态。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/widgets/remote-selection`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 所属层    | L3 · 编辑器业务层（控件 / widget）                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 语言/形态 | TypeScript / Lit widget 包（含 doc + edgeless 两套 widget）                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 关键依赖  | `@blocksuite/std`（`WidgetComponent`/`TextSelection`/`BlockSelection`）、`@blocksuite/std/gfx`（`GfxControllerIdentifier`/`gfx.selection`/`viewport`）、`@blocksuite/affine-block-surface`（`EdgelessCRUDIdentifier`）、`@blocksuite/affine-shared`（`getSelectionRectsCommand`/`EditPropsStore`）、`@blocksuite/affine-model`（各块模型判定透明背景）、`@blocksuite/store`（`awarenessStore`/`UserInfo`/`BaseSelection`）、`@preact/signals-core`、`lit`、`lodash-es/throttle` |
| 被谁依赖  | 编辑器预设（通过 `RemoteSelectionViewExtension` 注册）、`@affine/core`（协作编辑场景）                                                                                                                                                                                                                                                                                                                                                                                          |
| 对外入口  | `.`（两个 widget 类 + 标签常量）、`./view`（`RemoteSelectionViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                    |

## 1. 设计逻辑

### 在 widget 统一范式中的位置

本包遵循与所有 `widgets/*` 相同的范式（见 `blocksuite-affine-widget-drag-handle.md` §1、`blocksuite-affine-widget-edgeless-dragging-area.md` §1）：

1. **`WidgetComponent` 子类 + Shadow DOM 浮层**：两个 widget——页面模式的 `AffineDocRemoteSelectionWidget extends WidgetComponent`（`doc/doc-remote-selection.ts:40`）与白板模式的 `EdgelessRemoteSelectionWidget extends WidgetComponent<RootBlockModel>`（`edgeless/index.ts:22`）——都是挂在 root 上的绝对定位浮层，`:host { pointer-events: none }`（`doc-remote-selection.ts:42`、`edgeless/index.ts:24`）保证它永远不拦截本地用户的鼠标。
2. **`WidgetViewExtension` 注册到 `affine:page` scope**：`src/index.ts:10`/`:16` 分别用 `WidgetViewExtension('affine:page', …)` 声明 doc 与 edgeless 两个 widget。
3. **`ViewExtensionProvider` 统一装配**：`src/view.ts` 的 `RemoteSelectionViewExtension` 在 `setup` 里永远注册 `docRemoteSelectionWidget`，**仅当 `context.scope === 'edgeless'`** 时再追加 `edgelessRemoteSelectionWidget`（`view.ts:20-26`）——因为页面模式不存在白板图元/游标，无需 edgeless widget。
4. **监听 host 状态**：这里监听的不是本地事件，而是 **`std.selection.remoteSelections`** 与 **`store.awarenessStore`**——即 Yjs awareness 协议同步进来的远端客户端状态。

### remote-selection 独有的问题

普通选区 widget 画的是"我自己"的选择；本包画的是"所有别人"的选择，复杂度集中在三件独有的事：

- **awareness → 几何**（独有之一）：远端客户端广播的是**抽象选择**（"blockId=X 的第 3~10 个字符"或"选中了图元 id=Y"），不是像素矩形。widget 必须在**本地 DOM**里把这些抽象选择重新解析成屏幕矩形——而本地的滚动位置、缩放、块是否已渲染都和远端不同，解析随时可能失败（远端选的块本地还没加载）。
- **颜色分配**（独有之二）：每个协作者要有一个**稳定且互不冲突**的颜色，刷新/重连后颜色应尽量一致。`RemoteColorManager` + `RandomPicker` 负责"不重复地发牌 + 落盘复用"。
- **双模型两套渲染**（独有之三）：页面模式渲染的是**文字选区矩形 + 块选区矩形 + 文本光标竖线 + 用户名气泡**（DOM Range 驱动）；白板模式渲染的是**图元包围盒 + 带旋转 + 自由游标图标 + 用户名**（模型坐标 → 视口坐标驱动）。两者几何来源完全不同，故拆成 `doc/` 与 `edgeless/` 两个独立 widget。

一句话：**本地用户的选区由编辑器核心直接画；远端用户的选区没有本地 DOM 事件可依赖，必须从 awareness 状态反向重建几何**——这就是本包存在的理由。

## 2. 目录与关键文件

```text
src/
├── index.ts                        # 两个 WidgetViewExtension('affine:page', …) + re-export doc/edgeless
├── view.ts                         # RemoteSelectionViewExtension：doc 恒注册、edgeless 仅白板 scope
├── effects.ts                      # customElements.define（两个 widget 标签）
├── doc/
│   ├── doc-remote-selection.ts     # ★AffineDocRemoteSelectionWidget：页面模式远端选区/光标渲染
│   ├── utils.ts                    # selectionStyle / cursorStyle：两个 styleMap 工厂
│   ├── config.ts                   # DocRemoteSelectionConfig 类型（哪些块用透明背景）
│   └── index.ts                    # re-export
├── edgeless/
│   └── index.ts                    # ★EdgelessRemoteSelectionWidget：白板模式远端图元框/游标渲染
└── manager/
    ├── color-picker.ts             # RandomPicker + multiPlayersColor（8 色无放回洗牌发牌）
    └── remote-color-manager.ts     # ★RemoteColorManager：按 clientId 取色、本地色落盘 EditPropsStore
```

## 3. 实现细节

### 3.1 awareness 数据源：`remoteSelections` 与 `awarenessStore`

两个 widget 都从同一处取远端状态。页面 widget 用一个 `computed` 把"选择"与"用户信息"拼起来（`doc-remote-selection.ts:60`）：

```ts
private readonly _remoteSelections = computed(() => {
  const status = this.store.awarenessStore.getStates();          // clientId → { user, color, … }
  return [...this.std.selection.remoteSelections.entries()].map(  // clientId → BaseSelection[]
    ([id, selections]) => ({ id, selections, user: status.get(id)?.user })
  );
});
```

`std.selection.remoteSelections` 是 std 选择管理器维护的"**排除自己之后**的所有客户端选择表"，它本身建立在 Yjs awareness 的变更广播之上；`awarenessStore.getStates()` 提供每个 `clientId` 的 `user`（名字/头像）与 `color`。白板 widget 则取三张更细的表：`remoteSurfaceSelectionsMap`（图元选区）、`remoteCursorSelectionMap`（自由游标坐标）（`edgeless/index.ts:95`/`:110`）。

### 3.2 ★页面模式：从抽象选择重建矩形

`AffineDocRemoteSelectionWidget` 的核心是把 `BaseSelection[]` 翻译成 `SelectionRect[]`。入口 `_getSelectionRect`（`doc-remote-selection.ts:212`）：

1. 把远端选择分成**文本选区**（`instanceof TextSelection`）与**块选区**（`instanceof BlockSelection`）；两者皆空直接返回 `[]`。
2. 调 **`getSelectionRectsCommand`**（`std.command.exec`，`:233`）——这是 shared 提供的命令，在本地 DOM 里把"文本选区的 range + 块选区的 blockId"解析成一组 `{ blockId, left, top, width, height }`。复用命令而非自己写 Range 遍历，保证与本地选区高亮同源。
3. 对每个矩形按块类型决定是否**透明背景**：`_config.blockSelectionBackgroundTransparent`（`:77`）用 `matchModels` 判定 code/database/image/attachment/bookmark/surface-ref/embed 等"自带底色的块"——这些块若盖一层半透明色会很脏，故只画边框不填色（`transparent: true`）。

文本光标（竖线）单独由 `_getCursorRect`（`:146`）算：它取**选区的结束点**，用 `std.range.textSelectionToRange` 造一个零长度 range，读 `range.getClientRects()` 的最后一个矩形作为光标位置；若块还没渲染出 range（远端刚插入、本地未同步完），退化为"块文本末尾"再试一次（`:123-141`）——这是"远端选的位置本地可能还不存在"的典型兜底。所有坐标都减去 `offsetParent` 的 `getBoundingClientRect` 并加回 `scrollTop/scrollLeft`（`:180-185`），换算成相对 widget 容器、随滚动稳定的坐标。

渲染 `render()`（`:331`）按客户端分组：每个远端用户 → 一组选区矩形 div（`selectionStyle`）+ 一条光标竖线 + 一个用户名气泡（`backgroundColor` 为该用户颜色，`display` 取决于是否有 `user.name`）。`selectionStyle`（`utils.ts:6`）把矩形渲染成 `opacity: 20%`、`borderRadius: 3px` 的色块——半透明是为了不遮挡下面的文字。

### 3.3 ★页面模式的刷新时机：高频事件 + 节流

远端选区要随**本地**的滚动、resize、文档变更、视口变化持续重算。`connectedCallback`（`:260`）订阅了一整套触发器：

- `handleEvent('wheel', …)` 与 window `resize` → `requestUpdate`（滚动/窗口变化时重绘，`:263`/`:267`）；
- `effect(() => _updateSelectionsThrottled(_remoteSelections.value))`：awareness 变化 → 节流更新（`:273`）；
- `store.slots.blockUpdated` → 文档内容变了（可能影响矩形）重算（`:279`）；
- `gfx.viewport.viewportUpdated` → 视口变化**立即**（非节流）重算（`:285`）；
- `std.event.active$` → 本编辑器失焦时 `std.selection.clearRemote()` 清掉远端渲染（`:291`）。

`_updateSelections`（`:306`）里用一个 `Set<number>` 对 `clientId` **去重**（同一客户端多条记录只取第一条），把每条选择算出 `rects` 写进 `@state() _selections`，触发 Lit 重渲。`_updateSelectionsThrottled = throttle(_updateSelections, 60)`（`:326`）把高频的 awareness/blockUpdated 压到 ~16fps，而视口更新走不节流的 `_updateSelections` 以求跟手——**该快的快、该省的省**。

### 3.4 ★白板模式：模型坐标 + CSS transform 补偿

`EdgelessRemoteSelectionWidget`（`edgeless/index.ts`）不走 DOM Range，而是走**图元模型矩形**。`_updateRemoteRects`（`:108`）遍历 `remoteSurfaceSelectionsMap`，把每个远端选区的 `elements`（id 列表）经 `crud.getElementById` 取回 `GfxModel`，用 `getSelectedRect(elements)` 求包围盒；**单个图元时额外取 `rotate`**（`:128-134`），让远端选择框能跟着旋转的图元一起转。

关键在于**坐标系对齐**。widget 的 `:host` 用一个随视口变化的 CSS transform 整体缩放平移（`_updateTransform`，`:150`）：

```ts
const { translateX, translateY, zoom, viewScale } = this.gfx.viewport;
this.style.setProperty('--v-zoom', `${zoom / viewScale}`);
this.style.setProperty(
  'transform',
  `translate(${translateX / viewScale}px, ${translateY / viewScale}px) scale(var(--v-zoom))`
);
```

于是每个远端框只需用**模型坐标**定位（`transform: translate(left,top) rotate(deg)`，`:237`），外层 host 的 transform 会把它一并换算到屏幕——注释写明"补偿外层 CSS scale，匹配 `GfxBlockComponent.getCSSTransform`"（`:153`）。`_updateTransform` 用 `requestThrottledConnectedFrame` 包裹（`:150`），保证视口高频变化时按帧合批、且组件断开后不再执行。

远端**游标**（`_updateRemoteCursor`，`:90`）直接用 awareness 里的 `{ x, y }` 模型坐标定位，但图标本身要**抵消 host 的缩放**以保持恒定视觉大小：`transform: translate(x,y) scale(calc(1/var(--v-zoom)))`（`:251`）——框跟着缩放、游标图标不缩放，这个细节用一个 CSS 变量的正反运算优雅解决。游标用 `MultiCursorDuotoneIcon` 图标 + 用户名气泡，fill/stroke 都染成该用户颜色（`:255`）。

白板的刷新由 surface 的 `elementAdded/Removed/Updated`、`store.slots.blockUpdated`、`selection.slots.remoteUpdated`/`remoteCursorUpdated`、`viewport.viewportUpdated` 一整套 slot 驱动（`:183-212`），且 `_updateOnElementChange`（`:81`）会先用 `selection.hasRemote(id)` 过滤——只有真被远端选中的元素变化才触发重算，避免无谓刷新。

### 3.5 ★颜色分配：无放回洗牌 + 落盘复用

`manager/color-picker.ts` 定义了一个泛型 `RandomPicker<T>`：内部持有 `_copyArray`，每次 `pick()` 随机抽一个并 `splice` 删除，**抽空后再从 `_originalArray` 重新铺满**（`:15-24`）——即"一副牌发完再洗牌续发"，保证在协作者数量 ≤ 8 时颜色**互不重复**。`multiPlayersColor`（`:27`）是用 8 个 `--affine-multi-players-*` 主题色实例化的全局单例。

`RemoteColorManager`（`manager/remote-color-manager.ts`）负责"谁是什么色"：

- 构造时为**本地客户端**定色：优先读 `EditPropsStore` 的 `remoteColor` 存储（跨会话复用，`:12`），没有才 `multiPlayersColor.pick()` 并落盘（`:17-20`）——于是你刷新页面后颜色不变。
- `get(id)`（`:23`）取某 `clientId` 的颜色：优先读该客户端 awareness 里广播的 `color` 字段；若查的正是**自己**且 awareness 还没写上，就现场定色、`setLocalStateField('color', …)` 广播出去并落盘。

这样**每个客户端自己决定并广播自己的颜色**，其他人只读不改——分布式下用"各自发牌 + 广播"避免了中心分配的冲突。两个 widget 各自 `new RemoteColorManager(this.std)`，但因都读写同一份 awareness/EditPropsStore，颜色一致。

## 4. 语法特色

- **`computed` 聚合 awareness**：`_remoteSelections = computed(() => …)`（`doc-remote-selection.ts:60`）把"selection 表 + awareness user 表"派生成一个数组；`effect(() => _updateSelectionsThrottled(_remoteSelections.value))` 订阅它——`.value` 建立依赖、`.peek()`（`:281`/`:287`）读值不建立依赖，代码在"非信号触发"的回调里刻意用 `peek` 防止重复订阅。
- **`instanceof` 运行时类型分流**：`selections.find(s => s instanceof TextSelection)`、`filter(s => s instanceof BlockSelection)`（`:156-161`）用类实例把异构的 `BaseSelection[]` 分成文本/块两类分别处理——比标签字符串判定更类型安全。
- **`DirectiveResult<typeof StyleMapDirective>` 返回类型**：`selectionStyle`/`cursorStyle`（`utils.ts:6`/`:23`）把 `styleMap(...)` 的返回值显式标注为指令结果类型，让样式工厂可被 `style="${…}"` 直接消费且类型可查。
- **泛型 `WidgetComponent<RootBlockModel>` 对比裸 `WidgetComponent`**：edgeless widget 绑定 `RootBlockModel`（需要 `this.block.model` 类型），doc widget 用裸基类（只在运行时 `flavour !== 'affine:page'` 时报错守卫，`:151`/`:219`）——两种写法对照体现 widget 泛型参数的作用。
- **`repeat(items, keyFn, tplFn)`**：白板渲染用 Lit 的 `repeat` 以 `clientId` 为 key 复用 DOM 节点（`edgeless/index.ts:224`/`:242`），协作者增减时按 key 精准 diff，避免整块重建。
- **CSS 变量做正反缩放**：`--v-zoom` 一处定义（`:154`），框用 `scale(var(--v-zoom))`、游标用 `scale(calc(1/var(--v-zoom)))`（`:251`）——用同一变量的倒数实现"容器缩放但图标不缩放"。
- **`泛型 RandomPicker<T>`**：`color-picker.ts:1` 用类型参数把"无放回随机发牌"抽象成通用结构，当前只用于颜色，但可复用于任何需要"不重复发牌"的场景。
- **`requestThrottledConnectedFrame(fn, this)`**：shared 工具把 rAF 节流 + "组件已连接才执行"合并（`edgeless/index.ts:150`），避免断开后的回调访问失效 DOM。

## 5. 设计 / 实现亮点

- **"本地画自己、远端重建几何"的清晰分工**：本地选区由编辑器核心直接渲染，远端选区没有 DOM 事件可循，只能从 awareness 的抽象选择在本地 DOM 里反向重建矩形——本包把这件"协作可视化"的脏活单独封装，使核心编辑器对"有没有协作者"无感。
- **复用 `getSelectionRectsCommand`**：远端文本/块选区的矩形解析直接走与本地高亮同一条命令，而非另写一套 Range 遍历——保证"别人选的"和"自己选的"视觉完全一致，且只维护一处几何逻辑。
- **分布式颜色分配**：不设中心分配器，每个客户端用无放回洗牌为自己挑色、广播、落盘，其他人只读。既避免冲突，又让同一用户跨会话颜色稳定——用最小机制解决了分布式一致性。
- **白板坐标的 transform 补偿 + 游标反缩放**：整个 widget 用一个随视口的 CSS transform 承载，远端框只用模型坐标定位即可对齐；再用 `1/--v-zoom` 让游标图标恒定大小。把复杂的坐标换算下沉到一个 host transform，渲染代码极简。
- **刷新策略分层**：awareness/文档变更走 `throttle(60ms)` 省性能，视口变更走不节流以求跟手，失焦即 `clearRemote`——对"高频但不都重要"的触发源做了精细的快慢分流。
- **渲染层彻底 `pointer-events: none`**：远端选区绝不能拦截本地用户操作，两个 widget 的 `:host` 与每个子元素都强制穿透指针——协作浮层与本地交互零干扰。

## 6. 对外 API 与注意事项

- **主要导出**：`AffineDocRemoteSelectionWidget` / `AFFINE_DOC_REMOTE_SELECTION_WIDGET`、`EdgelessRemoteSelectionWidget` / `AFFINE_EDGELESS_REMOTE_SELECTION_WIDGET`、`SelectionRect` 类型、`DocRemoteSelectionConfig` 类型、`RemoteSelectionViewExtension`（`./view`）。
- **装配**：通过 `RemoteSelectionViewExtension` 接入；doc widget 在任何有 root 的编辑器都注册，edgeless widget **仅白板 scope** 注册（`view.ts:23`）。
- **注意**：
  - 两个 widget 都是 `pointer-events: none` 的纯投影层，**不产生任何选择**；要改"框选命中/选区行为"应改选区系统或 gfx，不是本包。
  - 页面光标/矩形依赖**本地 DOM 已渲染出远端所选的块**；远端选了本地尚未加载的块时，`_getCursorRect` 会退化到块末尾或返回 `null`（`:123`），属预期容错。
  - 颜色来自 awareness 的 `color` 字段 + 本地落盘 `EditPropsStore('remoteColor')`；协作者超过 8 人时 `RandomPicker` 洗牌续发会出现**颜色重复**（设计容许）。
  - doc widget 断言宿主必须是 `affine:page`（`:151`/`:219`），否则 `console.error` 并返回空——它只能挂在 root。
  - 本编辑器失焦（`std.event.active$` 为假）会 `clearRemote()` 清空远端渲染（`:291`）；多编辑器共存时这保证只有活跃编辑器显示协作光标。

## 7. 延伸

- 底层：`@blocksuite/store`（`awarenessStore`/Yjs awareness 协议、`UserInfo`、`BaseSelection`/`remoteSelections`）、`@blocksuite/std`（`WidgetComponent`/`TextSelection`/`BlockSelection`/`std.command`/`std.range`）、`@blocksuite/std/gfx`（白板 `selection`/`viewport`/`GfxModel`）。
- 协作上游：std 的选择扩展（`framework/store/src/extension/selection/selection-extension.ts` 维护 `remoteSelections`）、gfx 选择（`framework/std/src/gfx/selection.ts` 维护 `remoteSurfaceSelectionsMap`/`remoteCursorSelectionMap`）。
- 依赖命令/服务：`@blocksuite/affine-shared` 的 `getSelectionRectsCommand`（矩形解析）、`EditPropsStore`（颜色落盘）、`requestThrottledConnectedFrame`。
- 对照阅读：`blocksuite-affine-widget-drag-handle.md`（同样的 signal/throttle/视口补偿范式）、`blocksuite-affine-widget-edgeless-dragging-area.md`（本地框选的职责切分）、`toeverything-infra.md`（signal/computed 响应式基础）。
</content>

</invoke>
