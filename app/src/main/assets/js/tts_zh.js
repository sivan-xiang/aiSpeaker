// 中文语音引擎（诗词 tab 专用）—— sherpa-onnx 离线中文 TTS，模型内置打包。
//
// 与英文 Kokoro 引擎对外暴露完全一致的接口，因此 app.js 无需任何改动：
//   initTTS / listVoices / speak / stopAll / pauseTTS / resumeTTS / togglePause / isPaused
//
// 运行方式：
//   1) 运行 scripts/fetch_sherpa_zh.py，把 sherpa-onnx 的 wasm 运行时 + 一个中文模型
//      下载并放进 assets（完全离线、随 APK 打包）；
//   2) 运行时优先加载本地 ./sherpa-onnx-wasm.js，找不到再回退到 CDN（esm.sh），
//      保证「没跑脚本」时联网也能用，跑了脚本后则 100% 离线。
import { TTS_CONFIG } from "./sherpa-zh-model.js";

// 动态加载 sherpa-onnx wasm 运行时（本地优先，CDN 兜底）
let sherpaMod = null;
let sherpaPromise = null;
async function loadSherpa() {
  if (sherpaMod) return sherpaMod;
  if (sherpaPromise) return sherpaPromise;
  sherpaPromise = (async () => {
    let mod;
    try {
      // 优先用随 APK 打包的本地运行时（离线）
      mod = await import("./sherpa-onnx-wasm.js");
    } catch (e) {
      console.warn("[tts_zh] 本地 sherpa-onnx 未找到，回退 CDN：", e);
      mod = await import("https://esm.sh/@sherpa-onnx/wasm");
    }
    if (!mod || typeof mod.createOfflineTts !== "function") {
      throw new Error("sherpa-onnx 运行时缺少 createOfflineTts 导出");
    }
    return mod;
  })().catch((e) => { sherpaPromise = null; throw e; });
  return sherpaPromise;
}

// 对外暴露的音色（沿用原 id，保证 app.js 默认音色 "zf_xiaoxiao" 仍可命中）。
// sid = sherpa 说话人编号（vits-icefall-zh-aishell3 共 174 个说话人，这里挑 8 个）。
const ZH_VOICES = [
  { id: "zf_xiaoxiao", name: "中文女声 1", sid: 0 },
  { id: "zf_xiaobei",  name: "中文女声 2", sid: 1 },
  { id: "zf_xiaoni",   name: "中文女声 3", sid: 2 },
  { id: "zf_xiaoyi",   name: "中文女声 4", sid: 3 },
  { id: "zm_yunjian",  name: "中文男声 1", sid: 4 },
  { id: "zm_yunxi",    name: "中文男声 2", sid: 5 },
  { id: "zm_yunxia",   name: "中文男声 3", sid: 6 },
  { id: "zm_yunyang",  name: "中文男声 4", sid: 7 },
];

let tts = null;
let ttsPromise = null;
let audioCtx = null;
let playing = [];
let stopped = false;
let paused = false;
let resumeWaiters = [];
let currentSid = 0;

export function listVoices() {
  return ZH_VOICES;
}

function sidFor(voice) {
  const v = ZH_VOICES.find((x) => x.id === voice);
  return v ? v.sid : 0;
}

export async function initTTS(setStatus) {
  if (tts) return tts;
  if (ttsPromise) return ttsPromise;
  setStatus?.("正在初始化中文 TTS（sherpa-onnx）…");
  ttsPromise = (async () => {
    const mod = await loadSherpa();
    if (typeof mod.initWasm === "function") await mod.initWasm();
    const inst = await mod.createOfflineTts(TTS_CONFIG);
    tts = inst;
    return inst;
  })().catch((e) => { ttsPromise = null; throw e; });
  return ttsPromise;
}

// 启动即预热中文模型（后台异步，不阻塞 UI；与英文引擎的自动下载一致）。
initTTS().catch(() => {});

// --- Native bridge（在 App WebView 内通过 @JavascriptInterface 驱动媒体通知；浏览器里是 no-op）---
function notifyNative(method, arg) {
  try {
    const b = window.AndroidBridge;
    if (b && typeof b[method] === "function") b[method](arg || "");
  } catch (e) { /* ignore */ }
}

function ensureCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended" && !paused) audioCtx.resume();
  return audioCtx;
}

function waitIfPaused() {
  if (!paused) return Promise.resolve();
  return new Promise((res) => resumeWaiters.push(res));
}

// 把 sherpa 生成的 Float32 音频播放出来，返回「播放结束」的 Promise（便于逐句串接 + 支持暂停）。
function playAudio(audio) {
  return new Promise((resolve) => {
    const ctx = ensureCtx();
    const sr = audio.sampleRate || 22050;
    const buf = ctx.createBuffer(1, audio.samples.length, sr);
    buf.copyToChannel(audio.samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const finish = () => {
      playing = playing.filter((s) => s !== src);
      resolve();
    };
    src.onended = finish;
    src.start();
    playing.push(src);
  });
}

export function stopAll() {
  stopped = true;
  paused = false;
  playing.forEach((s) => { try { s.stop(); } catch (e) { /* ignore */ } });
  playing = [];
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  notifyNative("onTtsStop");
}

export function pauseTTS() {
  if (paused || stopped) return;
  paused = true;
  if (audioCtx) audioCtx.suspend(); // 暂停正在播放的 buffer
  notifyNative("onTtsPause");
}

export function resumeTTS() {
  if (!paused) return;
  paused = false;
  if (audioCtx) audioCtx.resume();
  const ws = resumeWaiters;
  resumeWaiters = [];
  ws.forEach((r) => r());
  notifyNative("onTtsResume");
}

export function togglePause() {
  if (paused) resumeTTS(); else pauseTTS();
}

export function isPaused() {
  return paused;
}

// 按中文/英文标点与换行切句，避免一次性合成过长文本（sherpa 单次 maxNumSentences=1）。
function chunkText(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [clean];
  const out = [];
  let buf = "";
  for (const p of parts) {
    if ((buf + p).length > 120) {
      if (buf) out.push(buf);
      buf = p;
    } else {
      buf += p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export async function speak(text, voice, setStatus, title) {
  stopped = false;
  paused = false;
  currentSid = sidFor(voice || "zf_xiaoxiao");
  const sentences = chunkText(text);
  if (!sentences.length) { setStatus?.("没有可朗读的文本"); return; }
  await initTTS(setStatus);
  // 通知原生层：开始前台播放 + 媒体通知
  notifyNative("onTtsStart", title || "");
  for (let i = 0; i < sentences.length; i++) {
    if (stopped) break;
    await waitIfPaused();
    if (stopped) break;
    const audio = await tts.generate({ text: sentences[i], sid: currentSid, speed: 1.0 });
    if (stopped) break;
    await waitIfPaused();
    if (stopped) break;
    await playAudio(audio);
    setStatus?.("朗读中…");
  }
  if (!stopped) {
    setStatus?.("完成");
    notifyNative("onTtsStop"); // 自然结束，收起通知
  }
}
