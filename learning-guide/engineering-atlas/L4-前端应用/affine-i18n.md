# `@affine/i18n`

> 一句话定位：AFFiNE 的**国际化基础设施**——以 `i18next` + `react-i18next` 为运行时，用 `@magic-works/i18n-codegen` 从基准语言 `en.json` 生成**类型安全的 key 访问器**，并通过 Tolgee 平台协作翻译、按需懒加载各语言资源。

| 项        | 值                                                                                |
| --------- | --------------------------------------------------------------------------------- |
| 目录      | `packages/frontend/i18n`                                                          |
| 所属层    | L4 · 前端应用                                                                     |
| 语言/形态 | TypeScript 库（含 codegen 构建脚本）                                              |
| 关键依赖  | `i18next`、`react-i18next`、`@magic-works/i18n-codegen`、`dayjs`、`@affine/debug` |
| 被谁依赖  | `@affine/component`、`@affine/core`、各 `apps/*` 几乎所有展示文案的模块           |
| 对外入口  | `.`（`I18n`、`useI18n`、`SUPPORTED_LANGUAGES`、`i18nTime`、`Trans` …）            |

## 1. 设计逻辑

前端国际化的三个痛点，本包各给一个答案：

1. **key 的类型安全**：纯字符串 key（`t('com.affine.xxx')`）拼错不报错、重构无提示。本包用 codegen 把 `en.json` 的每个 key 生成一个**同名方法**（`useAFFiNEI18N()['com.affine.xxx']()`），于是拼错即编译报错、带参数的 key 有参数类型。
2. **运行时与类型检查的平衡**：若把全部资源作为 `i18next` 的 `CustomTypeOptions.resources` 打开类型，会让整个 codebase 的类型检查极慢（见 `i18next.ts:81-92` 注释"DO NOT ENABLE THIS … make typecheck of whole codebase so laggy"）。所以本包**刻意不开**那条路，改用独立生成的 `i18n.gen.ts` 承载类型。
3. **协作翻译与体积**：基准语言 `en` 内联打包，其余 25 种语言用动态 `import()` 懒加载；社区通过 Tolgee 平台翻译，CI 回灌。

核心立场：**基准语言（`src/resources/en.json`）是唯一真相源**——加 key、改文案都只动它，codegen 与完整度统计、Tolgee 同步都围绕它展开。

## 2. 目录与关键文件

```text
i18n/
├── .i18n-codegen.json        # codegen 配置：input=en.json → output=i18n.gen，parser=i18next
├── build.ts                  # 构建脚本：注入 server 错误文案 → (可选)清理无用 key → codegen → 算完整度
├── cleanup.mjs
└── src/
    ├── index.ts              # 聚合导出 i18next / react / resources / utils + i18nCompletenesses
    ├── i18next.ts            # getOrCreateI18n()、I18n 代理、I18nString 类型、createI18nWrapper
    ├── react.ts              # useI18n()（hook 版）+ re-export Trans/useTranslation
    ├── i18n.gen.ts           # 【生成物】useAFFiNEI18N()：每个 key 一个带 JSDoc 的方法
    ├── i18n-completenesses.json  # 【生成物】各语言翻译完整度百分比
    ├── resources/
    │   ├── index.ts          # Language 联合类型 + SUPPORTED_LANGUAGES（名称/emoji/rtl/懒加载器）
    │   ├── en.json           # 基准语言（唯一真相源）
    │   └── <lang>.json       # 25 种其它语言
    └── utils/
        ├── index.ts          # export i18nTime
        └── time.ts           # 基于 dayjs 的本地化相对/绝对时间
```

## 3. 实现细节

### 3.1 i18next 实例：自定义 backend + 懒加载 + 回退链

`i18next.ts` 的 `getOrCreateI18n()` 惰性创建单例，挂一个**自定义 backend**，`read(lng, ns, callback)` 时从 `SUPPORTED_LANGUAGES[lng].resource` 取资源——若是函数就 `import()` 懒加载，否则直接回调：

