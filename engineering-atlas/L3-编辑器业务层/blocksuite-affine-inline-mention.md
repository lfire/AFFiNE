# `@blocksuite/affine-inline-mention`

> 一句话定位：AFFiNE 的**@提及成员行内元素层**——它把一个 `{ member, notification? }` 对象作为 delta 属性嵌入富文本，渲染成一个 `embed: true` 的原子节点 `<affine-mention>`（形如 `@张三` 的高亮小标签），并通过 `UserProvider` 异步解析成员信息，按"加载中 / 正常 / 已移除 / 错误"四态切换展示；成员数据与补全菜单均由宿主经 DI 注入，本包只负责"按 member id 渲染一个会实时更新的提及标签"。

| 项        | 值                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/inlines/mention`                                                                                                                                                                                |
| 所属层    | L3 · 编辑器业务层（行内元素）                                                                                                                                                                                      |
| 语言/形态 | TypeScript 库（Lit 组件 + InlineSpec，极简 6 文件）                                                                                                                                                                |
| 关键依赖  | `@blocksuite/std`（`InlineSpecExtension`/`ZERO_WIDTH_FOR_EMBED_NODE`）、`@blocksuite/affine-shared`（`UserProvider`/`unsafeCSSVarV2`）、`@blocksuite/global/lit`（`SignalWatcher`/`WithDisposable`）、`lit`、`zod` |
| 被谁依赖  | `@blocksuite/affine-inline-preset`（装进默认 inline manager）、协作/通知相关功能                                                                                                                                   |
| 对外入口  | `.`（`AffineMention` + inline-spec + effects）、`./view`（`MentionViewExtension`）                                                                                                                                 |

## 1. 设计逻辑

### 它在 inline 范式里的位置

对照 inline 六要素，mention 是最"轻"的一个——它只占了其中三格：

- **attribute schema**：`mention: z.object({ member: z.string(), notification: z.string().optional() })`（`inline-spec.ts:12-21`）——值是对象，`member` 存成员 id，`notification` 可选存通知 id；
- **渲染组件**：`<affine-mention>`（`affine-mention.ts`），`embed: true`，是不可编辑的原子 token；
- **view 注册**：`MentionViewExtension`（`view.ts`）只注册 spec。

它**没有** markdown 匹配、**没有** keymap、**没有** store/adapter、**没有** 命令。这是刻意的：mention 不参与 `[@...]` 之类的文本语法转换，也不参与 Markdown/HTML 序列化（它是运行时的协作对象，跨文档导出意义不大）。`package.json` 的 `exports` 只有 `.` 和 `./view`，没有 `./store`，正是这一取舍的直接体现。

### 为什么单独成包，核心抽象是什么

mention 的"富"不在交互而在**数据生命周期**：一个提及标签存的只是 member id，但要显示成员名字、头像、并随成员状态（在职/离职/被删）实时变化。这带来一个关键设计决策——**本包不持有任何成员数据，也不实现 @ 补全菜单**，它只定义两件事：

1. 一个 attribute 契约：delta 里存什么（`{ member, notification }`）；
2. 一套渲染契约：拿到 member id 后，向 `UserProvider` 要 `userInfo$(id)` / `isLoading$(id)` 两个 signal，据此渲染四态 UI。

成员列表从哪来、@ 键如何唤起补全面板、选中后如何 `insertText` 带上 `mention` 属性——这些都在**宿主应用**（AFFiNE 主程序）里实现，经 `UserProvider` / `UserListProvider`（`affine-shared/services/user-service`）注入。本包与宿主的边界就是这两个 Provider 接口。这样 blocksuite 内核保持与"具体用户系统"无关，换一套账号体系只需换 Provider 实现。

### 与同层边界

mention 与 reference 同为 `embed: true` 的原子引用节点，但指向对象不同：reference 指向**文档**（`pageId`），mention 指向**成员**（`member` id）。两者都用 `ZERO_WIDTH_FOR_EMBED_NODE` 占位、都靠外部 Provider 解析实时标题/名字。差别在：reference 还承担别名、视图升格、序列化；mention 极简，只做"渲染 + 异步解析 + 状态态切换"。

## 2. 目录与关键文件

```text
mention/src/
├── index.ts          # 导出 affine-mention / effects / inline-spec
├── inline-spec.ts    # ★ MentionInlineSpecExtension：mention schema(member+notification) + embed 渲染器
├── affine-mention.ts # ★ <affine-mention>：按 UserProvider 的 signal 渲染 loading/default/removed/error 四态
├── effects.ts        # customElements.define('affine-mention', …) + 全局类型声明合并
└── view.ts           # MentionViewExtension：注册 spec + effects
```

没有 `store.ts`、没有 `adapters/`、没有 `command.ts`、没有 `markdown.ts`——目录的"缺席"本身就是设计说明：mention 是纯视图侧的行内元素。

## 3. 实现细节

### 3.1 embed InlineSpec：对象 schema + selected 透传

`MentionInlineSpecExtension`（`inline-spec.ts:7-34`）用工厂重载取 `std`，`embed: true`：

```ts
return {
  name: 'mention',
  schema: z.object({
    mention: z
      .object({
        member: z.string(),
        notification: z.string().optional(),
      })
      .optional()
      .nullable()
      .catch(undefined),
  }),
  match: delta => !!delta.attributes?.mention?.member,
  renderer: ({ delta, selected }) =>
    html`<affine-mention
      .delta=${delta}
      .std=${std}
      .selected=${selected}
    ></affine-mention>`,
  embed: true,
};
```

两个细节值得注意：

- `match` 不只看 `mention` 存在，而是 `mention?.member`——**没有 member id 的提及视为无效**，不会命中渲染，避免空标签。
- `renderer` 解构出了 `selected`（`InlineManager` 在渲染 embed 节点时注入"该原子节点是否被选中"），透传给组件用于高亮。这是 embed 节点区别于 wrapper 的渲染参数之一（link 的 renderer 就没取 `selected`）。

### 3.2 四态渲染：UserProvider 的 signal 驱动

`AffineMention extends SignalWatcher(WithDisposable(ShadowlessElement))`（`affine-mention.ts:15-17`）——`SignalWatcher` 让组件在读取的 signal 变化时自动重渲染。`render()`（`:86-137`）是全部逻辑所在，按优先级分四态：

```ts
const userService = this.std.getOptional(UserProvider);
const memberId = this.delta.attributes?.mention?.member;
if (!userService || !memberId) {
  return errorContent; // ① 无服务/无 id → @Unknown Member
}

