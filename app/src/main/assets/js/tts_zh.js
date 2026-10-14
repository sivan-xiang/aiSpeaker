// 中文语音引擎（诗词 tab 专用）。
//
// 当前实现复用 Kokoro-82M 的中文音色（zf_*/zm_*），与英文引擎共用同一份本地模型，
// 无需额外部署、完全离线。这样诗词就能用真正的中文音色朗读，而不是英文音素近似。
//
// 若以后想换成真正的独立中文引擎（SpeechT5 / sherpa-onnx WASM / 中文 VITS 等），
// 只需让本模块继续对外提供统一接口即可，app.js 不需要改动：
//   initTTS / listVoices / speak / stopAll / pauseTTS / resumeTTS / togglePause / isPaused
import {
  initTTS as kokoroInitTTS,
  speak as kokoroSpeak,
  stopAll,
  pauseTTS,
  resumeTTS,
  togglePause,
  isPaused,
} from "./tts.js";

// Kokoro-82M 的中文音色（来源：kokoro.js/voices）。
const ZH_VOICES = [
  { id: "zf_xiaoxiao", name: "zf_xiaoxiao · 中文女声（标准）" },
  { id: "zf_xiaobei", name: "zf_xiaobei · 中文女声（温柔）" },
  { id: "zf_xiaoni", name: "zf_xiaoni · 中文女声（清亮）" },
  { id: "zf_xiaoyi", name: "zf_xiaoyi · 中文女声（清晰）" },
  { id: "zm_yunjian", name: "zm_yunjian · 中文男声（沉稳）" },
  { id: "zm_yunxi", name: "zm_yunxi · 中文男声（亲切）" },
  { id: "zm_yunxia", name: "zm_yunxia · 中文男声（温和）" },
  { id: "zm_yunyang", name: "zm_yunyang · 中文男声（有活力）" },
];

export function listVoices() {
  return ZH_VOICES;
}

export function initTTS(setStatus) {
  // 复用英文引擎已加载的同一份 Kokoro 模型
  return kokoroInitTTS(setStatus);
}

// 中文默认稍慢一点（0.95）更自然；voice 缺省用标准女声 zf_xiaoxiao。
export function speak(text, voice, setStatus, title) {
  return kokoroSpeak(text, voice || "zf_xiaoxiao", setStatus, title, 0.95);
}

export { stopAll, pauseTTS, resumeTTS, togglePause, isPaused };
