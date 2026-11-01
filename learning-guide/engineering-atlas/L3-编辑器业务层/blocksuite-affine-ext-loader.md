# `@blocksuite/affine-ext-loader`

> 本包是重点包，运行机制、关键流程和易错点见 [重点包精讲](../重点包精讲/12-扩展装配.md)。

> 一句话定位：BlockSuite/AFFiNE 编辑器的**扩展装载机**——用一组 `ViewExtensionProvider` / `StoreExtensionProvider` 声明"在某个场景（page / edgeless / store…）下需要哪些扩展"，再由 `ViewExtensionManager` / `StoreExtensionManager` 按 scope 把它们**组合**成一份可注入 DI 容器的 `ExtensionType[]`。它是"编辑器能力按环境拼装"的总开关。

| 项        | 值                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 目录      | `blocksuite/affine/ext-loader`                                                                                         |
| 所属层    | L3 · 编辑器业务层（基座）                                                                                              |
| 语言/形态 | TypeScript 库                                                                                                          |
| 关键依赖  | `@blocksuite/global`（DI/异常）、`@blocksuite/store`（`ExtensionType`）、`zod`                                         |
| 被谁依赖  | `@blocksuite/affine-foundation` 及所有 `affine-block-*` 包（每个块都导出一个 `XxxViewExtension`）、编辑器装配层        |
| 对外入口  | `.`（`ViewExtensionProvider`/`ViewExtensionManager`/`StoreExtensionProvider`/`StoreExtensionManager` 及其 Identifier） |

## 1. 设计逻辑

AFFiNE 的编辑器不是"一套固定功能"，而是**同一批块能力在不同环境下的不同组合**：

- 同一个段落块，在 `page`（文档流）、`edgeless`（白板画布）、`mobile-page`（移动端）、`preview-page`（只读预览）下需要注册的交互、工具栏、拖拽能力并不一样；
- `store` 层（纯数据，不含 UI）又需要另一套扩展（schema、selection、adapter）。

如果让每个块自己写 `if (mode === 'edgeless') ...` 散落各处，装配逻辑会彻底失控。`ext-loader` 的立场是：**把"场景 → 扩展集合"的映射收敛成一个声明式、可缓存、可配置、类型安全的装载管线**。

三层核心抽象：

1. **Provider（`BaseExtensionProvider`）**：一个"能力包作者"的声明单元。它实现 `setup(context, options)`，在里面根据 `context.scope` 调 `context.register([...])` 注册扩展。每个 affine 块包都导出一个 `ViewExtensionProvider` 子类。
2. **Context**：传给 provider 的运行时上下文，携带当前 `scope` 和链式 `register` 函数。
3. **Manager（`ExtensionManager`）**：持有一组 provider 类，`get(scope)` 时依次实例化并 `setup`，把所有 register 进来的扩展汇成 `ExtensionType[]` 返回，交给 DI 容器 `setup`。

与同层 `@blocksuite/affine-foundation` 的边界：`ext-loader` 只提供**机制**（装载框架本身），`foundation` 等包提供**内容**（具体的 `FoundationViewExtension` / `FoundationStoreExtension` 实例）。

## 2. 目录与关键文件

```text
src/
├── base-provider.ts    # BaseExtensionProvider<Scope, Options>：所有 provider 的基类；Context/Empty 类型
├── manager.ts          # ExtensionManager<Scope>：provider 注册表 + 按 scope 构建/缓存/配置
├── view-provider.ts    # ViewExtensionProvider：视图场景 provider；ViewScope 六种枚举；effect() 一次性副作用
├── view-manager.ts     # ViewExtensionManager + ViewExtensionManagerIdentifier（可被 DI 注入）
├── store-provider.ts   # StoreExtensionProvider：scope 固定为 'store'
├── store-manager.ts    # StoreExtensionManager + StoreExtensionManagerIdentifier
├── index.ts            # 汇总导出
└── __tests__/ext-loader.unit.spec.ts  # 行为规格：多 scope、缓存、schema 校验、effect 一次性
```

## 3. 实现细节

### 3.1 Provider：声明"某 scope 要什么扩展"

`BaseExtensionProvider` 只有两样东西：一个 `schema`（zod，用于校验 options）和一个 `setup`。`setup` 默认只做一件事——如果传了 options 就用 schema 校验：

```ts
// base-provider.ts:63-67
setup(_context: Context<Scope>, option?: Options) {
  if (option) {
    this.schema.parse(option);
  }
}
```

