# `@affine/error`

> 一句话定位：AFFiNE 前端的**统一错误门面**——把后端通过 GraphQL 返回的结构化"用户友好错误"（`UserFriendlyError`）、网络层异常、以及各种来路不明的 `throw`，全部归一成同一个带 `status/code/type/name/message` 的 `UserFriendlyError` 实例，供上层做类型化的错误判定与提示。

| 项        | 值                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------- |
| 目录      | `packages/common/error`                                                                         |
| 所属层    | L1 · 通用基础设施                                                                               |
| 语言/形态 | TypeScript 库（单入口，仅 110 行）                                                              |
| 关键依赖  | peer：`@affine/graphql`（提供 `ErrorNames`/`ErrorDataUnion`）、`graphql`（`GraphQLError` 基类） |
| 被谁依赖  | `@affine/core` 的错误处理、GraphQL 请求层、各业务模块的 `catch` 分支                            |
| 对外入口  | `.`（`UserFriendlyError`、`GraphQLError`、`ErrorName`、`ErrorData`）                            |

## 1. 设计逻辑

前端的错误来源五花八门：后端 GraphQL 返回的业务错误（带结构化 `extensions`）、`fetch` 抛的网络错误、请求被取消、服务端版本不兼容、还有各种代码里随手 `throw` 的字符串或 `Error`。如果每个 `catch` 都自己判断"这是什么错、给用户看什么、能不能重试"，错误处理会迅速失控。

`@affine/error` 的立场是：**前端只认一种错误类型 `UserFriendlyError`**。无论原始异常长什么样，都先经 `UserFriendlyError.fromAny()` 归一，之后上层只需面对一个结构稳定、字段齐全、可按 `name` 精确判定的对象。

更关键的是，这个前端错误模型**不是凭空设计的，而是后端错误契约的镜像**。AFFiNE 后端在 `packages/backend/server/src/base/error/def.ts` 里用一张 `USER_FRIENDLY_ERRORS` 表集中定义了所有业务错误（类型、HTTP 状态、文案、附加数据的形状）。这张表经代码生成，产出 GraphQL schema 里的 `enum ErrorNames` 与 `union ErrorDataUnion`；这些又被 `@affine/graphql` 的 codegen 同步成前端 TS 类型。`@affine/error` 正是在这些生成类型之上，补齐前端独有的几种错误名、并给出归一与判定逻辑。于是**后端一处定义，前后端类型自动对齐**——后端新增一个错误码，前端的 `ErrorName` 联合类型会自动多出一项。

**为何单独成包**：错误处理是贯穿全前端的横切关注点，且它恰好横跨 `@affine/graphql`（类型来源）与所有业务模块（使用方）。独立成包可以用 `peerDependencies` 优雅处理对 graphql 的依赖（见第 6 章），同时保持自身极小。

## 2. 目录与关键文件

```text
packages/common/error/
├── package.json        # peer: @affine/graphql + graphql；单入口 "."
└── src/
    └── index.ts        # 全部实现（110 行）：类型 + GraphQLError + UserFriendlyError
```

与之呼应的两处外部文件（本包不含，但强相关）：

```text
packages/backend/server/src/base/error/def.ts   # 后端真值源：USER_FRIENDLY_ERRORS 表 + 代码生成器
packages/common/graphql/src/schema.ts            # codegen 产物：enum ErrorNames / type ErrorDataUnion
```

## 3. 实现细节

### 3.1 错误契约的统一形状

所有错误最终都实现 `UserFriendlyErrorResponse` 接口——它正是后端错误序列化到 GraphQL `extensions` 里的形状：

```ts
// 来源：packages/common/error/src/index.ts:11
export interface UserFriendlyErrorResponse {
  status: number; // HTTP 状态码
  code: string; // 如 'INTERNAL_SERVER_ERROR'
  type: string; // 业务类别，如 'resource_already_exists'
  name: ErrorName; // 具体错误名（联合类型，见下）
  message: string;
  data?: any; // 结构化附加数据
  stacktrace?: string;
}
```