userService.revalidateUserInfo(memberId); // 触发（可能的）重新拉取
const isLoading$ = userService.isLoading$(memberId);
const userInfo$ = userService.userInfo$(memberId);

if (userInfo$.value) {
  if (userInfo$.value.removed) return; /* @Inactive Member，data-type=removed */
  else return; /* @${name ?? 'Unknown'}，data-type=default */
}
if (isLoading$.value)
  return; /* @loading...，data-type=loading，带脉冲动画三点 */
return errorContent; // ② 非加载、又无信息 → 错误态
```

- `revalidateUserInfo`（`:100`）在每次渲染时调用，由 Provider 自行决定是否真的发请求（通常有缓存/去抖）——组件只管"声明我需要这个人的信息"。
- 四态对应 CSS 的 `data-type` 属性（`:40-52`）：`default` 用主文本色、`removed`/`error` 用 disable 色、`loading` 用 placeholder 色 + skeleton 背景。
- loading 态的 `@loading...` 用三个 `.dot` span 配 `@keyframes pulse`（`:56-83`）做依次淡入的呼吸点，是纯 CSS 动画、无 JS 定时器。
- 每一态的模板末尾都挂 `<v-text .str=${ZERO_WIDTH_FOR_EMBED_NODE}></v-text>`（如 `:91`/`:110`/`:118`/`:132`）——embed 节点的铁律占位，保证 `InlineEditor` 正确计算该原子 token 的光标与选择。

### 3.3 成员数据契约：UserProvider / AffineUserInfo

本包渲染依赖的 Provider 定义在 `@blocksuite/affine-shared/services/user-service`：

```ts
export interface UserService {
  currentUserInfo$: Signal<AffineUserInfo | null>;
  userInfo$(id: string): Signal<AffineUserInfo | null>;
  isLoading$(id: string): Signal<boolean>;
  error$(id: string): Signal<string | null>;
  revalidateUserInfo(id: string): void;
}
```

`AffineUserInfo` 是个**可辨识联合**（`user-service/types.ts`）：

```ts
type RemovedUserInfo = { id: string; removed: true };
type ExistedUserInfo = {
  id: string;
  name?: string | null;
  avatar?: string | null;
  removed?: false;
};
type AffineUserInfo = RemovedUserInfo | ExistedUserInfo;
```

组件里 `userInfo$.value.removed` 的判断（`:105`）正是对这个联合做窄化——`removed: true` 这一支渲染"已失效成员"。

而 @ 补全菜单的数据源是**另一个** Provider：`UserListProvider`（`user-list-service.ts`）提供 `users$` / `search(keyword)` / `loadMore()` / `hasMore$`——它服务于宿主实现的 @ 面板分页搜索，**不在本包内调用**，本包只负责最终渲染。理解这一分工是看懂 mention "极简"的关键：补全（搜索/分页/选择）在上层，渲染（解析/四态）在本包。

### 3.4 插入路径（跨包协作）

本包不提供插入 API。实际插入一个提及由宿主的 @ widget 完成：用户选中某成员后，调用 `inlineEditor.insertText(range, ' ', { mention: { member: id } })` 之类（单空格 insert 作为 embed 占位 + mention 属性）。随后本包的 spec `match` 命中、渲染出标签。可对照 reference 包 `insertLinkedNode`（`utils.ts`）的同构写法理解——只是 mention 的插入逻辑在应用层而非包内。

## 4. 语法特色

- **embed + 零宽占位**：`embed: true`（`inline-spec.ts:32`）配 `ZERO_WIDTH_FOR_EMBED_NODE`（`affine-mention.ts:91` 等多处），把一个成员对象塞进一个字符位、渲染成不可编辑原子 token——与 footnote/reference 同范式。
- **`SignalWatcher` mixin 驱动重渲染**：`SignalWatcher(WithDisposable(ShadowlessElement))`（`:15`）让 `render()` 内读到的 `userInfo$` / `isLoading$`（`@preact/signals-core` Signal）一旦变化就自动触发更新，无需手动订阅——异步数据到达即刷新 UI。
- **可辨识联合窄化**：`userInfo$.value.removed`（`:105`）对 `AffineUserInfo` 联合类型按字面量字段窄化到 `RemovedUserInfo`，TS 在各分支推出精确类型。
- **`match` 做深层存在性判断**：`!!delta.attributes?.mention?.member`（`:22`）用可选链三级穿透，把"有 mention 但无 member id"视为不匹配，从源头挡掉空标签。
- **渲染参数解构 `selected`**：`renderer: ({ delta, selected }) => …`（`:25`）——embed 节点的渲染上下文比 wrapper 多一个"是否被选中"，mention 透传给 `data-selected` 做高亮。
- **`unsafeCSSVarV2` 主题变量**：`color: ${unsafeCSSVarV2('text/primary')}`（`:20`）把设计系统 token 以类型安全方式注入 Lit `css`，换肤随主题变量走。
- **全局类型声明合并**：`effects.ts:7-11` 用 `declare global { interface HTMLElementTagNameMap { 'affine-mention': AffineMention } }`，让 `document.createElement('affine-mention')` 得到正确类型。
- **纯 CSS 动画**：loading 三点用 `@keyframes pulse` + `animation-delay`（`:64-83`）实现，零 JS 定时器，省去组件销毁时清理计时器的心智负担。

## 5. 设计 / 实现亮点

- **"渲染与数据源彻底解耦"**：本包不持有成员数据、不实现补全面板，只定义 `{member}` 契约与四态渲染，数据全从 `UserProvider` 经 DI 注入。blocksuite 内核因此与具体账号系统无关，换后端只换 Provider 实现。
- **signal 驱动的实时性**：成员改名、离职只需 Provider 更新对应 signal，所有引用该成员的提及标签自动重渲染，无需本包维护任何订阅列表。
- **四态可辨识 UI**：loading / default / removed / error 用 `data-type` 显式区分并各配色，把"异步 + 可能失效"的现实状态完整表达，而非只有"有/无"。
- **刻意的极简与缺省**：没有 store/adapter/command/markdown——用目录的"空"表达"mention 是运行时协作对象、不参与文本语法与序列化"的产品判断，降低维护面。
- **`match` 的防御性**：要求 `mention.member` 存在才渲染，从 spec 层杜绝空标签，比在组件里补判断更靠前。

## 6. 对外 API 与注意事项

- 主要导出：`AffineMention` 组件；`MentionInlineSpecExtension`；`effects()`；`./view` 的 `MentionViewExtension`。
- **约定**：
  - 使用前需经 `MentionViewExtension` 注册 spec 并 `effects()` 定义 `<affine-mention>`。
  - 宿主必须经 `UserServiceExtension(service)` 注入 `UserProvider`，否则所有提及渲染成 `@Unknown Member`（错误态）。
  - delta 的 `mention.member` 必填（spec `match` 以此为准），`notification` 可选。
- **注意**：
  - 本包**不提供** @ 补全菜单与成员搜索——那是宿主基于 `UserListProvider` 实现的；本包也不提供插入命令，插入由上层 `insertText(..., { mention })` 完成。
  - 本包**不参与** Markdown/HTML 序列化（无 `./store`），提及是运行时协作对象。
  - 组件是 `embed` 原子节点，不可编辑其内部文字；更新提及须经 `formatText`/`insertText` 改 `mention` 属性。
  - 成员信息的新鲜度由 `UserProvider.revalidateUserInfo` 的实现决定，组件每次渲染都会调用它声明需求。

## 7. 延伸

- 数据契约：`@blocksuite/affine-shared/services/user-service` 的 `UserProvider`/`UserService`、`UserListProvider`/`UserListService`、`AffineUserInfo`（`RemovedUserInfo`/`ExistedUserInfo` 可辨识联合）。
- 底层：`@blocksuite/std/inline` 的 `InlineSpecExtension`（embed 语义）、`ZERO_WIDTH_FOR_EMBED_NODE`；`@blocksuite/global/lit` 的 `SignalWatcher`。
- 装配方：`@blocksuite/affine-inline-preset`（把 mention spec 放进 `DefaultInlineManagerExtension`）——见 `blocksuite-affine-inline-preset.md`。
- 同层对照：`blocksuite-affine-inline-reference.md`（同为 embed 引用节点，指向文档；带别名/序列化）、`blocksuite-affine-inline-footnote.md`（embed + 异步来源预览回填）、`blocksuite-affine-rich-text.md`（inline 范式总述）。
