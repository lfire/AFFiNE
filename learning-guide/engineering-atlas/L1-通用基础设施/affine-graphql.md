# `@affine/graphql`

> 一句话定位：AFFiNE 前端的**自动生成 GraphQL 客户端**——以后端 `schema.gql` 为单一真值源，用 GraphQL Codegen 把每条 `.gql` 操作生成为"带类型的查询对象 + 类型化的变量/响应"，再配一个极简、类型安全、支持文件上传的 `gqlFetcherFactory`，让前端像调用本地函数一样发起强类型 GraphQL 请求。

| 项        | 值                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------- |
| 目录      | `packages/common/graphql`                                                                          |
| 所属层    | L1 · 通用基础设施                                                                                  |
| 语言/形态 | TypeScript 库（大部分是 codegen 产物）                                                             |
| 关键依赖  | `graphql`、`@affine/error`（抛 `GraphQLError`）、`@affine/debug`、`lodash-es`                      |
| 被谁依赖  | `@affine/core` 所有需要访问后端的模块、`@affine/error`（反向取类型）、`@affine/nbstore`（cloud）等 |
| 对外入口  | `.`（`gqlFetcherFactory`、全部生成的查询对象与类型）                                               |

## 1. 设计逻辑

前端访问后端有两种常见做法：用 Apollo/urql 这类重型客户端（带缓存、链路、插件，但体积大、心智重），或手写 `fetch` + 手维护类型（轻但类型与后端极易漂移）。AFFiNE 选第三条路——**代码生成驱动的轻客户端**，核心诉求有三：

1. **类型绝不与后端漂移**：后端 `packages/backend/server/src/schema.gql` 是唯一真值源。前端写 `.gql` 操作文件，codegen 读取 schema + 操作，生成每个操作的变量类型、响应类型。schema 变了、操作用了不存在的字段，构建期就报错。
2. **运行时极薄**：不要缓存/规范化那套。`fetcher.ts` 只有一个工厂函数，负责拼 body、处理文件上传（multipart）、解析响应、抛统一错误。缓存、响应式交给上层（`@toeverything/infra` 的 LiveData / nbstore）。
3. **调用点强类型且简洁**：业务代码 `gqlFetch({ query: createWorkspaceMutation, variables: {...} })`，变量类型自动约束、返回类型自动推断——传错字段或漏字段即编译失败。

**与 `@affine/error` 的双向关系**：错误类型（`ErrorNames`/`ErrorDataUnion`）由后端定义、经本包 codegen 生成在 `schema.ts` 里；而 `@affine/error` 把它们 import 过去封装成 `UserFriendlyError`。反过来，本包的 `fetcher` 又 import `@affine/error` 的 `GraphQLError` 来抛错——两包互相依赖，因此 `@affine/error` 用 `peerDependencies` 声明对 `@affine/graphql` 的依赖以避免重复实例（见 affine-error.md 第 6 章）。

## 2. 目录与关键文件

```text
packages/common/graphql/
├── package.json            # build 脚本 = gql-gen；dep: graphql/@affine/error/@affine/debug
├── codegen.yml             # Codegen 配置：schema 来源、scalar 映射、插件链
├── export-gql-plugin.cjs   # 自定义 Codegen 插件：把 .gql 变成运行时查询对象 + Queries/Mutations 联合
├── README.md
└── src/
    ├── schema.ts           # 【生成】8600+ 行：所有类型 + ErrorNames/ErrorDataUnion + Queries/Mutations 联合
    ├── graphql/
    │   ├── index.ts        # 【生成】每个操作导出为 { id, op, query, file?, deprecations? }
    │   ├── *.gql           # 【手写】源：每个文件一条 query/mutation/fragment
    │   └── calendar/ license/ fragments/ ...  # 按领域分目录
    ├── fetcher.ts          # 【手写】gqlFetcherFactory + 类型工具 + 文件上传转换
    └── index.ts            # re-export fetcher + graphql + schema
```

