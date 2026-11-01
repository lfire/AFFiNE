# `@blocksuite/affine-gfx-template`

> 一句话定位：白板**模板/贴纸插入**的图形层——把一份序列化的白板内容（`DocSnapshot`，含页面块、便签、画布图元、连接线、分组、frame）作为"模板"整体插入到当前白板，或把单张图片作为"贴纸"落到画布中心。核心难点是**插入时的 ID 重生成与引用重映射**（避免与现有内容冲突、保持连接线/分组/frame 的内部引用正确）、**摆放位置计算**（插到现有内容旁的空白区）、以及 **z-order 索引重排**（fractional index 重新生成让模板叠在最上层）。

| 项        | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/gfx/template`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 所属层    | L3 · 编辑器业务层（gfx 图形层）                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 语言/形态 | TypeScript 库                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 关键依赖  | `@blocksuite/std`（`BaseTool`/`GfxControllerIdentifier`）、`@blocksuite/affine-block-surface`（`SurfaceBlockModel`/`SurfaceBlockTransformer`/`getSurfaceBlock`/`generateElementId`/`sortIndex`）、`@blocksuite/affine-model`（`ConnectorElementModel`）、`@blocksuite/store`（`DocSnapshot`/`BlockSnapshot`/`Transformer`/`DocSnapshotSchema`）、`@blocksuite/global`（`Bound`/`getCommonBound`）、`@blocksuite/affine-widget-edgeless-toolbar`（拖拽控制器）、`rxjs`、`yjs`、`lit`、`@floating-ui/dom` |
| 被谁依赖  | edgeless 预设（通过 `TemplateViewExtension` 注册工具与模板面板）                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 对外入口  | `.`、`./view`（`TemplateViewExtension`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 1. 设计逻辑

### 1.1 在 gfx 范式中的位置：工具是壳，`TemplateJob` 是核

gfx 五件套里，本包的 **"工具"几乎是空的**——`TemplateTool`（`template-tool.ts:3`）只有一行 `toolName='template'`，不处理任何指针事件。它存在的意义只是让工具栏有个"模板"态来弹出模板面板。本包**没有自己的 `ElementModel`/renderer/交互扩展**，因为模板不是一种图元，而是一个**动作**：把一批别的图元/块"倒进"当前白板。

真正的重量在 **`TemplateJob`**（`services/template.ts:77`）——一个把 `DocSnapshot` 反序列化并插入当前 surface 的"任务对象"，加上一组 **中间件（middleware）** 在插入前改写快照。`TemplateViewExtension`（`view.ts:18`）只在 edgeless 下注册 `TemplateTool` 和 `templateSeniorTool`（工具栏按钮 → 弹 `EdgelessTemplatePanel`）。

### 1.2 独有难点：把"一份文档"安全地并入"另一份文档"

模板本质是一份 `DocSnapshot`（整份白板的序列化）。把它插进当前白板远不是"addBlock 一遍"那么简单，有四个独有难题，构成本包主线：

1. **ID 冲突**：模板里的块/图元 id 可能与当前文档撞车 → 必须全部重生成，且**连接线的 source/target、分组的 children、frame 的 childElementIds、surface-ref 的 reference 这些"引用 id"要同步重映射**。
2. **合并而非新增**：模板里的 `affine:page`/`affine:surface` 是容器，不能再插一个新 page/surface，而要**合并进当前文档已有的** page/surface。
3. **加载顺序**：`surface`/`surface-ref`/`frame` 这类"引用了别的块 id"的块必须**延后插入**（等被引用者先就位）。
4. **摆放与层级**：模板要放到现有内容**旁边的空白区**，且 z-index 要**重排到最上层**。

## 2. 目录与关键文件

```text
template/src/
├── index.ts                          # 导出 template.ts / tool / 面板 / 类型
├── view.ts                           # TemplateViewExtension：注册 TemplateTool + templateSeniorTool
├── template-tool.ts                  # TemplateTool：空壳工具（仅提供工具态）
├── services/
│   ├── template.ts                   # ★TemplateJob：反序列化 + 插入；createTemplateJob 工厂
│   └── template-middlewares.ts       # ★四个中间件：replaceId/insertPlace/sticker/regenerateIndex
└── toolbar/
    ├── template-panel.ts             # ★EdgelessTemplatePanel：模板选择面板（搜索/分类/预览卡）
    ├── builtin-templates.ts          # 内置模板数据
    ├── cards.ts / template-loading.ts / overlay-scrollbar.ts
    ├── template-type.ts              # Template 类型定义
    ├── senior-tool.ts                # templateSeniorTool：工具栏按钮
    └── template-tool-button.ts
