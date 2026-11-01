# `@blocksuite/affine-components`

> 一句话定位：AFFiNE 编辑器**块层共享的 Lit UI 组件与交互原语库**——把 toolbar（浮动工具栏）、portal（脱离文档流渲染）、peek（预览视图）、hover（悬浮控制）、caption（块标题编辑）、context-menu（右键/下拉菜单）、color-picker、toggle 等"每种块都要用、但又不属于任何单一块"的 UI 件集中沉淀，供所有 `affine-block-*` 以子路径按需引入。它是块层的"UI 零件箱"，而非数据或业务逻辑。

| 项        | 值                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/components`                                                                                                                                                                                   |
| 所属层    | L3 · 编辑器业务层（UI 基座）                                                                                                                                                                                     |
| 语言/形态 | TypeScript / Lit 组件库（`sideEffects: false`，纯摇树）                                                                                                                                                          |
| 关键依赖  | `@blocksuite/std`（`BlockComponent`/`ShadowlessElement`）、`@blocksuite/affine-model`、`@blocksuite/affine-shared`、`@blocksuite/global`、`@floating-ui/dom`、`@blocksuite/icons`、`lit`、`@lit/context`、`rxjs` |
| 被谁依赖  | 几乎所有 `@blocksuite/affine-block-*`、`affine-widget-*`、画布工具                                                                                                                                               |
| 对外入口  | 无根导出（`index.ts` 为空），**仅子路径导出**：`./toolbar`、`./portal`、`./peek`、`./hover`、`./caption`、`./context-menu`、`./color-picker` 等 30+ 个                                                           |

## 1. 设计逻辑

块化编辑器的每种块（附件、书签、代码、图片…）在渲染时都要解决一批**相同的 UI 问题**：选中块后要弹一条浮动工具栏、工具栏要脱离块自身的 `overflow` 渲染到 `body`、悬浮时要显示操作按钮、块下方要有可编辑的 caption、双击要能全屏预览。如果每个块各写一套，既重复又不一致。`affine-components` 的职责就是把这些**跨块复用的"视图零件"与"交互控制器"**抽成一个独立包。

它与同层其它包的边界非常清晰：

1. **不是数据，不是命令**：`affine-model` 管数据模型、`affine-shared` 管命令/服务/工具函数，本包只管**可视组件（Lit custom element）与交互控制器（ReactiveController）**。
2. **区别于 `@affine/component`（`packages/frontend/component`）**：那是**应用框架层**的 **React** 组件库（设置页、对话框、侧边栏等产品 UI，`private: true`）；本包是**编辑器内核层**的 **Lit** 组件库，服务于"块的渲染与就地交互"，两者语言、层级、消费者都不同，名字相近但不可混淆。
3. **纯子路径、零副作用**：`index.ts` 刻意写成 `export {}`——本包**没有统一入口**，强制使用方从 `@blocksuite/affine-components/toolbar` 这样的精确子路径引入，配合 `sideEffects: false`，保证最佳摇树（某块只用 portal 就不会打包进 peek）。自定义元素的注册集中在各块包的 `effects.ts` 里按需触发。

核心抽象可归为三类：**浮层体系**（portal → hover → toolbar/menu/peek 层层叠加）、**块装饰基类**（`CaptionedBlockComponent` 把 caption/选中样式/zero-width 织进块组件）、**可插拔协议**（`@Peekable` 装饰器 + `PeekViewProvider` 标识符把"预览"委托给上层实现）。

## 2. 目录与关键文件

```text
src/
├── index.ts                       # export {} —— 故意为空，强制子路径导入
├── portal/                        # 脱离文档流渲染的底座
│   ├── portal.ts                  # <blocksuite-portal> Lit 元素（随父组件重渲染）
│   ├── helper.ts                  # createSimplePortal / createLitPortal（命令式、只渲染一次 + floating-ui 定位）
│   └── types.ts                   # PortalOptions / AdvancedPortalOptions
├── hover/                         # 悬浮显示浮层的 ReactiveController
│   ├── controller.ts              # HoverController：引用计数式全局互斥 + 过渡动画
│   └── when-hover.ts              # whenHover：reference/floating 双区域的悬浮判定
├── toolbar/                       # 块浮动工具栏
│   ├── toolbar.ts                 # <editor-toolbar>：吞掉 pointerdown/wheel 的容器
│   ├── menu-button.ts             # <editor-menu-button>：基于 floating-ui 的弹出按钮
│   ├── types.ts                   # MenuItem / MenuItemGroup / ToolbarMoreMenuConfig
│   └── icon-button.ts separator.ts menu-context.ts config.ts
├── peek/                          # 全屏预览视图
│   ├── peekable.ts                # @Peekable 类装饰器（绑定双击/shift-click）
│   ├── controller.ts             # PeekableController：桥接到 PeekViewProvider
│   ├── service.ts                 # PeekViewProvider 标识符 + PeekViewExtension
│   └── type.ts                    # PeekViewService 接口（重载的 peek）
├── caption/                       # 块标题
│   ├── captioned-block-component.ts  # CaptionedBlockComponent：带 caption/选中样式的块基类
│   ├── block-caption.ts           # <block-caption-editor>：就地可编辑 caption
│   └── styles.ts
├── context-menu/                  # 下拉/右键菜单（menu / sub-menu / group / item / input…）
├── toggle-button/                 # 折叠三角按钮（<blocksuite-toggle-button>）
├── color-picker/ date-picker/ slider/ icon-button/ tooltip/ toast/
├── embed-card-modal/ link-preview/ citation/ linked-doc-title/
├── card-style-dropdown-menu/ view-dropdown-menu/ size-dropdown-menu/
├── edgeless-line-width-panel/ edgeless-line-styles-panel/ ...  # 画布专用面板
├── block-selection/ block-zero-width/ drop-indicator/          # 块装饰件
└── icons/ notification/ resource/ smooth-corner/ filterable-list/
```

## 3. 实现细节

### 3.1 portal：两种脱离文档流的方式

块工具栏/菜单必须渲染到 `document.body`，否则会被块自身的 `overflow:hidden`、`transform`、`z-index` 裁剪。本包提供**声明式**与**命令式**两条路径。

声明式 `<blocksuite-portal>`（`portal/portal.ts:20-54`）覆写 `createRenderRoot`，在 `container`（默认 `document.body`）上新建一个 `.blocksuite-portal` 容器并把渲染根指过去，`disconnectedCallback` 时移除：

```ts
export class Portal extends LitElement {
  override createRenderRoot() {
    const portalRoot = document.createElement('div');
    const renderRoot = this.shadowDom ? portalRoot.attachShadow({ mode: 'open', ... }) : portalRoot;
    portalRoot.classList.add('blocksuite-portal');
    this.container.append(portalRoot);
    this._portalRoot = portalRoot;
    return renderRoot;            // 组件内容渲染到 body 下的这个节点
  }
}
```

命令式 `createLitPortal`（`portal/helper.ts:123-225`）更常用：它内部调 `createSimplePortal` 把模板**用 `lit` 的 `render()` 一次性渲染**到一个新建节点，再用 `@floating-ui/dom` 的 `computePosition`/`autoUpdate` 对齐到 `referenceElement`。几个务实细节：

- `closeOnClickAway` 用 `setTimeout` 延迟一帧再挂 `click` 监听，**避免触发它的那次点击立刻把自己关掉**（`helper.ts:147-161`）。
- 初始 `visibility:hidden`，定位算完再显形，杜绝"先出现在左上角再跳走"的闪烁（`helper.ts:167-201`）。
- `abortWhenRefRemoved`：每次 `update` 先用 `isElementVisible`（优先 `checkVisibility()`）检查锚点是否还可见，锚点消失就 `abort`，避免悬挂浮层（`helper.ts:181-188`）。
- `portalRoot.style.pointerEvents = 'auto'`——AFFiNE 的 modal 会给 body 设 `pointer-events:none`，这里强制恢复，否则浮层点不动（`helper.ts:70-73`）。

### 3.2 hover：引用计数的全局互斥浮层

`HoverController`（`hover/controller.ts:70-201`）是一个 Lit `ReactiveController`，把"鼠标悬浮 reference 或 floating 区域 → 显示浮层 → 移开 → 带过渡地销毁"封装成可复用控制器。它随宿主 `hostConnected` 启动 `whenHover` 监听，命中悬浮时调用调用方传入的 `onHover` 拿到 portal 配置，再 `createLitPortal` 创建浮层。

亮点是**静态全局互斥**：当 `allowMultiple` 为 false（默认）时，用一个静态字段保证全编辑器同时只有一个 hover 浮层：

```ts
if (!this._hoverOptions.allowMultiple) {
  HoverController.globalAbortController?.abort(); // 先关掉上一个
  HoverController.globalAbortController = this._abortController;
}
```

销毁走 `abortHoverPortal`（`controller.ts:35-68`）：先把 `transition.out` 的样式应用上去，监听 `transitionend`/`transitioncancel` 后再真正 `abort`，并用 `setTimeout(duration)` 兜底——保证浮层**淡出动画播完才从 DOM 移除**，而不是生硬消失。

### 3.3 toolbar：被动容器 + floating-ui 弹出按钮

`<editor-toolbar>`（`toolbar/toolbar.ts:6-46`）本身极简——一个 `<slot>` 容器，核心只做一件事：在 `connectedCallback` 里 `stopPropagation`/`preventDefault` 掉自身的 `pointerdown` 和 `wheel`，**防止在工具栏上的操作把块的选区/滚动打乱**。样式复用 `affine-shared` 的 `panelBaseStyle`，保持所有浮层外观一致。

菜单项是**数据驱动**的。`toolbar/types.ts:11-39` 定义了一套声明式配置：

```ts
export type AdvancedMenuItem<T> = Omit<MenuItem, 'action' | 'disabled'> & {
  action?: (context: T) => void | Promise<void>;
  disabled?: boolean | ((context: T) => boolean);
  when?: (context: T) => boolean;          // 运行时决定是否出现
  generate?: (context: T) => MenuItemPart | void;  // 运行时生成 action
};
export type MenuItemGroup<T> = { type: string; items: AdvancedMenuItem<T>[]; when?: ... };
```

`when`/`disabled`/`generate` 都接受 `context` 回调，于是一条工具栏配置能根据"当前选中的块、模式、只读态"动态裁剪——这正是 `ToolbarMoreMenuConfig.configure(groups)` 允许上层增删菜单组的扩展点。弹出用 `EditorMenuButton`（`toolbar/menu-button.ts`），内部 `createButtonPopper`（来自 `affine-shared`）把 trigger 与 content 用 floating-ui 关联，打开时自动隐藏 trigger 的 tooltip。

### 3.4 peek：装饰器声明 + 服务委托

"预览"（双击附件/书签卡片弹出大图或文档）是跨块能力，但**具体怎么渲染预览弹窗属于应用层**，块层不该关心。本包用"装饰器声明 + DI 服务委托"解耦：

块组件加上 `@Peekable()` 类装饰器（`peek/peekable.ts:36-137`）即获得预览能力。它返回一个派生类，在实例上用 `Symbol('peekable')` 挂一个 `PeekableController`，并在 `connectedCallback` 绑定 `dblclick` 与 `shift+click`：

```ts
export const Peekable =
  (options = { action: ['double-click', 'shift-click'] }) =>
  (Class, context: ClassDecoratorContext) => {
    const derivedClass = class extends Class {
      [symbol] = new PeekableController(this, options.enableOn);
      override connectedCallback() {
        super.connectedCallback();
        if (actions.includes('double-click'))
          this.disposables.addFromEvent(target, 'dblclick', e => {
            if (this[symbol].peekable && this._peekableInEdgeless(e)) {
              e.stopPropagation();
              this[symbol].peek();
            }
          });
      }
    };
    return derivedClass;
  };