手写的只有 `.gql` 操作文件、`fetcher.ts`、`codegen.yml` 与 `export-gql-plugin.cjs`；`schema.ts` 与 `graphql/index.ts` 全是 `yarn build`（`gql-gen`）产物，顶部标注 _"do not manipulate this file manually"_。

## 3. 实现细节

### 3.1 Codegen 配置：schema 来源与插件链

```yaml
# 来源：codegen.yml
schema: ../../backend/server/src/schema.gql # 单一真值源：后端 schema
documents: ./src/**/*.gql # 前端操作文件
config:
  scalars: # GraphQL 标量 → TS 类型映射
    DateTime: string
    Decimal: number
    JSON: Record<string, string>
    Upload: File
  avoidOptionals: { field: true } # 字段不可选，用 `T | null` 显式表达可空
generates:
  ./src/schema.ts:
    plugins:
      - typescript # 生成 schema 类型
      - typescript-operations # 生成每个操作的变量/响应类型
      - ./export-gql-plugin.cjs: { output: ./src/graphql/index.ts } # 自定义插件
```

`avoidOptionals.field: true` + `maybeValue: T | null` 是关键取舍：生成的字段**都是必填但可为 `null`**，而非可选 `?`。这逼迫调用方显式处理 `null`，避免"字段忘写却编译通过"的隐患。标量映射把 `DateTime`/`UUID` 等后端标量统一映射为前端易用的类型。

### 3.2 自定义插件 `export-gql-plugin.cjs`：把 `.gql` 变成运行时对象

标准 codegen 只生成类型，运行时还需要查询字符串本身。这个自定义插件遍历每个 `.gql`，生成一个运行时常量：

```ts
// 生成产物样例（src/graphql/index.ts）
export const createWorkspaceMutation = {
  id: 'createWorkspaceMutation' as const,
  op: 'createWorkspace',
  query: `mutation createWorkspace { createWorkspace { id public createdAt } }`,
};
```

插件（`export-gql-plugin.cjs`）做了几件精细的事：

- **命名归一**（`getExportedName`，第 13 行）：操作名 + 操作类型后缀（`Query`/`Mutation`/`Fragment`），如 `createWorkspace` mutation → `createWorkspaceMutation`，保证导出名无歧义、不重复（`addDef` 检测重名即抛错）。
- **文件上传探测**（`containsFile`，第 165 行）：递归检查操作变量类型里是否出现 `Upload` 标量，是则在对象上标记 `file: true`，运行时据此走 multipart 上传。
- **弃用字段检测**（`parseDeprecations`，第 54 行）：用 `visitWithTypeInfo` 遍历操作 AST，比对 schema 里字段的 `deprecationReason`，把"本操作用了哪些弃用字段"写进 `deprecations` 数组——运行时在 canary 构建会 `logger.warn` 提示（见 3.4）。
- **`#import` 片段内联**（`parseImports`，第 115 行）：支持在 `.gql` 里用 `#import "./fragments/xxx.gql"` 复用 fragment，插件把被引片段名以模板插值 `${fragmentName}` 拼接进查询字符串。
- **生成 `Queries`/`Mutations` 联合**（第 266 行）：把所有 query/mutation 汇成两个判别联合类型追加到 `schema.ts`：

```ts
// 生成于 schema.ts:7741
export type Queries = { name: 'xxxQuery'; variables: XxxQueryVariables; response: XxxQuery } | ...
export type Mutations = { name: 'xxxMutation'; variables: ...; response: ... } | ...
```

这两个联合是 `fetcher` 类型推断的枢纽。

### 3.3 `fetcher.ts`：用 `id` 做类型桥的强类型请求

每个生成的查询对象都带 `id: 'xxx' as const`。`fetcher` 用这个字面量 id 从 `Queries`/`Mutations` 联合里 `Extract` 出对应的变量类型与响应类型：

