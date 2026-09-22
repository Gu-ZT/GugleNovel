import DOMPurify from "dompurify";
import {Marked} from "marked";

// 参考 dsh-launcher 主页新闻的渲染管线：marked(GFM) 解析 + DOMPurify 消毒。
// 小说正文以段落为主，不引入 katex/脚注等扩展。
const marked = new Marked({gfm: true, breaks: true});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** 将 Markdown 文本渲染为可安全注入 v-html 的 HTML。 */
export function renderMarkdown(content: string): string {
  const raw = marked.parse(content, {async: false});
  return DOMPurify.sanitize(raw);
}
