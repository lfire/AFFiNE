# `@blocksuite/affine-model`

> 一句话定位：AFFiNE 编辑器**所有块与画布元素的数据模型中心**——用 `defineBlockSchema` 定义每种块（paragraph/list/note/database/embed…）的 flavour、props 与父子约束，用 `@field`/`@local` 装饰器定义画布元素（shape/connector/brush…），并集中托管 `DocMode`、主题色、各类几何/枚举常量与对应的 zod schema。它是整个编辑器的"数据词典"。

| 项        | 值                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `blocksuite/affine/model`                                                                                                                                                                              |
| 所属层    | L3 · 编辑器业务层（基座）                                                                                                                                                                              |
| 语言/形态 | TypeScript 库（纯数据，无 UI）                                                                                                                                                                         |
| 关键依赖  | `@blocksuite/store`（`BlockModel`/`defineBlockSchema`）、`@blocksuite/std/gfx`（`GfxPrimitiveElementModel`/`field`）、`@blocksuite/global`、`@toeverything/theme`、`yjs`、`zod`、`fractional-indexing` |
| 被谁依赖  | 几乎所有上层包：`affine-shared`、`affine-rich-text`、各 `affine-block-*`、`data-view`                                                                                                                  |
| 对外入口  | `.`（blocks + consts + elements + themes + utils 全量）                                                                                                                                                |

## 1. 设计逻辑

编辑器里"数据"与"渲染/交互"必须分离：数据模型要能脱离 UI 独立存在（用于协同、序列化、剪贴板、AI 读写），渲染层只是数据的投影。AFFiNE 把**全部模型定义集中到一个包**，而不是散落在各块包里，原因有三：

1. **避免循环依赖**：块 A 的工具栏可能要引用块 B 的模型类型（如 `embed` 要引用 `surface` 元素）。若模型跟着各自的块包走，极易形成环。集中到 `affine-model` 后，所有包都单向依赖它。
2. **单一事实来源**：`DocMode`、`EmbedCardStyle`、主题色、几何常量这些跨块共享的定义只有一处，杜绝漂移。
3. **双形态建模**：BlockSuite 有两类"模型"——**块模型**（文档流里的 `BlockModel`，树形父子）与**画布元素模型**（edgeless 里的 `GfxPrimitiveElementModel`，自由坐标）。本包同时承载两者，并通过 `GfxCompatible` 让部分块（note/embed）也能出现在画布上。

与同层边界：`affine-model` 只定义"数据长什么样"；"怎么操作数据"（命令）在 `affine-shared/commands`，"怎么渲染"在各 `affine-block-*`。

## 2. 目录与关键文件

```text
src/
├── index.ts                 # 汇总导出 blocks / consts / elements / themes / utils
├── blocks/                  # 文档流块模型（每种一个子目录）
│   ├── paragraph/paragraph-model.ts   # ParagraphBlockSchema + ParagraphBlockModel
│   ├── list/list-model.ts             # ListBlockSchema（bulleted/numbered/todo）
│   ├── note/note-model.ts             # NoteBlockSchema（GfxCompatible，跨文档/画布）
│   ├── root/ database/ code/ image/ attachment/ bookmark/
│   ├── embed/ latex/ frame/ divider/ callout/ table/ edgeless-text/ surface-ref/
├── elements/                # 画布元素模型（GfxPrimitiveElementModel 子类）
│   ├── shape/shape.ts        # ShapeElementModel + LocalShapeElementModel
│   ├── connector/ brush/ group/ mindmap/ highlighter/ text/
│   └── index.ts              # SurfaceElementModelMap / SurfaceTextModelMap 类型映射
├── consts/                  # 跨块常量 + zod schema
│   ├── doc.ts                # DocMode/DocModes、ReferenceInfo、FootNote 等
│   ├── note.ts text.ts shape.ts connector.ts line.ts mindmap.ts ...
├── themes/                  # 默认主题色 DefaultTheme / Color / ColorSchema
└── utils/                   # types.ts（BlockMeta/EmbedCardStyle）、helper.ts（defineEmbedModel）、enum.ts
```

## 3. 实现细节

### 3.1 块模型：defineBlockSchema 三件套

每种块都遵循同一模式——schema、schema extension、model 类。以段落为例（`blocks/paragraph/paragraph-model.ts:29-65`）：

```ts
export const ParagraphBlockSchema = defineBlockSchema({
  flavour: 'affine:paragraph',
  props: (internal): ParagraphProps => ({
    type: 'text',
    text: internal.Text(),          // 用 internal 原语创建可协同的 Y.Text
    collapsed: false,
    // ...BlockMeta: 'meta:createdAt' 等审计字段
  }),
  metadata: {
    version: 1,
    role: 'content',
    parent: ['affine:note', 'affine:database', 'affine:paragraph', ...],
  },
  toModel: () => new ParagraphBlockModel(),
});
export const ParagraphBlockSchemaExtension = BlockSchemaExtension(ParagraphBlockSchema);
export class ParagraphBlockModel extends BlockModel<ParagraphProps> {
  override isEmpty(): boolean {
    return this.props.text$.value.length === 0 && this.children.length === 0;
  }
}
```