子类覆写 `setup`，先 `super.setup(context, options)` 完成校验，再按 scope 分流注册。`view-provider.ts:28-54` 的文档示例清楚展示了这个模式：

```ts
override setup(context: ViewExtensionContext, options?: { theme: string }) {
  super.setup(context, options);
  context.register([CommonExt]);
  if (context.scope === 'page') context.register([PageExt]);
  else if (context.scope === 'edgeless') context.register([EdgelessExt]);
  if (options?.theme === 'dark') context.register([DarkModeExt]);
}
```

### 3.2 Context：链式 register 与 scope 闭包

Context 由 Manager 针对每个 scope 现场构造（`manager.ts:77-86`），`register` 是一个闭包，把扩展塞进该 scope 对应的 `Set`，并返回 `context` 自身以支持链式：

```ts
// manager.ts:77-86
private readonly _getContextByScope = (scope: Scope): Context<Scope> => {
  const context: Context<Scope> = {
    scope,
    register: (extensions) => {
      this._registerToScope(scope, extensions);
      return context;   // 链式
    },
  };
  return context;
};
```

用 `Set`（`manager.ts:59-73`）而非数组承接，天然去重——同一个扩展被多个 provider 重复注册也只保留一份。

### 3.3 Manager：构建、缓存与"配置即重建"

`ExtensionManager` 内部维护四张表（`manager.ts:15-27`）：

| 字段                                               | 作用                         |
| -------------------------------------------------- | ---------------------------- |
| `_extensions: Map<scope, Set<Ext>>`                | 每个 scope 已汇集的扩展      |
| `_providers: Set<ProviderClass>`                   | 构造时传入的 provider 类清单 |
| `_providerOptions: Map<ProviderClass, object>`     | 每个 provider 的配置         |
| `_providerInstances: Map<ProviderClass, instance>` | provider 实例缓存            |

`get(scope)` 是核心（`manager.ts:96-109`）：先清掉该 scope 的旧结果，再 `_build(scope)` 遍历所有 provider——**实例不存在才 new，否则复用缓存**（`manager.ts:42-51`），然后对每个实例调 `setup(context, options)`。最后把 `Set` 转数组返回；scope 不存在则抛 `BlockSuiteError(ValueNotExists)`。

`configure(provider, options)`（`manager.ts:120-145`）是精巧的一环：它既支持直接给值，也支持 `(prev) => next` 的函数式更新；更新完成后**删除该 provider 的实例缓存**（`manager.ts:144`），从而保证下次 `get` 会用新配置重新 `setup`——这就是"配置变更即重建"的实现。若新旧配置引用相等（`prev === config`）则直接短路，不触发重建。

### 3.4 ViewExtensionProvider：六种 scope 与 effect 一次性

`ViewScope` 把"视图环境"枚举成六种（`view-provider.ts:11-17`）：`page` / `edgeless` / `preview-page` / `preview-edgeless` / `mobile-page` / `mobile-edgeless`，并配了三个便捷判定 `isEdgeless` / `isPreview` / `isMobile`（`view-provider.ts:89-113`）供 provider 内部分流。

最值得学的是 `effect()` 的"每个 provider 类只跑一次"机制。像"注册自定义元素 `customElements.define`""只能执行一次，否则抛错。它用**类上的静态标志**来守护（`view-provider.ts:67,115-122`）：

```ts
static effectRan = false;

override setup(context: ViewExtensionContext, options?: Options) {
  super.setup(context, options);
  const constructor = this.constructor as typeof ViewExtensionProvider;
  if (!constructor.effectRan) {
    constructor.effectRan = true;
    this.effect();
  }
}
```

`this.constructor` 取到的是**具体子类**的构造函数，因此每个子类各有独立的 `effectRan`，互不影响（测试 `ext-loader.unit.spec.ts:178-229` 专门验证了 `ViewExt1.effectRan` 为 true 时 `ViewExt2.effectRan` 仍为 false）。

### 3.5 Manager 自注入：让扩展能反向拿到 Manager

`ViewExtensionManager.get` 覆写父类，在返回的扩展列表尾部追加一个"自注册扩展"（`view-manager.ts:40-48`）：

```ts
override get(scope: ViewScope) {
  const extensions = super.get(scope);
  const selfExtension: ExtensionType = {
    setup: di => { di.addImpl(ViewExtensionManagerIdentifier, () => this); },
  };
  return extensions.concat(selfExtension);
}
```

