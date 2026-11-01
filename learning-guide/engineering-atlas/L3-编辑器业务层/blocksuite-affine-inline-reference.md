# `@blocksuite/affine-inline-reference`

> 一句话定位：AFFiNE 的**文档内链引用行内元素层**（即"@页面 / 双链"）——它把一个 `reference: { type: 'LinkedPage', pageId, params?, title?, description? }` 对象作为 delta 属性嵌入富文本，渲染成一个 `embed: true` 的原子节点 `<affine-reference>`（图标 + 文档标题，形如 `📄 产品规划`），标题**随被引文档实时联动**（改名即变、删除则置灰删除线）；支持自定义别名（alias）、悬停工具栏、点击经 `RefNodeSlotsProvider.docLinkClicked` 跳转/预览、以及把行内引用升格为 linked-doc 卡片块。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/inlines/reference`                                                                                                                                                                                                                                                                                                                                    |
| 所属层    | L3 · 编辑器业务层（行内元素）                                                                                                                                                                                                                                                                                                                                            |
| 语言/形态 | TypeScript 库（Lit 组件 + InlineSpec + Markdown/HTML/PlainText Adapter + Toolbar）                                                                                                                                                                                                                                                                                       |
| 关键依赖  | `@blocksuite/affine-model`（`ReferenceInfoSchema`/`ReferenceInfo`）、`@blocksuite/std`（`InlineSpecExtension`/`ConfigExtensionFactory`/`ZERO_WIDTH_FOR_EMBED_NODE`）、`@blocksuite/affine-shared`（`DocDisplayMetaProvider`/`ToolbarRegistryIdentifier`/`REFERENCE_NODE`）、`@blocksuite/affine-components`（`whenHover`/`Peekable`）、`@floating-ui/dom`、`rxjs`、`zod` |
| 被谁依赖  | `@blocksuite/affine-inline-link`（借 `RefNodeSlotsProvider` 做内链跳转）、`@blocksuite/affine-inline-preset`（装进默认 inline manager；`[[ ]]` 转链用 `insertLinkedNode`）、linked-doc widget                                                                                                                                                                            |
| 对外入口  | `.`（inline-spec + reference-node + toolbar + utils + adapters）、`./view`（`ReferenceViewExtension`）、`./store`（`ReferenceStoreExtension`）                                                                                                                                                                                                                           |

## 1. 设计逻辑

### 它在 inline 范式里的位置

对照 inline 六要素，reference 的站位：

- **attribute schema**：`reference` 对象，`type ∈ {'Subpage'(废弃), 'LinkedPage'}` 再 `.merge(ReferenceInfoSchema)`（`inline-spec.ts:30-43`）——即 `{ type, pageId, params?, title?, description? }`；
- **渲染组件**：`<affine-reference>`（`reference-node/reference-node.ts`），`embed: true`，不可编辑的原子 token；
- **markdown 匹配**：reference 不参与"输入文本即时转换"（它由 `[[` widget 或粘贴链接生成），但有**序列化** adapter（导出成文档 URL 链接）；
- **keymap**：自身不注册；`[[Selected]]` 转链的触发在 preset 的 `bracket.ts` 里，调用本包的 `insertLinkedNode`；
- **view/store 注册**：`ReferenceViewExtension`（spec + toolbar + `RefNodeSlotsExtension`）与 `ReferenceStoreExtension`（3 个 adapter）。

reference 与 mention 同为 `embed` 原子引用节点（见 `blocksuite-affine-inline-mention.md`），都用 `ZERO_WIDTH_FOR_EMBED_NODE` 占位、都靠外部 Provider 解析**实时**展示文本。差别在指向对象：mention→成员（`UserProvider`），reference→文档（`DocDisplayMetaProvider`）；且 reference 更"重"——它带别名、视图升格、三格式序列化。

### 为什么单独成包，核心抽象是什么

文档内链是知识工具的命脉，它的"富"体现在**引用是一种活的关系**，而非一段死文字：

1. **实时标题**：引用存的只是 `pageId`，显示的标题必须随目标文档改名而变、随删除而失效。本包不缓存标题，每次渲染都向 `DocDisplayMetaProvider.title(pageId)` 取**信号**，并订阅 `docListUpdated` / `textChange` 在目标变化时刷新 `refMeta`。
2. **别名（alias）**：用户可给某个引用起一个**局部显示名**（存进 `reference.title/description`，即 `AliasInfoSchema`），覆盖实时标题但不改目标文档。这解释了 `ReferenceInfoSchema = {pageId, params} ∪ AliasInfo` 的结构。
3. **深链参数**：`params`（`ReferenceParamsSchema`）可带 `mode/blockIds/elementIds/databaseId/xywh`，让一个引用精确指向文档内某个块/元素/视图模式——这是"引用到块"的基础。
4. **跳转总线**：点击引用要打开/预览目标文档，统一走 `RefNodeSlotsProvider.docLinkClicked`（一个 rxjs `Subject`），由宿主决定是整页跳转、新标签还是浮层预览。
5. **视图升格 + 序列化**：行内引用可转成 linked-doc 卡片；导出 Markdown 时变成指向文档 URL 的链接。

核心抽象因此是 **`ReferenceInfo`（引用信息）+ `DocDisplayMetaProvider`（实时元信息）+ `RefNodeSlotsProvider`（跳转总线）** 三者的组合——本包把它们编织成一个会呼吸的行内节点。

### 与同层边界

reference 是 link 的**依赖项**（被 link 反向引用）：link 的内链跳转复用 reference 的 `RefNodeSlotsProvider`，link 的 markdown 导入会把本站 URL 还原成 `reference` 属性。可理解为 **reference 是"强类型内链"的权威表达**，link 是"任意 URL"的弱表达，两者在"URL 恰为内链"处互转。`insertLinkedNode`（`utils.ts`）则被 preset 的 `[[ ]]` 括号逻辑调用——reference 向下被 link 依赖、向上被 preset 装配。

## 2. 目录与关键文件

```text
reference/src/
├── index.ts                         # 汇总导出 adapters/inline-spec/reference-node/toolbar/utils
├── inline-spec.ts                   # ★ ReferenceInlineSpecExtension：reference schema + embed 渲染器 + 装配 config
├── utils.ts                         # insertLinkedNode：在光标处插入一个 REFERENCE_NODE + reference 属性
├── reference-node/
│   ├── reference-node.ts            # ★ <affine-reference>：图标+标题渲染 + 实时 refMeta + 悬停接工具栏 + open()
│   ├── reference-config.ts          # ReferenceNodeConfig(Provider)：customContent/interactable/hidePopup + DI
│   ├── reference-node-slots.ts      # ★ RefNodeSlotsProvider：docLinkClicked(rxjs Subject) 跳转总线
│   ├── types.ts                     # DocLinkClickedEvent / RefNodeSlots 类型
│   ├── configs/toolbar.ts           # 工具栏：标题/Inline-Card 视图切换/删除（别名编辑等）
│   └── reference-popup/
│       ├── reference-popup.ts       # <reference-popup>：别名编辑浮层（输入自定义标题 + Reset/Save）
│       └── toggle-reference-popup.ts
├── adapters/
│   ├── markdown/inline-delta.ts     # delta → mdast link（指向 docLinkBaseUrl 拼出的文档 URL）
│   ├── plain-text/inline-delta.ts   # delta → "标题: URL" 纯文本
│   ├── html/inline-delta.ts         # delta → html
│   └── index.ts
├── toolbar.ts                       # referenceNodeToolbar：绑到 affine:reference flavour
├── view.ts / store.ts / effects.ts  # 扩展注册 + customElements.define
```

## 3. 实现细节

### 3.1 embed InlineSpec：schema 合并 + config 装配

`ReferenceInlineSpecExtension`（`inline-spec.ts:13-57`）用工厂形态，在工厂里**顺手装配** `ReferenceNodeConfigProvider`：

```ts
InlineSpecExtension<AffineTextAttributes>('reference', provider => {
  const std = provider.get(StdIdentifier);
  const configProvider = new ReferenceNodeConfigProvider(std);
  const config =
    provider.getOptional(ReferenceNodeConfigExtension.identifier) ?? {};
  if (config.customContent)
    configProvider.setCustomContent(config.customContent);
  if (config.interactable !== undefined)
    configProvider.setInteractable(config.interactable);
  if (config.hidePopup !== undefined)
    configProvider.setHidePopup(config.hidePopup);
  return {
    name: 'reference',
    schema: z.object({
      reference: z
        .object({ type: z.enum(['Subpage', 'LinkedPage']) })
        .merge(ReferenceInfoSchema)
        .optional()
        .nullable()
        .catch(undefined),
    }),
    match: delta => !!delta.attributes?.reference,
    renderer: ({ delta, selected }) =>
      html`<affine-reference
        .std=${std}
        .delta=${delta}
        .selected=${selected}
        .config=${configProvider}
      ></affine-reference>`,
    embed: true,
  };
});
```

- schema 用 `z.object({type}).merge(ReferenceInfoSchema)`——把"类型标签"与"引用信息（pageId/params/title/description）"**声明合并**成一个 schema。`'Subpage'` 保留仅为向后兼容（注释 `:34` 标 deprecated）。
- 工厂里读 `ReferenceNodeConfigExtension`（可选 DI 配置）把宿主的 `customContent`/`interactable`/`hidePopup` 灌进 `configProvider`，再以 `.config` 注入组件——每个编辑器可有不同引用交互策略（如只读预览场景设 `interactable: false`）。

### 3.2 `<affine-reference>`：实时标题的三层联动

`AffineReference extends WithDisposable(ShadowlessElement)`（`reference-node.ts:40`），类上还打了 `@Peekable({ action: false })`（`:39`）——赋予"浮层预览"能力。实时性由三处协同：

1. **取值走 signal**：`_title` getter（`:102-109`）与 `_icon`（`:95-100`）都从 `DocDisplayMetaProvider` 取：

```ts
get _title() {
  const { pageId, params, title } = this.referenceInfo;
  return this.std.get(DocDisplayMetaProvider)
    .title(pageId, { params, title, referenced: true }).value || title;
}
```

传入的 `title`（别名）作为优先项——`DocDisplayMetaProvider.title` 内部据别名/实时标题/删除态算出最终展示文本。`referenced: true` 标记"这是被引用语境"。

2. **订阅目标变化**：`connectedCallback`（`:184-230`）里订阅 `doc.workspace.slots.docListUpdated`（文档增删改）与 `inlineEditor.slots.textChange`，回调 `_updateRefMeta` 刷新 `@state refMeta`——目标文档改名/删除即触发组件重渲染。
3. **删除态降级**：`render()`（`:237-292`）里 `isDeleted = !refMeta`，删除时 `affineTextStyles` 叠加 `color: disable + text-decoration: line-through`（`:263-272`），把失效引用显示成灰色删除线。

渲染结构（`:274-291`）：若有 `customContent` 用自定义模板，否则 `${icon}<span class="affine-reference-title">${title}</span>`，末尾照例挂 `<v-text .str=${ZERO_WIDTH_FOR_EMBED_NODE}>` 作 embed 占位。`connectedCallback` 还校验 `delta.insert === REFERENCE_NODE`（`:203-207`）——引用节点的 insert 必须是约定的 `REFERENCE_NODE` 字符，否则 `console.error`。

### 3.3 点击跳转：Peekable + docLinkClicked 总线

`open`（`:147-160`）是点击/中键的统一入口：

```ts
readonly open = (event?) => {
  if (!this.config.interactable) return;
  if (event?.event?.button === 2) return;         // 右键不跳
  this.std.getOptional(RefNodeSlotsProvider)?.docLinkClicked.next({
    ...this.referenceInfo,
    ...event,
    openMode: event?.event?.button === 1 ? 'open-in-new-tab' : event?.openMode,
    host: this.std.host,
  });
};
```

它不自己打开文档，而是把 `DocLinkClickedEvent` 推进 `RefNodeSlotsProvider.docLinkClicked`——这是一个 **rxjs `Subject`**（`reference-node-slots.ts:22-24`），由宿主订阅后决定如何打开（整页/新标签/预览）。中键映射成 `'open-in-new-tab'`。`@Peekable` 装饰器则额外提供"浮层预览"的 peek 能力。这条总线被 link 包共用——这正是 link 依赖 reference 的根由。

### 3.4 RefNodeSlotsProvider：进程内单例的跳转总线

`reference-node-slots.ts:19-30` 定义了一个**模块级单例** slots：

```ts
const slots: RefNodeSlots = { docLinkClicked: new Subject() };
export const RefNodeSlotsExtension: ExtensionType = {
  setup: di => {
    di.addImpl(RefNodeSlotsProvider, () => slots);
  },
};
```

所有 reference/link 节点推事件、宿主订阅处理，都经这一个 `Subject`。用 rxjs `Subject` 而非 signal，是因为这是**事件流**（点击动作）而非**状态**——语义上"每次点击都应被处理一次"，不是"持有当前值"。

### 3.5 别名编辑浮层：覆盖实时标题而不改目标

`ReferencePopup`（`reference-popup/reference-popup.ts:22`）是一个输入自定义标题的浮层。核心 `_setTitle`（`:130-150`）：

```ts
const reference = { type: 'LinkedPage', ...this.referenceInfo };
if (title) reference.title = title;
else {
  delete reference.title;
  delete reference.description;
} // Reset：回到实时标题
this.inlineEditor.insertText(this.inlineRange, REFERENCE_NODE, { reference });
```

- **Save** 把用户输入写进 `reference.title`（别名存进 delta 属性），于是 `_title` getter 优先显示它；
- **Reset**（`_onReset :120-128`）删掉 `title/description`，引用回落到 `DocDisplayMetaProvider` 的实时标题；
- 浮层用 `signal title$`（`:266`）持有输入、`live()` 指令（`:183`）双向绑定、`computePosition` + `inline()` 中间件定位（`:210-234`，同 link 浮层）。
- 操作埋点经 `TelemetryProvider`（`SavedAlias`/`ResetedAlias`，`:94`/`:125`）。

这把"别名 = 局部覆盖，实时标题 = 默认"的模型落到实处：别名是 delta 里的 `title` 字段，缺省则跟随目标。

### 3.6 插入引用：insertLinkedNode

`utils.ts:4-21` 是对外的插入 API，被 preset 的 `[[ ]]` 逻辑与 linked-doc widget 调用：

```ts
export function insertLinkedNode({ inlineEditor, docId }) {
  const inlineRange = inlineEditor.getInlineRange();
  if (!inlineRange) return;
  inlineEditor.insertText(inlineRange, REFERENCE_NODE, {
    reference: { type: 'LinkedPage', pageId: docId },
  });
  inlineEditor.setInlineRange({ index: inlineRange.index + 1, length: 0 });
}
```

插入一个 `REFERENCE_NODE` 字符（embed 占位）并带上 `reference` 属性，光标移到其后。`REFERENCE_NODE` 是 `affine-shared/consts` 里约定的占位字符——所有引用节点的 insert 都是它，与组件 `connectedCallback` 的校验呼应。

### 3.7 配置 Provider：可插拔交互策略

`reference-config.ts` 用 `ConfigExtensionFactory` 定义 `ReferenceNodeConfigExtension`（`:12-13`），宿主可注入 `{ customContent?, interactable?, hidePopup? }`。`ReferenceNodeConfigProvider`（`:15-53`）把这些包成带 getter/setter 的可变对象，并提供 `doc`（`= std.store`）等便捷访问。`interactable: false` 可做"只读引用"（不跳转不弹工具栏），`customContent` 可替换整段渲染，`hidePopup` 关掉悬停工具栏。

### 3.8 序列化：引用导出成文档 URL 链接

reference 没有"输入即时转换"的 markdown 规则，但有三格式**导出** adapter。Markdown（`adapters/markdown/inline-delta.ts:7-42`）把引用变成指向文档 URL 的 mdast `link`：

```ts
const title = configs.get(`title:${reference.pageId}`);
const url = AdapterTextUtils.generateDocUrl(
  configs.get('docLinkBaseUrl') ?? '',
  String(reference.pageId),
  reference.params ?? {}
);
mdast = { type: 'link', url, children: [{ type: 'text', value: title ?? '' }] };
```

`params` 被编进 URL（含 mode/blockIds 等深链信息）。Plain-text（`plain-text/inline-delta.ts`）则导出 `"标题: URL"` 形式。注意**导出用 `configs.get('title:${pageId}')`** 取标题而非实时查询——导出上下文预先把各文档标题塞进 configs。导入方向（URL → reference）由 `affine-inline-link` 的 markdown adapter 承担（本站 URL 还原成 reference），两包在此分工。

## 4. 语法特色

- **schema 声明合并 `merge`**：`z.object({ type }).merge(ReferenceInfoSchema)`（`inline-spec.ts:30-39`）把类型标签与引用信息合成一个 zod schema；`ReferenceInfoSchema` 本身又是 `{pageId, params} .merge(AliasInfoSchema)`（`model/consts/doc.ts:52-57`）——zod 的 `merge` 做到了 schema 级的组合复用。
- **getter 走 signal 实现实时性**：`_title`/`_icon`（`reference-node.ts:95-109`）每次读都从 `DocDisplayMetaProvider.title(...).value` 取，配合 `@state refMeta` 与 slot 订阅，目标文档一变即重渲染——"引用是活关系"的类型落地。
- **rxjs `Subject` 做事件总线**：`docLinkClicked: new Subject()`（`reference-node-slots.ts:23`）用事件流而非 signal 表达"点击动作"，语义上每次点击处理一次；对比 mention/reference 用 signal 持有状态。
- **`@Peekable` 类装饰器**：`@Peekable({ action: false })`（`:39`）以装饰器方式给组件织入"浮层预览"能力，是关注点以 mixin/装饰器横切注入的范例。
- **embed + `ZERO_WIDTH_FOR_EMBED_NODE` + `REFERENCE_NODE`**：引用是原子 token，insert 恒为约定字符 `REFERENCE_NODE`，渲染末尾挂零宽占位（`:290`），`connectedCallback` 校验 insert 合法性（`:203-207`）。
- **`ConfigExtensionFactory` 生成可选配置 DI**：`reference-config.ts:12` 用工厂造出 `ReferenceNodeConfigExtension`，spec 工厂里 `getOptional` 读取——宿主不配也能跑（默认 interactable）。
- **`live()` 指令绑定受控输入**：别名浮层 `.value=${live(this.title$.value)}`（`reference-popup.ts:183`）用 Lit `live` 指令让 input 与 signal 严格同步，避免 Lit 的脏检查跳过外部赋值。
- **别名用"删字段"表达重置**：`_setTitle` 里 `delete reference.title`（`:139-140`）而非置空串——缺省字段才能让 getter 回落到实时标题，语义比空串精确。

## 5. 设计 / 实现亮点

- **引用是活关系而非死文字**：标题/图标全程走 `DocDisplayMetaProvider` 信号 + slot 订阅，目标改名实时同步、删除自动置灰删除线——把"双链"的核心价值（引用永远指向最新目标）做进渲染层。
- **别名 = 局部覆盖模型**：用 `AliasInfoSchema`（title/description）作为可选覆盖，存在则显示别名、删除则回落实时标题，用"字段有无"而非魔法值表达两态，Reset 即删字段。
- **跳转总线复用**：`RefNodeSlotsProvider`（rxjs Subject 单例）被 reference 与 link 共用，宿主一处订阅即统一处理所有内链打开，解耦"节点"与"打开策略"。
- **深链参数内建**：`ReferenceParamsSchema` 把 mode/blockIds/elementIds/xywh 编进引用并进 URL，使"引用到块/元素/视图"成为一等能力，而非后补。
- **可插拔交互策略**：`ReferenceNodeConfigProvider` 让 `interactable/hidePopup/customContent` 可按编辑器注入，同一实现服务可编辑文档、只读预览、AI 引用等场景。
- **与 link 的清晰互补**：reference（强类型内链、embed 原子）与 link（任意 URL、wrapper 可编辑）在"本站 URL"处双向互转，各司其职而非功能重叠。

## 6. 对外 API 与注意事项

- 主要导出：`AffineReference`、`ReferencePopup`、`toggleReferencePopup`；`ReferenceInlineSpecExtension`；`ReferenceNodeConfig`/`ReferenceNodeConfigExtension`/`ReferenceNodeConfigProvider`；`RefNodeSlotsProvider`/`RefNodeSlotsExtension`/`DocLinkClickedEvent`/`RefNodeSlots`；`insertLinkedNode`；`builtinInlineReferenceToolbarConfig`/`referenceNodeToolbar`；各格式 adapter；`./view` 的 `ReferenceViewExtension`、`./store` 的 `ReferenceStoreExtension`。
- **约定**：
  - 渲染经 `ReferenceViewExtension`（注册 spec + toolbar + `RefNodeSlotsExtension` + 定义 `<affine-reference>`/`<reference-popup>`）；序列化经 `ReferenceStoreExtension`（3 个导出 adapter）。
  - 引用节点的 `delta.insert` 必须是 `REFERENCE_NODE`（用 `insertLinkedNode` 插入可保证）；真实信息在 `attributes.reference`（`ReferenceInfo` + type）。
  - 跳转须有宿主订阅 `RefNodeSlotsProvider.docLinkClicked`；实时标题/图标须有 `DocDisplayMetaProvider`，否则显示回退标题（别名或 `DEFAULT_DOC_NAME`）。
- **注意**：
  - `interactable: false` 时点击不跳转、不弹工具栏（只读/预览场景）。
  - 别名存在 `reference.title`；Reset 通过**删除**该字段回落实时标题，不要用空串。
  - 导入方向（文档 URL → reference）由 `affine-inline-link` 的 markdown adapter 处理；本包只导出。
  - `'Subpage'` type 已废弃，新引用一律 `'LinkedPage'`。

## 7. 延伸

- 数据契约：`@blocksuite/affine-model` 的 `ReferenceInfoSchema`（`{pageId, params}` ∪ `AliasInfoSchema`）、`ReferenceParamsSchema`（深链参数）——`model/src/consts/doc.ts`。
- 服务：`@blocksuite/affine-shared/services` 的 `DocDisplayMetaProvider`（实时标题/图标）、`ToolbarRegistryIdentifier`、`TelemetryProvider`；`@blocksuite/affine-components` 的 `whenHover`/`Peekable`。
- 消费/协作方：`blocksuite-affine-inline-link.md`（共用 `RefNodeSlotsProvider`、URL↔reference 互转）、`blocksuite-affine-inline-preset.md`（`[[ ]]` 调 `insertLinkedNode`、装进 `DefaultInlineManager`）。
- 底层：`@blocksuite/std/inline` 的 `InlineSpecExtension`（embed 语义）、`ZERO_WIDTH_FOR_EMBED_NODE`；`REFERENCE_NODE` 占位常量（`affine-shared/consts`）。
- 同层对照：`blocksuite-affine-inline-mention.md`（同为 embed 引用节点，指向成员）、`blocksuite-affine-rich-text.md`（inline 范式总述）。