```

`_peekableInEdgeless`（`peekable.ts:64-100`）处理白板里的微妙情形：双击时用 `gfx.getElementByPoint` 做命中测试，若点击位置被别的图元遮住就**不触发预览**（除非命中的是包含自己的 `NoteBlockModel`）。

真正弹窗由 `PeekableController`（`controller.ts`）转发给 `PeekViewProvider`：

```ts
peek = (template?) => Promise.resolve(
  this.target.std.getOptional(PeekViewProvider)?.peek({ target: this.target, template }));
get peekable() { return !!this._getPeekViewService() && (this.enable ? this.enable(this.target) : true); }
```

`PeekViewProvider` 只是个 `createIdentifier<PeekViewService>`（`service.ts:6-16`），由上层通过 `PeekViewExtension(service)` 注入实现。于是**块层只声明"我可被预览"，预览弹窗的 UI/动画交给 `@affine/core` 的实现**——`peekable` getter 还会据"服务是否注册"自动降级（没注册就不响应双击）。`PeekViewService.peek` 用 TS **重载**同时支持"传 pageRef 让服务自渲染"和"传 target+template 自带内容"两种调用（`type.ts:21-51`）。

### 3.5 caption：把块通用装饰织进基类

多数媒体块（附件/书签/图片/代码）都需要：块下方一个 caption、选中时的高亮边框/背景、以及块末尾的"零宽占位"。`CaptionedBlockComponent`（`caption/captioned-block-component.ts:18-89`）继承 `std` 的 `BlockComponent`，在构造时用 `addRenderer` 把这些装饰**包裹**到子类真正的内容外层：

```ts
export class CaptionedBlockComponent<Model, Service, WidgetName> extends BlockComponent<...> {
  constructor() { super(); this.addRenderer(this._renderWithWidget); }
  private _renderWithWidget(content: unknown) {
    return html`<div style=${...} class=${classMap({ 'affine-block-component': true, [theme]: true, border: isBorder })}>
      ${content}
      ${this.useCaptionEditor ? html`<block-caption-editor ${ref(this._captionEditorRef)}></block-caption-editor>` : nothing}
      ${this.selectedStyle === SelectedStyle.Background
        ? html`<affine-block-selection .selected=${watch(this.selected$)}></affine-block-selection>` : null}
      ${this.useZeroWidth && !this.store.readonly ? html`<block-zero-width .block=${this}></block-zero-width>` : nothing}
    </div>`;
  }
  protected accessor useCaptionEditor = false;    // 子类按需开启
  protected accessor selectedStyle = SelectedStyle.Background;
  protected accessor useZeroWidth = false;
}
```

子类只需把 `useCaptionEditor = true` 就自动获得完整 caption 能力。`<block-caption-editor>`（`block-caption.ts`）本身是个 `ShadowlessElement`，用 `@consume` 注入 `std`/`store`/`model` context，`field-sizing: content` 让输入框随内容自适应高度，并把 caption 作为协同字段写回模型。

### 3.6 context-menu：命令式菜单构建器

`context-menu/` 是一套不依赖 Lit 模板、可**命令式**构建的菜单系统（`menu.ts`/`sub-menu.ts`/`group.ts`/`item.ts`/`input.ts`/`menu-renderer.ts`）。它支持嵌套子菜单、分组、分隔线、可聚焦项与输入项，是斜杠菜单、块右键菜单、各类 dropdown 的底层渲染器，与 toolbar 的声明式 `MenuItemGroup` 配置互补。

## 4. 语法特色

- **标准（Stage-3）类装饰器 + `accessor`**：`@Peekable()` 是 `(Class, context: ClassDecoratorContext) => DerivedClass` 的类装饰器，通过**返回子类**织入行为；注释特别强调"必须写在 `@customElement` 下方"——因为装饰器求值顺序是自下而上，`@Peekable` 要先于 `customElement` 注册生效（`peekable.ts:31-34`）。
- **`Symbol` 做私有槽位**：`const symbol = Symbol('peekable')` 把控制器挂在实例上且不与业务字段冲突，`isPeekable` 用 `Reflect.has(e, symbol)` 做鸭子类型探测（`peekable.ts:18-22`）。
- **`ReactiveController` 模式**：`HoverController implements ReactiveController`，用 `host.addController(this)` 挂到任意 Lit 元素，`hostConnected/hostDisconnected` 对接宿主生命周期——比继承更灵活的"能力组合"。
- **方法重载表达多态入口**：`PeekViewService.peek(...)` 三个重载分别对应 pageRef / target+template / BlockComponent，调用方按场景获得精确类型（`type.ts`）。
- **泛型约束 + 混入基类**：`CaptionedBlockComponent<Model extends BlockModel, Service extends BlockService, WidgetName extends string>` 原样透传给 `BlockComponent` 的三参泛型，子类（如附件块）继承时填入自己的 `AttachmentBlockModel`。
- **Mixin 叠加**：`WithDisposable(LitElement)`、`WithDisposable(ShadowlessElement)` 给组件注入 `disposables`，统一事件/订阅的自动回收。
- **`lit/directives` 组合**：`classMap`/`styleMap`/`ref`/`watch`（来自 `@blocksuite/global/lit`，桥接 Signal）在 `_renderWithWidget` 里协作，`watch(this.selected$)` 把选中 Signal 直接绑进模板。
- **`as const` 事件名 + 子路径 `exports`**：`package.json` 的 `exports` 把每个子目录显式映射，配合 `sideEffects:false` 实现"用哪个子路径才打包哪个"。

## 5. 设计 / 实现亮点

- **零根导出强制摇树**：`index.ts` 空、只开子路径，是在库设计层面**用约束换包体积**——任何块包都只能精确依赖它用到的零件，避免"引一个 toast 带进整个组件库"。
- **浮层三件套层层复用**：`createLitPortal`（定位）← `HoverController`（悬浮 + 全局互斥 + 过渡）← `toolbar/menu`（内容），每层只解决一个问题、向下复用，是典型的"小而专的控制器组合成复杂交互"。
- **预览的"声明 + 委托"解耦**：`@Peekable` 让块只声明能力、`PeekViewProvider` 把实现留给应用层，且服务缺失时自动降级——块层与产品层彻底松耦合的范例。
- **块装饰收敛到基类**：`CaptionedBlockComponent.addRenderer` 把 caption/选中/zero-width 这三件"几乎每个媒体块都要、又容易写不一致"的事收口到一处，子类一个布尔开关即可，杜绝重复与漂移。
- **动画与生命周期的正确性**：hover 浮层"先播淡出再移除 DOM"、portal"定位算完再显形 / 锚点消失即自毁 / 延迟挂 click-away"，这些都是浮层类 UI 最容易踩的坑，本包在控制器层一次性兜住。

## 6. 对外 API 与注意事项

- 主要导出（按子路径）：`./portal`（`createLitPortal`/`createSimplePortal`/`Portal`）、`./hover`（`HoverController`/`whenHover`）、`./toolbar`（`EditorToolbar`/`EditorMenuButton`/`MenuItem`/`MenuItemGroup`）、`./peek`（`Peekable`/`PeekableController`/`PeekViewProvider`/`PeekViewExtension`）、`./caption`（`CaptionedBlockComponent`/`BlockCaptionEditor`）、`./context-menu`、`./color-picker`、`./toggle-button` 等。
- **约定**：务必用精确子路径 `@blocksuite/affine-components/xxx` 引入，没有根入口；自定义元素（`<editor-toolbar>`/`<blocksuite-portal>`…）需要由使用它的块包在 `effects.ts` 中注册（import 触发 `customElements.define`）。
- **注意**：
  - `@Peekable` 必须紧跟在 `@customElement` 之下，否则注册顺序错误导致预览失效。
  - `createLitPortal` 的模板是**一次性渲染**，内容变化需显式 `updatePortal` 或重建 portal，别指望它跟随父组件响应式更新。
  - `HoverController` 默认全局互斥（`allowMultiple:false`），多个浮层要共存须显式开启。
  - 本包是 **Lit**，不要与 React 的 `@affine/component` 混用；它处于 BlockSuite 内核层，上面不应反向依赖应用层。

## 7. 延伸

- 底层：`@blocksuite/std`（`BlockComponent`/`ShadowlessElement`/`BlockStdScope`）、`@blocksuite/global`（`WithDisposable`/`watch`/DI）、`@floating-ui/dom`（定位）。
- 同层消费方：`affine-block-attachment`/`bookmark`/`code` 等用 `CaptionedBlockComponent` 作基类、用 `@Peekable`、用 toolbar 配置；`affine-shared` 提供 `panelBaseStyle`/`createButtonPopper`。
- 对照：`@affine/component`（`packages/frontend/component`）是应用层 React 组件库，职责与本包正交。
- 相关文档：`blocksuite-std.md`（块组件/扩展/命令机制）、`blocksuite-affine-model.md`（数据模型）。
