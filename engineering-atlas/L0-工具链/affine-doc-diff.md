# `@affine/doc-diff`

> 一句话定位：一个**离线 Yjs 快照差异工具**——读取两个（或多个）序列化的 Yjs 文档二进制，把它们还原成普通 JS 对象后，按"根文档页面列表 / 文件夹表 / 收藏表"三种语义做记录级 diff，并把增删改以可读文本打印到控制台，用于排查 AFFiNE 数据同步/迁移问题。

| 项        | 值                                                                                  |
| --------- | ----------------------------------------------------------------------------------- |
| 目录      | `tools/doc-diff`                                                                    |
| 所属层    | L0 · 工具链与类型基座                                                               |
| 语言/形态 | TypeScript CLI 脚本（`r ./src/index.ts`）                                           |
| 关键依赖  | `yjs`、`@affine-tools/cli`（提供 `r` 运行器）                                       |
| 被谁依赖  | 开发者手动排查工具（非运行时依赖）                                                  |
| 对外入口  | `main: index.ts`；`scripts`：`diff` / `diff:root` / `diff:folder` / `diff:favorite` |

## 1. 设计逻辑

AFFiNE 的数据底座是 Yjs（CRDT）：工作区的文档元信息、文件夹组织结构、收藏列表都存成 Yjs 文档，持久化/同步时序列化为二进制 update。当出现"同步后页面丢了""文件夹顺序乱了""收藏对不上"这类问题时，开发者手头往往只有几个 `.bin` 快照，需要快速看清"从快照 A 到快照 B 到底变了什么"。

直接比对二进制毫无意义（CRDT 的内部结构不可读），所以本工具的核心思路是：

1. **还原**：把每个二进制 `applyUpdate` 进一个全新的 `Y.Doc`，得到内存中的 Yjs 文档。
2. **降维**：用 `toPlain` 把 Yjs 共享类型（`Y.Map`/`Y.Array`/`Y.Text`/子 `Y.Doc`）递归转成稳定排序的普通 JS 值（`PlainValue`），从而可比较、可打印。
3. **按业务语义取记录集**：不同 doc 类型的"记录"存放方式不同——根文档的页面在 `meta.pages`、组织/收藏是"每条记录一个顶层 shared `Y.Map`"的表结构——于是分 `rootdoc`/`folder`/`favorite` 三种模式各自抽取。
4. **记录级 diff**：以记录 id/key 为主键，算出 added/removed/changed，changed 再逐字段对比。

它刻意做成**离线、只读、零网络**的纯函数式管道，便于在任意环境对任意快照跑。

## 2. 目录与关键文件

```text
tools/doc-diff/src/
├── index.ts     # CLI 入口：解析模式与文件、读取各 doc、按模式两两 diff 打印
├── io.ts        # readYjsDocFromFile（读文件 applyUpdate）、getDisplayLabel
├── plain.ts     # PlainValue 类型、toPlain（Yjs→普通值）、isEqual（稳定序列化比较）、formatValue
├── diff.ts      # diffKeyedRecords：通用的"按 id 的记录集" added/removed/changed 算法
├── rootdoc.ts   # 根文档模式：从 meta.pages 抽取记录 + 打印 diff
└── table.ts     # 表模式：从顶层 shared Y.Map 抽取记录 + 打印 folder/favorite diff
```

## 3. 实现细节

### 3.1 入口：模式解析与两两 diff

`index.ts` 支持可选子命令（`root`/`folder`/`favorite`，各有别名，缺省为 `rootdoc`）后跟至少两个文件路径。它先把所有文件读成 doc，再按模式分派；对多于两个文件的情况，**相邻两两比较**（`i` 与 `i+1`）：

```ts
// tools/doc-diff/src/index.ts（节选）
case 'rootdoc': {
  const metas = docs.map(extractRootDocPagesMeta);
  for (let i = 0; i < files.length - 1; i += 1) {
    printRootDocPairDiff({ fromLabel: getDisplayLabel(files[i]!), toLabel: getDisplayLabel(files[i + 1]!),
      fromMeta: metas[i]!, toMeta: metas[i + 1]! });
  }
  break;
}
// folder: extractYjsTable(doc, 'id')；favorite: extractYjsTable(doc, 'key')
default: { const unreachableMode: never = mode; fail(`Unknown mode: ${unreachableMode}`); }
```

注意 `folder` 用 `id` 作主键、`favorite` 用 `key`——同一套表抽取逻辑靠主键字段名参数化。`default` 分支用 `const unreachableMode: never = mode` 做**穷尽性检查**：若将来新增 mode 忘了处理，TS 会在此报类型错误。

### 3.2 `toPlain`：Yjs → 可比较的普通值

`plain.ts` 的 `toPlain` 是整套工具的基石，按类型递归下降，且对对象键**排序**以保证稳定：

```ts
// tools/doc-diff/src/plain.ts（节选）
if (value instanceof Text) return value.toString();
if (value instanceof Doc) return { __type: 'YDoc', guid: value.guid };
if (value instanceof YArray) return value.toArray().map(toPlain);
if (value instanceof YMap) {
  const keys = Array.from(value.keys()).sort();
  const obj = {};
  for (const key of keys) obj[key] = toPlain(value.get(key));
  return obj;
}
if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
```

子 `Y.Doc` 不展开内容、只留 `{ __type: 'YDoc', guid }`（避免无限展开嵌套文档）；二进制转 base64 便于比较与展示。