```ts
// 来源：src/fetcher.ts:13
export type _QueryVariables<Q extends GraphQLQuery> =
  Q['id'] extends Queries['name']
    ? Extract<Queries, { name: Q['id'] }>['variables']
    : Q['id'] extends Mutations['name']
      ? Extract<Mutations, { name: Q['id'] }>['variables']
      : undefined;

export type QueryResponse<Q extends GraphQLQuery> = Extract<
  Queries | Mutations,
  { name: Q['id'] }
>['response'];
```

于是 `gqlFetch({ query: createWorkspaceMutation, variables })`：`variables` 被约束为该 mutation 的变量类型、返回值被推断为其响应类型——**全靠 `id` 字面量在类型层面"查表"**。若某操作无变量，`QueryVariables` 求值为 `never`，`QueryVariablesOption` 把 `variables` 变成可省略，调用时无需传。

### 3.4 请求流程与文件上传

```ts
// 来源：src/fetcher.ts:181
export const gqlFetcherFactory = (endpoint, fetcher = fetch) => {
  const logger = new DebugLogger('GraphQL');
  return async <Query extends GraphQLQuery>(options: QueryOptions<Query>) => {
    // canary 构建：操作用了弃用字段则告警
    if (
      BUILD_CONFIG.appBuildType === 'canary' &&
      options.query.deprecations?.length
    ) {
      options.query.deprecations.forEach(d => logger.warn(d));
    }
    const body = formatRequestBody(options); // 普通 → JSON；含 File → FormData
    const isFormData = body instanceof FormData;
    const headers = {
      'x-operation-name': options.query.op /* json 时加 content-type */,
    };
    return fetcher(
      endpoint,
      merge(options.context, {
        method: 'POST',
        headers,
        body: isFormData ? body : JSON.stringify(body),
        timeout: options.timeout,
        signal: options.signal,
      })
    ).then(async res => {
      if (res.headers.get('content-type')?.startsWith('application/json')) {
        const result = (await res.json()) as ExecutionResult;
        if (res.status >= 400 || result.errors) {
          const firstError = result.errors?.[0];
          throw new GraphQLError(firstError.message, firstError); // 统一抛 @affine/error 的 GraphQLError
        }
        if (result.data) return result.data as any;
      }
      throw new GraphQLError('GraphQL query responds unexpected result...');
    });
  };
};
```

文件上传遵循 **GraphQL multipart request 规范**（`transformToForm`，第 114 行）：把变量里的 `File` 抽出，构造 `operations`（含 `null` 占位）+ `map`（文件位置映射）+ 编号的文件字段。`buildMap` 递归处理嵌套对象/数组里的 File。这让"上传头像""导入文件"等带文件的 mutation 能与普通查询用同一套 API。

错误处理上，任何非 2xx、或带 `errors` 的响应都**抛第一个错误**包成 `@affine/error` 的 `GraphQLError`——与第 1 章呼应，下游 `UserFriendlyError.fromAny` 即可归一。`x-operation-name` 请求头便于后端日志按操作名归类。

### 3.5 `RecursiveMaybeFields`：变量的深度可空放宽

生成的变量类型字段都是"必填可空"（`avoidOptionals`）。但调用方构造变量时，可空字段其实可以直接省略。`RecursiveMaybeFields`（`fetcher.ts:38`）把变量类型里**可为 null 的字段递归改成可选**：

```ts
export type RecursiveMaybeFields<T> = T extends primitive
  ? T
  : {
      [K in NullableKeys<T>]?: RecursiveMaybeFields<T[K]>; // 可空字段 → 可选
    } & {
      [K in NonNullableKeys<T>]: RecursiveMaybeFields<T[K]>; // 非空字段 → 保持必填
    };
```

这样既保证必填字段不漏，又让可空字段写起来省心——是"生成类型严格、调用体验宽松"的桥接。

## 4. 语法特色

