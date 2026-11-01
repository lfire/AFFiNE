# `@affine/revert-update`

> 一句话定位：一个**生成 Yjs "回滚更新"的离线工具**——给定一个较新快照（from）与一个较旧快照（to），借 Yjs 的 `UndoManager` 计算出一个 update 二进制，把它应用到较新文档上即可让其内容回退到较旧状态。用于数据事故时的定向回滚。

| 项        | 值                                                        |
| --------- | --------------------------------------------------------- |
| 目录      | `tools/revert-update`                                     |
| 所属层    | L0 · 工具链与类型基座                                     |
| 语言/形态 | TypeScript CLI 脚本（`r ./index.ts`）                     |
| 关键依赖  | `yjs`、`@affine-tools/cli`（提供 `r` 运行器）             |
| 被谁依赖  | 开发者/运维手动使用（数据回滚场景）                       |
| 对外入口  | `main: index.ts`；`scripts`：`generate`（`r ./index.ts`） |

## 1. 设计逻辑

Yjs 是 CRDT：历史一旦合并就无法简单"删除"，不能像 SQL 那样 `UPDATE` 把状态改回去。但现实里确实会遇到"某次变更把文档搞坏了，想恢复到坏之前"。CRDT 要求"只增、可收敛"，正确做法不是篡改历史，而是**生成一个新的 update，其效果是抵消差异**——相当于一枚"反向补丁"。

本工具的核心巧思：不自己手写反向逻辑，而是**借 Yjs 自带的 `UndoManager` 制造撤销效果**。思路是——把"从 older 到 newer 的差异"应用到 older 文档上，再立刻 `undo()`，这一步 undo 产生的状态变化正好就是"把 newer 的改动撤回"的 update。再把它相对 newer 的 state vector 编码出来，就得到可直接 `applyUpdate` 到 newer 文档上的回滚补丁。

它是**离线、确定性、可多种输入/输出格式**的纯函数脚本，方便在任意环境对导出的快照跑，并把结果以 bin/base64/hex 回写文件或打到 stdout。

## 2. 目录与关键文件

```text
tools/revert-update/
├── index.ts        # 全部逻辑：参数解析 + generateRevertUpdate + 读写多格式 IO
└── package.json    # scripts: generate；依赖 yjs + @affine-tools/cli
```

## 3. 实现细节

### 3.1 `generateRevertUpdate`：用 UndoManager 造反向补丁

这是整个工具的心脏，仅十余行，却精确利用了 Yjs 的四个核心 API：

```ts
// tools/revert-update/index.ts
function generateRevertUpdate(
  fromNewerBin: Uint8Array,
  toOlderBin: Uint8Array
): Uint8Array {
  const newerDoc = new Doc();
  applyUpdate(newerDoc, fromNewerBin);
  const olderDoc = new Doc();
  applyUpdate(olderDoc, toOlderBin);

  const newerState = encodeStateVector(newerDoc);
  const olderState = encodeStateVector(olderDoc);

  const diff = encodeStateAsUpdate(newerDoc, olderState); // older 缺失的那部分（= newer 多出来的改动）
  const undoManager = new UndoManager(Array.from(olderDoc.share.values())); // 跟踪 older 所有共享类型

  applyUpdate(olderDoc, diff); // 把"多出来的改动"合进 older —— 此刻 older 内容追平 newer
  undoManager.undo(); // 撤销这批改动 —— 内容回到 older，但产生了"撤销"操作

  return encodeStateAsUpdate(olderDoc, newerState); // 相对 newer 编码：仅含撤销带来的增量
}
```

逐步拆解"为什么这样能回滚"：

1. `encodeStateAsUpdate(newerDoc, olderState)` 产出**newer 相对 older 多出的那部分 update**（`diff`），即"坏掉的那批改动"。
2. 新建 `UndoManager` 跟踪 `olderDoc` 的所有共享类型，开始录制。
3. `applyUpdate(olderDoc, diff)`：把那批改动合进 older —— 现在 older 的内容等同 newer，而这步被 UndoManager 记成一个可撤销的变更。
4. `undoManager.undo()`：撤销它 —— older 内容回到原样，但 CRDT 里新增了"撤销"所对应的操作（删除标记等）。
5. `encodeStateAsUpdate(olderDoc, newerState)`：**以 newer 的 state vector 为基准**编码，得到的 update 只包含"相对 newer 缺的那部分"——也就是那次 undo 带来的增量。把它应用到 newer 文档上，newer 就被回退到 older 的内容。