`isEqual` 则把两个值各自过一遍 `stableComparable`（递归排序键、把 `MISSING`/`undefined`/`Uint8Array` 规整成带标记的普通结构）再 `JSON.stringify` 比较字符串——用"稳定序列化后比字符串"这一朴素但可靠的方式判等，规避了对象键顺序、特殊值等干扰。

### 3.3 `diffKeyedRecords`：通用记录集 diff

`diff.ts` 不关心业务，只处理 `Map<id, record>` 到 `Map<id, record>` 的差异，输出 `{ added, removed, changed }`。三类分别靠集合运算得出，changed 再对两记录的键并集逐个比字段，用 `MISSING` 符号区分"该字段不存在"与"值为 null"：

```ts
// tools/doc-diff/src/diff.ts（changed 判定节选）
const keys = Array.from(
  new Set([...Object.keys(fromRecord), ...Object.keys(toRecord)])
).sort();
for (const key of keys) {
  const fromValue = Object.hasOwn(fromRecord, key) ? fromRecord[key] : MISSING;
  const toValue = Object.hasOwn(toRecord, key) ? toRecord[key] : MISSING;
  if (!isEqual(fromValue, toValue))
    fields.push({ key, from: fromValue, to: toValue });
}
```

所有遍历都对 id 集合 `sort()`，保证输出顺序确定、可 diff 友好。

### 3.4 两种抽取策略

- **根文档（`rootdoc.ts`）**：记录在 `rootDoc.getMap('meta').get('pages')`，可能是 `Y.Array` 或普通数组，逐条取 `id` 入 `recordsById`，重复 id 记进 `duplicateIds` 以便告警。打印时用 `title` 给 id 配可读标签，changed 的字段逐行展示 `from -> to`。
- **组织/收藏表（`table.ts`）**：遍历 `doc.share.keys()`——每个顶层共享键是一条 `Y.Map` 记录；跳过"已删除"记录（带 `$$DELETED` 标志或 `size === 0`），按传入的 `keyField`（`id` 或 `key`）取主键。folder 打印时额外展示 `parentId`/`index` 并对 `type === 'folder'` 的 `data`（文件夹名）做重命名高亮。

### 3.5 时间戳友好格式化

`formatValue` 对"看起来像时间戳"的字段（key 以 `date`/`at` 结尾、含 `timestamp` 等）把毫秒数额外渲染成 ISO 字符串，并对长值 `truncate` 到 200 字符，避免刷屏：

```ts
// tools/doc-diff/src/plain.ts（节选）
if (typeof value === 'number' && isLikelyTimestampKey(key))
  return formatTimestampMillis(value); // "1700000000000 (2023-11-14T...)"
return truncate(JSON.stringify(value));
```

## 4. 语法特色

- **`unique symbol` 哨兵**：`export const MISSING: unique symbol = Symbol('missing')`，用独一无二的 symbol 作"字段缺失"标记，类型上以 `typeof MISSING` 参与联合，杜绝与任何真实值混淆。
- **递归联合类型 `PlainValue`**：自引用的 `PlainValue = ... | PlainValue[] | { [k: string]: PlainValue }` 精确描述"任意 JSON 式值"。
- **`never` 穷尽检查**：`const unreachableMode: never = mode` 让新增模式时在编译期暴露遗漏分支。
- **`instanceof` 类型守卫链**：`toPlain` 用一连串 `value instanceof YMap/YArray/Text/Doc/Uint8Array` 在运行期辨别 Yjs 类型并窄化。
- **`Object.hasOwn` 精确存在性判断**：区分"键不存在"与"键值为 undefined/null"，配合 `MISSING` 表达三态。
- **非空断言 `files[i]!`**：在已 `length >= 2` 校验后用 `!` 告诉编译器索引安全。
- **Yjs 核心 API**：`new Doc()` + `applyUpdate(doc, bytes)` 还原文档，`doc.getMap(key)`/`doc.share.keys()` 访问共享结构。

## 5. 设计 / 实现亮点

- **"还原 + 降维 + 通用 diff"三段式**：业务差异（三种 doc 类型）只体现在"怎么抽记录"，diff 算法完全复用 `diffKeyedRecords`，新增一种 doc 类型只需写一个抽取器。
- **稳定化一切**：键排序 + 稳定序列化判等 + id 排序输出，让结果与输入的内部顺序无关、可重复、可再 diff。
- **面向排障的可读输出**：时间戳双形态、标题标签、重命名高亮、重复 id 告警，都是为"人一眼看懂发生了什么"服务。
- **纯离线只读**：不连网络、不改输入，拿到任意快照就能跑，安全且可脚本化（`diff:root` 等预置脚本）。

## 6. 对外 API 与注意事项

- 用法：`r ./src/index.ts [root|folder|favorite] <a.bin> <b.bin> [...更多]`；`-h/--help` 打印帮助。多文件相邻两两比较。
- **不可混用不同 doc 类型的文件**（帮助文本明确提示），因为抽取逻辑按模式固定。
- 子文档不展开（只留 guid），如需对比文档正文内容，本工具不覆盖。
- `folder`/`favorite` 依赖记录存为"顶层 shared Y.Map"的约定；若数据结构变化，抽取器需同步更新。

## 7. 延伸

- 同层：`@affine/revert-update`（同样基于 Yjs 快照，但生成"回滚 update"而非 diff 展示）。
- 相关底座：`@toeverything/infra` 的 ORM 把 Yjs 当数据库（表/记录心智），本工具 diff 的正是那套数据。
- 对应教程：learning-guide 工具链/数据层章节《Yjs 快照的离线差异与排障》。
