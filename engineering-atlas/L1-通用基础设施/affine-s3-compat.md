# `@affine/s3-compat`

> 一句话定位：AFFiNE 的**轻量 S3 兼容对象存储客户端**——在 `s3mini` + `aws4` 之上封装一套统一的 `S3CompatClient` 接口，支持对象的增删查、HEAD 元信息、分片上传（multipart）、以及 SigV4 预签名 URL，用来对接 AWS S3 及一切兼容 S3 协议的存储（MinIO、R2、OSS 等），作为 blob/附件的后端存储层。

| 项        | 值                                                                                      |
| --------- | --------------------------------------------------------------------------------------- |
| 目录      | `packages/common/s3-compat`                                                             |
| 所属层    | L1 · 通用基础设施                                                                       |
| 语言/形态 | TypeScript 库（单文件 529 行，Node 侧）                                                 |
| 关键依赖  | `s3mini`（极简 S3 客户端）、`aws4`（SigV4 签名）、`fast-xml-parser`（解析 S3 XML 响应） |
| 被谁依赖  | 后端 blob 存储、附件服务（自托管/云端对象存储对接）                                     |
| 对外入口  | `.`（`S3Compat`、`createS3CompatClient`、相关类型与 `parseListPartsXml`）               |

## 1. 设计逻辑

AFFiNE 要把图片、附件等 blob 存到对象存储。官方 AWS SDK（`@aws-sdk/client-s3`）功能全但体积巨大、依赖繁多，而 AFFiNE 实际只用到一小撮操作：put/get/head/delete/list + 分片上传 + 预签名 URL。`@affine/s3-compat` 的立场是：**用最小依赖覆盖这组核心需求，并抹平"各家 S3 兼容服务的差异"**。

它的三个设计要点：

1. **统一接口 `S3CompatClient`**：把所有操作收敛成一个接口，上层只依赖接口、不关心底层是 AWS 还是 MinIO 还是 R2。
2. **组合三个小库而非一个大 SDK**：`s3mini` 做常规请求、`aws4` 做 SigV4 签名、`fast-xml-parser` 解析 S3 返回的 XML——三者加起来远小于官方 SDK。某些 `s3mini` 未覆盖的操作（HEAD、list-parts、预签名）则自行用 `aws4` 签名 + `fetch` 实现。
3. **兼容性兜底**：不同 S3 服务在"路径风格 vs 虚拟主机风格""endpoint 是否已含 bucket""XML 响应结构""错误码"上各有差异，本包用 `buildEndpoint`、`parseListPartsXml`、`detectErrorCode` 等把这些差异吸收掉。

**为何单独成包**：对象存储是后端 blob 层的基础设施，独立成包便于单独测试、替换底层库，也让"存储协议适配"与业务解耦。

## 2. 目录与关键文件

```text
packages/common/s3-compat/
├── package.json          # dep: s3mini / aws4 / fast-xml-parser
└── src/
    └── index.ts          # 全部实现（529 行）：
                          #   - 类型：S3CompatConfig/Credentials/S3CompatClient 接口
                          #   - 工具：buildEndpoint/encodeKey/parseListPartsXml/detectErrorCode
                          #   - S3Compat 类（实现接口）+ createS3CompatClient 工厂
```

## 3. 实现细节

### 3.1 统一接口与配置

```ts
// 来源：src/index.ts:42
export interface S3CompatClient {
  putObject(key, body, meta?): Promise<void>;
  getObjectResponse(key): Promise<Response | null>;
  headObject(key): Promise<{ contentType?; contentLength?; lastModified?; checksumCRC32? } | undefined>;
  deleteObject(key): Promise<void>;
  listObjectsV2(prefix?): Promise<ListObjectsItem[]>;
  // 分片上传
  createMultipartUpload / uploadPart / listParts / completeMultipartUpload / abortMultipartUpload
  // 预签名 URL
  presignGetObject / presignPutObject / presignUploadPart
}
```

`S3CompatConfig` 含 `endpoint`/`region`/`bucket`/`forcePathStyle`/`presign` 等；`body` 类型联合覆盖 `Blob | Buffer | Uint8Array | ReadableStream | Readable`，同时兼容浏览器流与 Node 流。

### 3.2 `buildEndpoint`：路径风格 vs 虚拟主机风格的兼容

