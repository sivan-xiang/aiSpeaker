// 诗词数据
// ---------------------------------------------------------------------------
// 默认数据源：内置「诗词游乐场」lite 数据集（poems_classic_0.json，小学必背 75 首），离线可用。
// 字段已校准：paragraphs[] -> 正文；dynasty + author -> 作者显示。
// 远程覆盖：把 POETRY_REMOTE_URL 改成你的 lite 数据集地址（返回 [{title,author,content}]
//   或兼容 paragraphs[] 的 chinese-poetry / 诗词游乐场格式），点「从网络加载诗词」即可替换内置数据。
//   示例（你的 CloudBase 部署，路径需按实际确认）：
//   https://tools-h5-d1gfo9r198d4d8b04-1313809642.tcloudbaseapp.com/poetry/data/poems_classic_0.json
import { BUNDLED_POEMS } from "./poems_classic_0.js";

export const POETRY_REMOTE_URL = "";

// 校准「诗词游乐场」lite 数据集字段
function normalizeClassic(list) {
  return (list || []).map((p) => ({
    title: p.title || "无题",
    author: [p.dynasty, p.author].filter(Boolean).join(" · "),
    content: Array.isArray(p.paragraphs)
      ? p.paragraphs.join("\n")
      : (p.content_text || p.content || ""),
  }));
}

// 兼容远程格式的归一化（[{title,author,content}] 或 {paragraphs:[...]} 或 chinese-poetry）
export function normalizeRemote(data) {
  const arr = Array.isArray(data) ? data : data.poems || [];
  return arr.map((p) => {
    if (p.content) return { title: p.title, author: p.author || "", content: p.content };
    if (Array.isArray(p.paragraphs))
      return { title: p.title, author: [p.dynasty, p.author].filter(Boolean).join(" · "), content: p.paragraphs.join("\n") };
    return { title: p.title || "无题", author: p.author || "", content: String(p) };
  });
}

export const DEFAULT_POEMS = normalizeClassic(BUNDLED_POEMS);
