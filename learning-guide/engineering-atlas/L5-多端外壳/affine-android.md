# `@affine/android`

> 一句话定位：AFFiNE 的 **Android 外壳应用**——与 `@affine/ios` 对称的"薄壳"：同样用 **Capacitor** 把 `@affine/core` 的 React Web 内容塞进 Android 系统 `WebView`，再用一组 **Kotlin 原生插件桥**补齐本地存储、鉴权、Mermaid/Typst 渲染等能力。不同之处在于宿主语言是 Kotlin、构建系统是 Gradle、GraphQL 走 Apollo-Kotlin 运行时，且原生侧还额外承载了 Jetpack Compose 的 AI 聊天界面与 Android 特有的 IME 输入桥。

| 项        | 值                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录      | `packages/frontend/apps/android`                                                                                                                                                                                   |
| 所属层    | L5 · 多端外壳                                                                                                                                                                                                      |
| 语言/形态 | TypeScript（Web 侧桥）+ Kotlin（原生壳）+ Capacitor/Gradle 应用                                                                                                                                                    |
| 关键依赖  | `@affine/core`、`@affine/mobile-shared`、`@affine/nbstore`、`@capacitor/core`、`@capgo/inappbrowser`、`react`；原生侧 Capacitor Android、Hilt、Compose、Apollo-Kotlin、OkHttp、JNA、`affine_mobile_native`(UniFFI) |
| 被谁依赖  | 无（终端产物，产出 Google Play 的 AFFiNE Android App，AAB）                                                                                                                                                        |
| 构建产物  | `dist/`（Web 资产）+ Gradle 编译出的 `.aab`                                                                                                                                                                        |

## 1. 设计逻辑

### 外壳薄、核心厚（与 iOS 同一范式）

Android 端与 iOS 共享同一条设计准则：**业务全在 L4 的 `@affine/core`，外壳只提供入口、平台适配与原生桥**。`apps/android` 的 `src/` 是一份结构几乎镜像 iOS 的 TypeScript 代码——同样 `index.tsx` 挂载 React、`app.tsx` 装配 `Framework` DI、`setup.ts` 调视口参数、`plugins/*` 声明 Capacitor 插件 TS 侧。Web 内容是同一份 `dist`。

### Capacitor 混合应用模型

模型不变：系统 `WebView`（由 `MainActivity extends BridgeActivity` 托管）加载 `dist/index.html` 跑 `@affine/core`；Web 侧 `registerPlugin<T>('Name')` 拿代理，调用被 Capacitor bridge 送到原生；原生侧一个带 `@CapacitorPlugin(name="Name")` 注解的 `Plugin` 子类响应并 `call.resolve(...)` 回传。

### Android 独有部分（与 iOS 的差异）

虽然范式相同，Android 壳在以下几点与 iOS 明显分叉：

1. **宿主语言与构建系统**：Kotlin + Gradle（`App/app/build.gradle`），而非 Swift + Xcode。Rust/UniFFI 的编译与绑定生成**内嵌进 Gradle 任务**（`org.mozilla.rust-android-gradle` 插件 + 自定义 `generateUniFFIBindings` Exec 任务），而 iOS 是独立的 `codegen.ts` 脚本手动触发。
2. **GraphQL 走运行时而非预生成 Swift 包**：Android 没有 `codegen.ts`、没有 Apollo 代码生成脚本；原生侧用 **Apollo-Kotlin 运行时 + OkHttp**（`GraphQLService`/`SSEService`/`WebService`，经 Hilt 注入）直接发请求。
3. **更"厚"的原生层**：Android 壳内含一个 **Jetpack Compose 写的 AI 聊天界面**（`ai/AIActivity` + `ChatViewModel`）、**Hilt 依赖注入**（`@HiltAndroidApp`/`@AndroidEntryPoint`）、**Firebase**（Crashlytics/Analytics），以及为解决 Android `WebView` 对 `contenteditable` 输入法支持缺陷而写的一整套 **Android IME 桥**（`AffineImeBridge`/`AffineInputConnection`/`ImeReplayController`）。这是 Android 平台适配税最重的地方。
4. **插件集合不同**：Android 有 `ai-button`、`mobile-back`（系统返回手势），而没有 iOS 的 `image-picker`/`navigation-gesture`/`paywall`/`share-inbox`（付费走 Google Play 外部流程，分享/图片选择能力分布不同）。

