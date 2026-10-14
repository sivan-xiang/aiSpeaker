// Kokoro Web — runs 100% on-device inside the WebView via Transformers.js.
// Model: onnx-community/Kokoro-82M-v1.0-ONNX (Apache-2.0).
// On first launch the lib + model are fetched from a CDN, then cached by the WebView.
import { KokoroTTS } from "https://esm.sh/kokoro-js";

let tts = null;
let audioCtx = null;
let playing = [];
let stopped = false;

export async function initTTS(setStatus) {
  if (tts) return tts;
  setStatus?.("正在加载 Kokoro 模型（首次约几十 MB，之后走缓存）…");
  tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8", // q8: 体积小、wasm 上速度可接受；追求音质可改 fp32（配合 webgpu）
    device: "wasm", // WebView 内最稳；若设备支持 WebGPU 可改 "webgpu"
  });
  setStatus?.("模型就绪");
  return tts;
}

export function listVoices() {
  return tts ? tts.list_voices() : [];
}

function ensureCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
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

export function stopAll() {
  stopped = true;
  playing.forEach((s) => { try { s.stop(); } catch (e) {} });
  playing = [];
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

export async function speak(text, voice, setStatus) {
  stopped = false;
  await initTTS(setStatus);
  const chunks = chunkText(text);
  if (!chunks.length) { setStatus?.("没有可朗读的文本"); return; }
  for (const c of chunks) {
    if (stopped) break;
    const audio = await tts.generate(c, { voice: voice || "af_heart" });
    if (stopped) break;
    playBuffer(audio);
    setStatus?.("朗读中…");
  }
  if (!stopped) setStatus?.("完成");
}