于是任何注入了 `ViewExtensionManagerIdentifier` 的运行时代码，都能拿到装配自己的那个 Manager（例如切换 scope 重新取扩展）。`StoreExtensionManager` 同理（`store-manager.ts:38-46`）。测试 `ext-loader.unit.spec.ts:159-176` 验证了注入链路可用。

## 4. 语法特色

- **双泛型基类 + 默认类型参数**：`BaseExtensionProvider<Scope extends string, Options extends object = Empty>`（`base-provider.ts:46-49`）。`Scope` 用 `extends string` 约束成字符串字面量联合，`Options` 默认空对象 `Empty = {}`，使不需要配置的 provider 可以零参书写。
- **`typeof Class` 作为 Map 键**：Manager 用 `typeof BaseExtensionProvider<Scope>`（即构造函数类型，`manager.ts:17-27`）作键存 provider 类与实例，实现"用类当 token"。
- **`this.constructor as typeof ViewExtensionProvider`**：运行时拿到具体子类的静态面，配合 `static effectRan` 实现"每个子类一次性"——TS 里访问实例的静态成员必须经由 `this.constructor` 并做类型断言。
- **函数式更新的联合参数**：`configure` 的 `options: ((prev: T | undefined) => T | undefined) | T | undefined`（`manager.ts:122`），用 `typeof options === 'function'` 在运行时分派两种形态。
- **zod 作运行时校验**：`schema: ZodSchema = z.object({})`（`base-provider.ts:54`），弥补 TS 类型擦除后的运行时空缺——options 来自外部装配，必须运行时校验。
- **结构化 `ExtensionType` 字面量**：自注册扩展直接写成 `{ setup: di => {...} }`（`view-manager.ts:42-46`），说明 `ExtensionType` 是鸭子类型接口而非必须继承的类。

## 5. 设计 / 实现亮点

- **机制与内容彻底分离**：`ext-loader` 不含任何具体能力，只定义"怎么装"；具体"装什么"全部外置到各块包的 provider。新增一个块＝新增一个 provider 类并加入 Manager 的构造参数，零侵入。
- **scope 驱动的多环境复用**：同一批 provider，`get('page')` 与 `get('edgeless')` 产出不同扩展集，一次声明覆盖 PC/移动端/预览六种环境，避免条件分支外溢。
- **实例缓存 + 配置即重建**：`get` 多次调用不会重复 new provider（测试验证构造函数只被调一次；`setup` 每次 `get` 仍会执行），而 `configure` 通过"删缓存"优雅触发精确重建——没有引入脏标记或事件总线。
- **effect 一次性守护**：用类静态标志解决"全局副作用（定义自定义元素）只能跑一次"的经典难题，比模块级布尔更贴合"按 provider 类"的粒度。
- **Manager 自注入闭环**：装载产物里塞入 Manager 自身，打通"运行时反查装载器"的能力，支撑动态换 scope 场景。

## 6. 对外 API 与注意事项

- 主要导出：`ViewExtensionProvider` / `ViewExtensionManager` / `ViewExtensionManagerIdentifier` / `ViewScope` / `ViewExtensionContext`，`StoreExtensionProvider` / `StoreExtensionManager` / `StoreExtensionManagerIdentifier` / `StoreExtensionContext`；通用底座 `BaseExtensionProvider` / `ExtensionManager` 不从 `index.ts` 导出。
- **约定**：provider 子类覆写 `setup` 时**必须先 `super.setup(context, options)`**，否则 schema 校验与 effect 守护都不会触发。
- **注意**：`get(scope)` 对未知 scope 会抛 `BlockSuiteError`，而非返回空数组；`effect()` 内放"全局只应执行一次"的副作用（如 `customElements.define`），不要放依赖 scope 的逻辑——它只跑一次且与 scope 无关。
- `configure` 传入与上次**引用相等**的对象不会触发重建；要强制重建需传新对象或函数式更新。

## 7. 延伸

- 同层内容提供方：`@blocksuite/affine-foundation`（`FoundationViewExtension` / `FoundationStoreExtension`，见 `foundation/src/view.ts`、`store.ts`）、各 `affine-block-*` 块包。
- 底层依赖：`@blocksuite/global` 的 `createIdentifier`（DI 标识符）、`@blocksuite/store` 的 `ExtensionType`。
- 对照：L1 `@toeverything/infra` 的 `Framework`——两者都是 DI 装配思路，但 infra 面向前端业务模块的作用域化 DI，ext-loader 面向编辑器"块能力按视图环境组合"。