### 与同层其它包的边界

与 iOS 完全一致：共享的 **TS 逻辑**在 `@affine/mobile-shared`，共享的 **Rust 原生实现**在 `affine_mobile_native`。`apps/android` 只装 **Android 独有的 Kotlin 壳与 Android 专属插件声明**。

## 2. 目录与关键文件

```text
apps/android/
├── package.json             # name=@affine/android；scripts: build/sync/sync:dev(10.0.2.2:8080)/studio(cap open android)
├── capacitor.config.ts      # appId=app.affine.pro, webDir='dist', android.path='App'；AAB keystore；SystemBars
├── README.md                # 开发说明：local.properties 配 rust.cargoCommand/rustcCommand
├── src/                     # ===== Web 侧（TypeScript，镜像 iOS）=====
│   ├── index.tsx            # 入口：bindNativeDBApis + createRoot 挂载 <App/>
│   ├── app.tsx              # Framework DI + window.* 回调 + nbstore Worker 客户端
│   ├── setup.ts             # 视口适配（注释说明 Android WebView 不易被杀，保留缩放范围）
│   ├── proxy.ts / setup-worker.ts / nbstore.worker.ts
│   └── plugins/             # affine-theme / ai-button / auth / hashcash / nbstore / preview / mobile-back.ts
└── App/                     # ===== 原生侧（Kotlin / Gradle）=====
    ├── build.gradle / settings.gradle / variables.gradle
    ├── gradle/libs.versions.toml      # 版本目录（version catalog）
    ├── capacitor.settings.gradle      # Capacitor 自动生成的插件模块清单
    ├── service/                       # 独立 Gradle 模块（网络/服务层）
    └── app/
        ├── build.gradle               # 应用模块：plugins/cargo{}/generateUniFFIBindings 任务
        ├── capacitor.build.gradle
        ├── proguard-rules.pro
        └── src/main/
            ├── AndroidManifest.xml    # MainActivity(singleTask) + affine:// 深链 + AIActivity + FileProvider
            └── java/
                ├── app/affine/pro/
                │   ├── AFFiNEApp.kt            # @HiltAndroidApp Application：WebView 预热 + Timber + Firebase
                │   ├── MainActivity.kt         # BridgeActivity 子类：注册插件 + WebView 配置 + AI FAB
                │   ├── AffineEditorWebView.kt / AffineImeBridge.kt / AffineInputConnection.kt  # IME 输入桥
                │   ├── AffineWebViewClient.kt / AuthInitializer.kt / CapacitorConfig.kt
                │   ├── plugin/*.kt             # 各插件 Kotlin 实现（Plugin + @CapacitorPlugin）
                │   ├── ai/                     # Compose AI 聊天：AIActivity + chat/ChatViewModel + ui/*
                │   ├── service/                # GraphQLService/SSEService/WebService/OkHttp（Hilt）
                │   └── theme/ components/ utils/
                └── uniffi/affine_mobile_native/affine_mobile_native.kt   # 生成物（UniFFI Kotlin 绑定）
```

## 3. 实现细节

### 3.1 Web 侧与 iOS 的镜像关系

`src/index.tsx` 与 iOS 几乎逐行一致：`bindNativeDBApis(NbStoreNativeDBApis)` 后 `createRoot(...).render(<App/>)`。`app.tsx` 的 DI 装配也同构——`configureCommonModules`/`configureBrowserWorkbenchModule`/`configureMobileModules`，再 `framework.impl(...)` 注入平台 Provider。差异点：Android 注入 `AIButtonProvider`（iOS 无），而不注入 iOS 的 `HapticProvider`/`NativePaywallProvider`：

```ts
// 来源：src/app.tsx（Android）—— grep 命中的注册点
framework.impl(NbstoreProvider, { ... });
framework.impl(PopupWindowProvider, { ... });
framework.impl(ValidatorProvider, { ... });     // hashcash
framework.impl(AIButtonProvider, { ... });       // ← Android 独有：悬浮 AI 按钮
framework.scope(ServerScope).override(AuthProvider, resolver => ({ ... }));  // 登录改走原生
```

