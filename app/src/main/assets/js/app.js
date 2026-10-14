import * as enTts from "./tts.js"; // 英文引擎（Kokoro，英文书用）
import * as zhTts from "./tts_zh.js"; // 中文引擎（诗词 tab 用）
import { DEFAULT_POEMS, POETRY_REMOTE_URL, normalizeRemote } from "./data/poems.js";

const $ = (sel) => document.querySelector(sel);
const statusEl = $("#status");
const voiceSel = $("#voice");
const setStatus = (s) => { statusEl.textContent = s; };

let currentText = "";
let currentTitle = "";
let currentEngine = enTts; // 当前朗读引擎：诗词=zhTts，英文书=enTts

// ---------- Tab switching ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $("#" + btn.dataset.tab).classList.add("active");
  });
});

// ---------- Reader ----------
function openReader(title, meta, text) {
  currentText = text;
  currentTitle = title + (meta ? ` · ${meta}` : "");
  $("#readerTitle").textContent = title + (meta ? ` · ${meta}` : "");
  const body = $("#readerBody");
  body.textContent = text; // textContent avoids HTML injection
  $("#reader").classList.remove("hidden");
  resetPauseBtn();
  window.scrollTo(0, 0);
}
$("#readerBack").addEventListener("click", () => $("#reader").classList.add("hidden"));

function resetPauseBtn() {
  const pb = $("#readerPause");
  if (pb) pb.textContent = "⏸ 暂停";
}

// ---------- Engines / Voices ----------
// 切换朗读引擎并刷新音色下拉框（诗词=中文引擎，英文书=英文引擎）
function setEngine(engine, defaultVoice) {
  if (currentEngine === engine && voiceSel.value) return;
  currentEngine = engine;
  populateVoices();
  if (defaultVoice) voiceSel.value = defaultVoice;
}

// 页面加载即用音色列表填充下拉框（不依赖模型下载）
function populateVoices() {
  const voices = currentEngine.listVoices();
  if (!voices || !voices.length) return;
  const prev = voiceSel.value;
  voiceSel.innerHTML = "";
  voices.forEach((v) => {
    const o = document.createElement("option");
    o.value = v.id || v.name || v;
    o.textContent = v.name || v.id || v;
    voiceSel.appendChild(o);
  });
  // 尽量保留用户已选音色；否则用当前引擎的默认音色
  if (prev && [...voiceSel.options].some((o) => o.value === prev)) {
    voiceSel.value = prev;
  } else {
    voiceSel.value = currentEngine === zhTts ? "zf_xiaoxiao" : "af_heart";
  }
}

async function ensureVoices() {
  await currentEngine.initTTS(setStatus);
  populateVoices(); // 模型加载后用权威音色列表刷新下拉框
}

// 加载时立即填充音色（默认英文引擎）
populateVoices();

// 启动即预下载模型（Kokoro，含中英文音色），省去首次朗读的等待
enTts.initTTS(setStatus)
  .then(() => { populateVoices(); setStatus("模型就绪，可朗读"); })
  .catch((e) => setStatus("模型加载失败：" + (e && e.message ? e.message : e)));

// 原生媒体通知 / 耳机按键 -> 转发到当前激活的引擎
window.__ttsStop = () => currentEngine.stopAll();
window.__ttsPause = () => currentEngine.pauseTTS();
window.__ttsResume = () => currentEngine.resumeTTS();
window.__ttsToggle = () => currentEngine.togglePause();

// ---------- TTS controls ----------
$("#readerSpeak").addEventListener("click", async () => {
  if (!currentText) return;
  await ensureVoices();
  resetPauseBtn();
  currentEngine.speak(currentText, voiceSel.value, setStatus, currentTitle);
});
$("#stopBtn").addEventListener("click", () => { currentEngine.stopAll(); setStatus("已停止"); resetPauseBtn(); });

const pauseBtn = $("#readerPause");
if (pauseBtn) {
  pauseBtn.addEventListener("click", () => {
    currentEngine.togglePause();
    pauseBtn.textContent = currentEngine.isPaused() ? "▶ 继续" : "⏸ 暂停";
  });
}

