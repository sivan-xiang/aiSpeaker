#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 sherpa-onnx 的 wasm 运行时 + 一个中文 TTS 模型下载并内置打包到 assets 中，
让「诗词」tab 的中文朗读完全离线（不联网）。

用法（在你的机器上，需联网一次）：
    py -3.10 scripts/fetch_sherpa_zh.py
    # 重新下载：py -3.10 scripts/fetch_sherpa_zh.py --force

依赖：仅 Python 标准库（urllib / tarfile / json / pathlib / shutil）。
产物：
    app/src/main/assets/js/sherpa-onnx-wasm.js      # wasm 运行时（ESM）
    app/src/main/assets/js/*.wasm                    # wasm 二进制
    app/src/main/assets/tts_zh_model/<MODEL>/...     # 中文模型文件
    app/src/main/assets/js/sherpa-zh-model.js        # 由本脚本按实际文件名生成
"""

import json
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

# ----------------------------------------------------------------------------
# 可改项：想换中文模型时，改这里（并重新运行脚本即可）
# ----------------------------------------------------------------------------
MODEL = "vits-icefall-zh-aishell3"
MODEL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    f"tts-models/{MODEL}.tar.bz2"
)
# sherpa-onnx 的 npm wasm 包名（优先用 scoped 名，失败再退回非 scoped 名）
NPM_PACKAGES = ["@sherpa-onnx/wasm", "sherpa-onnx-wasm"]

ROOT = Path(__file__).resolve().parent.parent          # ReadAloudApp/
ASSETS = ROOT / "app" / "src" / "main" / "assets"
JS_DIR = ASSETS / "js"
MODEL_DIR = ASSETS / "tts_zh_model" / MODEL
CONFIG_JS = JS_DIR / "sherpa-zh-model.js"


def log(msg):
    print(f"[fetch-sherpa-zh] {msg}")


def die(msg):
    print(f"[fetch-sherpa-zh] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def download(url, dest: Path, label: str):
    dest.parent.mkdir(parents=True, exist_ok=True)
    log(f"下载 {label}：{url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        total = int(resp.headers.get("Content-Length", 0) or 0)
        downloaded = 0
        chunk = 1 << 16
        with open(dest, "wb") as f:
            while True:
                buf = resp.read(chunk)
                if not buf:
                    break
                f.write(buf)
                downloaded += len(buf)
                if total:
                    pct = downloaded * 100 // total
                    print(f"  {label}: {pct:3d}% ({downloaded // 1024} KB)", end="\r")
        print()
    log(f"  已保存 {dest} ({dest.stat().st_size // 1024} KB)")


def extract_tar(tar_path: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path) as tf:
        tf.extractall(out_dir)
    log(f"  解压到 {out_dir}")


def fetch_runtime():
    """拉取 @sherpa-onnx/wasm npm 包，复制 ESM 入口 + 所有 .wasm 到 assets/js/。"""
    target_js = JS_DIR / "sherpa-onnx-wasm.js"
    if target_js.exists() and "--force" not in sys.argv:
        log(f"运行时已存在，跳过：{target_js}（用 --force 强制重新拉取）")
        return

    pkg_json_url = None
    for pkg in NPM_PACKAGES:
        try:
            url = f"https://registry.npmjs.org/{pkg}/latest"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                manifest = json.load(r)
            tarball = manifest["dist"]["tarball"]
            log(f"npm 包 {pkg}@{manifest.get('version')}  tarball: {tarball}")
            pkg_json_url = tarball
            break
        except Exception as e:  # noqa: BLE001
            log(f"  尝试 {pkg} 失败：{e}")
    if not pkg_json_url:
        die("无法从 npm 获取 @sherpa-onnx/wasm / sherpa-onnx-wasm，请检查网络或手动放置运行时。")

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        tgz = td / "pkg.tgz"
        download(pkg_json_url, tgz, "npm 运行时")
        extract_tar(tgz, td / "pkg")
        pkg_root = td / "pkg" / "package"
        if not pkg_root.exists():
            # 某些 tarball 不解压出 package/ 前缀
            pkg_root = td / "pkg"
        pj = json.loads((pkg_root / "package.json").read_text(encoding="utf-8"))

        # 解析 ESM 入口文件
        exports = pj.get("exports", {})
        entry = ""
        if isinstance(exports, dict):
            top = exports.get(".", {})
            if isinstance(top, dict):
                entry = top.get("import") or top.get("default") or ""
        if not entry:
            entry = pj.get("module") or pj.get("main") or ""
        if not entry:
            die("在 npm 包的 package.json 中找不到入口文件（module/main/exports）。")
        entry_path = (pkg_root / entry).resolve()
        if not entry_path.exists():
            die(f"入口文件不存在：{entry_path}")
        target_js.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(entry_path, target_js)
        log(f"  复制 ESM 入口 -> {target_js}")

        # 复制所有 .wasm
        count = 0
        for w in pkg_root.rglob("*.wasm"):
            shutil.copyfile(w, JS_DIR / w.name)
            count += 1
        log(f"  复制 {count} 个 .wasm 到 {JS_DIR}")


def fetch_model():
    if (MODEL_DIR / "model.onnx").exists() and "--force" not in sys.argv:
        log(f"模型已存在，跳过：{MODEL_DIR}（用 --force 强制重新拉取）")
        return
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        tbz = td / f"{MODEL}.tar.bz2"
        download(MODEL_URL, tbz, "中文模型")
        extract_tar(tbz, MODEL_DIR)
    # 有的 tarball 会把文件解到 <MODEL>/<MODEL>/ 嵌套一层，归一化一下
    nested = MODEL_DIR / MODEL
    if nested.is_dir() and not (MODEL_DIR / "model.onnx").exists():
        for item in nested.iterdir():
            shutil.move(str(item), str(MODEL_DIR / item.name))
        nested.rmdir()


def detect_config():
    files = {p.name: p for p in MODEL_DIR.iterdir() if p.is_file()}
    dirs = {p.name: p for p in MODEL_DIR.iterdir() if p.is_dir()}

    # model: 优先 model.onnx，否则取最大的 .onnx
    if "model.onnx" in files:
        model_file = "model.onnx"
    else:
        onnx = [p for p in MODEL_DIR.rglob("*.onnx")]
        if not onnx:
            die(f"模型目录未找到 .onnx 文件：{MODEL_DIR}")
        model_file = max(onnx, key=lambda p: p.stat().st_size).name

    tokens_file = "tokens.txt" if "tokens.txt" in files else ""
    if not tokens_file:
        for n in files:
            if "tokens" in n:
                tokens_file = n
                break

    lexicon_file = "lexicon.txt" if "lexicon.txt" in files else ""

    data_dir = ""
    for cand in ("dict", "espeak-ng-data", "espeak-data"):
        if cand in dirs:
            data_dir = cand
            break

    fsts = sorted(n for n in files if n.endswith(".fst"))
    rule_fsts = ",".join(f"{MODEL}/{f}" for f in fsts)

    return {
        "model": model_file,
        "tokens": tokens_file,
        "lexicon": lexicon_file,
        "dataDir": data_dir,
        "ruleFsts": rule_fsts,
    }


def write_config(cfg):
    d = f"tts_zh_model/{MODEL}"
    model = f"{d}/{cfg['model']}"
    tokens = f"{d}/{cfg['tokens']}" if cfg["tokens"] else ""
    lexicon = f"{d}/{cfg['lexicon']}" if cfg["lexicon"] else ""
    data_dir = f"{d}/{cfg['dataDir']}" if cfg["dataDir"] else ""
    rule_fsts = cfg["ruleFsts"]

    text = f"""// 中文 TTS 模型配置（sherpa-onnx）。本文件由 scripts/fetch_sherpa_zh.py 自动生成。
// 模型文件位于 app/src/main/assets/tts_zh_model/{MODEL}/，随 APK 内置打包、完全离线。
export const TTS_MODEL_DIR = "{d}";

export const TTS_CONFIG = {{
  model: {{
    vits: {{
      model: "{model}",
      lexicon: "{lexicon}",
      tokens: "{tokens}",
      dataDir: "{data_dir}",
      noiseScale: 0.667,
      noiseScaleW: 0.8,
      lengthScale: 1.0,
    }},
  }},
  ruleFsts: "{rule_fsts}",
  maxNumSentences: 1,
}};
"""
    CONFIG_JS.write_text(text, encoding="utf-8")
    log(f"已生成配置：{CONFIG_JS}")
    log(f"  model={model}  tokens={tokens or '(空)'}  lexicon={lexicon or '(空)'}"
        f"  dataDir={data_dir or '(空)'}  ruleFsts={rule_fsts or '(空)'}")


def main():
    JS_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    log("开始拉取 sherpa-onnx 中文 TTS（运行时 + 模型）…")
    fetch_runtime()
    fetch_model()
    cfg = detect_config()
    write_config(cfg)
    size_mb = sum(f.stat().st_size for f in MODEL_DIR.rglob("*") if f.is_file()) / (1024 * 1024)
    log("完成 ✅")
    log(f"模型目录占用约 {size_mb:.1f} MB（已计入 APK 体积，属于一次性内置）。")
    log("下一步：用 Android Studio 打开 ReadAloudApp 编译运行即可（无需联网即可中文朗读）。")


if __name__ == "__main__":
    main()