关键点：

- `props(internal)` 用传入的 `InternalPrimitives` 创建 `Text()`（Yjs 支撑的协同文本），保证属性默认值是"可协同"的。
- `metadata.role`（`content`/`hub`/`root`…）与 `metadata.parent`/`children` 共同声明**块树的结构约束**——哪些块能作为谁的父/子。段落可挂在 note、database、list、callout 等之下。
- `BlockSchemaExtension(...)` 把 schema 包成一个可注册进 DI/store 的 `ExtensionType`，供上层装配。
- model 类只覆写**纯数据行为**（如 `isEmpty`），不碰渲染。

列表块（`list-model.ts`）结构相同，`ListType = 'bulleted' | 'numbered' | 'todo' | 'toggle'`（`:12`，注释标明 `toggle` 已废弃），多了 `checked`/`order` 等属性。

### 3.2 跨文档/画布的块：GfxCompatible 混入

note 既出现在文档流、又能放到 edgeless 画布，因此它的 props 混入了 `GfxCompatibleProps`（坐标 `xywh`、`index`、`rotate`、`lockedBySelf`），model 类则用 `GfxCompatible(BlockModel)` 混入几何能力（`blocks/note/note-model.ts:119-122`）：

```ts
export class NoteBlockModel
  extends GfxCompatible<NoteProps>(BlockModel)
  implements GfxElementGeometry
{
  override includesPoint(x, y): boolean {
    if (!this._isSelectable()) return false;
    const bound = Bound.deserialize(this.xywh);
    return bound.isPointInBound([x, y], 0);
  }
  // ...containsBound / intersectsBound 按 displayMode 判定是否可选中
}
```

`GfxCompatible<Props>(SuperClass)` 是一个**类混入工厂**：接收一个基类、返回带几何能力的新类。`utils/helper.ts:19-26` 把它进一步封装成 `defineEmbedModel`，供所有 embed 块复用。

### 3.3 画布元素：@field / @local / @prop 装饰器

画布元素不走 `BlockModel` 那套树形结构，而是继承 `GfxPrimitiveElementModel`，用**访问器装饰器**声明属性。shape（`elements/shape/shape.ts:57-186`）节选：

```ts
export class ShapeElementModel extends GfxPrimitiveElementModel<ShapeProps> {
  get type() {
    return 'shape';
  }

  @field(DefaultTheme.shapeTextColor)
  accessor color!: Color; // @field：参与 Yjs 同步的持久属性

  @field()
  accessor shapeType: ShapeType = ShapeType.Rect;

  @local()
  accessor textDisplay: boolean = true; // @local：仅本地、不同步
}
```

- `@field(defaultValue)` 声明**会被序列化并协同同步**的属性；`@local()` 声明**仅本地内存**的属性（如临时显示态）。
- 用 TS 的 `accessor` 关键字（Stage-3 装饰器的自动访问器），装饰器据此织入 getter/setter，把读写转发到底层 Yjs 数据。
- `static propsToY(props)`（`:67-73`）定义"普通 props → Yjs 结构"的转换（如把字符串 text 转成 `Y.Text`）。
- 同时还有 `LocalShapeElementModel extends GfxLocalElementModel`（`:188-260`），用 `@prop()` 声明属性——这是**不入库的纯本地元素**（如预览、临时绘制），与协同版共享字段但各自独立。

`elements/index.ts` 用两张类型映射表把 `type` 字符串关联到具体模型类：

```ts
export type SurfaceElementModelMap = {
  shape: ShapeElementModel; connector: ConnectorElementModel;
  brush: BrushElementModel; group: GroupElementModel; ...
};
```

### 3.4 consts：常量与 zod schema 并存

`consts/doc.ts` 是跨块常量的典型。它既导出字面量元组又导出类型，还为需要运行时校验的结构配 zod schema：

```ts
// consts/doc.ts:4-6, 38-59
export type DocMode = 'edgeless' | 'page';
export const DocModes = ['edgeless', 'page'] as const;

export const ReferenceParamsSchema = z
  .object({
    mode: z.enum(DocModes),
    blockIds: z.string().array(),
    // ...
  })
  .partial();
export type ReferenceParams = z.infer<typeof ReferenceParamsSchema>;
```