- **条件类型 + `Extract` 做"类型查表"**：`Extract<Queries, { name: Q['id'] }>['variables']` 用操作对象的 `id` 字面量从联合里精确取出变量/响应类型，是整套强类型的核心机制。
- **`as const` 字面量 id**：生成对象的 `id: 'xxx' as const` 保留字面量类型，才能被条件类型匹配到联合成员。
- **映射类型区分可空/非空键（`NullableKeys`/`NonNullableKeys`）**：用 `null extends T[K]` 判别字段可空性，再分别映射为可选/必填——TS 条件分配的精巧运用。
- **递归映射类型（`RecursiveMaybeFields`）**：深度遍历嵌套对象放宽可空字段。
- **判别联合 `Queries`/`Mutations`**：以 `name` 为判别字段，承载"操作名→变量→响应"的三元映射。
- **代码生成为"类型真值源"**：schema.ts 由后端 schema 生成，TS 类型系统成为前后端契约的编译期校验器——这是 codegen 范式的精髓。
- **GraphQL AST 访问器（插件侧）**：`visit` / `visitWithTypeInfo` / `TypeInfo` 遍历操作文档，结合 schema 做弃用检测与文件探测——Node 侧元编程。

## 5. 设计 / 实现亮点

- **单一真值源 + 构建期校验**：后端 `schema.gql` 一处定义，前端类型自动跟随；用了不存在/弃用的字段在 `gql-gen` 时即暴露，杜绝运行时惊喜。
- **极薄运行时**：整个客户端运行时就一个工厂函数 + 几个工具函数，无缓存/规范化负担，体积与可预测性俱佳；缓存与响应式交由更合适的层。
- **强类型调用、零手维护**：调用点变量/响应全自动推断，开发者只写 `.gql` 与调用，类型"免费"获得。
- **自定义插件补齐运行时缺口**：标准 codegen 不给运行时查询对象，自定义插件补上，并顺带做了文件探测、弃用告警、片段内联、重名检测——把工程约束前移到生成期。
- **文件上传与普通查询统一 API**：通过 multipart 规范让带文件的 mutation 无缝融入。
- **与错误体系闭环**：请求失败统一抛 `@affine/error` 的 `GraphQLError`，错误类型又源自同一 schema，形成"类型—请求—错误"的完整闭环。

## 6. 对外 API 与注意事项

- **主要导出**：`gqlFetcherFactory(endpoint, fetcher?)`（返回 `gqlFetch`）、全部生成的操作对象（如 `createWorkspaceMutation`、`getWorkspacesQuery`）、全部 schema 类型与 `Queries`/`Mutations`/`ErrorNames`/`ErrorDataUnion`、类型工具 `QueryResponse`/`QueryVariables`。
- **使用约定**：
  - 新增后端交互 = 新建一个 `.gql`（一个具名 query/mutation/fragment）→ 跑 `yarn workspace @affine/graphql build` → 获得强类型操作对象。
  - 操作必须具名（匿名操作插件会报错）；复用片段用 `#import "./fragments/xxx.gql"`。
  - 带文件的变量用 `Upload` 标量，插件自动标 `file: true` 走 multipart。
- **坑**：
  - `schema.ts`/`graphql/index.ts` 是生成物，**切勿手改**；改了会被下次 codegen 覆盖。
  - schema 未更新到最新就跑 codegen，会生成过时类型；前后端联调时注意同步 `schema.gql`。
  - 字段都是"必填可空"（`T | null`），响应里务必处理 `null`；构造变量时可空字段可省（`RecursiveMaybeFields`）。
  - `gqlFetch` 失败抛 `GraphQLError`（来自 `@affine/error`），需用 `UserFriendlyError.fromAny` 归一；注意与 `@affine/error` 的 peer 依赖关系，避免 `graphql` 多实例。
  - 弃用字段告警仅在 canary 构建输出，其他构建静默。

## 7. 延伸

- 同层：`@affine/error`（错误类型源自本包 codegen，又被本包 fetcher 消费，互为依赖）、`@affine/debug`（GraphQL 日志）、`@affine/env`（`BUILD_CONFIG.appBuildType` 控制弃用告警）。
- 后端：`packages/backend/server/src/schema.gql`（schema 真值源）。
- 对应教程：learning-guide 关于"GraphQL 代码生成与类型安全客户端"的章节。
