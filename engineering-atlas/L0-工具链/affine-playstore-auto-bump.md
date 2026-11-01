# `@affine/playstore-auto-bump`

> 一句话定位：Android 发布流水线里的 **Google Play 版本号自动递增 + 上架提交器**——`bump` 子命令查询 Play Store 上已有的最大 `versionCode` 并把本地 `build.gradle` 递增到比它更高；`submit` 子命令把构建好的 AAB 上传到 internal 轨道并提交草稿发布，带幂等与"仅查询"等安全机制。

| 项        | 值                                                                         |
| --------- | -------------------------------------------------------------------------- |
| 目录      | `tools/playstore-auto-bump`                                                |
| 所属层    | L0 · 工具链与类型基座                                                      |
| 语言/形态 | TypeScript CLI 脚本（`r ./index.ts`）                                      |
| 关键依赖  | `@googleapis/androidpublisher`、`@affine-tools/utils`、`@affine-tools/cli` |
| 被谁依赖  | Android 发布 CI 流水线                                                     |
| 对外入口  | `main: index.ts`；`scripts`：`bump`（默认）/ `submit`                      |

## 1. 设计逻辑

Google Play 要求每次上传的 `versionCode` 严格大于历史任何一次，否则拒收。手工维护极易出错（忘了 bump、本地与线上不一致、重复提交）。本工具把这件事自动化，并针对 CI 的不确定性做了多重防御：

1. **版本号以"本地值与线上最大值取大再 +1"为准**：既防止本地落后于线上（别人已发过更高版本），也保证单调递增。
2. **提交幂等**：`submit` 前先查该 `versionCode` 是否已经出现在某个轨道的发布里；已提交就直接视为成功、不重复上传/提交，让 CI 重试（retry）天然安全。
3. **"仅查询"模式与运行标识**：支持 `STORE_QUERY_ONLY` 只核验结果不执行写操作，并把 `operationRunId`/`operationAttempt` 写进回执，用于在"上一步真的跑了但结果不可见"时区分状态，避免把"未知"误判成"成功"。

它通过官方 `@googleapis/androidpublisher` 的 **Edit 事务**模型（insert edit → 操作 → commit/delete）与 Play 交互，所有只读探查都及时 `delete` 掉临时 edit 以免泄漏。

## 2. 目录与关键文件

```text
tools/playstore-auto-bump/
├── index.ts        # 全部逻辑：fetchVersionCode / bump / submit，按 argv 分派
└── package.json    # scripts: bump / submit；依赖 androidpublisher + utils + cli
```

## 3. 实现细节

### 3.1 认证与 Edit 事务

脚本用 `GoogleAuth`（application default credentials，scope 为 `androidpublisher`）构造 publisher 客户端。所有操作都在一个 **edit 事务**里进行，`createEdit` 封装了"开事务取 id"：

```ts
// tools/playstore-auto-bump/index.ts（节选）
const publisher = new androidpublisher_v3.Androidpublisher({ auth });
async function createEdit(applicationId: string) {
  const response = await publisher.edits.insert({ packageName: applicationId });
  if (!response.data.id) throw new Error('Google Play returned no edit ID');
  return response.data.id;
}
```

### 3.2 `fetchVersionCode`：查线上最大版本

开一个 edit、列出已上传的 bundles、取最大 `versionCode`（至少为 1），**用完立刻 delete 掉这个只读 edit**：

```ts
// tools/playstore-auto-bump/index.ts
export async function fetchVersionCode(applicationId: string): Promise<number> {
  const editId = await createEdit(applicationId);
  const response = await publisher.edits.bundles.list({
    packageName: applicationId,
    editId,
  });
  await publisher.edits.delete({ packageName: applicationId, editId });
  return Math.max(
    1,
    ...(response.data.bundles ?? []).map(b => b.versionCode ?? 0)
  );
}
```

### 3.3 `bump`：改写 build.gradle 并落盘元数据

用 `@affine/android` 包的真实路径定位 `App/app/build.gradle`，正则抓出本地 `versionCode`，与线上最大值取大 +1，写回文件，并把 `{ packageName, versionCode }` 写入元数据文件供后续 `submit` 消费：

```ts
// tools/playstore-auto-bump/index.ts（bump 节选）
const gradlePath = new Package('@affine/android').join(
  'App/app/build.gradle'
).value;
const gradle = fs.readFileSync(gradlePath, 'utf8');
const pattern = /(versionCode(?:\s|=)*)(\d+)/;
const local = Number(gradle.match(pattern)?.[2] ?? 0);
const versionCode = Math.max(local, await fetchVersionCode(packageName)) + 1;
fs.writeFileSync(gradlePath, gradle.replace(pattern, `$1${versionCode}`));
fs.writeFileSync(
  process.env.STORE_BUILD_METADATA ?? 'store-build.json',
  JSON.stringify({ packageName, versionCode })
);
```

正则 `$1` 回引保留了 `versionCode` 字面量与其间的空白/等号，只替换数字部分。