`ErrorName` 把**后端生成的错误名**与**前端独有的错误名**合并：

```ts
// 来源：packages/common/error/src/index.ts:4
export type ErrorName =
  | keyof typeof ErrorNames // 来自 @affine/graphql（源自后端 USER_FRIENDLY_ERRORS）
  | 'NETWORK_ERROR'
  | 'CONTENT_TOO_LARGE'
  | 'REQUEST_ABORTED'
  | 'UNSUPPORTED_SERVER_VERSION'; // 这四个只在前端发生，后端没有
```

这体现了边界的精确划分：绝大多数错误由后端定义、前端继承；但"网络不通""请求被取消""内容过大""服务端版本太旧"这几种**天生发生在前端/传输层**的错误，后端不可能知道，于是在此补齐。

### 3.2 `ErrorData`：用映射类型把"错误名"连到"附加数据的形状"

每种错误可能携带不同形状的 `data`（如 `BlobNotFound` 带 blobId、`DocActionDenied` 带角色信息）。后端为每种带参错误生成了一个 `XxxDataType`，汇成 `ErrorDataUnion`。前端用一个映射类型把"错误名 → 对应 data 类型"关联起来：

```ts
// 来源：packages/common/error/src/index.ts:31
type ToPascalCase<S extends string> = S extends `${infer A}_${infer B}`
  ? `${Capitalize<Lowercase<A>>}${ToPascalCase<B>}`
  : Capitalize<Lowercase<S>>;

export type ErrorData = {
  [K in ErrorNames]: Extract<
    ErrorDataUnion,
    { __typename?: `${ToPascalCase<K>}DataType` } // 把 BLOB_NOT_FOUND 拼成 BlobNotFoundDataType 再筛出
  >;
};
```

`ToPascalCase` 是一个**递归的模板字面量类型**：把 `BLOB_NOT_FOUND` 这样的大写下划线命名，在类型层面转换为 `BlobNotFound`，再拼上 `DataType` 后缀，用 `Extract` 从联合里精确筛出对应的数据类型。这样 `ErrorData['BLOB_NOT_FOUND']` 就能精确推断出该错误的 data 形状——**类型完全自动派生自后端契约，零手工维护**。

### 3.3 `GraphQLError`：收窄 `extensions` 的类型

GraphQL 规范里 `extensions` 是任意对象。AFFiNE 继承 `graphql` 库的 `GraphQLError`，把它收窄为已知形状：

```ts
// 来源：packages/common/error/src/index.ts:42
export class GraphQLError extends BaseGraphQLError {
  // @ts-expect-error better to be a known type without any type casting
  override extensions!: UserFriendlyErrorResponse;
}
```

`@ts-expect-error` 是有意为之——基类把 `extensions` 声明为更宽的类型，这里故意用更窄的类型覆盖它，换取"读 `error.extensions.name` 无需任何 `as` 断言"的便利。注释直言"宁可要一个已知类型，也不要到处类型转换"。

### 3.4 `fromAny`：一切异常的归一入口

核心价值在这个静态工厂。它穷举各种"原始异常"的可能形态，统一产出 `UserFriendlyError`：

```ts
// 来源：packages/common/error/src/index.ts:59
static fromAny(anything: any) {
  if (anything instanceof UserFriendlyError) return anything;   // 已是目标类型，幂等

  switch (typeof anything) {
    case 'string':
      return UnknownError(anything);                            // 裸字符串 → 包装成 500
    case 'object': {
      if (anything) {
        if (anything instanceof GraphQLError) {
          return new UserFriendlyError(anything.extensions);    // GraphQL 错误 → 取 extensions
        } else if (anything.type && anything.name && anything.message) {
          return new UserFriendlyError(anything);               // 鸭子类型：已符合响应形状
        } else if (anything.message) {
          return UnknownError(anything.message);                // 普通 Error → 保留 message
        }
      }
    }
  }
  return UnknownError('Unhandled error raised. Please contact us for help.');  // 兜底
}
```

