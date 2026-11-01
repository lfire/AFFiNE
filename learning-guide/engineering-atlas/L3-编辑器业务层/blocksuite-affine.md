# `@blocksuite/affine`

> 一句话定位：BlockSuite 的**聚合门面包**——它几乎不含自有逻辑，而是把散落在数十个 `affine-block-*` / `affine-gfx-*` / `affine-inline-*` / `affine-widget-*` / `affine-fragment-*` 以及 `foundation` 里的扩展，用两个工厂函数 `getInternalViewExtensions()` / `getInternalStoreExtensions()` 汇成"一份现成的编辑器扩展清单"，再通过一张庞大的 `exports` 子路径表把底层所有能力**单一入口**转出。它是 `@affine/core` 使用整个 BlockSuite 的唯一门面。

| 项        | 值                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/all`                                                                                                                                                                                                                                 |
| 所属层    | L3 · 编辑器业务层（聚合/门面）                                                                                                                                                                                                                          |
| 语言/形态 | TypeScript 库（聚合再导出，几乎无自有实现）                                                                                                                                                                                                             |
| 关键依赖  | 全部 `@blocksuite/affine-*`（blocks/gfx/inlines/widgets/fragments）、`foundation`、`ext-loader`、`@blocksuite/std`/`store`/`global`/`sync`/`data-view`                                                                                                  |
| 被谁依赖  | `@affine/core`（经 `@blocksuite/affine/*` 子路径引入一切并构建 Manager）                                                                                                                                                                                |
| 对外入口  | `.`（空）、`./extensions/view`、`./extensions/store`、`./ext-loader`、`./std`、`./store`、`./foundation/*`、`./blocks/*`、`./gfx/*`、`./inlines/*`、`./widgets/*`、`./fragments/*`、`./components/*`、`./shared/*`、`./schemas`、`./model` 等（上百条） |

## 1. 设计逻辑

BlockSuite/AFFiNE 把编辑器能力拆成了**极其细粒度的几十个包**：每个块一个 `affine-block-*`、每个图形元素一个 `affine-gfx-*`、每种行内标记一个 `affine-inline-*`、每个浮层一个 `affine-widget-*`、每个可嵌入面板一个 `affine-fragment-*`，外加 `foundation`（地基）与 `ext-loader`（装载机制）。细拆的好处是边界清晰、可独立测试与摇树；坏处是**使用方（`@affine/core`）若要拼出一个完整编辑器，得 import 几十个包、手动收集几十个 `XxxViewExtension`**——这既啰嗦又让 core 与 BlockSuite 的内部包结构强耦合。

`@blocksuite/affine`（目录名 `all`）就是为消除这个负担而生的**门面（Facade）**。它的立场是：

1. **汇总扩展**：把每个包导出的 `XxxViewExtension` / `XxxStoreExtension` 收进两个数组工厂 `getInternalViewExtensions()` / `getInternalStoreExtensions()`，使用方一次拿到"内置全家桶"。
2. **统一入口**：用 `package.json` 的 `exports` 把所有底层包的子路径**重新映射**到 `@blocksuite/affine/*` 下（如 `@blocksuite/affine/blocks/paragraph/view` → `@blocksuite/affine-block-paragraph/view`），使用方只依赖 `@blocksuite/affine` 一个包名。
3. **提供 schema 清单**：`schemas.ts` 导出 `AffineSchemas`（所有内置块模型 schema 数组），供创建 Workspace/Store 时注册。

它**不组装 Manager、不实例化编辑器**——真正 `new ViewExtensionManager([...])` 和 `configure(...)` 发生在 `@affine/core` 的 `blocksuite/manager/{view,store}.ts`。`all` 只负责"把内置扩展备齐并命名空间化"，把"怎么配、加哪些 app 专属扩展"留给 core。这是门面与装配的职责分界。

## 2. 目录与关键文件

```text
src/
├── index.ts               # export {}（空；门面的"值"全走子路径，主入口零副作用）
├── extensions/
│   ├── view.ts            # ★ getInternalViewExtensions()：汇总 ~50 个 ViewExtension
│   └── store.ts           # ★ getInternalStoreExtensions()：汇总 ~30 个 StoreExtension
├── effects.ts             # 仅 type 聚合（declare const _GLOBAL_）：声明各包 effects 的类型并集
├── schemas.ts             # AffineSchemas：内置块模型 schema 数组
├── ext-loader/index.ts    # export * from '@blocksuite/affine-ext-loader'
├── std/{index,gfx,inline,effects}.ts   # 再导出 @blocksuite/std/*
├── store/{index,test}.ts  # 再导出 @blocksuite/store
├── foundation/{view,store,clipboard}.ts # 再导出 foundation 子入口
├── blocks/<block>/{view,store,index}.ts # 每块三文件，各 export * from 对应底层包
├── gfx/<elem>/{view,store,index}.ts     # 图形元素再导出
├── inlines/<inline>/{view,store,index}.ts
├── widgets/<widget>/{view,index}.ts
├── fragments/<fragment>/{view,index}.ts # 含 doc-title/outline/frame-panel/adapter-panel
├── components/<comp>.ts   # 再导出 affine-components 子路径
├── shared/*.ts            # 再导出 affine-shared 子路径
└── model/、sync/ 等        # 再导出 model / sync
```

每个叶子文件几乎都是一行 `export * from '@blocksuite/affine-<pkg>/<sub>'`。

## 3. 实现细节

### 3.1 getInternalViewExtensions：视图扩展全家桶

`extensions/view.ts` 顶部 import 近 50 个 `XxxViewExtension`（分 Gfx / Block / Inline / Widget / Fragment 五组），函数返回一个**有序数组**（`view.ts:60-132`）：

```ts
export function getInternalViewExtensions() {
  return [
    FoundationViewExtension, // 地基永远第一
    // Gfx
    PointerViewExtension,
    GfxNoteViewExtension,
    BrushViewExtension /* … */,
    // Block
    AttachmentViewExtension,
    /* … */ RootViewExtension,
    // Inline
    InlineCommentViewExtension,
    /* … */ InlinePresetViewExtension,
    // Widget —— order will affect the z-index of the widget
    DragHandleViewExtension,
    /* … */ EdgelessToolbarViewExtension,
    // Fragment
    DocTitleViewExtension,
    FramePanelViewExtension,
    OutlineViewExtension,
    AdapterPanelViewExtension,
  ];
}
```

两个顺序约定很关键：

- **`FoundationViewExtension` 置顶**：地基先注册（主题、文档模式、剪贴板等），其它扩展才有依赖可用（见 `blocksuite-affine-foundation.md`）。
- **Widget 的顺序影响 z-index**：代码注释明确写了 `order will affect the z-index of the widget`（`view.ts:108`）——数组顺序即浮层叠放次序，这是用"声明顺序"编码 UI 层级的务实设计。

四个 fragment 扩展（本任务另外四篇的主角）都在列表末尾被收录（`view.ts:127-130`）。

### 3.2 getInternalStoreExtensions：数据层扩展全家桶

`extensions/store.ts` 同理，import ~30 个 `XxxStoreExtension` 并返回数组（`store.ts:34-72`），同样 `FoundationStoreExtension` 置顶。store 扩展是**纯数据层**（schema、selection、adapter、序列化），不含 UI——因此 fragment/widget 不出现在这里（它们没有 store 扩展），而 adapter-panel 预览用到的 `MarkdownAdapterFactory` 等正是经由此处的 `FoundationStoreExtension` 注册进容器的。

### 3.3 两份清单如何被 @affine/core 消费

门面的价值在使用方才完全显现。`@affine/core` 的 `blocksuite/manager/view.ts` 这样用（节选 `manager/view.ts:87-105`）：

```ts
this._manager = new ViewExtensionManager([
  ...getInternalViewExtensions(), // ← 门面提供的内置全家桶
  AffineThemeViewExtension, // ← 以下是 app 专属扩展
  AffineEditorViewExtension,
  CloudViewExtension,
  PdfViewExtension,
  MobileViewExtension,
  AIViewExtension /* … */,
]);
```

即：**内置扩展来自 `@blocksuite/affine`，应用特化扩展来自 `@affine/core` 自己**，两者 `[...spread, ...app]` 拼成最终 Manager 的 provider 清单。随后 core 用链式 `configure(FoundationViewExtension, { telemetry, fontConfig, peekView })` 等注入宿主能力（`manager/view.ts:161-199`），最后 `manager.get('page')` / `get('edgeless')` 产出可注入 `BlockStdScope` 的扩展集（`manager/view.ts:370-375`）。store 侧对称（`manager/store.ts:28-32`）。

这条链路印证了门面定位：`all` 备料 → `core` 配置与实例化 → `ext-loader` 的 Manager 按 scope 装配（见 `blocksuite-affine-ext-loader.md`）。

### 3.4 exports 子路径：把内部包结构命名空间化

`package.json` 的 `exports` 有上百条，规律是**把底层包的子路径平移到 `@blocksuite/affine/` 命名空间**。对照 `blocks/paragraph/view`：

```jsonc
"./blocks/paragraph/view": "./src/blocks/paragraph/view.ts"
```

而 `src/blocks/paragraph/view.ts` 只有一行（`blocks/paragraph/view.ts:1`）：

```ts
export * from '@blocksuite/affine-block-paragraph/view';
```

于是 core 写 `import { ParagraphViewExtension } from '@blocksuite/affine/blocks/paragraph/view'`，而非 `@blocksuite/affine-block-paragraph/view`。好处：**core 永远只依赖 `@blocksuite/affine` 一个包名**，BlockSuite 内部怎么拆包/改包名都被门面吸收，解耦彻底。`view`/`store`/`index` 三分文件也贯彻了 ext-loader 的 view/store 双通道 + effects 分离约定。

### 3.5 schemas：内置块模型清单

`schemas.ts` 从 `@blocksuite/affine-model` 等 import 所有块的 `*BlockSchema`，汇成 `AffineSchemas: z.infer<typeof BlockSchema>[]`（`schemas.ts:33-59`）。注释特意说明 `Import models only, the bundled file should not include anything else`（`schemas.ts:1`）——schema 是纯数据，刻意不牵连视图/effects 代码，让只需"建文档数据结构"的场景（如 SSR、后端）能单独引入而不拉入 UI。

### 3.6 effects.ts 为何只有类型

`effects.ts` 没有任何运行时副作用调用，只有一个 `declare const _GLOBAL_: typeof stdEffects | typeof richTextEffects | ...`（`effects.ts:18-34`），且 import 全部带 `type`。它的作用纯粹是**在类型层面把各包 effects 的类型并起来**（可能用于类型检查或文档），真正的 `customElements.define` 副作用由各包自己的 `effect()` 在被装载时触发（见 foundation / 各 fragment 的 `view.ts`）。这与 `index.ts` 的 `export {}` 一道，确保门面主入口**零运行时副作用**。

## 4. 语法特色

- **`export {}` 空桶主入口**：`index.ts` 仅 `export {}`（`index.ts:1`），把文件标记为 ES module 且零导出——门面刻意不在 `.` 暴露任何东西，强制使用方走具名子路径，最大化摇树、杜绝"import 门面即拉入全部"。
- **`export * from` 再导出墙**：数百个叶子文件都是单行 `export * from '@blocksuite/affine-*/...'`（如 `blocks/paragraph/view.ts:1`、`std/effects.ts:1`、`store/index.ts:3`）——用 barrel re-export 做命名空间平移，是门面模式的教科书写法。
- **工厂函数返回数组而非常量**：`getInternalViewExtensions()` 是函数不是 `const`（`view.ts:60`）。每次调用返回新数组，避免多个 Manager 共享同一可变数组引用、也便于使用方 spread 后追加。
- **`exports` 条件映射**：`package.json` 的 exports map 是现代 Node/打包器的"包入口协议"，一条条把子路径指向源文件——门面的"统一入口"本质上由这张表实现，而非代码。
- **`import { type effects as X }`**：`effects.ts` 用 `type` 修饰的具名 import（`effects.ts:1-16`），只引类型不引值，配合 `declare const` 做纯类型聚合，运行时零开销。
- **`z.infer<typeof BlockSchema>[]`**：`AffineSchemas` 的类型由 zod schema 反推（`schemas.ts:33`），一处 schema 定义同时供运行时校验与静态类型。
- **别名 import 消歧**：同名扩展用 `as` 改名，如 `LinkViewExtension as GfxLinkViewExtension`（`view.ts:29`）、`NoteViewExtension as GfxNoteViewExtension`（`view.ts:31`）——block 与 gfx 都有 Note/Link，门面汇总时必须消歧。

## 5. 设计 / 实现亮点

- **门面消除耦合**：core 只认 `@blocksuite/affine` 一个包与其子路径，BlockSuite 几十个内部包的拆分/重命名/迁移都被门面层吸收，是大型 monorepo 控制依赖面的关键手法。
- **"备料"与"装配"分离**：`all` 只提供有序扩展清单 + schema，不 new Manager、不 configure——把实例化与宿主能力注入留给 core，使同一份 BlockSuite 能被不同宿主（桌面/移动/AI）以不同配置复用。
- **用数组顺序编码语义**：view 扩展数组里 Foundation 置顶（依赖顺序）、Widget 顺序即 z-index（UI 层级）——把隐式约束显式化为"声明顺序"，简单而有效。
- **零副作用主入口 + 子路径摇树**：`export {}` + `exports` 子路径 + effects 仅类型，三管齐下保证"引门面不等于引全部"，打包体积可控。
- **schema 纯数据隔离**：`AffineSchemas` 刻意只引 model，让纯数据场景免拉 UI，照顾 SSR/后端复用。
- **view/store/effects 三通道贯穿**：门面的目录结构（每块 `view`/`store`/`index`）忠实复刻 ext-loader 的三通道约定，结构即文档。

## 6. 对外 API 与注意事项

- 主要导出：`getInternalViewExtensions()`（`./extensions/view`）、`getInternalStoreExtensions()`（`./extensions/store`）、`AffineSchemas`（`./schemas`）；以及经 `exports` 映射的全部 `./blocks/*`、`./gfx/*`、`./inlines/*`、`./widgets/*`、`./fragments/*`、`./std`、`./store`、`./ext-loader`、`./foundation/*`、`./components/*`、`./shared/*`、`./model`、`./sync` 子路径。
- **用法**：使用方 `new ViewExtensionManager([...getInternalViewExtensions(), ...appExtensions])`，再 `configure(...)` 注入宿主能力，最后 `get(scope)`（见 `@affine/core` 的 `blocksuite/manager/view.ts`、`store.ts`）。
- **注意**：
  - 主入口 `.` 为 **`export {}`（空）**，任何能力都必须从具名子路径引入，`import '@blocksuite/affine'` 什么也拿不到。
  - 两个工厂返回的数组**顺序有语义**：别随意重排——Foundation 必须在前，Widget 顺序决定浮层 z-index。
  - `effects.ts` 不产生运行时副作用，别指望 import 它就能注册自定义元素；元素注册发生在各扩展被 `ViewExtensionManager.get(scope)` 装配并执行其 `effect()` 时（经 ext-loader 的类静态一次性守护）。
  - 门面只"备料"，真正的 Manager 构造与 `configure` 在 `@affine/core`；本包不提供编辑器实例或 React 组件。
  - 新增一个块/fragment 包时，需同时：在对应工厂数组加扩展、在 `exports` 加子路径、新建 `src/.../{view,store,index}.ts` 再导出文件——三处同步。

## 7. 延伸

- 机制底座：`@blocksuite/affine-ext-loader`（`ViewExtensionManager`/`StoreExtensionManager`，见 `blocksuite-affine-ext-loader.md`）——门面汇总的扩展最终交给它按 scope 装配。
- 地基内容：`@blocksuite/affine-foundation`（两份清单的首项，见 `blocksuite-affine-foundation.md`）。
- 被聚合的 fragment：`blocksuite-affine-fragment-doc-title.md` / `-outline.md` / `-frame-panel.md` / `-adapter-panel.md`——它们的 `XxxViewExtension` 都在 `getInternalViewExtensions()` 末尾被收录。
- 使用方：`@affine/core` 的 `blocksuite/manager/{view,store}.ts`（构造 Manager、`configure`、`get(scope)`），以及 `AffineSchemas` 在创建 Workspace 时注册块模型。
- 对照：L1 `@toeverything/infra` 的 `Framework` 是前端业务模块的 DI；本门面则是"把编辑器扩展备齐并命名空间化"的聚合层，二者在 core 中会合——core 用 infra 管业务模块、用本门面管编辑器能力。
