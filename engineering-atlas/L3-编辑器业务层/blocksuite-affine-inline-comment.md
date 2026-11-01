# `@blocksuite/affine-inline-comment`

> 一句话定位：AFFiNE 的**行内评论高亮层**——它不是一个块，而是富文本 delta 上的一组 `comment-<id>` 布尔属性。本包用一个 `InlineSpecExtension` 把这些属性渲染成带下划线/背景色的 `<inline-comment>` 包裹 span，并用一个 `LifeCycleWatcher`（`InlineCommentManager`）把编辑器里的高亮状态与外部 `CommentProvider`（评论业务）双向同步。

| 项        | 值                                                                                                                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/inlines/comment`                                                                                                                                                                                                                                                            |
| 所属层    | L3 · 编辑器业务层（行内元素）                                                                                                                                                                                                                                                                  |
| 语言/形态 | TypeScript 库（Lit 组件 + InlineSpec + LifeCycleWatcher）                                                                                                                                                                                                                                      |
| 关键依赖  | `@blocksuite/std`（`InlineSpecExtension`/`dynamicSchema`/`ShadowlessElement`/`LifeCycleWatcher`）、`@blocksuite/affine-rich-text`（`getInlineEditorByModel`）、`@blocksuite/affine-shared`（`CommentProviderIdentifier`）、`@blocksuite/affine-ext-loader`、`@lit/context`、`zod`、`lodash-es` |
| 被谁依赖  | 编辑器预设/评论功能装配方（通过 `InlineCommentViewExtension`）                                                                                                                                                                                                                                 |
| 对外入口  | `.`（`InlineCommentManager` + inline-spec + utils + view）、`./view`（`InlineCommentViewExtension`）、`./store`                                                                                                                                                                                |

## 1. 设计逻辑

### 它在 inline 范式里的位置

先回忆块范式与 inline 范式的根本差异（见 `blocksuite-affine-rich-text.md`）：**块**是 `BlockModel`，有独立 id、children、在文档树里占一个节点；**inline 元素**则是一段 `Y.Text` 的 delta 上携带的 `attributes`，它没有自己的模型，只是富文本里被特殊渲染的一段 span。评论天然属于后者——"给这几个字加评论"不该把这几个字从段落里拆出来变成一个块，而应该在它们的 delta 上打一个标记。

所以评论高亮的落点是：**在选区覆盖的每个字符的 delta attributes 上写入 `comment-<commentId>: true`**。`InlineEditor` 渲染时，凡是带该属性的连续片段就被 `CommentInlineSpecExtension` 的 `renderer` 包进 `<inline-comment>`，加上高亮样式。

### 为什么单独成包

评论有两个与"行内渲染"无关、但必须耦合的现实：

1. **一段文字可以同时属于多条评论**。所以属性不是单个 `comment: id`，而是**动态键** `comment-<id>: boolean`——一个 delta 上可以有任意多个 `comment-xxx`。布尔值 `true`=未解决（unresolved）、`false`=已解决（resolved）。这决定了它用 `dynamicSchema` 而非固定字段。
2. **评论的真相在编辑器之外**。谁发的、评论内容、是否已删除/已解决，都由外部评论系统（`CommentProvider`）掌握。编辑器里只存"哪段文字挂了哪个 id"的高亮，必须与 provider 保持一致。

本包因此拆成**两半**：

- **渲染半**（`inline-spec.ts` + `inline-comment.ts`）：把 `comment-*` 属性渲染成高亮 span，并响应 provider 的"高亮某条评论"事件。
- **同步半**（`inline-comment-manager.ts`）：监听 provider 的增/删/解决/高亮事件与编辑器选区变化，把高亮写进/抹掉 delta，并在初始化时对账（provider 没有的评论就从编辑器里清掉）。

与同层其它 inline 包的边界：comment 的 attribute 是**动态键 + wrapper 渲染**（包裹子节点、不吞掉文本），这和 footnote/latex 的"固定键 + embed 独立节点"正好相反——评论只是给原文加装饰，原文字符仍然存在、可编辑。

## 2. 目录与关键文件

```text
comment/src/
├── index.ts                    # 导出 InlineCommentManager / inline-spec / utils / view
├── inline-spec.ts              # ★ Comment(Null)InlineSpecExtension：动态键 schema + wrapper 渲染器
├── inline-comment.ts           # ★ <inline-comment> Lit 组件：高亮样式 + 点击切换 + 响应 highlight 事件
├── inline-comment-manager.ts   # ★ InlineCommentManager（LifeCycleWatcher）：与 CommentProvider 双向同步
├── utils.ts                    # findAllCommentedTexts / findCommentedTexts / extractCommentIdFromDelta
├── view.ts                     # InlineCommentViewExtension：注册 spec + manager + effects
└── effects.ts                  # customElements.define('inline-comment', ...)
```

## 3. 实现细节

### 3.1 动态键的 attribute schema

评论属性的键不是固定的，而是 `comment-${CommentId}`。本包先定义类型与守卫（`inline-spec.ts:10-13`）：

```ts
type InlineCommendId = `comment-${CommentId}`;
function isInlineCommendId(key: string): key is InlineCommendId {
  return key.startsWith('comment-');
}
```

然后用 `dynamicSchema`（来自 `@blocksuite/std/inline`）构造一个"键满足守卫、值为可空布尔"的 zod schema（`inline-spec.ts:18-21`）：

```ts
schema: dynamicSchema(
  isInlineCommendId,
  z.boolean().optional().nullable().catch(undefined)
),
```

`dynamicSchema`（`std/inline/utils/dynamic-schema.ts:3-26`）的本质是 `z.preprocess`：它先把输入 record 里**不满足 `keyValidator` 的键全部过滤掉**，再用 `z.record(z.custom<Key>(keyValidator), valueType)` 校验。于是一个 delta 的 attributes 里即便混着 `bold`、`link`、`comment-a`、`comment-b`，经此 schema 只会留下 `comment-*` 这几个键——这正是"一段文字属于多条评论"所需的开放式结构。`.catch(undefined)` 保证脏数据不抛错而是降级。

### 3.2 match 与 wrapper 渲染

`match`（`inline-spec.ts:22-26`）判定一个 delta 是否"是评论"：只要它的 attributes 里存在任意 `comment-*` 键即命中。

`renderer`（`inline-spec.ts:27-42`）是关键，它和 footnote/latex 的 embed 渲染有本质区别——它带 `wrapper: true`（`:43`），**包裹** `children` 而非替换：

```ts
renderer: ({ delta, children }) => {
  if (!delta.attributes) return html`${nothing}`;
  const unresolved = Object.entries(delta.attributes).some(
    ([key, value]) => isInlineCommendId(key) && value === true
  );
  return html`<inline-comment
    .unresolved=${unresolved}
    .commentIds=${extractCommentIdFromDelta(delta)}
    >${when(children, () => html`${children}`, () => nothing)}</inline-comment>`;
},
```

- `unresolved`：只要有**任一** `comment-*` 的值为 `true`，这段就算"有未解决评论"，显示下划线高亮。
- `commentIds`：从 delta 里抽出所有评论 id（去掉 `comment-` 前缀，见 `utils.ts:56-64`）。
- `children`：原文的行内内容原样放进 slot——因为是 wrapper，文本仍由底层 `v-text` 渲染，评论只是套了一层带样式的 `<inline-comment>`。

### 3.3 `<inline-comment>` 组件：样式、点击巡航、高亮联动

`InlineComment extends WithDisposable(ShadowlessElement)`（`inline-comment.ts:23`），用 `@requiredProperties` 声明 `commentIds` 必传（`:20-22`）。它的样式用三态 class（`:24-38`）：

- `.unresolved`：`block/comment/highlightDefault` 背景 + `highlightUnderline` 下划线（有未解决评论的常态）；
- `.highlighted`：`block/comment/highlightActive` 背景（被外部"选中"某条评论时的强调态）。

两个交互：

- **点击巡航**（`:62-67`）：一段文字可能压着多条评论，点击时按 `_index` 轮流高亮下一条，`(this._index + 1) % this.commentIds.length` 取模循环——点一下亮第一条、再点亮第二条……循环往复：

```ts
private readonly _handleClick = () => {
  if (this.unresolved) {
    this._provider?.highlightComment(this.commentIds[this._index]);
    this._index = (this._index + 1) % this.commentIds.length;
  }
};
```

- **响应高亮事件**（`:69-79`）：订阅 provider 的 `onCommentHighlighted`。当高亮的 id 落在本段的 `commentIds` 里就加 `highlighted`，否则移除——这样点侧边栏某条评论时，正文里对应的 span 会联动变色。

`highlighted` 是 `@state()`（`:55-56`），在 `willUpdate`（`:92-107`）里把布尔态翻译成 class 的增删——用 `willUpdate` 而非 `render` 直接操作 `classList`，因为组件 `render()` 只返回 `<slot></slot>`（`:109-111`，纯粹透传子节点，样式全靠宿主元素的 class）。

`_provider` 通过 `@consume({ context: stdContext })` 拿到 `BlockStdScope` 再 `getOptional(CommentProviderIdentifier)`（`:52-60`）——用 Lit context 注入，`getOptional` 表示评论功能可选，没装 provider 时组件只渲染不交互。

### 3.4 InlineCommentManager：与 provider 的双向同步

`InlineCommentManager extends LifeCycleWatcher`（`inline-comment-manager.ts:27`，`key='inline-comment-manager'`）是本包的"控制面"。`LifeCycleWatcher` 是 std 的扩展生命周期钩子，`mounted()`（`:38-61`）里一次性订阅 provider 的全部事件：

| provider 事件             | 处理                                    | 作用                                           |
| ------------------------- | --------------------------------------- | ---------------------------------------------- |
| `onCommentAdded`          | `_handleAddComment`                     | 把选区各块的文字打上 `comment-<id>: true`      |
| `onCommentDeleted`        | `_handleDeleteAndResolve(id,'delete')`  | 把 `comment-<id>` 置 `null`（删除属性）        |
| `onCommentResolved`       | `_handleDeleteAndResolve(id,'resolve')` | 把 `comment-<id>` 置 `false`（保留但变已解决） |
| `onCommentHighlighted`    | `_handleHighlightComment`               | 记录当前高亮 id 到 signal                      |
| `selection.slots.changed` | `_handleSelectionChanged`               | 选区离开评论区时取消高亮                       |

**加评论**（`_handleAddComment`，`:102-166`）是最复杂的一段。它要把一个可能跨多个块的 `TextSelection` 拆成"每个块各自的局部选区 + 该块的 inlineEditor"，再逐块 `formatText`：

```ts
const [_, { selectedBlocks }] = this.std.command
  .chain()
  .pipe(getSelectedBlocksCommand, { textSelection: selection })
  .run();
