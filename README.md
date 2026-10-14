# 朗读壳 ReadAloud（WebView 薄壳 + 网页端 Kokoro 本地推理）

一个**极简的 Android 应用壳**：原生层只有一个 `WebView`，所有功能（阅读 UI、内容获取、TTS）都在网页层实现。TTS 通过 **Kokoro-82M** 在 WebView 内**完全本地推理**（基于 Transformers.js，不联网、不依赖任何云端 API），满足「内置 Kokoro-82M + 本地推理」的诉求，同时把原生工程复杂度降到最低。

## 架构

```
Android (WebView 薄壳)
   └── assets/index.html  (网页应用)
         ├── js/tts.js      → 英文引擎：kokoro-js（onnx-community/Kokoro-82M-v1.0-ONNX，wasm 本地推理）
         ├── js/tts_zh.js   → 中文引擎（诗词 tab 专用）：sherpa-onnx 离线中文 TTS（模型内置打包）
         ├── js/app.js      → 标签页 / 书架 / 阅读器 / 双引擎分发
         ├── js/sherpa-zh-model.js → 中文模型路径配置（脚本自动生成）
         └── tts_zh_model/  → sherpa-onnx 中文模型文件（随 APK 内置，离线）
         ├── js/data/poems.js → 诗词数据（内置示例 + 远程 URL 配置）
         └── css/style.css
```

- **双引擎分发**：诗词 tab 走**中文引擎**（sherpa-onnx 离线中文 TTS），英文公版书（Gutenberg / Standard Ebooks）走英文引擎（Kokoro）。两套引擎接口完全隔离，对外暴露同一组函数（`listVoices / initTTS / speak / stopAll / pauseTTS / resumeTTS / togglePause / isPaused`），因此 `js/app.js` 无需改动。中文引擎的 wasm 运行时与模型**随 APK 内置打包**，断网也能用。
- **推理在哪**：模型在 WebView 的浏览器引擎里跑，属于「端侧本地」。首次启动会从 CDN 拉取 `kokoro-js` 库与模型权重（约几十 MB），之后由 WebView 缓存，断网也能用。
- **音频播放**：`tts.generate()` 返回 `Float32Array`（24kHz），经 Web Audio `AudioContext` 播放。

## 内容来源（三大类，均已接入）

| 模块 | 来源 | 说明 |
| --- | --- | --- |
| 诗词 | **内置「诗词游乐场」lite 数据集（小学必背 75 首）**，离线即用 + 可配置远程 JSON | 数据来自 `js/data/poems_classic_0.js`（由 `poems_classic_0.json` 转换）。在 `js/data/poems.js` 填 `POETRY_REMOTE_URL` 可远程覆盖，或接 `chinese-poetry` 格式 |
| 英文公版书 | Project Gutenberg（经 Gutendex 镜像） | 拉取书目 → 取 `text/plain` 正文 → 朗读 |
| Standard Ebooks | OPDS 目录 | **解析 XHTML 章节正文**：OPDS 条目 → `/text` 目录页 → 抓取每个 `/text/chapter-N` XHTML → 抽取可读正文拼接成全文（已过滤扉页/版权/目录等非正文章节）|

## 后台播放 / 系统媒体通知

朗读时会启动一个**前台服务**（Foreground Service，类型为 `mediaPlayback`），并在通知栏显示一个**媒体风格通知**，带「暂停 / 播放 / 停止」按钮。即使把 App 切到后台、锁屏，朗读也会继续；通知上的按钮与耳机线控、蓝牙按键会回控 WebView 内的 Kokoro 朗读（通过 `MediaSessionCompat` + `@JavascriptInterface` 桥接）。

- 实现要点：
  - `MainActivity` 创建 `MediaSessionCompat`，媒体按钮回调通过 `webView.evaluateJavascript` 调用 `window.__ttsPause / __ttsResume / __ttsStop`（在 `js/tts.js` 暴露）。
  - `tts.js` 在开始/暂停/继续/结束时通过 `window.AndroidBridge.onTtsStart/onTtsPause/onTtsResume/onTtsStop` 通知原生层，原生据此更新 `MediaSession` 状态并启动/停掉前台服务与通知。
  - `PlaybackService` 负责构造 `NotificationCompat.MediaStyle` 通知（`androidx.media:media`）。
- 首次启动会请求「通知」权限（Android 13+）。

## 中文 TTS（sherpa-onnx，离线内置）

诗词 tab 使用 **sherpa-onnx** 的离线中文 TTS（基于 ONNX Runtime WASM，CPU 推理），模型文件**随 APK 内置打包**，不联网、不依赖任何云端 API。英文书仍走 Kokoro。

首次使用前需把运行时与模型放进 `assets/`（在你**自己的电脑上**联网跑一次即可，之后完全离线）：

```bash
# 在 ReadAloudApp/ 目录下（需 Python 3.10+）
py -3.10 scripts/fetch_sherpa_zh.py
# 重新下载加 --force
```

脚本会：

1. 从 npm 拉取 `@sherpa-onnx/wasm`，把 wasm 运行时（`sherpa-onnx-wasm.js` + `*.wasm`）放进 `app/src/main/assets/js/`；
2. 从 sherpa-onnx 官方 release 下载中文模型（默认 `vits-icefall-zh-aishell3`），解压到 `app/src/main/assets/tts_zh_model/`；
3. 按实际解压出来的文件名**自动生成** `app/src/main/assets/js/sherpa-zh-model.js`（模型路径配置）。