// ---------- Generic list rendering ----------
function renderList(containerId, items, onPick) {
  const c = $("#" + containerId);
  c.innerHTML = "";
  if (!items.length) { c.innerHTML = '<div class="loading">没有可用条目</div>'; return; }
  items.forEach((it) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="title">${escapeHtml(it.title)}</div>` +
      (it.meta ? `<div class="meta">${escapeHtml(it.meta)}</div>` : "");
    card.addEventListener("click", () => onPick(it));
    c.appendChild(card);
  });
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

// ---------- Poetry (内置「诗词游乐场」lite 数据集，离线可用) ----------
function renderPoems(list) {
  const items = list.map((p) => ({
    title: p.title,
    meta: p.author || "",
    _content: p.content,
  }));
  renderList("poetry-list", items, (it) => { setEngine(zhTts, "zf_xiaoxiao"); openReader(it.title, it.meta, it._content); });
}
renderPoems(DEFAULT_POEMS);

$("#loadRemotePoetry").addEventListener("click", async () => {
  if (!POETRY_REMOTE_URL) {
    alert("请在 js/data/poems.js 中设置 POETRY_REMOTE_URL（你的 lite 数据集地址）后再试。");
    return;
  }
  setStatus("正在加载远程诗词…");
  try {
    const data = await (await fetch(POETRY_REMOTE_URL)).json();
    const list = normalizeRemote(data);
    if (list.length) renderPoems(list);
    setStatus(`已加载 ${list.length} 首`);
  } catch (e) {
    setStatus("加载失败：" + e.message);
  }
});

// ---------- Gutenberg (via Gutendex mirror of Project Gutenberg) ----------
$("#loadGutenberg").addEventListener("click", async () => {
  const c = $("#gutenberg-list");
  c.innerHTML = '<div class="loading">加载中…</div>';
  try {
    const res = await fetch("https://gutendex.com/books/?page=1");
    const data = await res.json();
    const items = data.results
      .map((b) => {
        const f = b.formats || {};
        const txt = f["text/plain; charset=utf-8"] || f["text/plain"] || null;
        return txt
          ? { title: b.title, meta: (b.authors || []).map((a) => a.name).join(", "), _txt: txt }
          : null;
      })
      .filter(Boolean);
    renderList("gutenberg-list", items, async (it) => {
      setEngine(enTts, "af_heart");
      setStatus("正在下载正文…");
      const text = await (await fetch(it._txt)).text();
      openReader(it.title, it.meta, text);
    });
    setStatus(`找到 ${items.length} 本可朗读`);
  } catch (e) {
    c.innerHTML = '<div class="loading">加载失败：' + escapeHtml(e.message) + "</div>";
  }
});

// ---------- Standard Ebooks (OPDS -> XHTML chapters) ----------
$("#loadStandard").addEventListener("click", async () => {
  const c = $("#standard-list");
  c.innerHTML = '<div class="loading">加载中…</div>';
  try {
    const res = await fetch("https://standardebooks.org/opds");
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const entries = [...doc.querySelectorAll("entry")];
    const items = entries
      .map((e) => {
        const title = e.querySelector("title")?.textContent || "";
        const author = e.querySelector("author > name")?.textContent || "";
        const alt = e.querySelector('link[rel="alternate"]') || e.querySelector("link");
        const href = alt?.getAttribute("href") || "";
        return href ? { title, meta: author, _href: href } : null;
      })
      .filter(Boolean);
    renderList("standard-list", items, async (it) => {
      await openStandardBook(it);
    });
    setStatus(`目录 ${items.length} 条`);
  } catch (e) {
    c.innerHTML = '<div class="loading">加载失败：' + escapeHtml(e.message) + "</div>";
  }
});

// Standard Ebooks 正文：OPDS 条目 -> /text 目录页 -> 抓取每个 /text/chapter-N XHTML -> 抽取可读正文
// 过滤掉扉页/版权/目录等非正文章节，得到干净的全文。
const SE_SKIP = /(titlepage|halftitle|halftitlepage|cover|colophon|imprint|uncopyright|copyright|toc|dedication|endnotes|loi|loa|contents|craftsmanship|epigraph)/i;

async function openStandardBook(it) {
  setEngine(enTts, "af_heart");
  const base = it._href.replace(/\/+$/, "");
  const textUrl = base.endsWith("/text") ? base : base + "/text";
  currentTitle = it.title;
  $("#readerTitle").textContent = it.title;
  $("#readerBody").textContent = "正在解析 XHTML 正文…";
  $("#reader").classList.remove("hidden");
  resetPauseBtn();
  window.scrollTo(0, 0);
  try {
    const html = await (await fetch(textUrl)).text();
    const toc = new DOMParser().parseFromString(html, "text/html");
    const baseUrl = new URL(textUrl);
    const seen = new Set();
    const chapterUrls = [];
    toc.querySelectorAll("a[href]").forEach((a) => {
      try {
        const raw = a.getAttribute("href");
        if (!raw) return;
        const abs = new URL(raw, baseUrl).href;
        const clean = abs.split("#")[0];
        if (clean.includes("/text/") && clean !== textUrl && clean !== textUrl + "/") {
          const seg = new URL(clean).pathname.split("/").pop();
          if (!SE_SKIP.test(seg) && !seen.has(clean)) {
            seen.add(clean);
            chapterUrls.push(clean);
          }
        }
      } catch (e) { /* ignore bad link */ }
    });

    let fullText = "";
    if (chapterUrls.length) {
      for (let i = 0; i < chapterUrls.length; i++) {
        if (i % 5 === 0) setStatus(`正在解析正文 ${i + 1}/${chapterUrls.length}…`);
        const chHtml = await (await fetch(chapterUrls[i])).text();
        const chDoc = new DOMParser().parseFromString(chHtml, "text/html");
        fullText += extractReadingText(chDoc) + "\n\n";
      }
    } else {
      // 兜底：目录页本身即正文（部分书籍单页呈现）
      fullText = extractReadingText(toc);
    }
    fullText = fullText.replace(/\n{3,}/g, "\n\n").trim();
    currentText = fullText;
    $("#readerBody").textContent = fullText || "（无正文）";
    setStatus(`已载入全文，约 ${fullText.length} 字`);
  } catch (e) {
    $("#readerBody").textContent = "解析失败：" + e.message;
    setStatus("加载失败：" + e.message);
  }
}

// 抽取 XHTML 章节的可读正文（按文档顺序保留 p / h1-h6 / blockquote / li）
function extractReadingText(doc) {
  const root = doc.body || doc.documentElement;
  if (!root) return "";
  root.querySelectorAll("script,style,noscript,nav,header,footer,aside,figure,svg").forEach((n) => n.remove());
  const blocks = root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,blockquote,li");
  const parts = [];
  blocks.forEach((b) => {
    const t = (b.textContent || "").replace(/\s+/g, " ").trim();
    if (t) parts.push(t);
  });
  return parts.join("\n\n");
}