### 3.4 `submit`：带幂等与校验的上架

`submit` 读取三件输入（`STORE_BUILD_METADATA` 元数据、`STORE_BUNDLE` AAB 路径、`STORE_RECEIPT` 回执输出），并要求一对正整数运行标识（`operationRunId`/`operationAttempt`），再逐层校验元数据合法（包名一致、`versionCode` 为安全整数）。核心幂等判断是"该 versionCode 是否已在任一轨道的任一发布里出现"：

```ts
// tools/playstore-auto-bump/index.ts（submit 节选）
const editId = await createEdit(packageName);
const tracks = await publisher.edits.tracks.list({ packageName, editId });
const submitted = tracks.data.tracks?.some(track =>
  track.releases?.some(release =>
    release.versionCodes?.includes(String(candidate.versionCode))
  )
);
```

随后分三条路径：

- **`STORE_QUERY_ONLY === '1'`（仅查询）**：删掉 edit，不做任何写操作；若线上查不到结果且未允许缺失（`STORE_ALLOW_ABSENT !== '1'`）则抛错——明确表达"上一步执行过但结果不可见，状态不能当成功"。最后把 `submitted ? 'submitted' : 'not-submitted'` 连同运行标识写进回执。
- **已 `submitted`**：直接删 edit（幂等短路，不重复上传）。
- **未提交**：先查该 versionCode 的 bundle 是否已上传过，没有才 `edits.bundles.upload`（流式上传 AAB）并校验返回的 `versionCode` 与候选一致；然后 `edits.tracks.update` 把它作为 `draft` 发布到 `internal` 轨道，`edits.commit` 提交事务。

无论走哪条写路径，成功后都写回执 `{ ...candidate, ...operation, store: 'google-play', status: 'submitted' }`。

### 3.5 分派

脚本尾部按 argv 分派，默认 `bump`：

```ts
if (process.argv.includes('submit')) {
  await submit();
} else {
  await bump();
}
```

对应 `package.json` 的 `"bump": "r ./index.ts"` 与 `"submit": "r ./index.ts submit"`。

## 4. 语法特色

- **顶层 `await` + argv 分派**：ESM 脚本直接 `await bump()/submit()`，无 `main()` 包装。
- **正则捕获组回引**：`gradle.replace(/(versionCode(?:\s|=)*)(\d+)/, '$1' + code)` 用 `$1` 保留前缀、只换数字，是"精准改写配置文本"的常见手法。
- **可变参数展开求最大**：`Math.max(1, ...(bundles).map(...))` 用展开把动态数组喂给 `Math.max`。
- **`Number.isSafeInteger` 严校验**：对来自环境变量/JSON 的数值做安全整数校验，防止注入异常版本号。
- **流式上传**：`media.body: fs.createReadStream(bundle)` 以流上传 AAB，避免整包读进内存。
- **`??` 默认值链**：`process.env.STORE_BUILD_METADATA ?? 'store-build.json'` 等为环境变量提供回退。
- **跨包路径定位**：`new Package('@affine/android').join('App/app/build.gradle')` 借 `@affine-tools/utils` 的 `Package` 抽象拿到 Android 工程里的真实文件，而非硬编码相对路径。

## 5. 设计 / 实现亮点

- **版本号单调且不落后**：本地与线上取大再 +1，一举解决"忘 bump""本地落后""重复 code"三类问题。
- **CI 重试安全（幂等）**：`submit` 先探测"是否已提交"，已提交即短路，让流水线 retry 不会造成重复上架或报错。
- **"仅查询"与运行标识**：针对分布式/可重试 CI 的"结果不可见"难题，用 `STORE_QUERY_ONLY` + `operationRunId/Attempt` 把状态显式化，拒绝把"未知"乐观当成"成功"。
- **Edit 事务即用即清**：所有只读探查用完立即 `delete` edit，避免在 Play 侧堆积悬挂事务。
- **层层防御性校验**：包名、安全整数、上传后版本回验，每一步都对外部输入不信任。

## 6. 对外 API 与注意事项

- 导出 `fetchVersionCode(applicationId)` 可复用；`bump`/`submit` 为内部流程，经脚本分派触发。
- 目标应用固定为 `app.affine.pro`。
- 需要 Google 服务账号凭据（ADC）且具备 androidpublisher 权限。
- `submit` 必备 `STORE_BUILD_METADATA`/`STORE_BUNDLE`/`STORE_RECEIPT` 及正整数 `STORE_OPERATION_RUN_ID`/`STORE_OPERATION_ATTEMPT`，缺一即抛错。
- 发布落在 `internal` 轨道、`draft` 状态——不是直接面向公开用户，需后续在 Play Console 推进。

## 7. 延伸

- 同层：`@affine-tools/cli`（提供 `r` 运行器）、`@affine-tools/utils`（`Package` 路径定位）。
- 相关：`@affine/revert-update`、`@affine/doc-diff` 同为"发布/运维辅助脚本"族。
- 对应教程：learning-guide 工具链章节《移动端发布自动化与幂等上架》。