设计上的讲究：

- **幂等**：已是 `UserFriendlyError` 直接返回，可安全多次调用。
- **鸭子类型识别**（`anything.type && anything.name && anything.message`）：即便对象不是 `GraphQLError` 实例（比如跨 worker 结构化克隆后丢失了原型链），只要字段齐全就按响应处理——这对跨线程/序列化场景很关键。
- **层层降级**：GraphQL 错误 → 符合形状的对象 → 有 message 的任意对象 → 最终兜底文案，确保**任何输入都不会让归一本身抛异常**。
- 未知错误统一包成 `UnknownError`（`500 / INTERNAL_SERVER_ERROR`）。

### 3.5 字段与判定：只读实现 + 便捷断言

`UserFriendlyError` 用 `response` 的字段初始化一组 `readonly` 属性，并提供判定方法：

```ts
// 来源：packages/common/error/src/index.ts:47
export class UserFriendlyError
  extends Error
  implements UserFriendlyErrorResponse
{
  readonly status = this.response.status;
  override readonly name = this.response.name; // 覆盖 Error.name
  override readonly message = this.response.message;
  // ...

  constructor(private readonly response: UserFriendlyErrorResponse) {
    super(response.message);
  }

  is(name: ErrorName) {
    return this.name === name;
  } // 按错误名判定
  isStatus(status: number) {
    return this.status === status;
  }

  static isNetworkError(error: UserFriendlyError) {
    return error.name === 'NETWORK_ERROR';
  }
  isNetworkError() {
    return UserFriendlyError.isNetworkError(this);
  }
  notNetworkError() {
    return UserFriendlyError.notNetworkError(this);
  }
}
```

`isNetworkError` 同时提供静态版（可做 `.filter(UserFriendlyError.notNetworkError)` 传入高阶函数）与实例版，覆盖不同调用风格——网络错误的特殊照顾，是因为它通常意味着"可重试"而非"业务失败"。

### 3.6 与后端 `USER_FRIENDLY_ERRORS` 的完整链路

```text
后端 def.ts                          codegen                    前端
USER_FRIENDLY_ERRORS 表  ──────▶  enum ErrorNames          ──▶  @affine/graphql
（type/message/args）             union ErrorDataUnion          schema.ts（TS 类型）
   │ generateUserFriendlyErrors()                                  │
   │                                                               ▼
   └──▶ 每个错误生成一个 class（继承后端 UserFriendlyError）   @affine/error
        抛出时序列化进 GraphQL extensions ──── 网络 ────▶ fromAny() 归一
```

后端 `generateUserFriendlyErrors()`（`def.ts:189`）遍历 `USER_FRIENDLY_ERRORS`，为每个错误码生成一个大写枚举项、一个 PascalCase 错误类、以及（若有 `args`）一个 `XxxDataType`，最后拼成 `enum ErrorNames` 与 `createUnionType({ name: 'ErrorDataUnion' })`。这些进入 GraphQL schema 后，被 `@affine/graphql` 的 codegen 同步为前端 TS 类型。前端的 `ErrorName`/`ErrorData` 直接消费它们——**单一真值源，前后端错误契约永不漂移**。

## 4. 语法特色