// ...取每个块的 model 与 getInlineEditorByModel(this.std, model)
// ...首块用 selection.from、尾块用 selection.to、中间块整块 [0, yText.length]
inlineEditor.formatText(
  selection.from,
  { [`comment-${id}`]: true },
  { withoutTransact: true }
);
```

注意 `withoutTransact: true`——评论高亮**不进入撤销栈**（你不希望 Ctrl+Z 把别人的评论标记撤掉，评论的增删由评论系统自己管）。中间块的处理（`:142-147`）直接用 `[0, yText.length]` 覆盖整块，因为跨块选区的中间块一定是全选的。

**删除/解决**（`_handleDeleteAndResolve`，`:168-193`）反向操作：`findCommentedTexts` 找出所有挂了该 id 的文字片段，`delete` 写 `null`（移除属性）、`resolve` 写 `false`（标记已解决，高亮消失但属性留痕）。整体包在 `store.withoutTransact` 里，同样不污染撤销栈。

### 3.5 初始化对账：以 provider 为准

`_init()`（`:67-82`）解决一个协同现实：编辑器里残留的评论高亮可能已经在 provider 侧被删了（比如在别的端删除评论后再打开文档）。于是启动时取 `provider.getComments('all')` 与 `getCommentsInEditor()` 做差集，**编辑器有、provider 没有的**一律按删除处理：

```ts
difference(commentsInEditor, commentsInProvider).forEach(comment => {
  this.std
    .get(BlockElementCommentManager)
    .handleDeleteAndResolve(comment, 'delete');
});
```

`getCommentsInEditor()`（`:84-100`）把三类评论载体合并去重：行内文字（`findAllCommentedTexts`）、块级（`findAllCommentedBlocks` 的 `props.comments`）、画板元素（`findAllCommentedElements` 的 `comments`）——可见评论是**跨 inline/block/surface 三种载体**的统一能力，本包只负责其中 inline 那一份。

### 3.6 选区感知的自动取消高亮

`_handleSelectionChanged`（`:199-229`）：当用户把光标移到别处（非折叠选区，或光标所在 delta 已不含任何评论 id）时，调用 `provider.highlightComment(null)` 取消高亮。它用 `_highlightedCommentId$.peek()` 读当前高亮态（`peek` 不建立订阅依赖），用 `getDeltaByRangeIndex` 取光标处 delta 再 `extractCommentIdFromDelta` 判断——细节是"光标仍停在评论区内就不取消"，避免误伤。

### 3.7 utils：从 delta 反查评论

`utils.ts` 是纯函数工具：`findAllCommentedTexts(store)`（`:6-45`）遍历全文所有 model 的 `text.toDelta()`，维护 `index` 游标，凡遇到 `comment-*` 属性就构造一个指向该片段的 `TextSelection` 存进 `Map<TextSelection, CommentId>`；`findCommentedTexts(store, id)`（`:47-54`）按 id 过滤；`extractCommentIdFromDelta`（`:56-64`）从单个 delta 抽 id 列表。这些是 manager 定位"哪段文字该改"的基础。

### 3.8 装配：双 spec 的开关设计

`InlineCommentViewExtension`（`view.ts:18-42`）是本包对外装配入口。它有个精巧设计——用 `optionsSchema`（`enabled` 默认 true）在**注册期**决定注册哪个 spec：

```ts
context.register([
  options?.enabled
    ? CommentInlineSpecExtension
    : NullCommentInlineSpecExtension,
  InlineCommentManager,
]);
```

`NullCommentInlineSpecExtension`（`inline-spec.ts:46-59`）的 `match` 恒 `false`、`renderer` 返回空——即"注册了但不渲染任何评论"。关键在最后一行：

```ts
// reuse the same identifier
NullCommentInlineSpecExtension.identifier =
  CommentInlineSpecExtension.identifier;