```ts
// 来源：src/i18next.ts
read: (lng, _ns, callback) => {
  const resource = SUPPORTED_LANGUAGES[lng].resource;
  if (typeof resource === 'function') {
    resource().then(data => callback(null, data.default))
              .catch(err => callback(null, null));
  } else {
    callback(null, resource);  // en 直接内联
  }
},
```

`fallbackLng` 是一个函数而非字符串，实现了**精细回退链**（`i18next.ts:42-59`）：`cn` → `zh-Hans`；`xx-YY` → `xx` → `en`（如 `es-AR` 回退到 `es` 再到 `en`）。`partialBundledLanguages: true` 允许只打包 `en`、其余运行时注入；`interpolation.escapeValue: false` 因为 React 自带转义。

### 3.2 两种消费姿势：`I18n`（命令式）与 `useI18n`（React）

两者都由 `createI18nWrapper(getI18nFn)` 产出，区别只在 i18n 实例来源：

```ts
// src/i18next.ts：命令式单例（供非 React 代码/工具层）
export const I18n = createI18nWrapper(getOrCreateI18n);
// src/react.ts：hook 版（随语言切换自动重渲染）
export const useI18n = () => {
  const { i18n } = useTranslation('translation');
  return useMemo(() => createI18nWrapper(() => i18n), [i18n]);
};
```

`createI18nWrapper` 返回的是一个 **`Proxy`**：已知成员（`t`/`language`/`changeLanguage`/`on`）走真实方法；其余任意 key 一律被当作翻译 key，返回 `I18nMethod.t.bind(null, key)`——于是 `i18n['com.affine.xxx']({ arg: 1 })` 等价于 `t('com.affine.xxx', { arg: 1 })`。`has` 陷阱则用 `i18n.exists(key)` 支持 `in` 判断。`t` 还兼容三种入参：字符串 key、`{ i18nKey, options }` 对象、以及未知 key 时**原样返回 key 自身**（容错）。

### 3.3 codegen：从 `en.json` 生成类型安全访问器

`.i18n-codegen.json` 指定 `parser.type = i18next`（`contextSeparator: '$'`、`pluralSeparator: '_'`），`generator.type = i18next/react-hooks`、`hooks: 'useAFFiNEI18N'`、`emitTS: true`。产物 `i18n.gen.ts` 里每个 key 变成一个带 JSDoc 原文注释的方法：

```ts
// 来源：src/i18n.gen.ts（生成物，顶部 @ts-nocheck）
export function useAFFiNEI18N(): {
  /** `Back to my Content` */
  ['404.back'](): string;
  /** `AFFiNE Cloud` */
  ['AFFiNE Cloud'](): string;
  // ...带插值的 key 会带 values 参数
};
```

它内部用一个 `createProxy` + `Object.defineProperty` 惰性缓存每个 key 的函数。`i18next.ts` 再从这个生成函数反推类型：

```ts
export type I18nFuncs = ReturnType<typeof useAFFiNEI18N>;
type KnownI18nKey = keyof I18nFuncs;
export type I18nString =
  KnownI18nKey | string | { i18nKey: string; options?: Record<string, any> };
```

`I18nString` 是全应用传递"可翻译文案"的标准类型——既接受强类型 key，也接受裸字符串与带参对象，`isI18nString` 做运行时判定。

### 3.4 build.ts：不止 codegen 的构建流水线

`build.ts` 顶层 `await` 依次做四件事：

1. **`appendErrorI18n()`**：从 `@affine/server` 的 `base/error/def.ts` 读 `USER_FRIENDLY_ERRORS`，把每个错误的 `message`（字符串或 `(args)=>string`）转成 `error.<KEY>` 写回 `en.json`——**服务端错误文案自动纳入前端 i18n**，`(args)=>string` 形式会用 `{{key}}` 占位回填。
2. **`cleanupResources()`**（`--cleanup`）：扫描 `packages/frontend/**` 源码，用正则找出已用 key（含模板串/拼接动态前缀 `com.affine.xxx.${}`），删除所有语言里的无用 key。
3. **`i18nnext()`**：`runCli` 执行 codegen（`--dev` 时 watch）。
4. **`calcCompletenesses()`**：以 `en` 的 key 数为分母，算每种语言完整度百分比写入 `i18n-completenesses.json`（变体语言如 `es-AR` 会合并其基语 `es` 的键再计算）。

