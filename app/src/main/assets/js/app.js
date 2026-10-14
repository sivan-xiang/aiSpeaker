import { initTTS, listVoices, speak, stopAll } from "./tts.js";
import { SAMPLE_POEMS, POETRY_REMOTE_URL } from "./data/poems.js";

const $ = (sel) => document.querySelector(sel);
const statusEl = $("#status");
const voiceSel = $("#voice");
const setStatus = (s) => { statusEl.textContent = s; };

let currentText = "";
let voicesReady = false;

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
  $("#readerTitle").textContent = title + (meta ? ` · ${meta}` : "");
  const body = $("#readerBody");
  body.textContent = text; // textContent avoids HTML injection
  $("#reader").classList.remove("hidden");
  window.scrollTo(0, 0);
}
$("#readerBack").addEventListener("click", () => $("#reader").classList.add("hidden"));

// ---------- Voices ----------
async function ensureVoices() {
  if (voicesReady) return;
  await initTTS(setStatus);
  const voices = listVoices();
  if (voices && voices.length) {
    voiceSel.innerHTML = "";
    voices.forEach((v) => {
      const o = document.createElement("option");
      o.value = v.id || v.name || v;
      o.textContent = `${v.name || v.id || v}${v.gender ? " · " + v.gender : ""}`;
      voiceSel.appendChild(o);
    });
  } else {
    // Fallback: Kokoro's well-known English voices.
    ["af_heart", "af_bella", "am_michael", "bf_emma", "bm_george"].forEach((id) => {
      const o = document.createElement("option");
      o.value = id; o.textContent = id; voiceSel.appendChild(o);
    });
  }
  voicesReady = true;
}

// ---------- TTS controls ----------
$("#readerSpeak").addEventListener("click", async () => {
  if (!currentText) return;
  await ensureVoices();
  speak(currentText, voiceSel.value, setStatus);
});
$("#stopBtn").addEventListener("click", () => { stopAll(); setStatus("已停止"); });

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

// ---------- Poetry ----------
function renderPoems(list) {
  const items = list.map((p) => ({
    title: p.title,
    meta: p.author || "",
    _content: p.content,
  }));
  renderList("poetry-list", items, (it) => openReader(it.title, it.meta, it._content));
}
function normalizePoems(data) {
  const arr = Array.isArray(data) ? data : (data.poems || []);
  return arr.map((p) => {
    if (p.content) return { title: p.title, author: p.author, content: p.content };
    if (Array.isArray(p.paragraphs)) {
      return { title: p.title, author: p.author, content: p.paragraphs.join("\n") };
    }
    return { title: p.title || "无题", author: p.author || "", content: String(p) };
  });
}
renderPoems(SAMPLE_POEMS);

$("#loadRemotePoetry").addEventListener("click", async () => {
  if (!POETRY_REMOTE_URL) {
    alert("请在 js/data/poems.js 中设置 POETRY_REMOTE_URL（你的 lite 数据集地址）后再试。");
    return;
  }
  setStatus("正在加载远程诗词…");
  try {
    const data = await (await fetch(POETRY_REMOTE_URL)).json();
    const list = normalizePoems(data);
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
      setStatus("正在下载正文…");
      const text = await (await fetch(it._txt)).text();
      openReader(it.title, it.meta, text);
    });
    setStatus(`找到 ${items.length} 本可朗读`);
  } catch (e) {
    c.innerHTML = '<div class="loading">加载失败：' + escapeHtml(e.message) + "</div>";
  }
});

// ---------- Standard Ebooks (OPDS) ----------
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
      setStatus("正在拉取正文…");
      const html = await (await fetch(it._href)).text();
      openReader(it.title, it.meta, stripHtml(html));
    });
    setStatus(`目录 ${items.length} 条`);
  } catch (e) {
    c.innerHTML = '<div class="loading">加载失败：' + escapeHtml(e.message) + "</div>";
  }
});

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
  const text = (div.textContent || "").replace(/\s+/g, " ").trim();
  return text;
}