`setup.ts` 的视口适配也比 iOS"温和"，注释直接点明原因——Android `WebView` 不像 `WKWebView` 那样容易被系统杀进程，所以**保留用户可见的缩放范围**，只减少手势期工作量与低缩放画布内存：

```ts
// 来源：src/setup.ts（Android）
// Android WebView is less prone to the iOS WKWebView process kill, so keep the
// user-facing zoom range unchanged.
viewportRuntimeConfig.SKIP_REFRESH_DURING_GESTURE = true;
viewportRuntimeConfig.OVERSCAN_RATIO = 0.2;
viewportRuntimeConfig.CANVAS_DPR_CAP_BY_ZOOM = [
  [0.5, 1],
  [0.8, 2],
];
// 注意：没有 iOS 的 ZOOM_MIN = 0.4
```

nbstore 的三段式链路（主线程桥 → Worker 存储引擎 → 原生插件 → Rust）与 iOS 完全相同，由 `@affine/nbstore` 与 `async-call-rpc` 提供，此处不赘述，差异只在最后一跳的原生实现语言。

### 3.2 Kotlin 插件范式（`app/.../plugin/*`）

对应 iOS 的 `CAPPlugin + CAPBridgedPlugin`，Android 用注解驱动。最小插件 `HashCashPlugin`：

```kotlin
// 来源：app/src/main/java/app/affine/pro/plugin/HashCashPlugin.kt
import uniffi.affine_mobile_native.hashcashMint        // ← UniFFI 生成的 Kotlin 符号

@CapacitorPlugin(name = "HashCash")                     // 注解提供 jsName（注意：iOS 是 "Hashcash"）
class HashCashPlugin : Plugin() {
  @PluginMethod
  fun hash(call: PluginCall) {
    launch(Dispatchers.IO) {                            // 扩展函数，内部用 activity.lifecycleScope
      val challenge = call.getString("challenge") ?: ""
      val bits = call.getInt("bits") ?: 20
      val hash = hashcashMint(resource = challenge, bits = bits.toUInt())  // Rust u32 ← Kotlin UInt
      call.resolve(JSObject().apply { put("value", hash) })
    }
  }
}
```

> **关键对称/差异**：TS 侧 `registerPlugin<HashCashPlugin>('HashCash')`（见 `src/plugins/hashcash/index.ts`）的名字 `'HashCash'` 必须等于注解 `name`。而 iOS 对应插件的 `jsName` 是 `"Hashcash"`——**两端大小写不同**，因为两端 TS 声明文件各自独立，各自与本端原生对齐，这是镜像结构下容易踩的坑。nbstore 插件名则两端统一为 `"NbStoreDocStorage"`。

协程桥接由一个扩展函数统一封装（对应 iOS 的 `DispatchQueue`/`Task`）：

```kotlin
// 来源：app/.../plugin/PluginExt.kt
fun Plugin.launch(context: CoroutineContext = EmptyCoroutineContext, ...) =
  activity?.lifecycleScope?.launch(context, start, block)
fun PluginCall.getStringEnsure(key: String): String =
  getString(key) ?: throw IllegalArgumentException("Missing $key parameter")
```

`NbStorePlugin` 与 iOS 对称地持有 UniFFI 的 `DocStoragePool`，差别只是 Kotlin 的惰性初始化与 `suspend` 调用：

```kotlin
// 来源：app/.../plugin/NbStorePlugin.kt
@CapacitorPlugin(name = "NbStoreDocStorage")
class NbStorePlugin : Plugin() {
  private val docStoragePool by lazy { newDocStoragePool() }   // UniFFI 自由函数
  @PluginMethod fun connect(call: PluginCall) {
    launch(Dispatchers.IO) {
      val db = peerDir.resolve("$spaceId.db")
      docStoragePool.connect(id, db.path)                      // suspend 调用（UniFFI async→suspend）
      call.resolve()
    }
  }
}
```

`PreviewPlugin` 同样调 UniFFI 的 `renderMermaidPreviewSvg` / `renderTypstPreviewSvg`，与 iOS 的 Swift 版逻辑一一对应（含 Typst 字体目录的本地路径校验）。

### 3.3 Activity 宿主与插件注册（`MainActivity.kt`）

iOS 在 `capacitorDidLoad` 里注册插件**实例**；Android 在 `BridgeActivity` 的 `init` 块里注册插件**类**（由 Capacitor 实例化）：