关键在第 5 步用 `newerState` 作基准：它让输出 update 专为"打到 newer 上"量身定做，而非把整个 older 全量塞过去。

### 3.2 多格式 IO 与 CLI 参数

脚本支持 `--from`/`--to` 两个输入，各自可选 `file`/`base64`/`hex` 格式（`--from-format`/`--to-format`，默认 `file`），输出可 `--out` 到文件或走 stdout，格式 `bin`/`base64`/`hex`（默认：有 `--out` 时 `bin`，否则 `base64`）：

```ts
// tools/revert-update/index.ts（输出默认值推导）
const defaultOutFormat = outPath ? 'bin' : 'base64';
```

`parseArgs` 是一个手写的极简解析器：遍历 argv，遇 `-h/--help` 打印帮助即退，非 `--` 开头或缺值即 `fail`（打印错误 + 帮助 + `exit(1)`），把 `--k v` 收进 Map。`readInput` 按格式把输入读成 `Uint8Array`（文件读字节；base64/hex 用 `Buffer.from(trimmed, fmt)` 解码）。`writeOutput` 对称地把结果以目标格式写文件或输出 stdout（二进制 stdout 直接 `process.stdout.write(Buffer.from(update))`，文本格式补换行）。

### 3.3 顶层执行

脚本尾部直接跑完整管道，无函数封装：

```ts
const { from, to, fromFormat, toFormat, outPath, outFormat } = parseArgs(
  process.argv.slice(2)
);
const fromBin = readInput(from, fromFormat);
const toBin = readInput(to, toFormat);
const revertUpdate = generateRevertUpdate(fromBin, toBin);
writeOutput(revertUpdate, outPath, outFormat);
```

## 4. 语法特色

- **Yjs 增量同步 API 组合**：`encodeStateVector`（状态向量）/ `encodeStateAsUpdate(doc, sv)`（相对某状态的差异）/ `applyUpdate` / `UndoManager`——用 CRDT 原语"拼"出反向补丁，而非手写 diff，是对 Yjs 模型的深度运用。
- **字面量联合类型约束格式**：`type InputFormat = 'file' | 'base64' | 'hex'`、`OutputFormat = 'bin' | 'base64' | 'hex'`，`parseInputFormat`/`parseOutputFormat` 在运行期把字符串收窄到联合成员，非法值走 `fail`（返回 `never`）。
- **`never` 返回类型表达"不返回"**：`function fail(message): never` 告知类型系统它必定 `process.exit`，于是调用处无需再处理后续。
- **`Buffer` 与 `Uint8Array` 互转**：编解码 base64/hex 全靠 Node `Buffer`，再 `new Uint8Array(...)` 喂给 Yjs（Yjs 吃 `Uint8Array`）。
- **顶层 `await`/直跑**：ESM 脚本直接执行整条管道。

## 5. 设计 / 实现亮点

- **"用 UndoManager 造反向补丁"**：绕开手写 CRDT 逆运算，借官方撤销机制保证语义正确与收敛性——是对"CRDT 不可删改"约束的优雅规避。
- **基准化输出**：以 newer 的 state vector 编码，使回滚补丁体积最小且专打 newer，而非全量覆盖。
- **输入输出全格式可配**：file/base64/hex 自由组合，既能对接导出的二进制文件，也能直接处理日志里粘来的 base64 串，便于应急。
- **离线确定性**：不连网络、不改输入文档对象，给定同样输入必得同样补丁，可安全在生产事故排查时复现。

## 6. 对外 API 与注意事项

- 用法：`r ./tools/revert-update/index.ts --from <newer> --to <older> [--from-format ...] [--out ...]`；`-h` 看帮助。
- **语义顺序要记牢**：`--from` 是**较新**快照、`--to` 是**较旧**（目标）快照；生成的 update 用于打到 `from` 文档上使其回退到 `to`。
- 产物是"反向 update"而非完整文档；需由调用方 `applyUpdate` 到目标文档并再持久化。
- 回滚本身也是一次 CRDT 变更（会进入历史），不是"抹除"——符合 Yjs 不可变历史的本质。

## 7. 延伸

- 同层：`@affine/doc-diff`（同样读 Yjs 快照，但做"差异展示"而非"生成回滚补丁"）。
- 相关底座：`@affine/nbstore` / `@toeverything/infra` 的 ORM 产生并持久化这些 Yjs 文档。
- 对应教程：learning-guide 数据层章节《CRDT 回滚：用 UndoManager 生成反向 update》。