S3 寻址有两种风格：**虚拟主机式**（`https://bucket.s3.region.amazonaws.com`）与**路径式**（`https://minio.local/bucket`）。MinIO/自托管常用路径式，AWS 用虚拟主机式。`buildEndpoint`（`index.ts:180`）据 `forcePathStyle` 与当前 endpoint 已有结构，智能决定把 bucket 放进路径还是主机名：

```ts
// 来源：src/index.ts:180
if (config.forcePathStyle) {
  const firstSegment = url.pathname.split('/').find(Boolean);
  if (firstSegment !== config.bucket)
    url.pathname = joinPath(url.pathname, config.bucket); // 放路径
  return url;
}
const hostHasBucket = url.hostname.startsWith(`${config.bucket}.`);
const pathHasBucket = firstSegment === config.bucket;
if (!hostHasBucket && !pathHasBucket)
  url.hostname = `${config.bucket}.${url.hostname}`; // 放主机名
```

关键在于**幂等判断**——先检查 bucket 是否已出现在路径/主机里，避免重复拼接（否则会得到 `bucket.bucket.host` 这种错误）。

### 3.3 SigV4 签名：`signedFetch` 与 `presign` 一体两面

AWS 签名 V4 有两种用法：**请求头签名**（签名放 `Authorization` 头，用于后端直接请求）与**查询串签名**（签名放 URL query，产出可分发给客户端的预签名 URL）。两者都用 `aws4.sign`，仅差一个 `signQuery` 标志：

```ts
// 请求头签名（index.ts:259）
const signed = aws4.sign({ method, service: 's3', region, host, path: requestPath, headers }, credentials);
return this.fetchImpl(`${origin}${signed.path}`, { method, headers: signedHeaders });

// 查询串签名（index.ts:291）—— 多了 signQuery: true 与 X-Amz-Expires
const signed = aws4.sign({ ..., signQuery: true }, credentials);
return { url: `${origin}${signed.path}`, headers, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
```

`presignPutObject` 还可选择把 `Content-Type` 纳入签名（`signContentTypeForPut`），以约束客户端上传时的内容类型。预签名让**前端能直传对象存储、绕过后端中转**，节省后端带宽——这是对象存储的典型高效用法。

### 3.4 自行实现 `s3mini` 未覆盖的操作

`putObject`/`getObjectResponse`/`deleteObject`/`listObjectsV2`/multipart 的 create/upload/complete/abort 直接委托给 `s3mini`。但 **HEAD** 与 **listParts** `s3mini` 不提供，本包用 `signedFetch` + XML 解析自行实现：

- **`headObject`**（`index.ts:346`）：发 HEAD 请求，404 或错误码 `NoSuchKey`/`NotFound` 返回 `undefined`（视为对象不存在），否则从响应头提取 `content-length`/`content-type`/`last-modified`/`x-amz-checksum-crc32`。
- **`listParts`**（`index.ts:443`）：**循环分页**拉取分片列表。S3 的 list-parts 可能被截断（`IsTruncated`），用 `NextPartNumberMarker` 翻页直到取全；错误码 `NoSuchUpload` 返回 `undefined`。

### 3.5 XML 解析与错误码探测

S3 用 XML 返回列表与错误。`parseListPartsXml`（`index.ts:150`）用 `fast-xml-parser` 解析，并处理两个现实坑：

- **单元素 vs 数组**：XML 里只有一个 `<Part>` 时解析成对象、多个时成数组。`asArray` 工具统一成数组。
- **布尔/数字的字符串化**：`IsTruncated` 可能是字符串 `"true"`，`toBoolean` 统一处理；ETag 用 `s3mini` 的 `sanitizeETag` 去掉引号。

`detectErrorCode`（`index.ts:141`）从错误 XML 里抽 `<Error><Code>`，用于区分"对象不存在"（返回 `undefined`）与"真错误"（抛异常）——这个区分很重要，让上层能用 `undefined` 语义化地表达"not found"而非靠 try/catch。

### 3.6 流式上传的 `duplex: 'half'`

用 `fetch` 上传 `ReadableStream`/`Readable` 时，现代规范要求显式设 `duplex: 'half'`，否则报错。`shouldUseDuplex`（`index.ts:199`）判断 body 是否为流（排除 string/ArrayBuffer/Uint8Array/Blob），是则注入该选项：