```

## 3. 实现细节

### 3.1 `TemplateJob`：插入流水线

`TemplateJob`（`template.ts:77`）的入口是 `insertTemplate(template)`（`:345`）：

1. **校验**：`DocSnapshotSchema.parse(template)`（`:346`，zod 运行时校验）确保快照结构合法。
2. **算包围盒**：`_getTemplateBound()`（`:127`）遍历模板所有块/图元的 `xywh` 求联合包围盒（`getCommonBound`），连接线按浮空端点 position 算（忽略 group/connector 自身 xywh）——这是摆放定位的依据。
3. **发 `beforeInsert` 信号**：通过 rxjs `Subject` 把 `{type:'template', template, bound}` 推给所有中间件（中间件据此改写快照，见 3.3）。
4. **快照转模型数据** `_jsonToModelData`（`:229`）：递归把 `BlockSnapshot` 转成可插入的 modelData，每个块插入前再发一次 `{type:'block'}` 信号给中间件。
5. **插入** `_insertToDoc`（`:168`）：按序 `doc.addBlock`。

### 3.2 三类特殊块：延后、合并、引用

`TemplateJob` 用三个常量表达插入规则：

- **`DEFERED_BLOCK = ['affine:surface','affine:surface-ref','affine:frame']`**（`:33`）：这些块**引用了别的块 id**，必须**延后插入**。`_jsonToModelData`/`_insertToDoc` 都先插普通块、把 defered 的推进 `deferInserting` 队列，最后再插（`:225-226`）——保证被引用者先存在。
- **`MERGE_BLOCK = ['affine:surface','affine:page']`**（`:43`）：这些是容器，不能新增，要**合并进现有**。`_getMergeBlockId`（`:118`）把模板里的 page/surface id 映射到当前文档的 root/surface id，`_mergeProps`（`:306`）把模板 surface 里的图元**合并进当前 surface 的 `Y.Map`**。
- 合并 surface 图元时（`_mergeSurfaceElements`，`:319`）用 surface 的 `SurfaceBlockTransformer.elementFromJSON` 反序列化每个图元，且 **connector/group 延后**（`:332`，因为它们引用别的图元 id）。

注意 `affine:surface` 同时在两个表里——它既要合并（并入现有 surface）又要延后（内部图元引用多）。

### 3.3 四个中间件：插入前的快照改写

中间件是 `(job: TemplateJob) => void`，在构造时订阅 `job.slots.beforeInsert`，于插入前改写快照。`createTemplateJob`（`:384`）按 `type` 组装：

- **`replaceIdMiddleware`**（`template-middlewares.ts:9`，**最关键**）：给每个块/图元生成新 id（`regeneratedIdMap` 记录旧→新映射），并**递归重映射所有引用**：surface 内图元 id（`generateElementId`）、**connector 的 source.id/target.id**（`:88-108`）、**group 的 children.json 键**（`:73-86`）、**frame 的 childElementIds**（`:116-123`）、**surface-ref 的 reference**（`:36-45`）。这保证插入后所有内部引用依然自洽、且不与现有内容撞 id。
- **`createInsertPlaceMiddleware`**（`:127`，仅 template 类型）：把整个模板**平移到现有内容右侧的空白区**（`createTemplateJob` 里算 `currentContentBound.x += w + 20/zoom`，`:408`）。它先在 `template` 信号里记下模板原点与目标点的 `offset`，再对每个块的 `xywh`、surface 图元 xywh、connector 浮空端点 position 统一加 offset（`changePosition`，`:156`）；group/connector 的 xywh 删掉（由成员派生）。
- **`createRegenerateIndexMiddleware`**（`:237`，仅 template）：**重排 z-order**。先 `job.walk` 收集所有块/图元的 fractional index 并按原顺序 `sortIndex` 排序（含 group 成员的分组排序），再用当前图层的 `idxGenerator` 生成一批**新的、在当前内容之上的**索引，`resetIndex` 写回——让模板整体叠在最上层且内部层级不乱。
- **`createStickerMiddleware`**（`:206`，仅 sticker）：把单张 `affine:image` 居中到 `center`（或视口中心）并给个最高 index——"贴纸"就是一张落在画布中央的图。

### 3.4 `createTemplateJob`：按类型装配

`createTemplateJob(std, type, center?)`（`:384`）是对外工厂：拿到当前 surface（没有则抛 `NoSurfaceModelError`），按 `type` 组装中间件数组——`template` 类型装 `insertPlace`（算现有内容右侧空位）+ `regenerateIndex`；`sticker` 类型装 `sticker`（居中）；**两者都装 `replaceId`**（id 重生成是任何插入都必须的）。最后 `TemplateJob.create`。

### 3.5 模板面板：`EdgelessTemplatePanel`

`EdgelessTemplatePanel`（`toolbar/template-panel.ts:35`，`WithDisposable(LitElement)`）是一个 467×568 的浮层面板：顶部搜索框、分类标签、下方模板预览卡网格。模板预览用 SVG data URL（`toSvgPreviewDataUrl`，`:31`）。选中模板即 `createTemplateJob('template')` 并 `insertTemplate`，插完切回 `DefaultTool`。它还用 `EdgelessDraggableElementController` 支持**把模板卡直接拖到画布**落位。

## 4. 语法特色

- **中间件模式（函数式插件）**：`(job) => void` + `job.slots.beforeInsert` 订阅，把"插入前改写"做成可插拔的一串中间件——按需组合（template 一套、sticker 另一套），与 connector/surface 的 middleware 思想一致。
- **rxjs `Subject` 作插入事件总线**：`beforeInsert` 发 `{type:'template'}`（整体信号）与 `{type:'block'}`（逐块信号）两种 payload，中间件按 `payload.type` 分别响应。
- **判别联合 payload**：`SlotPayload = SlotBlockPayload | {type:'template', ...}`（`:63`）用 `type` 判别，TS 自动收窄。
- **`as const` 常量元组 + 索引类型**：`DEFERED_BLOCK`/`MERGE_BLOCK`/`TEMPLATE_TYPES` 用 `as const` 锁成字面量元组，再 `(typeof X)[number]` 导出联合类型——单一真相、类型与值同源。
- **zod 运行时校验**：`DocSnapshotSchema.parse` 在插入前验证外部模板数据，弥补 TS 类型擦除后的运行时缺口。
- **`assertType<T>`**：对动态 JSON 字段（connector 的 source/target、frame 的 childElementIds）用 `assertType` 断言形状，便于类型安全地改写。
- **递归 `walk`**：`TemplateJob.walk`（`:367`）递归遍历快照树，供 bound 计算与 index 收集复用。
- **延后队列**：用 `deferInserting`/`defered` 数组把"依赖其它 id 的块"推后处理——拓扑排序的朴素实现。

## 5. 设计 / 实现亮点

- **ID 重生成 + 引用重映射一站式**：`replaceIdMiddleware` 把块 id、图元 id、connector 端点、group 成员、frame 成员、surface-ref 引用全部重映射，保证插入内容既不撞车又内部自洽——这是"把一份文档并入另一份"最硬的骨头。
- **合并 vs 新增 vs 延后的清晰分类**：用 `MERGE_BLOCK`/`DEFERED_BLOCK` 两张表把容器合并、引用延后表达得一目了然，插入顺序正确。
- **摆放与层级自动化**：模板自动落到现有内容旁的空白、z-order 重排到顶层，用户插入即见、不覆盖已有内容。
- **template/sticker 两形态复用同一引擎**：同一个 `TemplateJob` + 中间件组合，既能插整份白板也能贴单图，差异只在中间件装配。
- **工具极简、逻辑内聚**：`TemplateTool` 空壳、真正逻辑全在可独立测试的 `TemplateJob`/中间件里，关注点分离彻底。

## 6. 对外 API 与注意事项

- 主要导出：`TemplateJob`/`createTemplateJob`、`TemplateTool`、`EdgelessTemplatePanel`、`templateSeniorTool`、`Template` 类型；`./view` 的 `TemplateViewExtension`。
- **必须有 surface**：`createTemplateJob` 在非白板文档（无 surface）会抛 `NoSurfaceModelError`。
- **模板数据须符合 `DocSnapshot`**：`insertTemplate` 会 `DocSnapshotSchema.parse` 校验，结构不合法直接报错。
- **插入必经 `replaceId`**：任何插入都要重生成 id，否则会与现有内容冲突；自定义中间件不要移除它。
- **`template` vs `sticker` 行为不同**：template 整体插到旁边空白并重排层级；sticker 把单图居中。类型传错会用错中间件。
- **surface/page 合并、frame/surface-ref 延后**：理解这套规则才能正确扩展模板支持的块类型；新增"引用了别的 id"的块需加进 `DEFERED_BLOCK` 并在 `replaceId` 里补重映射。
- **连接线/分组的 xywh 会被丢弃**：插入时它们的几何由成员派生，中间件会 `delete xywh`——不要依赖模板里这些字段。

## 7. 延伸

- 基础设施：`@blocksuite/std/gfx` 的 `BaseTool`/`GfxControllerIdentifier`、`@blocksuite/store` 的 `Transformer`/`DocSnapshot`/`DocSnapshotSchema`。
- 画布层：`@blocksuite/affine-block-surface` 的 `SurfaceBlockModel`/`SurfaceBlockTransformer`/`getSurfaceBlock`/`generateElementId`/`sortIndex`。
- 受影响的图元：`connector`（source/target 重映射）、`group`（children 重映射）、frame（childElementIds）、surface-ref（reference）——模板插入正确性强依赖对这些引用结构的理解。
- 工具栏：`@blocksuite/affine-widget-edgeless-toolbar`（`SeniorToolExtension`/`EdgelessDraggableElementController`）。