```kotlin
// 来源：app/.../MainActivity.kt
@AndroidEntryPoint
class MainActivity : BridgeActivity(), AIButtonPlugin.Callback, AFFiNEThemePlugin.Callback, View.OnClickListener {
  @Inject lateinit var webService: WebService       // Hilt 注入（iOS 无等价物）
  @Inject lateinit var sseService: SSEService
  @Inject lateinit var graphQLService: GraphQLService
  init {
    registerPlugins(listOf(
      AFFiNEThemePlugin::class.java, AIButtonPlugin::class.java, AuthPlugin::class.java,
      HashCashPlugin::class.java, NbStorePlugin::class.java, MobileBackPlugin::class.java,
      PreviewPlugin::class.java,
    ))
  }
  override fun load() {                               // WebView 加载时机的钩子
    super.load()
    configureAndroidIMEBridge()                        // ← Android 特有：装 IME 输入桥
    AuthInitializer.initialize(bridge)
    configureEditorWebView()
  }
  override fun onTrimMemory(level: Int) {              // 对应 iOS didReceiveMemoryWarning
    if (level >= TRIM_MEMORY_UI_HIDDEN)
      bridge.webView.evaluateJavascript("window.dispatchEvent(new Event('affine:memory-pressure'))", null)
  }
}
```

`configureEditorWebView` 关掉 WebView 缩放、按 `BuildConfig.DEBUG` 决定是否允许混合内容（dev server 走 http），`onClick` 则在点 AI 悬浮按钮（`FloatingActionButton`）时刷新服务并打开 Compose 的 `AIActivity`——这些 Compose UI 是 Android 壳比 iOS"厚"出来的部分。

### 3.4 Application 与原生基建（`AFFiNEApp.kt`）

```kotlin
// 来源：app/.../AFFiNEApp.kt
@HiltAndroidApp
class AFFiNEApp : Application() {
  override fun onCreate() {
    super.onCreate()
    startWebView()                                    // WebViewCompat.startUpWebView 异步预热，缩短首帧
    if (BuildConfig.DEBUG) Timber.plant(AffineDebugTree())
    else Timber.plant(CrashlyticsTree(), FileTree(applicationContext))  // 日志落 Crashlytics/文件
    CapacitorConfig.init(baseContext)
    Firebase.crashlytics.setCustomKeys { key("affine_version", CapacitorConfig.getAffineVersion()) }
  }
}
```

`@HiltAndroidApp` 生成 Hilt 的依赖注入根；`WebViewCompat.startUpWebView` 在应用启动时异步预热 WebView 进程（iOS 无此需求）；Firebase Crashlytics 是 Android 独有的崩溃上报（iOS 侧不依赖 Firebase）。

### 3.5 Gradle 构建与 Rust/UniFFI 内嵌（`app/build.gradle`）

这是 Android 与 iOS 构建链最大的分野：iOS 用独立 `codegen.ts` + `cargo` 命令手动生成，Android 把 Rust 编译与绑定生成**织进 Gradle 任务图**。

```gradle
// 来源：app/build.gradle
plugins {
  alias libs.plugins.android.application
  alias libs.plugins.kotlin.android
  alias libs.plugins.ksp                 // KSP（Hilt 注解处理）
  alias libs.plugins.rust.android        // org.mozilla.rust-android-gradle
  alias libs.plugins.compose             // Jetpack Compose
  alias libs.plugins.firebase.crashlytics
  alias libs.plugins.hilt
}

cargo {                                   // rust-android-gradle 配置块
  module = "../../../../mobile-native"    // 指向 packages/frontend/mobile-native
  libname = "affine_mobile_native"
  features { defaultAnd("use-as-lib") }
  targets = [nativeTarget]                // arm64 / x86_64（由 AFFINE_ANDROID_NATIVE_TARGET 决定）
  targetDirectory = "../../../../../../target"
  apiLevel = 28
  targetIncludes = ["libaffine_mobile_native.so"]   // cdylib（对比 iOS 用 staticlib）
  profile = providers.environmentVariable("AFFINE_ANDROID_CARGO_PROFILE").getOrElse("release")
}
```

