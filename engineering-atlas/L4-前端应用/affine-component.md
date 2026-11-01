# `@affine/component`

> 一句话定位：AFFiNE 的**React 通用 UI 组件库**——把设计系统（`@toeverything/theme` 的 token）落地为一套与业务无关的、可复用的 React 组件（Button/Modal/Menu/Table…），用 vanilla-extract 写样式、用 data 属性驱动变体，并提供把 BlockSuite 的 Lit 组件嵌进 React 树的桥接层。它是整个桌面/移动/Web 外壳 UI 的零件库。

| 项        | 值                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `packages/frontend/component`                                                                                            |
| 所属层    | L4 · 前端应用                                                                                                            |
| 语言/形态 | TypeScript / React 库                                                                                                    |
| 关键依赖  | `@toeverything/theme`、`@vanilla-extract/*`、`@radix-ui/*`、`lit`、`@emotion/styled`(deprecated)、`clsx`、`@affine/i18n` |
| 被谁依赖  | `@affine/core` 及各 `apps/*`（web/electron-renderer/mobile）                                                             |
| 对外入口  | `.`（聚合导出）、`./theme`、`./ui/*`、`./*`（见 package.json `exports`）                                                 |

## 1. 设计逻辑

AFFiNE 的 UI 代码分两套技术栈，必须先厘清边界，否则会与 BlockSuite 的同名目录混淆：

- **`@affine/component`（本包）**：**React** 组件，服务"编辑器之外的应用外壳"——设置面板、登录、模态框、侧边栏按钮、表格、菜单等。宿主是 React 18/19 的应用层（`@affine/core`）。
- **`@blocksuite/affine-components`（`blocksuite/affine/components`）**：**Lit (Web Components)** 组件，服务"编辑器画布之内"——如 `color-picker`、`toolbar`、`tooltip`、`drop-indicator`、`portal` 等，宿主是 BlockSuite 的 Lit 渲染体系。二者名字相似但技术栈、宿主、职责完全不同。

本包单独成包的动机：

1. **与业务解耦**：组件不感知 workspace/doc 等业务概念，只接受 props，可被所有 `apps/*` 与 Storybook 独立消费（`package.json` 里有 `storybook dev`）。
2. **设计系统落地点**：把 `@toeverything/theme` 的设计 token（`cssVar`/`cssVarV2`）统一消费在这里，业务层不直接碰 token。
3. **桥接 Lit↔React**：编辑器是 Lit、外壳是 React，需要一个受控的边界把 Lit 的 `TemplateResult` 塞进 React（`lit-react/`），本包是这个边界的归属地。

## 2. 目录与关键文件

```text
src/
├── index.ts                # 聚合导出：hooks / lit-react / styles / ui/* / utils
├── theme/                  # 设计系统入口（副作用导入）
│   ├── index.ts            # import '@toeverything/theme/style.css' + fonts/global/theme
│   ├── theme.css.ts        # globalStyle('body', ...) 绑定 cssVar 到 body
│   ├── global.css / fonts.css
│   └── noise.avif
├── ui/                     # 无业务的基础组件（每个子目录一个组件族）
│   ├── button/             # button.tsx + button.css.ts(+stories)
│   ├── menu / modal / popover / tooltip / table / tabs / input ...
│   └── ...（约 35 个组件族）
├── components/             # 偏"半业务"的组合组件（auth / setting / notification-center ...）
├── lit-react/              # Lit ↔ React 桥
│   ├── create-component.ts # @lit/react createComponent 的定制版
│   ├── to-react-node.ts    # TemplateResult → ReactNode
│   └── lit-portal/         # 把 Lit 渲染挂到 React Portal
├── hooks/                  # useAutoFocus / useThemeValue / useDisposable ...
├── styles/                 # styled(已废弃的 emotion) + helper
├── fonts/                  # 内置字体
└── utils/                  # observe-resize / shallow-equal / view-transition ...
```

`package.json` 的 `exports` 用通配把目录映射成子入口：`"./ui/*": "./src/ui/*/index.ts"`、`"./*": "./src/components/*/index.tsx"`，于是 `@affine/component/ui/button`、`@affine/component/notification-center` 都能按需精确引入、利于摇树。

## 3. 实现细节

### 3.1 样式：vanilla-extract + CSS 变量 + data 属性驱动变体