### 3.5 本地化时间 `i18nTime`

`utils/time.ts` 基于 `dayjs`，定义 `TimeUnit` 并通过 `I18n` 输出本地化的相对/绝对时间（如 `i18nTime(1728538228000) -> 'Oct 10, 2024, 1:30:28 PM'`），把时间格式化也纳入 i18n 体系，而非散落各处。

## 4. 语法特色

- **`ReturnType<typeof fn>` 反推类型 + `keyof`**：不手写 key 联合，而是从生成的 `useAFFiNEI18N` 返回类型 `keyof` 出全部 key，类型随 `en.json` 自动同步。
- **`Proxy` 做动态成员**：`get`/`has` 陷阱把"任意 key 当翻译函数"，既保留 `i18n.t()` 又支持 `i18n['key']()` 两种写法，且 `as` 断言成 `typeof I18nMethod & ReturnType<typeof useAFFiNEI18N> & { [k]: () => string }` 对外暴露精确类型。
- **`declare module 'i18next'` 声明合并**：`CustomTypeOptions` 被刻意留空并注释说明"为性能不开启资源类型"——一个把"类型能力"与"编译性能"显式权衡的声明合并范例。
- **判别联合 + 类型守卫**：`I18nString` 是 `string | KnownKey | { i18nKey }` 判别联合，`isI18nString(value): value is I18nString` 做收窄。
- **懒加载类型**：`SUPPORTED_LANGUAGES[lng].resource` 的类型是 `LanguageResource | (() => Promise<{ default: Partial<LanguageResource> }>)`——内联与异步两种形态统一在一个字段，`Partial` 表达非基准语言可能缺键。
- **`satisfies`**：`time.ts` 的 `timeUnitCode = {...} satisfies Record<TimeUnit, number>`，校验映射完整而不丢失字面量类型。

## 5. 设计 / 实现亮点

- **"基准语言即真相源"**：开发只改 `en.json`，codegen/完整度/Tolgee 同步全自动，消除了"文案与类型不同步"的经典顽疾。
- **codegen 换类型检查性能**：明知开 `i18next` 原生类型会拖慢全仓 typecheck，改用独立 `.gen.ts` 承载类型，是对大型 monorepo 编译性能的清醒取舍。
- **服务端错误文案自动灌入**：`appendErrorI18n` 让前后端错误文案共用一套翻译键，避免重复维护。
- **按需懒加载 + 精细回退链**：只内联 `en`、其余 `import()`，首屏体积可控；`fallbackLng` 函数化处理方言与繁简回退，覆盖真实世界的语言变体。

## 6. 对外 API 与注意事项

- React 组件内用 `useI18n()`（语言切换会自动重渲染）；非 React/工具层用单例 `I18n`。富文本插值用 re-export 的 `<Trans>`。
- 加新文案：只在 `src/resources/en.json` 加 key，跑 `yarn build` 触发 codegen；**不要手改 `i18n.gen.ts`**（生成物、`@ts-nocheck`）。
- 未知 key 会**原样返回 key 字符串**而非抛错——线上看到 key 文本即说明漏翻/拼错。
- README 示例里的 `LOCALES` 为旧称，当前实际导出为 `SUPPORTED_LANGUAGES`（`resources/index.ts`）。
- 新增语言需在 `Language` 联合类型与 `SUPPORTED_LANGUAGES` 两处登记（名称/originalName/flagEmoji/是否 `rtl`/懒加载器）。

## 7. 延伸

- 运行时：`i18next`、`react-i18next`；协作平台：Tolgee（`i18n.affine.pro`）。
- 上游数据：`@affine/server` 的 `USER_FRIENDLY_ERRORS`（错误文案来源）。
- 消费方：`@affine/component`、`@affine/core`、各 `apps/*`。
- 日志：`@affine/debug`（`DebugLogger('i18n')`）。