```

两者**共用同一个 DI identifier**。这样无论启用与否，依赖这个 identifier 的地方都能解析到一个实现，只是行为不同——用"空实现占位"而非"不注册"，避免了下游 `get` 不到而报错。

## 4. 语法特色

- **模板字面量类型 + 类型守卫**：`` type InlineCommendId = `comment-${CommentId}` `` 配合 `isInlineCommendId(key): key is InlineCommendId`（`inline-spec.ts:10-13`），把运行时的 `startsWith('comment-')` 判断与编译期类型收窄绑定，`Object.keys(...).filter(isInlineCommendId)` 过滤后数组元素类型即为模板字面量类型。
- **`z.preprocess` 构造动态键 schema**：`dynamicSchema` 用 `z.preprocess` 先裁剪 record 再 `z.record` 校验（`dynamic-schema.ts:7-25`），这是 zod 表达"键不固定、仅前缀约定"结构的标准手法——普通 `z.object` 做不到键集开放。
- **`@requiredProperties` 装饰器**：`inline-comment.ts:20-22` 用它声明 `commentIds` 必传且必须是字符串数组（`PropTypes.arrayOf`），缺失即报错——比 `!` 非空断言更早、更明确地暴露装配错误。
- **`hasChanged` 自定义相等**：`commentIds` 的 `@property` 传了 `hasChanged: (n,o)=>!isEqual(n,o)`（`:40-45`），用 `lodash-es` 的深比较替代 Lit 默认的 `===`——因为每次渲染 `extractCommentIdFromDelta` 都返回新数组，不深比较会导致无谓重渲染。
- **`@consume` + `@lit/context`**：`@consume({ context: stdContext }) accessor _std`（`:52-53`）用 Lit context 协议从祖先注入 `BlockStdScope`，让行内组件无需层层传参即可访问全局服务。
- **方法重载的 InlineSpecExtension**：comment 用的是**对象形态** `InlineSpecExtension({ name, schema, match, renderer, wrapper })`（`:15`），而 footnote/latex 用**工厂形态** `InlineSpecExtension('name', provider => {...})`——二者是同一函数的两个重载（`std/inline/extensions/inline-spec.ts:13-49`），对象形态适合无需访问 DI provider 的纯声明。
- **取模巡航**：`(this._index + 1) % this.commentIds.length`（`:65`）用取模实现"多评论循环高亮"，是数组环形遍历的经典写法。

## 5. 设计 / 实现亮点

- **以 delta 属性承载评论，零侵入原文结构**：评论只是给字符加 `comment-<id>` 标记并以 wrapper 包裹，原文仍是普通文本、可继续编辑，彻底避免"为评论拆块"的结构污染。这是 inline 范式相对 block 范式的典型优势场景。
- **动态键天然支持重叠评论**：`comment-a`/`comment-b` 可共存于同一段，配合点击取模巡航，优雅解决"一段文字多条评论"这一富文本评论的固有难题。
- **`true/false/null` 三态语义**：未解决（true，高亮）/ 已解决（false，留痕不高亮）/ 删除（null，抹除），用一个布尔属性的三种取值编码评论的完整生命周期。
- **`withoutTransact` 隔离撤销栈**：评论高亮的读写一律不进 undo 栈，杜绝"撤销误删他人评论"，体现了对协同语义边界的清醒认识。
- **空实现复用 identifier**：`Null*Extension` 用同一 identifier 占位，让"关闭评论渲染"与"开启"对下游完全透明，是 DI 下"可选特性"的干净做法。
- **启动对账保证一致性**：以 provider 为单一真相源，启动即清理编辑器里的孤儿高亮，解决协同/离线场景下的状态漂移。

## 6. 对外 API 与注意事项

- 主要导出：`InlineCommentManager`；`CommentInlineSpecExtension` / `NullCommentInlineSpecExtension`；`InlineComment` 组件；utils（`findAllCommentedTexts` / `findCommentedTexts` / `extractCommentIdFromDelta`）；`./view` 的 `InlineCommentViewExtension`。
- **约定**：评论的渲染与同步都依赖宿主应用注册 `CommentProviderIdentifier` 实现（增删改查、高亮事件的真正来源）。没有 provider 时组件仅渲染高亮、不响应交互，manager 的 `mounted` 直接 return。
- **注意**：
  - 高亮读写用 `withoutTransact`，**不受撤销影响**——要撤销评论须走评论系统本身。
  - `comment-<id>` 的值语义固定：`true`=未解决、`false`=已解决、`null`=删除；下游读取时需区分这三态。
  - 装配时通过 `InlineCommentViewExtension` 的 `enabled` 选项切换真实/空 spec，二者共享 identifier，不要绕过它直接注册两个真实 spec。
  - 评论是 inline/block/surface 三载体的联合能力，本包只覆盖 inline 文字；块与画板元素的评论在各自模型的 `comments` 字段。

## 7. 延伸

- 基座：`@blocksuite/affine-rich-text`（`getInlineEditorByModel` 定位编辑器、`<rich-text>` 承载 delta）、`blocksuite-affine-rich-text.md`（inline 范式总述）。
- 底层：`@blocksuite/std/inline` 的 `InlineSpecExtension` / `dynamicSchema`（动态键 schema）/ `AttributeRenderer`（`wrapper`/`embed` 语义）。
- 服务侧：`@blocksuite/affine-shared/services` 的 `CommentProviderIdentifier` / `BlockElementCommentManager` / `findAllCommentedBlocks` / `findAllCommentedElements`（评论的业务真相源与块/画板载体）。
- 同层对照：`blocksuite-affine-inline-footnote.md` / `blocksuite-affine-inline-latex.md`——同为 inline 包但走 `embed` 独立节点路线，与 comment 的 `wrapper` 装饰路线形成对比。