绑定生成是一个自定义 `Exec` 任务，依赖 `cargoBuild`，再被 `javaCompile` 依赖，从而"编 Rust → 生成 Kotlin 绑定 → 编 Kotlin"自动串联：

```gradle
// 来源：app/build.gradle
def t = tasks.register("generate${variantName}UniFFIBindings", Exec) {
  commandLine "${cargoPath}", 'run', '--bin', 'uniffi-bindgen', 'generate',
    '--library', "${buildDir}/rustJniLibs/android/${nativeAbi}/libaffine_mobile_native.so",
    '--language', 'kotlin', '--out-dir', "${project.projectDir}/src/main/java"
  dependsOn("cargoBuild")
}
variant.javaCompileProvider.get().dependsOn(t)
```

`cargoPath` 从 `local.properties` 的 `rust.cargoCommand` 读取（`README.md` 要求开发者配置），因为 Gradle 子进程不继承 shell 的 `PATH`。Rust 产物是 `.so`（动态库，经 JNA 在运行时加载），而 iOS 是 `.a`（静态库链接进 App）——这正是 affine-mobile-native.md 里 `crate-type = ["cdylib","staticlib"]` 两种产物各服务一端的落点。

### 3.6 Capacitor 配置差异（`capacitor.config.ts`）

```ts
// 来源：capacitor.config.ts（Android）
const config = {
  appId: 'app.affine.pro', appName: 'AFFiNE', webDir: 'dist',
  android: {
    path: 'App',
    buildOptions: { keystorePath: ..., releaseType: 'AAB' },   // 产物是 Android App Bundle
  },
  plugins: {
    SystemBars: { insetsHandling: 'css' },                     // 系统栏 inset 交给 CSS 处理
    CapacitorHttp: { enabled: false }, CapacitorCookies: { enabled: false },
  },
};
if (capServerUrl) config.server = { url: capServerUrl, cleartext: allowsCleartextServer };  // http 允许明文
```

与 iOS 的差异：Android 产 `AAB`、配 keystore 签名、处理 `SystemBars` 而非 iOS 的 `Keyboard.resize`；`sync:dev` 的 dev server 地址是 `http://10.0.2.2:8080`（Android 模拟器回环到宿主机的特殊地址），而 iOS 是 `localhost:8080`。

## 4. 语法特色

### TypeScript 侧

与 iOS 共享同一套（`registerPlugin<T>` 泛型契约、`NativeDBApis` 接口实现、`MessageChannel`+`async-call-rpc` 类型化 RPC、`window as any` 反向桥），详见 affine-ios.md 第 4 节，此处不重复。镜像结构下唯一需警惕的是**插件名字符串两端各自维护**（如 `HashCash` vs `Hashcash`）。

### Kotlin 侧

- **`@CapacitorPlugin(name="X")` 注解驱动注册**：Capacitor Android 用注解处理在编译期登记插件元数据，运行时 `registerPlugins(listOf(X::class.java))` 传 `Class` 由框架反射实例化——对比 iOS 传现成实例，Android 是"传类让框架 new"。
- **`@PluginMethod fun m(call: PluginCall)`**：方法签名固定收一个 `PluginCall`，用 `call.getString(...) ?: default` 取可空参数、`call.resolve(JSObject().apply { put(...) })` 回传——`apply { }` 作用域函数让构建返回对象的代码扁平化。
- **协程 + `Dispatchers.IO`**：`launch(Dispatchers.IO) { ... }` 把阻塞/IO 工作切到 IO 线程池，UniFFI 的 `suspend` 方法（Rust `async fn` 生成而来）在协程里自然 `await`；扩展函数 `Plugin.launch` 把 `activity.lifecycleScope` 封装起来，保证协程随 Activity 生命周期取消。
- **Kotlin 无符号类型对齐 FFI**：`bits.toUInt()` 把 `Int` 转 `UInt` 以匹配 Rust 的 `u32`——UniFFI 生成的 Kotlin 绑定用 Kotlin 原生无符号类型表达 Rust 的无符号整数。
- **`by lazy { }` 惰性单例**：`private val docStoragePool by lazy { newDocStoragePool() }` 让存储池首次使用时才构造，对应 iOS 的即时 `let` 初始化但更省启动开销。
- **Hilt 注解**：`@HiltAndroidApp`（Application 生成注入根）、`@AndroidEntryPoint`（Activity 成为注入点）、`@Inject lateinit var`（字段注入）——这套 DI 是 iOS 壳完全没有的原生基建。

