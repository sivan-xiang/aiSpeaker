# 朗读壳 ReadAloud（WebView 薄壳 + 网页端 Kokoro 本地推理）

一个**极简的 Android 应用壳**：原生层只有一个 `WebView`，所有功能（阅读 UI、内容获取、TTS）都在网页层实现。TTS 通过 **Kokoro-82M** 在 WebView 内**完全本地推理**（基于 Transformers.js，不联网、不依赖任何云端 API），满足「内置 Kokoro-82M + 本地推理」的诉求，同时把原生工程复杂度降到最低。

## 架构

```
Android (WebView 薄壳)
   └── assets/index.html  (网页应用)
         ├── js/tts.js      → kokoro-js（onnx-community/Kokoro-82M-v1.0-ONNX，wasm 本地推理）
         ├── js/app.js      → 标签页 / 书架 / 阅读器 / TTS 控制
         ├── js/data/poems.js → 诗词数据（内置示例 + 远程 URL 配置）
         └── css/style.css
```

- **推理在哪**：模型在 WebView 的浏览器引擎里跑，属于「端侧本地」。首次启动会从 CDN 拉取 `kokoro-js` 库与模型权重（约几十 MB），之后由 WebView 缓存，断网也能用。
- **音频播放**：`tts.generate()` 返回 `Float32Array`（24kHz），经 Web Audio `AudioContext` 播放。

## 内容来源（三大类，均已接入）

| 模块 | 来源 | 说明 |
| --- | --- | --- |
| 诗词 | 内置 12 首示例 + 可配置远程 JSON | 在 `js/data/poems.js` 填 `POETRY_REMOTE_URL` 接你的「诗词游乐场」lite 数据集，或 `chinese-poetry` 格式 |
| 英文公版书 | Project Gutenberg（经 Gutendex 镜像） | 拉取书目 → 取 `text/plain` 正文 → 朗读 |
| Standard Ebooks | OPDS 目录 | 解析条目 → 拉取正文（HTML 去标签）→ 朗读 |

## 环境要求

- **Android Studio** (Hedgehog 及以上) + **JDK 21**（已验证环境为 JDK 21）
- **minSdk 24**，target/compileSdk 35
- 首次启动需**联网**（下载库与模型）；之后可离线
- 测试设备：Android 8.0+（ONNX Runtime Web 的 wasm 后端不依赖 NNAPI/GPU）

## 构建与运行

1. 用 Android Studio 打开本目录（`File → Open`，选 `ReadAloudApp/`）。
2. 等待 Gradle 同步（首次会下载 Gradle 8.9 与依赖）。
   - 若 `./gradlew` 提示缺少 wrapper，可在已装 Gradle 的环境执行 `gradle wrapper`，或直接让 Android Studio 在打开时重新生成 wrapper。
3. 连接设备或启动模拟器，`Run 'app'`。
4. 进入 App 后点任意「朗读」按钮：首次会自动下载 Kokoro 模型（状态栏有提示），完成后开始朗读。

## 自定义

- **接你自己的诗词数据**：编辑 `app/src/main/assets/js/data/poems.js`
  - 把 `POETRY_REMOTE_URL` 改成你的 lite JSON 地址（返回 `[{title, author, content}]`，或兼容 `{title, author, paragraphs:[...]}` 的 chinese-poetry 格式），然后点「从网络加载诗词」。
  - 或直接往 `SAMPLE_POEMS` 里加数据。
- **音色**：朗读前会从 `tts.list_voices()` 填充下拉框；默认 `af_heart`（美式女声）。完整列表见运行时下拉。
- **推理后端/精度**（`js/tts.js` 的 `initTTS`）：
  - `device: "wasm"` + `dtype: "q8"`：通用、稳定、体积小（当前默认）。
  - 若设备浏览器支持 WebGPU，可改 `device: "webgpu"` + `dtype: "fp32"` 提升音质与速度。
- **停顿/注音**：Kokoro 支持 SSML（如 `<break/>`、`<phoneme>`），可在传入 `speak()` 前对文本做 SSML 包装，适合诗词按句停顿。

## 已知限制

- **Standard Ebooks** 目前走「OPDS 条目 → 在线正文页 HTML → 去标签朗读」；未解析 EPUB 二进制，长书可能偏慢。需要更精确正文可后续解析其 XHTML。
- **WebGPU** 在部分 Android WebView 上需安全上下文；当前默认 wasm 以保兼容。
- 模型权重与 JS 库首次需联网下载（一次性，已缓存）。
- 本仓库未包含 Gradle wrapper 二进制（`gradle-wrapper.jar`）；Android Studio 打开时会自动处理。

## 隐私

文本与音频全程不离开设备；唯一的联网动作是首次拉取开源模型权重（Apache-2.0）。