以 `ui/button/button.css.ts` 为例，这是本包样式写法的范本。它**不用 vanilla-extract 的 `recipe`**，而是手写 `style` + `createVar` + `selectors`，把"变体"压到 DOM 的 `data-*` 属性上：

```ts
// 来源：ui/button/button.css.ts
export const hVar = createVar('height');
const bgVar = createVar('bg');
const textVar = createVar('fg');

export const button = style({
  vars: { [gapVar]: '4px', [borderWidthVar]: '1px' },
  backgroundColor: bgVar,
  color: textVar,
  selectors: {
    '&[data-size="default"]': {
      vars: { [hVar]: '28px', [fontSizeVar]: cssVar('fontXs') },
    },
    '&[data-variant="primary"]': {
      vars: {
        [bgVar]: cssVarV2('button/primary'),
        [textVar]: cssVarV2('button/pureWhiteText'),
      },
    },
    '&:hover:before': { opacity: 1 },
  },
});
```

组件侧只需把 props 映射成 data 属性（`button.tsx`）：

```tsx
<button
  className={clsx(styles.button, className)}
  data-size={size}
  data-variant={variant}
  data-disabled={disabled || undefined}
  data-no-hover={withoutHover || BUILD_CONFIG.isMobileEdition || undefined}
/>
```

**为什么这么设计**：变体切换是改 DOM 属性而非换 class，CSS 作用由 `createVar` 的局部变量承载——外部可用同名 CSS 变量直接覆写（见文件顶部注释"Using variables can override externally, without considering the priority of selectors"），绕开了 CSS 选择器优先级战争。hover 效果用 `:before` 叠一层半透明 overlay（`cssVarV2('layer/background/hoverOverlay')`），而非改背景色，天然兼容各种 variant。

### 3.2 两套 token：`cssVar` 与 `cssVarV2`

`@toeverything/theme` 提供 v1（`cssVar('fontXs')`、`cssVar('textPrimaryColor')`）与 v2（`cssVarV2('button/primary')`、也支持点语法 `cssVarV2.layer.insideBorder.blackBorder`）。新组件优先用 v2 的语义化命名。`theme/theme.css.ts` 把基础 token 绑到 `body`：

```ts
globalStyle('body', {
  color: cssVar('textPrimaryColor'),
  fontFamily: cssVar('fontFamily'),
  fontSize: cssVar('fontBase'),
});
```

暗色模式不靠组件自己判断，而靠 `next-themes` 在根节点打 `[data-theme="dark"]`，css 里用 `'[data-theme="dark"] &'` 选择器切换（见 `button.css.ts` 的 `iconButton` 阴影）。需要在 JS 里读当前主题值时用 `hooks/use-theme-value.ts` 的 `useThemeValueV2(key)`，它结合 `useTheme().resolvedTheme` 在 `darkThemeV2`/`lightThemeV2` 间取值。

### 3.3 Lit ↔ React 桥：`lit-react/create-component.ts`

编辑器用 Lit，外壳用 React，要把一个 Lit `LitElement` 当 React 组件用。官方 `@lit/react` 有坑（见 `lit-react/readme.md`：属性在 `connectedCallback` 中被访问时有问题），所以本包 fork 了一份 `createComponent`。核心 trick（`create-component.ts:208-213` 注释）：**不直接用自定义元素的标签名**，而是 `new elementClass()` 造实例，再 `container.append(element)` 挂进一个包裹 `div`：

```ts
// 来源：lit-react/create-component.ts
if (elementRef.current === null) {
  const element = new elementClass();   // 手动实例化 LitElement
  elementRef.current = element;
}
React.useLayoutEffect(() => {
  // 把 props 分流：事件→addEventListener，property→直接赋值到元素
  for (const prop in elementProps) setProperty(elementRef.current, prop, ...);
});
React.useLayoutEffect(() => {
  if (!element.isConnected) container.append(element); // 挂载进 React 创建的容器
}, []);
```

props 会被分成三类（`create-component.ts:287-299`）：React 保留属性（`children/ref/style/className`）走 `reactProps`；事件名或元素原型上的属性走 `elementProps`（设到 Lit 元素上）；其余回落给容器 div。`to-react-node.ts` 则更轻量——定义了一个 `affine-lit-template-wrapper`（`@customElement` 装饰器）承载任意 `TemplateResult`，`toReactNode(template)` 把 Lit 模板转成可直接塞进 JSX 的 `ReactNode`。