```ts
// 来源：src/index.ts:231
this.fetchImpl = (input, init) => {
  if (shouldUseDuplex(init))
    return fetchImpl(input, { ...init, duplex: 'half' } as RequestInit);
  return fetchImpl(input, init);
};
```

这个 fetch 包装同时传给 `s3mini`（`fetch: this.fetchImpl`），让底层库也获得流式上传能力——一处包装、处处生效。

## 4. 语法特色

- **接口驱动 + 工厂函数**：`S3CompatClient` 接口 + `S3Compat` 实现 + `createS3CompatClient`/`S3Compat.fromConfig` 工厂，便于替换实现与依赖注入。
- **`satisfies ListPartItem`**：`parseListPartsXml` 里 `return { partNumber, etag } satisfies ListPartItem` 校验结构正确又不丢失推断。
- **类型守卫过滤 `undefined`**：`.filter((part): part is ListPartItem => !!part)` 用类型谓词把 `(T|undefined)[]` 收窄为 `T[]`。
- **宽联合 body 类型**：`Blob | Buffer | Uint8Array | ReadableStream | Readable` 同时覆盖浏览器与 Node 的多种数据源。
- **`signQuery` 标志复用签名逻辑**：请求头签名与预签名共用 `aws4.sign`，仅切一个布尔，避免两套签名实现。
- **防御式 XML 解析**：`asArray`/`toBoolean`/可选链层层兜底，应对各家 S3 服务 XML 结构的细微差异。
- **运行时 `fetch` 包装注入 `duplex`**：用高阶函数在不改调用点的前提下为所有请求加流式支持。

## 5. 设计 / 实现亮点

- **小依赖替代重型 SDK**：`s3mini + aws4 + fast-xml-parser` 覆盖核心需求，体积与冷启动远优于官方 SDK，适合 Serverless/边缘后端。
- **S3 方言兼容层**：`buildEndpoint` 的路径/虚拟主机风格自适应 + 幂等拼接、XML 单复数/类型兜底、错误码探测，让同一客户端对接 AWS/MinIO/R2/OSS 等多家服务。
- **预签名直传**：`presign*` 让前端直连对象存储，后端只发"通行证"，省带宽、降延迟。
- **缺失操作的自实现**：HEAD/listParts 用 `aws4` 手工签名 + fetch 补齐，并正确处理分页与 not-found 语义。
- **not-found 用 `undefined` 而非异常**：`headObject`/`listParts` 把"不存在"建模为返回值而非抛错，调用端更干净。
- **流式上传开箱即用**：`duplex: 'half'` 的自动注入解决了 `fetch` 上传流的常见陷阱。

## 6. 对外 API 与注意事项

- **主要导出**：`S3Compat` 类、`createS3CompatClient(config, credentials)` 与 `S3Compat.fromConfig` 工厂、`parseListPartsXml`、类型 `S3CompatConfig`/`S3CompatCredentials`/`S3CompatClient`/`PresignedResult`/`ListObjectsItem`/`ListPartItem`。
- **使用约定**：构造时传 `S3CompatConfig`（endpoint/region/bucket/forcePathStyle/presign）与凭据；大文件走 `createMultipartUpload → uploadPart* → completeMultipartUpload`（失败用 `abortMultipartUpload`）；前端直传用 `presignPutObject`/`presignUploadPart`。
- **坑**：
  - **Node 环境专用**：依赖 `node:buffer`/`node:stream`/`node:querystring`，不用于浏览器端。
  - `forcePathStyle` 要与实际服务匹配——MinIO/多数自托管需 `true`，AWS 用默认（虚拟主机式）；配错会导致 404 或签名不符。
  - 流式 body 必须经本包包装的 fetch 才会带 `duplex: 'half'`；自行绕过会报错。
  - 预签名 URL 默认 1 小时过期（`expiresInSeconds` 默认 3600）；`presignPutObject` 若签了 `Content-Type`，客户端上传必须带相同的头，否则签名校验失败。
  - `headObject`/`listParts` 返回 `undefined` 表示"不存在"，务必与"空列表"区分处理。

## 7. 延伸

- 底层库：`s3mini`、`aws4`（SigV4）、`fast-xml-parser`。
- 上层：后端 blob/附件存储服务（把 blob 的 key/分片映射到对象存储）。
- 对应教程：learning-guide 关于"对象存储与 S3 协议适配"的章节。