`SerializedXYWHSchema`（`:30-36`）用 `z.custom` 配正则校验 `[x,y,w,h]` 字符串格式——这类数据来自剪贴板/链接参数等外部输入，必须运行时兜底。note 模型同样用 `NoteZodSchema`（`note-model.ts:29-53`）给出带 `.default(...)` 的完整校验结构。

## 4. 语法特色

- **Stage-3 访问器装饰器 + `accessor`**：`@field()/@local()/@prop() accessor xxx`（`elements/shape/shape.ts`）是 TC39 装饰器提案的自动访问器写法，装饰器返回新的 get/set 把属性接到 Yjs。`accessor color!: Color` 的 `!` 断言"由装饰器初始化"。
- **类混入工厂（mixin）**：`GfxCompatible<Props>(BlockModel)`、`defineEmbedModel(Super)`（`utils/helper.ts:19-26`）用"函数接收类、返回子类"的高阶类模式，给块按需叠加几何能力——TS 里用 `Constructor<T>` 泛型约束表达。
- **`as const` 字面量元组 + `z.enum`**：`DocModes = [...] as const` 既做运行时常量，又能 `z.enum(DocModes)` 派生校验器，再 `z.infer` 回类型——一份定义贯穿值/校验/类型三态。
- **交叉类型组合 props**：`ParagraphProps = {...} & BlockMeta`、`ShapeProps = BaseElementProps & {...} & Partial<TextStyleProps>`（`shape.ts:35-52`），用 `&` 把审计字段、文本样式等可复用片段拼进每种块/元素。
- **`z.infer<typeof Schema>`**：大量类型直接从 zod schema 反推（`consts/doc.ts` 的 `ReferenceInfo`/`FootNote`），schema 是唯一事实来源。
- **`Exclude` 条件类型**：`Connectable = Exclude<GfxModel, ConnectorElementModel | BrushElementModel | GroupElementModel>`（`utils/types.ts:34-37`），用类型运算表达"可被连线连接的元素"。

## 5. 设计 / 实现亮点

- **模型集中、依赖单向**：把全部模型抽到一个无 UI 的包，从根上消除块之间的循环依赖，是大型块化编辑器能长期演进的结构性前提。
- **块模型与画布元素双体系统一**：同一个包用 `defineBlockSchema`（树形块）与 `GfxPrimitiveElementModel`+装饰器（坐标元素）两套机制，并用 `GfxCompatible` 把 note/embed 这类"两栖块"桥接到画布——罕见但必要的双形态建模。
- **协同优先的默认值**：`props(internal)` 强制用 `internal.Text()` 等原语构造默认值，保证新建块天然可协同、可 undo，而非事后包装。
- **结构约束即数据**：`metadata.parent/children/role` 把"块树合法性"声明成数据，由 store 统一校验，避免散落在各处的 if 判断。
- **值/校验/类型三位一体**：`as const` 元组 + zod + `z.infer` 的组合，使外部输入（链接参数、剪贴板、导入）在运行时有校验、在编译期有类型，覆盖类型擦除的盲区。

## 6. 对外 API 与注意事项

- 主要导出：各块的 `XxxBlockSchema` / `XxxBlockSchemaExtension` / `XxxBlockModel`、各画布元素 `XxxElementModel` / `LocalXxxElementModel`、`DocMode`/`DocModes`、`EmbedCardStyle`/`EMBED_CARD_WIDTH`、`DefaultTheme`/`Color`/`ColorSchema`、`defineEmbedModel`、各 zod schema。
- **约定**：新增块＝新建 `blocks/xxx/xxx-model.ts`，定义 schema（含 flavour/props/metadata/toModel）+ `BlockSchemaExtension` + model 类，并在 `blocks/index.ts` 导出；上层通过 schema extension 注册进 store。
- **注意**：`@field` 属性会同步给协同端、`@local`/`@prop(本地元素)` 不会，放错会导致"该同步的没同步/不该同步的污染文档"；`props.text$` 等 `$` 字段是 Signal，取值用 `.value`；`xywh` 存储为字符串 `[x,y,w,h]`，用 `Bound.deserialize` 解析；带 `@deprecated` 标注的字段（如 note 的 `hidden`、list 的 `toggle`）不要在新代码里使用。

## 7. 延伸

- 直接消费方：`@blocksuite/affine-shared`（`consts` 复用 EmbedCardStyle、`types` 复用 ReferenceInfo/FootNote）、`@blocksuite/affine-rich-text`（引用 `DatabaseBlockModel` 等）、各 `affine-block-*`。
- 底层：`@blocksuite/store`（`BlockModel`/`defineBlockSchema`/`Text`）、`@blocksuite/std/gfx`（`GfxPrimitiveElementModel`/`field`/`local`）。
- 相关：`data-view` 的 `ColumnDataType` 与 database 块模型配合；主题来自 `@toeverything/theme`。