### 3.4 组件的工程约定

`Button` 展示了本包组件的通用约定（`ui/button/button.tsx`）：`forwardRef` 透传 ref、`prefix`/`suffix` 接收 `ReactElement<SVGAttributes>` 并用 `cloneElement` 注入 `width/height:'100%'`、`loading` 时用内置 `Loading` 替换 prefix、`BUILD_CONFIG.isMobileEdition` 在移动端禁用 hover。Button 还内建 `Tooltip` 包裹，`tooltip`/`tooltipShortcut` 直接作为 props。

## 4. 语法特色

- **`.css.ts` 编译期样式（vanilla-extract）**：样式是类型安全的 TS，`createVar()` 返回带类型的 CSS 变量引用，`style({...})` 在构建期抽成静态 CSS 并返回 class 名字符串，零运行时开销。
- **`createVar` + `[var]: value` 计算属性键**：`vars: { [hVar]: '28px' }` 用计算键把运行时生成的变量名作为对象键——这是 vanilla-extract 变量 API 的惯用法。
- **模板字面量联合类型约束 props**：`ButtonType = 'primary' | 'secondary' | ...`、`[key: \`data-${string}\`]: string` 索引签名允许任意 data 属性透传且保持类型约束。
- **幻影类型（phantom type）标注事件**：`create-component.ts` 的 `EventName<T extends Event> = string & { __eventType: T }`——用交叉类型在字符串上"挂"一个仅类型层面存在的事件类型，于是 `events: { onfoo: 'foo' as EventName<FooEvent> }` 能让 `onfoo` 回调被推断为 `(e: FooEvent) => void`。
- **分布式条件类型做 Omit**：`DistributiveOmit<T, K> = T extends any ? (K extends keyof T ? Omit<T,K> : T) : T`，在联合类型上逐成员 `Omit`，用于安全剥离 `ref`。
- **`declare module` + `@customElement` 装饰器**：`to-react-node.ts` 用 Lit 的 `@customElement('affine-lit-template-wrapper')` 装饰器注册自定义元素，并 `override createRenderRoot()` 关闭 shadow DOM 以便样式穿透。

## 5. 设计 / 实现亮点

- **data 属性驱动变体 + CSS 变量覆写**：避免了 `recipe`/className 爆炸与选择器优先级问题，变体是 DOM 状态而非样式分支，天然可被外部样式与主题覆盖。
- **Lit↔React 桥的务实 fork**：没有硬扛官方库的 bug，而是用"手动实例化 + 容器挂载"绕过生命周期陷阱，代价是多一层包裹 div——一个被明确记录的权衡。
- **双 token 体系平滑迁移**：v1/v2 token 并存，新代码用语义化 v2，老代码不被迫重写，是大型设计系统演进的典型手法。
- **渐进废弃 emotion**：`styles/styled.tsx` 仅 re-export `@emotion/styled` 并标注 `@deprecated`，明确引导新组件走 vanilla-extract，用一行注释完成技术栈收敛的"软约束"。

## 6. 对外 API 与注意事项

- 主入口 `@affine/component` 聚合导出全部 `ui/*` 与 `hooks`/`utils`；精确子入口 `@affine/component/ui/button`、`@affine/component/theme`、`@affine/component/<组件>` 更利摇树。
- **副作用入口**：`@affine/component/theme` 是纯副作用导入（注入全局 CSS 与字体），应在应用根处 import 一次。
- **不要在本包写业务逻辑**：组件应保持无状态/受控；需要 workspace/doc 的逻辑属于 `@affine/core`。
- **区分 BlockSuite 组件**：画布内的 UI 去 `@blocksuite/affine-components`，不要在本包里找 `toolbar`/`color-picker`。
- `styled`（emotion）已废弃，新组件一律 `.css.ts`。

## 7. 延伸

- 设计系统：`@toeverything/theme`（token 来源）；编辑器 UI：`@blocksuite/affine-components`（Lit）。
- 国际化：`@affine/i18n`（组件文案）。
- 上层：`@affine/core` 与 `apps/*` 消费本包。
- 同层相关：`@affine/track`（组件上的 `data-event-props` 自动埋点，见 affine-track.md）。