运行后新增的产物都会进 APK 体积（模型约 30~120MB，取决于所选模型），属于一次性内置。

- **换模型**：编辑 `scripts/fetch_sherpa_zh.py` 顶部的 `MODEL` / `MODEL_URL`（例如更大的 `vits-zh-hf-theresa`），重新运行脚本即可，无需改其他代码。
- **音色**：诗词 tab 默认提供 8 个中文说话人（`zf_xiaoxiao` 等，对应 sherpa 的不同 `sid`），下拉框在页面加载时即填充，与原 Kokoro 中文音色 id 保持一致。
- **运行时兜底**：`tts_zh.js` 优先加载本地打包的 `./sherpa-onnx-wasm.js`，若未跑脚本则自动回退到 CDN（`esm.sh`），保证「没跑脚本」时联网也能用。
- **WebView 要求**：`MainActivity` 已开启 `allowFileAccessFromFileURLs` / `allowUniversalAccessFromFileURLs`，以便 `file://` 加载同目录 ES 模块与 `.wasm`/`.onnx`。

## 环境要求

- **Android Studio** (Hedgehog 及以上) + **JDK 21**（已验证环境为 JDK 21）
- **minSdk 24**，target/compileSdk 35
- 首次启动需**联网**（英文 Kokoro 的库与模型走 CDN，之后可离线）；**中文 sherpa-onnx 的运行时与模型**需先在本机跑一次 `scripts/fetch_sherpa_zh.py` 拉取并内置打包，之后中文朗读全程离线、不联网。
- 测试设备：Android 8.0+（ONNX Runtime Web 的 wasm 后端不依赖 NNAPI/GPU）

## 构建与运行

1. 用 Android Studio 打开本目录（`File → Open`，选 `ReadAloudApp/`）。
2. 等待 Gradle 同步（首次会下载 Gradle 8.9 与依赖）。
   - 若 `./gradlew` 提示缺少 wrapper，可在已装 Gradle 的环境执行 `gradle wrapper`，或直接让 Android Studio 在打开时重新生成 wrapper。
3. 连接设备或启动模拟器，`Run 'app'`。
4. 进入 App 后**自动开始下载** Kokoro 模型（状态栏实时提示进度），无需等点「朗读」；首次约几十 MB，之后走 WebView 缓存、可离线。模型就绪后即可朗读。

## 自定义

- **接你自己的诗词数据**：编辑 `app/src/main/assets/js/data/poems.js`
  - 默认已内置「诗词游乐场」lite 数据集（75 首，`js/data/poems_classic_0.js`）。
  - 把 `POETRY_REMOTE_URL` 改成你的 lite JSON 地址（返回 `[{title, author, content}]`，或兼容 `{title, author, paragraphs:[...]}` 的 chinese-poetry 格式），然后点「从网络加载诗词」即可远程覆盖。
  - 字段已校准：`paragraphs[]` → 正文；`dynasty + author` → 作者显示。
- **音色**：下拉框在**页面加载时即填充**；模型首次加载完成后会用权威列表刷新，并尽量保留你已选的音色。诗词 tab 自动切到中文音色（`zf_xiaoxiao` 等），英文书 tab 用英文音色（默认 `af_heart`）。
- **推理后端/精度**（`js/tts.js` 的 `initTTS`）：
  - `device: "wasm"` + `dtype: "q8"`：通用、稳定、体积小（当前默认）。
  - 若设备浏览器支持 WebGPU，可改 `device: "webgpu"` + `dtype: "fp32"` 提升音质与速度。
- **停顿/注音**：Kokoro 支持 SSML（如 `<break/>`、`<phoneme>`），可在传入 `speak()` 前对文本做 SSML 包装，适合诗词按句停顿。

## 已知限制

- **后台播放依赖前台服务**：切后台后朗读靠前台服务保活，部分厂商 ROM 的激进后台清理仍可能中断；若被回收，重新打开 App 即可。
- **Standard Ebooks** 走「OPDS → `/text` 目录 → 逐章抓取 XHTML 抽取正文」，章节较多时首次加载会发较多请求、略慢；已过滤扉页/版权/目录等无关章节。
- **中文朗读已升级为 sherpa-onnx 离线引擎**：诗词 tab 现在用 sherpa-onnx（vits-icefall-zh-aishell3 等中文模型）做真正的端侧中文合成，比早期「Kokoro 中文音色近似」更自然地道；模型随 APK 内置打包，需先跑一次 `scripts/fetch_sherpa_zh.py` 拉取运行时与权重。若想换更大/更高质量的中文模型，改脚本顶部 `MODEL` 重新运行即可。
- **WebGPU** 在部分 Android WebView 上需安全上下文；当前默认 wasm 以保兼容。
- 模型权重与 JS 库首次需联网下载（一次性，已缓存）。
- 本仓库未包含 Gradle wrapper 二进制（`gradle-wrapper.jar`）；Android Studio 打开时会自动处理。

## 隐私

文本与音频全程不离开设备；唯一的联网动作是首次拉取开源模型权重（Apache-2.0）。
