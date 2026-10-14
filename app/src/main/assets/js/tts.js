// Kokoro Web — runs 100% on-device inside the WebView via Transformers.js.
// Model: onnx-community/Kokoro-82M-v1.0-ONNX (Apache-2.0).
// On first launch the lib + model are fetched from a CDN, then cached by the WebView.
import { KokoroTTS } from "https://esm.sh/kokoro-js";

let tts = null;
let ttsPromise = null; // 去重并发加载，保证多次调用只下载一次
let audioCtx = null;
let playing = [];
let stopped = false;
let paused = false;
let queue = [];
let resumeWaiters = [];

// 内置兜底音色列表（Kokoro-82M 常见音色）。模型未加载、或静态 list_voices 不可用时使用，
// 保证下拉框在页面加载时即可选，不依赖模型下载。
const FALLBACK_VOICES = [
  { id: "af_heart", name: "af_heart", gender: "female" },
  { id: "af_bella", name: "af_bella", gender: "female" },
  { id: "af_nicole", name: "af_nicole", gender: "female" },
  { id: "af_sarah", name: "af_sarah", gender: "female" },
  { id: "af_sky", name: "af_sky", gender: "female" },
  { id: "am_michael", name: "am_michael", gender: "male" },
  { id: "am_echo", name: "am_echo", gender: "male" },
  { id: "am_puck", name: "am_puck", gender: "male" },
  { id: "am_liam", name: "am_liam", gender: "male" },
  { id: "bf_emma", name: "bf_emma", gender: "female" },
  { id: "bf_alice", name: "bf_alice", gender: "female" },
  { id: "bf_lily", name: "bf_lily", gender: "female" },
  { id: "bm_george", name: "bm_george", gender: "male" },
  { id: "bm_daniel", name: "bm_daniel", gender: "male" },
  { id: "bm_fable", name: "bm_fable", gender: "male" },
  { id: "bm_lewis", name: "bm_lewis", gender: "male" },
];

export async function initTTS(setStatus) {
  if (tts) return tts;
  if (ttsPromise) return ttsPromise; // 已有进行中的加载，复用同一个
  setStatus?.("正在加载 Kokoro 模型（首次约几十 MB，之后走缓存）…");
  ttsPromise = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8", // q8: 体积小、wasm 上速度可接受；追求音质可改 fp32（配合 webgpu）
    device: "wasm", // WebView 内最稳；若设备支持 WebGPU 可改 "webgpu"
  })
    .then((m) => { tts = m; return m; })
    .catch((e) => { ttsPromise = null; throw e; }); // 失败清零，允许重试
  return ttsPromise;
}

export function listVoices() {
  // 1) 模型已加载：用权威音色列表
  if (tts) {
    try { return tts.list_voices(); } catch (e) { /* fall through */ }
  }
  // 2) 部分版本提供静态 list_voices()，无需加载模型即可列出
  if (typeof KokoroTTS.list_voices === "function") {
    try { return KokoroTTS.list_voices(); } catch (e) { /* fall through */ }
  }
  // 3) 兜底：内置常见音色，保证下拉框永远可选
  return FALLBACK_VOICES;
}

function ensureCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended" && !paused) audioCtx.resume();
  return audioCtx;
}

function playBuffer(audio) {
  const ctx = ensureCtx();
  const sr = audio.sampling_rate || 24000;
  const buf = ctx.createBuffer(1, audio.audio.length, sr);
  buf.copyToChannel(audio.audio, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.onended = () => { playing = playing.filter((s) => s !== src); };
  src.start();
  playing.push(src);
}

// --- Native bridge (no-op when not inside the app WebView) ---
function notifyNative(method, arg) {
  try {
    const b = window.AndroidBridge;
    if (b && typeof b[method] === "function") b[method](arg || "");
  } catch (e) { /* ignore */ }
}

export function stopAll() {
  stopped = true;
  paused = false;
  queue = [];
  playing.forEach((s) => { try { s.stop(); } catch (e) {} });
  playing = [];
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  notifyNative("onTtsStop");
}

export function pauseTTS() {
  if (paused || stopped) return;
  paused = true;
  if (audioCtx) audioCtx.suspend(); // 暂停当前正在播放的 buffer
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

function waitIfPaused() {
  if (!paused) return Promise.resolve();
  return new Promise((res) => resumeWaiters.push(res));
}

// Split long text into <=200-char sentence chunks so generation stays stable.
function chunkText(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.match(/[^。！？.!?]+[。！？.!?]?/g) || [clean];
  const out = [];
  let buf = "";
  for (const p of parts) {
    if ((buf + p).length > 200) {
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
  queue = chunkText(text);
  if (!queue.length) { setStatus?.("没有可朗读的文本"); return; }
  await initTTS(setStatus);
  // 通知原生层：开始前台播放 + 媒体通知
  notifyNative("onTtsStart", title || "");
  for (let i = 0; i < queue.length; i++) {
    if (stopped) break;
    await waitIfPaused();
    if (stopped) break;
    const audio = await tts.generate(queue[i], { voice: voice || "af_heart" });
    if (stopped) break;
    await waitIfPaused();
    if (stopped) break;
    playBuffer(audio);
    setStatus?.("朗读中…");
  }
  if (!stopped) {
    setStatus?.("完成");
    notifyNative("onTtsStop"); // 自然结束，收起通知
  }
}

// 暴露给原生媒体通知 / 耳机按键：window.__tts*()
window.__ttsStop = stopAll;
window.__ttsPause = pauseTTS;
window.__ttsResume = resumeTTS;
window.__ttsToggle = togglePause;