- **递归模板字面量类型（`ToPascalCase`）**：用 `S extends \`${infer A}_${infer B}\``在类型层面做字符串拆分与递归，把`SNAKE_CASE`转`PascalCase`。这是把运行时命名约定"编译进类型系统"的高级技巧，使 `ErrorData` 的键值映射无需手写。
- **映射类型 + `Extract` + `__typename` 判别**：`{ [K in ErrorNames]: Extract<Union, {__typename?: ...}> }` 从一个大联合里按 GraphQL 的 `__typename` 判别字段精确筛出成员类型。
- **`keyof typeof Enum` 联合扩展**：`ErrorName = keyof typeof ErrorNames | '前端独有'`，把生成的枚举键与手写字面量合并成开放联合。
- **`implements` 接口 + 字段初始化器**：`class UserFriendlyError extends Error implements UserFriendlyErrorResponse`，用 `readonly x = this.response.x` 在字段初始化器里直接从构造参数赋值，省去构造体内的样板赋值。
- **`override` 修饰符**：显式 `override name`/`override message` 覆盖 `Error` 基类字段，让"我确实在覆盖父类成员"成为编译器可校验的意图。
- **刻意的 `@ts-expect-error`**：用更窄类型覆盖基类更宽的 `extensions`，以可读性换取一处受控的类型不协变——注释说明了取舍理由。
- **`switch (typeof)` + 鸭子类型兜底**：在运行时对 `any` 做结构探测，应对"跨序列化丢原型"的现实。

## 5. 设计 / 实现亮点

- **单一错误类型贯穿全前端**：上层只需 `catch (e) { const err = UserFriendlyError.fromAny(e); if (err.is('BLOB_NOT_FOUND')) ... }`，心智负担极低。
- **错误契约前后端自动对齐**：后端 `USER_FRIENDLY_ERRORS` 一处定义，经 codegen 流到前端类型，新增错误码零前端改动即获得类型与判定支持——这是跨语言（TS 后端 → TS 前端）契约同步的典范。
- **类型层面的命名转换**：`ToPascalCase` 让"错误名 → 数据类型"的映射完全由编译器推导，杜绝手工维护映射表的漂移风险。
- **归一入口的鲁棒性**：`fromAny` 对字符串、GraphQLError、鸭子对象、普通 Error 层层降级且永不抛错，是"错误处理代码本身不能再出错"原则的体现。
- **网络错误的一等公民待遇**：单独的 `isNetworkError`/`notNetworkError`（静态+实例双版本）呼应"网络错误可重试"的重试策略。

## 6. 对外 API 与注意事项

- **主要导出**：`UserFriendlyError`（类，含 `fromAny`/`is`/`isStatus`/`isNetworkError`）、`GraphQLError`（收窄 extensions 的 GraphQL 错误）、类型 `ErrorName`/`ErrorData`/`UserFriendlyErrorResponse`。
- **`peerDependencies` 而非 `dependencies`**：`@affine/graphql` 与 `graphql` 被声明为 peer。原因有二——(1) 避免重复安装/多实例（`graphql` 库有"单实例"要求，多份会导致 `instanceof` 失效）；(2) 错误类型本就源自 graphql 的 codegen 产物，二者必须共用同一份 `ErrorNames`/`ErrorDataUnion`。使用方须自行提供这两个依赖。
- **归一务必走 `fromAny`**：直接 `new UserFriendlyError(x)` 要求 `x` 已符合 `UserFriendlyErrorResponse`；面对来路不明的异常一律用 `UserFriendlyError.fromAny(e)`。
- **坑**：`GraphQLError` 的 `extensions` 用 `@ts-expect-error` 强行收窄，若后端未按 `UserFriendlyErrorResponse` 形状填充 extensions，读字段会得到 `undefined` 而类型却显示有值。
- **前端独有错误名**（`NETWORK_ERROR`/`REQUEST_ABORTED`/`CONTENT_TOO_LARGE`/`UNSUPPORTED_SERVER_VERSION`）由前端请求层在相应场景手动构造，后端不会返回。

## 7. 延伸

- 类型来源：`@affine/graphql`（`schema.ts` 的 `ErrorNames`/`ErrorDataUnion`，见 affine-graphql.md）。
- 真值源：后端 `packages/backend/server/src/base/error/def.ts` 的 `USER_FRIENDLY_ERRORS` 与 `generateUserFriendlyErrors()`。
- 对应教程：learning-guide 关于"前后端错误契约与统一错误处理"的章节。