### Gradle 侧

- **Version Catalog（`libs.versions.toml`）+ `alias libs.plugins.*`**：集中管理依赖版本，`alias` 引用让插件声明类型安全、可复用。
- **`afterEvaluate` + `tasks.register(..., Exec)` 动态建任务**：按每个 build variant 动态生成 `cargoBuild`/`generateUniFFIBindings` 依赖关系——因为 `cargoBuild` 任务要到工程求值后才存在。

## 5. 设计 / 实现亮点

- **与 iOS 高度对称的双端结构**：`src/` 几乎镜像，插件按名字配对，存储链路同构——读懂一端即读懂另一端，降低跨端维护成本。差异被刻意收敛到"宿主语言 + 构建链 + 平台适配"三处。
- **构建链自动化织入 Gradle**："Rust 编译 → UniFFI Kotlin 绑定 → Kotlin 编译"全部由 Gradle 任务依赖驱动，开发者一条 `cap sync` + Android Studio 构建即可，无需像 iOS 那样手动跑 codegen。
- **按平台调教的视口策略**：同一套 `viewportRuntimeConfig` 旋钮，iOS 因 `WKWebView` 易被杀而激进压内存、Android 因 `WebView` 稳健而保留体验——同一核心、不同外壳参数，是"薄壳做适配"的典型。
- **WebView 启动预热**：`WebViewCompat.startUpWebView` 在 `Application.onCreate` 异步初始化 WebView 进程，把混合应用最大的冷启动成本提前摊销。
- **直面 Android IME 顽疾**：为 `contenteditable` 在 Android `WebView` 上的输入法问题写了专门的 `AffineImeBridge`/`AffineInputConnection`/`ImeReplayController` 原生桥——这是 Web 技术栈在 Android 上最难啃的骨头，外壳在此承担了最重的适配。

## 6. 对外 API 与注意事项

- **本包无 JS 导出给其它包**：终端应用，`src/plugins/*` 仅供自身使用。
- **插件名两端各自维护**：改插件名需同步 TS `registerPlugin('X')` 与 Kotlin `@CapacitorPlugin(name="X")`；注意同一能力在 iOS/Android 的名字可能大小写不同（`HashCash`/`Hashcash`）。
- **必须配置 `rust.cargoCommand`**：`App/local.properties` 要写 `rust.cargoCommand`/`rust.rustcCommand` 绝对路径（见 `README.md`），否则 Gradle 子进程找不到 cargo。
- **`uniffi/affine_mobile_native.kt` 是生成物**：由 `generateUniFFIBindings` 任务产出，勿手改；改 Rust 导出重新构建即可再生成。
- **原生插件只能在主线程/WebView 上下文调用**：与 iOS 同，Worker 里的存储引擎经 `MessageChannel` RPC 回主线程才触达原生。
- **dev server 地址**：模拟器用 `http://10.0.2.2:8080`（回环宿主机），`cleartext` 仅 debug 开启；release 构建 `mixedContentMode = NEVER_ALLOW`。
- **产物与签名**：release 走 `AAB` + keystore，环境变量 `AFFINE_ANDROID_KEYSTORE_PASSWORD` 等提供密钥口令；`AFFINE_ANDROID_NATIVE_TARGET` 控制 ABI（默认 `arm64`→`arm64-v8a`）。

## 7. 延伸

- **原生桥底座**：`affine-mobile-native.md`（UniFFI Rust→Kotlin 绑定；`hashcashMint`/`DocStoragePool`/`renderMermaidPreviewSvg` 的 Rust 实现，`cdylib` 产物供 Android `.so`）。
- **共享 TS 逻辑**：`affine-mobile-shared.md`（鉴权请求代理、blob 文件 token 解码，被 `src/proxy.ts`、`plugins/nbstore` 复用）。
- **对称外壳**：`affine-ios.md`（Swift/Xcode 版；对照阅读可快速把握两端差异）。
- **复用的核心**：`@affine/core`（`configureMobileModules` 等）、`@affine/nbstore`（存储引擎与 `NativeDBApis` 契约）、`@toeverything/infra`（`Framework` DI，见 toeverything-infra.md）。
