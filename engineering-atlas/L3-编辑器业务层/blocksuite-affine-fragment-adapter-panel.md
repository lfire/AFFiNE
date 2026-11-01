# `@blocksuite/affine-fragment-adapter-panel`

> 一句话定位：一个可嵌入宿主应用侧栏的**适配器预览面板** fragment——把当前文档（`Store`）实时转换成 Markdown / PlainText / HTML / Snapshot 四种格式并在面板里预览，供调试、导出校对、"看看这篇文档序列化后长什么样"的场景使用。

| 项        | 值                                                                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/fragments/adapter-panel`                                                                                                                                                               |
| 所属层    | L3 · 编辑器业务层（fragment UI）                                                                                                                                                                          |
| 语言/形态 | TypeScript / Lit 组件库                                                                                                                                                                                   |
| 关键依赖  | `@blocksuite/affine-shared/adapters`（各格式 AdapterFactory）、`@blocksuite/affine-components/portal`、`@blocksuite/affine-ext-loader`、`@lit/context`、`@preact/signals-core`、`lit`、`@floating-ui/dom` |
| 被谁依赖  | 聚合包 `@blocksuite/affine`（经 `AdapterPanelViewExtension` 汇入）、宿主应用（直接挂 `<affine-adapter-panel>`）                                                                                           |
| 对外入口  | `.`（组件类 + 标签常量）、`./view`（`AdapterPanelViewExtension`）                                                                                                                                         |

## 1. 设计逻辑

**先定位 fragment 的角色**：fragment 不是编辑器内部的浮层 widget（那些由编辑器自己按选区/悬停挂载、随编辑态生灭），而是**面向宿主应用的、较大的可嵌入 UI 面板**。它的挂载者是宿主（AFFiNE 的侧栏/调试面板），数据来源是一个外部传入的 `Store`（文档），它只"订阅并呈现"这份文档，不拥有编辑器主视图。

adapter-panel 要解决的具体问题是：**把文档的多种序列化表示集中到一个可切换的预览面板**。BlockSuite 已经为每种外部格式实现了 `AdapterFactory`（Markdown / PlainText / HTML…），但它们平时只在复制/导入/导出的瞬间被调用，开发者和用户无法直观"看见"转换结果。本包把这些 factory 包进一个 Lit 面板：顶部选格式、中部渲染内容、HTML 还能在"源码/预览"间切换。

它刻意做得很薄——**不重新实现任何转换逻辑**，只做三件事：

1. 从 `store.get(XxxAdapterFactoryIdentifier)` 取出已注册的 adapter，调用 `fromDoc(store)` 得到字符串；
2. 用一组 `signal` 把"当前格式 / 各格式内容 / HTML 是否预览"组织成响应式上下文；
3. 用三段式 Lit 组件（panel → header + body）把上下文渲染出来，并在格式切换或文档变化时重算内容。

与同层 `foundation` 的边界：adapter 本身由 `foundation` 的 store 通道注册（`MarkdownAdapterFactoryExtension` 等），本包只是它们的**消费方与可视化外壳**。

## 2. 目录与关键文件

```text
src/
├── adapter-panel.ts   # ★ AdapterPanel 根组件：持有 store、创建 context、驱动内容计算
├── config.ts          # ADAPTERS 列表、AdapterItem/AdapterPanelContext 类型、adapterPanelContext
├── header/
│   ├── adapter-panel-header.ts  # 顶部栏：格式选择器触发 + 刷新按钮；用 portal 弹出菜单
│   └── adapter-menu.ts          # 浮出的格式选择菜单（markdown/plaintext/html/snapshot）
├── body/
│   └── adapter-panel-body.ts    # 内容区：四种格式各一容器，HTML 带 Source/Preview 切换
├── view.ts            # AdapterPanelViewExtension：仅注册 effects（customElements.define）
├── effects.ts         # 定义四个自定义元素
└── index.ts           # 汇总导出组件
```

## 3. 实现细节

### 3.1 一个 context，贯穿三层组件

`config.ts` 定义了面板的全部响应式状态，用 `@preact/signals-core` 的 `Signal` 承载，再经 `@lit/context` 的 `createContext` 做成可跨组件注入的 `adapterPanelContext`：

```ts
// config.ts:17-28
export type AdapterPanelContext = {
  activeAdapter$: Signal<AdapterItem>;
  isHtmlPreview$: Signal<boolean>;
  docSnapshot$: Signal<DocSnapshot | null>;
  htmlContent$: Signal<string>;
  markdownContent$: Signal<string>;
  plainTextContent$: Signal<string>;
};
export const adapterPanelContext = createContext<AdapterPanelContext>(
  'adapterPanelContext'
);
```

根组件 `AdapterPanel` 用 `@provide` 把它注入下去，header/body/menu 用 `@consume` 取用（`adapter-panel.ts:169`、`adapter-panel-body.ts:210`）。这样格式切换（menu 改 `activeAdapter$`）、内容更新（panel 写各 `*Content$`）、视图切换（body 改 `isHtmlPreview$`）三方都通过同一份 signal 通信，**无需 props 层层透传、也无需事件冒泡**。

### 3.2 内容计算：按需调用对应 AdapterFactory

`AdapterPanel` 的核心是四个私有取值方法，模式一致：建一个 transformer job，从 DI 容器取出对应 factory，`fromDoc` 出结果：

```ts
// adapter-panel.ts:70-85（Markdown 为例）
private async _getMarkdownContent() {
  try {
    const job = this._createJob();
    const markdownAdapterFactory = this.store.get(
      MarkdownAdapterFactoryIdentifier
    );
    const markdownAdapter = markdownAdapterFactory.get(job) as MarkdownAdapter;
    const result = await markdownAdapter.fromDoc(this.store);
    return result?.file;
  } catch (error) {
    console.error('Failed to get markdown content', error);
    return '';
  }
}
```

其中 `_createJob()` 是 `this.store.getTransformer(this.transformerMiddlewares)`（`adapter-panel.ts:47-49`）——transformer 是 BlockSuite 把文档树和外部格式互转的管线，宿主可通过 `transformerMiddlewares` 属性注入中间件定制转换。Snapshot 分支不走 adapter，直接 `job.docToSnapshot(store)` 拿内部快照（`adapter-panel.ts:51-55`）。

`_updateActiveContent`（`adapter-panel.ts:104-122`）是调度器：读当前 `activeAdapter.id`，只重算**当前选中**那一种格式，写回对应 signal——避免每次都把四种都转一遍。

### 3.3 三处触发点：何时重算

内容在三种时机被刷新：

| 触发     | 代码                                                                                                                      | 说明                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 切换格式 | `firstUpdated` 里的 `effect(() => { if (this.activeAdapter) this._updateActiveContent() })`（`adapter-panel.ts:142-150`） | `effect` 自动追踪 `activeAdapter$`，一改就重算 |
| 换文档   | `willUpdate` 中 `changedProperties.has('store')`（`adapter-panel.ts:136-140`）                                            | 宿主把新 `store` 传进来时重算                  |
| 手动刷新 | header 的刷新按钮 `@click=${this.updateActiveContent}`（`adapter-panel-header.ts:95`）                                    | 文档内容被编辑后用户主动拉取最新               |

`effect` 来自 signals，`willUpdate` 是 Lit 生命周期——两种响应式在同一个组件里协作：signal 管"面板内部状态"，Lit property 管"宿主传入的外部输入"。

### 3.4 HTML 的"源码 / 预览"双模式

body 对 HTML 格式特殊处理（`adapter-panel-body.ts:135-163`）：`isHtmlPreview$` 为假时把 HTML 文本原样当源码显示在 `<div>`；为真时塞进一个 **sandbox iframe** 真实渲染：

```ts
// adapter-panel-body.ts:139-143
html`<iframe
  class="html-preview-container"
  .srcdoc=${this.htmlContent}
  sandbox="allow-same-origin"
></iframe>`;
```

`sandbox="allow-same-origin"`（不含 `allow-scripts`）确保预览的 HTML 不能执行脚本——这是把不可信序列化内容塞进 iframe 的安全底线。底部一个 Source/Preview 切换条改写 `isHtmlPreview$`。

### 3.5 格式菜单：portal + floating-ui

header 点击格式选择器时，用 `@blocksuite/affine-components/portal` 的 `createLitPortal` 把 `<affine-adapter-menu>` 浮出（`adapter-panel-header.ts:67-83`），定位交给 `@floating-ui/dom` 的 `flip()` / `offset(4)`，`closeOnClickAway: true` 点外部自动关。切换前先 `abort()` 掉上一个 `AbortController` 保证同时只有一个菜单——这是 BlockSuite 浮层的标准写法。菜单项点击只改 `activeAdapter$` 再 `abort` 自身（`adapter-menu.ts:52-55`），内容重算由 3.3 的 `effect` 兜住。

### 3.6 body 的四容器常驻 + CSS 显隐

body 不是"只渲染当前格式"，而是 `ADAPTERS.map` 把四种容器**全部渲染**，用 `.adapter-container.active { display:block }` 控制显隐（`adapter-panel-body.ts:99-108,182-200`）。好处是切换格式时 DOM 不重建（尤其 iframe 不会重新加载），代价是四份内容都在 DOM 里——对预览面板这种低频、内容不大的场景是合算的取舍。

## 4. 语法特色

- **Mixin 叠加**：根组件 `class AdapterPanel extends SignalWatcher(WithDisposable(LitElement))`（`adapter-panel.ts:25`）。`WithDisposable` 注入 `disposables` 自动清理，`SignalWatcher` 让模板里读 `signal.value` 能触发重渲——两个高阶函数把能力"洋葱式"叠到 `LitElement` 上，是 BlockSuite 组件的通用基座。
- **`accessor` + 装饰器**：`@property({ attribute: false }) accessor store!: Store`（`adapter-panel.ts:163-164`）用 TC39 的 `accessor` 关键字配合 Lit 3 装饰器，比旧 `@property() store` 更贴合标准装饰器语义；`attribute: false` 表示该属性只能用 JS 赋值、不映射 HTML attribute（`Store` 是对象没法序列化成 attribute）。
- **`@provide` / `@consume`**：`@provide({ context: adapterPanelContext }) private accessor _context`（`adapter-panel.ts:169-170`）与子组件 `@consume`（`adapter-panel-body.ts:210`）构成 Lit 的 Context 协议，实现跨层级依赖注入。
- **联合字面量驱动的 `switch`**：`AdapterItem.id` 虽是 `string`，但 `_updateActiveContent` / `_renderAdapterContent` 都用 `switch (id)` 对 `'markdown' | 'html' | ...` 分派（`adapter-panel.ts:106`、`adapter-panel-body.ts:166`），逻辑集中、新增格式只改一处。
- **Lit 指令 `classMap`**：`classMap({ 'adapter-container': true, active: ... })`（`adapter-panel-body.ts:183-186`）声明式切类名，替代手写字符串拼接。
- **`declare global { interface HTMLElementTagNameMap }`**：每个组件文件尾部给自定义标签登记类型（`adapter-panel.ts:173-177`），使 `document.querySelector('affine-adapter-panel')` 能推断出 `AdapterPanel` 类型——TS 的声明合并用于 Web Components。

## 5. 设计 / 实现亮点

- **零转换逻辑的"消费型"面板**：所有格式转换复用已注册的 AdapterFactory，本包只做取值 + 展示，职责极窄；新增一种格式只需在 `ADAPTERS` 加一项、在 `switch` 加一分支。
- **signal + context 的状态总线**：六个 signal 装进一个 context，三层组件靠它解耦通信，没有一个自定义事件、没有 props 透传，是"小型可嵌入面板"的轻量状态管理范式。
- **精确重算**：只算当前选中格式（`_updateActiveContent` 按 `activeAdapter.id` 分派），避免四种格式全量转换的浪费。
- **iframe 安全预览**：用 `sandbox` 且不开 `allow-scripts` 渲染不可信 HTML，兼顾"所见即所得"与 XSS 防护。
- **容器常驻**：以少量冗余 DOM 换取切换时的零重建（iframe 不重载），对预览场景是正确取舍。

## 6. 对外 API 与注意事项

- 主要导出（`.`）：`AdapterPanel` / `AFFINE_ADAPTER_PANEL`、`AdapterPanelBody`、`AdapterPanelHeader`、`AdapterMenu` 及各自标签常量；`./view` 导出 `AdapterPanelViewExtension`。
- **用法**：宿主 `customElements` 就绪后（经 `AdapterPanelViewExtension.effect()` → `effects()`），挂 `<affine-adapter-panel .store=${store} .transformerMiddlewares=${[...]}></affine-adapter-panel>` 即可；`store` 必传。
- **注意**：
  - 面板依赖容器里已注册 `MarkdownAdapterFactoryIdentifier` 等——这些由 `foundation` 的 store 扩展提供，脱离完整编辑器扩展集单独用会 `store.get` 失败（代码里 `try/catch` 吞错并返回空串，表现为"面板空白"而非报错）。
  - `view.ts` 的 `AdapterPanelViewExtension` **只注册 effects、不 register 任何 scope 扩展**，它的唯一职责是经 `effect()` 一次性 `customElements.define` 四个标签；因此单独 `import` 组件类而不装载该 extension，标签不会被定义。
  - HTML 预览 iframe 仅 `allow-same-origin`，文档里的脚本在预览中不会执行，这是刻意为之。

## 7. 延伸

- 机制依赖：`@blocksuite/affine-ext-loader` 的 `ViewExtensionProvider`（见 `blocksuite-affine-ext-loader.md` 的 effect 一次性守护）。
- 内容来源：`@blocksuite/affine-shared/adapters` 的各 `AdapterFactoryIdentifier`，由 `@blocksuite/affine-foundation`（`blocksuite-affine-foundation.md` §3.3/§3.4）在 store 通道注册。
- 同层并列 fragment：`doc-title` / `frame-panel` / `outline`——同为"宿主挂载、订阅文档"的可嵌入面板。
- 上层聚合：`@blocksuite/affine`（`blocksuite-affine.md`）把本包的 `AdapterPanelViewExtension` 收进 `getInternalViewExtensions()`。
