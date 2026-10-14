// 中文 TTS 模型配置（sherpa-onnx）。
//
// 本文件由 scripts/fetch_sherpa_zh.py 在拉取模型后自动（重新）生成，
// 也允许你直接手改。模型文件位于：
//   app/src/main/assets/tts_zh_model/<MODEL>/
// 随 APK 内置打包，完全离线、不联网。
//
// 想换模型（例如更大的 vits-zh-hf-theresa）时：
//   1) 修改 fetch_sherpa_zh.py 顶部的 MODEL / MODEL_URL；
//   2) 重新运行脚本；它会按实际解压出来的文件名重写本配置。
export const TTS_MODEL_DIR = "tts_zh_model/vits-icefall-zh-aishell3";

export const TTS_CONFIG = {
  model: {
    vits: {
      model: `${TTS_MODEL_DIR}/model.onnx`,
      lexicon: `${TTS_MODEL_DIR}/lexicon.txt`,
      tokens: `${TTS_MODEL_DIR}/tokens.txt`,
      dataDir: `${TTS_MODEL_DIR}/dict`,
      noiseScale: 0.667,
      noiseScaleW: 0.8,
      lengthScale: 1.0,
    },
  },
  ruleFsts: `${TTS_MODEL_DIR}/date.fst,${TTS_MODEL_DIR}/number.fst`,
  maxNumSentences: 1,
};
