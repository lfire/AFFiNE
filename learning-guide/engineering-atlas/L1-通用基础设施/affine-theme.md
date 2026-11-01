# `@affine/theme`（实际发布为 `@toeverything/theme`）

> 一句话定位：AFFiNE 的**设计令牌（design tokens）与 CSS 变量系统**——把 Figma 里的颜色、字体、阴影、层级、调色盘等视觉常量，固化为一套"深浅双主题 + 类型安全访问器"的 CSS 自定义属性，让全前端用 `cssVar('...')` / `cssVarV2('text/primary')` 引用，而不写死任何色值。

| 项        | 值                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| 目录      | `packages/common/theme`（**仅占位**，源码已外迁）                                                             |
| 真实来源  | 独立仓库 [`toeverything/design`](https://github.com/toeverything/design)，发布为 npm 包 `@toeverything/theme` |
| 所属层    | L1 · 通用基础设施                                                                                             |
| 语言/形态 | TypeScript + vanilla-extract（构建产物为 `.css` + `.js` + `.d.ts`）                                           |
| 关键依赖  | `@vanilla-extract/css`（构建期）                                                                              |
| 被谁依赖  | `@affine/component`、`@affine/core`、各前端 app（`*.css.ts`、组件样式）                                       |
| 对外入口  | `.`（v1：`cssVar`/`lightTheme`…）、`./v2`（v2：`cssVarV2`）、`./style.css`、`./typography`、`./fonts`         |

## 1. 设计逻辑

一个编辑器产品的视觉一致性，取决于**色值/字号/阴影不散落在成百上千个组件里**。AFFiNE 的做法是把全部视觉常量抽象为"设计令牌"，并坚持三条原则：

1. **令牌即单一真值**：每个视觉量只定义一次（如 `text/primary`），组件只引用令牌名、永不写死 `#1e1e1e`。设计师在 Figma 调整，开发同步令牌即可，无需全局搜索替换色值。
2. **主题 = 同名令牌的不同取值**：深色/浅色/打印三套主题，是同一组令牌键映射到不同的 CSS 变量值。切换主题只需切换挂在根元素上的 `data-theme`，组件代码零改动。
3. **类型安全的令牌访问**：令牌名是几百个字符串，手写极易拼错。本包用 TypeScript 把每个令牌名变成**联合字面量类型**，`cssVar('text/primary')` 传错名字直接编译报错。

**为何外迁成独立仓库**：设计令牌是设计系统的产物，更新节奏与设计团队绑定、且会被多个项目复用，因此从 AFFiNE monorepo 剥离到 `toeverything/design` 独立演进。`packages/common/theme` 目录现仅剩一行 README 指向外部仓库——这是**"曾在此、已外迁"的历史痕迹**，实际消费的是 npm 上的 `@toeverything/theme`。

**v1 与 v2 两代令牌并存**：早期 v1（`cssVar`，扁平 camelCase 命名如 `--affine-text-primary-color`）仍被大量存量代码使用；新设计体系 v2（`cssVarV2`，层级斜杠命名如 `text/primary`，直接对应 Figma 图层路径）是演进方向。两者通过不同子入口（`.` vs `./v2`）隔离，渐进迁移。

## 2. 目录与关键文件

```text
packages/common/theme/
└── README.md               # 仅一行："This package has been moved to toeverything/design"

node_modules/@toeverything/theme/   # 实际安装的产物（源码在 toeverything/design 仓库）
├── package.json            # exports: "." / "./v2" / "./style.css" / "./typography" / "./fonts"
└── dist/
    ├── index.js / .d.ts    # v1：baseTheme/lightTheme/darkTheme/printTheme、cssVar()、camelToKebab()
    ├── v2/
    │   ├── variables.js    # v2 令牌值：lightThemeV2 / darkThemeV2（斜杠层级命名）
    │   └── index.js/.d.ts  # v2：cssVarV2（函数 + 嵌套对象双形态）、themeToVar()
    ├── style.css           # 所有 CSS 变量的声明（挂到 :root / [data-theme]）
    ├── presets/typography  # 排版预设
    └── cursors.d.ts        # 自定义光标（内联 SVG data URI）
```

## 3. 实现细节

### 3.1 令牌的三层结构：JS 对象 → CSS 变量名 → CSS 变量值

以 v1 为例，一个令牌经历三种表示：

- **JS 令牌对象**（camelCase 键）：`lightTheme.textPrimaryColor = '#...'`、`darkTheme.textPrimaryColor = '#...'`。
- **CSS 变量名**（kebab-case，带 `--affine-` 前缀）：`--affine-text-primary-color`。
- **CSS 变量值**：在 `style.css` 里按主题声明，如 `:root { --affine-text-primary-color: #... }`、`[data-theme='dark'] { --affine-text-primary-color: #... }`。

三者的桥梁是 `camelToKebab` 与 `cssVar`：

```ts
// 来源：@toeverything/theme/dist/index.d.ts:3,1338
export declare const camelToKebab: (s: string) => string;
export declare function cssVar(
  key: keyof AffineCssVariables | keyof AffineTheme,
  fallback?: string
): string; // 返回 `var(--affine-xxx[, fallback])`
```

`cssVar('textPrimaryColor')` 产出字符串 `var(--affine-text-primary-color)`，在 `*.css.ts`（vanilla-extract）或内联样式里直接用。`fallback` 参数生成带兜底的 `var(--x, fallback)`。

### 3.2 `AffineCssVariables`：用映射类型从令牌对象派生变量名类型

CSS 变量名的类型不是手写，而是从令牌对象的键**自动派生**：

```ts
// 来源：@toeverything/theme/dist/index.d.ts
export type Kebab<
  T extends string,
  A extends string = '',
> = T extends `${infer F}${infer R}`
  ? Kebab<R, `${A}${F extends Lowercase<F> ? '' : '-'}${Lowercase<F>}`>
  : A;

export type AffineTheme = typeof lightTheme & {
  editorMode: 'page' | 'edgeless';
};

export type AffineCssVariables = {
  [Key in `--affine-${Kebab<keyof AffineTheme>}`]: string; // 遍历令牌键 → 拼成 --affine-xxx
};
```

`Kebab` 是一个**递归模板字面量类型**：逐字符扫描，遇到大写字母就前插 `-` 再转小写，从而把 `textPrimaryColor` 在类型层面转成 `text-primary-color`。再用映射类型给每个键加 `--affine-` 前缀。于是**新增一个令牌，`cssVar` 的可接受参数类型会自动更新**——类型与数据完全同源，零手工维护。

### 3.3 v2：`cssVarV2` 的"函数 + 嵌套对象"双形态

v2 令牌名直接采用 Figma 的图层路径（`text/primary`、`button/siderbarPrimary/background`）。`cssVarV2` 提供两种等价调用语法：

```ts
// 来源：@toeverything/theme/dist/v2/index.d.ts:2250
/**
 * cssVarV2('text/primary');
 * cssVarV2('button/siderbarPrimary/background');
 * // 等价的嵌套属性语法：
 * cssVarV2.text.primary;
 * cssVarV2.button.siderbarPrimary.background;
 */
export declare const cssVarV2: typeof _cssVarV2 & NestedTheme;
```

它的类型是 `函数类型 & 嵌套对象类型` 的**交叉类型**：既能当函数 `cssVarV2('text/primary')` 调用，又能当对象 `cssVarV2.text.primary` 取属性。前者适合动态拼接键、后者有更好的自动补全与重构体验。令牌值在 `lightThemeV2`/`darkThemeV2`（`v2/variables.ts`）中以斜杠路径为键定义（如 `'aI/applyBackground'`、`'block/callout/background/blue'`），数量达上千。

### 3.4 主题切换：`data-theme` 驱动

`style.css` 把 `lightCssVariables` 挂在根作用域、`darkCssVariables` 挂在 `[data-theme='dark']`。还导出了多种组合形态供不同场景使用：

```ts
// 来源：@toeverything/theme/dist/index.d.ts:509
export declare const lightCssVariables: AffineCssVariables;
export declare const darkCssVariables: AffineCssVariables;
export declare const printCssVariables: AffineCssVariables;      // 打印主题
export declare const combinedLightCssVariables: {...};           // v1+v2 合并
export declare const scopedLightCssVariables: {...};             // 作用域化（挂到某容器而非全局）
```

运行时只需在根元素切 `data-theme`，所有 `var(--affine-*)` 自动重新解析——**组件完全无感知主题切换**。

### 3.5 `baseTheme`：不随主题变化的静态令牌

并非所有令牌都分深浅。字体族、字号、层级（z-index）、编辑器宽度这类"结构性常量"属于 `baseTheme`，无论主题如何都恒定：

```ts
// 来源：@toeverything/theme/dist/index.d.ts:15
export declare const baseTheme: {
  fontFamily: string;
  fontH1: string; /* ... */
  zIndexModal: string;
  zIndexPopover: string;
  editorWidth: string;
  editorSidePadding: string;
  scale: string;
  zoom: string;
  paletteLineYellow: string; /* 画板调色盘 ... */
};
```

注释直言这是"should not affected by `data-theme`"的静态部分——把"会变的"与"不变的"令牌分开，避免在深浅两套里重复声明恒定值。

### 3.6 自定义光标：内联 SVG → data URI

`cursors.d.ts` 还提供编辑器特有的光标（如抓取手势）。实现上把 SVG 字符串压缩后 `encodeURIComponent` 成 `data:image/svg+xml,...`，可直接用于 CSS `cursor` 属性——免去额外的图片请求。

## 4. 语法特色

- **递归模板字面量类型（`Kebab`）**：在类型系统里实现 camelCase→kebab-case 字符串变换，使 CSS 变量名类型从令牌对象自动推导。这是"把命名约定编译进类型"的典型手法（与 `@affine/error` 的 `ToPascalCase` 异曲同工）。
- **映射类型 + 模板字面量键（`AffineCssVariables`）**：`` { [K in `--affine-${Kebab<...>}`]: string } ``，遍历令牌键并统一加前缀生成变量名类型。
- **交叉类型做"双形态 API"（`cssVarV2`）**：`typeof _cssVarV2 & NestedTheme` 让同一个值既是函数又是嵌套对象，覆盖动态/静态两种使用习惯。
- **`typeof lightTheme` 派生类型**：`AffineTheme = typeof lightTheme & {...}`，类型直接取自令牌运行时对象，保证"类型即数据"。
- **vanilla-extract 零运行时 CSS-in-TS**：令牌与样式用 `.css.ts` 编写，构建期编译成静态 `.css`，运行时无样式计算开销——兼得 TS 类型安全与原生 CSS 性能。
- **`as const` 字面量联合**：`themeToVar` 的返回类型是几百个 `--affine-xxx` 字面量的联合，使返回值类型精确到具体变量名。

## 5. 设计 / 实现亮点

- **类型安全的令牌引用**：几百个令牌名全部是联合字面量类型，拼错即编译失败且有自动补全——把"魔法字符串"的风险用类型系统根除。
- **主题切换零组件改动**：深浅打印三套主题共享令牌名、仅值不同，靠 `data-theme` 一处切换，是 CSS 变量机制的教科书式运用。
- **类型完全从数据派生**：`Kebab`/`AffineCssVariables`/`typeof lightTheme` 让令牌新增/改名时，所有相关类型自动跟随，无手工同步成本。
- **v1/v2 渐进迁移**：旧扁平命名与新 Figma 层级命名经不同子入口共存，存量代码无需一次性重写。
- **设计—开发同源**：v2 令牌名即 Figma 图层路径，设计稿与代码用同一套命名，沟通零翻译损耗。
- **独立仓库解耦发布节奏**：设计系统与应用解耦，既可被多项目复用，又不拖慢主仓构建。

## 6. 对外 API 与注意事项

- **主要导出（v1，入口 `.`）**：`cssVar(key, fallback?)`、`lightTheme`/`darkTheme`/`printTheme`/`baseTheme`、`lightCssVariables`/`darkCssVariables`、`camelToKebab`、类型 `AffineTheme`/`AffineCssVariables`。
- **主要导出（v2，入口 `./v2`）**：`cssVarV2`（函数+嵌套双形态）、`lightThemeV2`/`darkThemeV2`、`themeToVar`、类型 `AffineThemeKeyV2`。
- **样式/资源入口**：`./style.css`（必须在应用入口引入一次，否则所有 `var(--affine-*)` 解析为空）、`./typography`、`./fonts` / `./fonts.css`。
- **包名注意**：仓库任务称其为 `@affine/theme`，但**实际 import 路径是 `@toeverything/theme`**（见 `packages/frontend/component/src/theme/theme.css.ts` 等）。`packages/common/theme` 目录本身只有占位 README，不含可用代码。
- **坑**：(1) 忘记引入 `style.css` 会导致变量未声明、UI 全黑/无色；(2) 新代码应优先用 v2 `cssVarV2`，v1 仅为兼容存量；(3) 令牌源码在外部仓库，本地无法直接改——需到 `toeverything/design` 修改并发版。

## 7. 延伸

- 上层：`@affine/component`（组件库，大量 `*.css.ts` 消费令牌）、各前端 app 的样式。
- 外部：[`toeverything/design`](https://github.com/toeverything/design) 仓库（令牌真值源）、vanilla-extract（CSS-in-TS 构建工具）。
- 对应教程：learning-guide 关于"设计令牌与主题系统"的章节。
