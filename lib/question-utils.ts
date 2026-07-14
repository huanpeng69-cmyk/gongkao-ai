import type { Option, Question } from "./types";

export type AnswerValue = string | boolean | string[];

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SAFE_TAGS = new Set([
  "p", "div", "span", "br", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "sub", "sup", "blockquote",
  "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "a",
]);

function normalizeChoiceText(value: string) {
  const text = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(text)) return value;
  return Array.from(new Set(text.split(""))).sort().join("");
}

function normalizeSpace(value: string) {
  return value
    .replace(/\s*欢迎使用公开真题库[\s\S]*$/g, "")
    .replace(/\s*备案编号：[\s\S]*$/g, "")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAttribute(tag: string, name: string) {
  const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  if (quoted) return quoted[2];
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1] || "";
}

function getImgSrc(imgTag: string) {
  return getAttribute(imgTag, "src");
}

function normalizeImageUrl(url: string) {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function isSafeImageUrl(url: string) {
  return /^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(url);
}

function isFormulaImage(tag: string, src = getImgSrc(tag)) {
  return /\bflag\s*=\s*["']?tex\b/i.test(tag) || /\/formulas(?:\?|$)|[?&]latex=/i.test(src);
}

function safeSpanAttribute(tag: string, name: "colspan" | "rowspan") {
  const value = getAttribute(tag, name);
  return /^\d{1,2}$/.test(value) ? ` ${name}="${value}"` : "";
}

/**
 * Normalizes trusted question-bank markup while removing executable HTML.
 * The returned HTML is safe to render with dangerouslySetInnerHTML.
 */
export function normalizeQuestionHtml(input = "") {
  if (!input) return "";

  const cleaned = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|form|button|input|textarea|select|option|base|meta|link|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|button|input|textarea|select|option|base|meta|link|svg|math)\b[^>]*\/?\s*>/gi, "")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/<br\s*\/?>\s*(?:<br\s*\/?>\s*){2,}/gi, "<br><br>")
    .replace(/<(p|div|span)\b[^>]*>\s*<\/\1\s*>/gi, "");

  return cleaned.replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (tag, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!SAFE_TAGS.has(name)) return "";
    if (/^<\//.test(tag)) return name === "br" || name === "img" ? "" : `</${name}>`;
    if (name === "br") return "<br>";

    if (name === "img") {
      const src = normalizeImageUrl(getImgSrc(tag).trim());
      if (!src || !isSafeImageUrl(src)) return "";
      const formula = isFormulaImage(tag, src);
      const originalAlt = decodeBasicEntities(getAttribute(tag, "alt")).trim();
      const alt = originalAlt || (formula ? "公式" : "题目或解析图片");
      const className = formula ? "question-formula-image" : "question-content-image";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}" class="${className}" loading="lazy" decoding="async">`;
    }

    if (name === "a") {
      const href = normalizeImageUrl(getAttribute(tag, "href").trim());
      if (!/^https?:\/\//i.test(href)) return "<span>";
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`;
    }

    if (name === "td" || name === "th") {
      return `<${name}${safeSpanAttribute(tag, "colspan")}${safeSpanAttribute(tag, "rowspan")}>`;
    }
    return `<${name}>`;
  }).trim();
}

export function getHtmlImageSources(html = "") {
  const seen = new Set<string>();
  const sources: string[] = [];
  const tags = html.match(IMG_TAG_RE) || [];

  tags.forEach((tag) => {
    const src = normalizeImageUrl(getImgSrc(tag));
    if (!src || !isSafeImageUrl(src) || seen.has(src)) return;
    seen.add(src);
    sources.push(src);
  });

  return sources;
}

export function getQuestionImageSources(question: Pick<Question, "question" | "options" | "dataMaterial">) {
  const seen = new Set<string>();
  const sources: string[] = [];
  const add = (items: string[]) => {
    items.forEach((src) => {
      if (!src || seen.has(src)) return;
      seen.add(src);
      sources.push(src);
    });
  };

  add(getHtmlImageSources(question.dataMaterial || ""));
  add(getHtmlImageSources(question.question || ""));
  question.options?.forEach((option) => add(getHtmlImageSources(option.text || "")));

  return sources;
}

/** @deprecated Use normalizeQuestionHtml. */
export function normalizeHtmlImages(html = "") {
  return normalizeQuestionHtml(html);
}

export function stripHtml(input = "") {
  const withImagePlaceholders = input.replace(IMG_TAG_RE, (tag) => isFormulaImage(tag) ? "[公式]" : "[图片]");
  return normalizeSpace(
    decodeBasicEntities(
      withImagePlaceholders
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|section|table|thead|tbody|tfoot|tr|ul|ol|li|blockquote|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

export function getQuestionText(question: Pick<Question, "question">) {
  return stripHtml(question.question);
}

export function getQuestionDisplayHtml(question: Pick<Question, "question">) {
  return normalizeQuestionHtml(question.question);
}

export function getQuestionMaterialHtml(question: Pick<Question, "dataMaterial">) {
  return normalizeQuestionHtml(question.dataMaterial || "");
}

export function getOptionDisplayText(option: Option) {
  const text = stripHtml(option.text);
  return text.toUpperCase() === option.key.toUpperCase() ? "" : text;
}

export function getOptionDisplayHtml(option: Option) {
  if (!/<[a-z][\s\S]*>/i.test(option.text || "")) return "";
  return normalizeQuestionHtml(option.text);
}

export function answerToText(value?: AnswerValue) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "正确" : "错误";
  return normalizeChoiceText(Array.isArray(value) ? value.join("") : String(value));
}

export function answerToKeys(value?: AnswerValue) {
  const text = answerToText(value);
  return /^[A-Z]+$/.test(text) ? text.split("") : [];
}

export function getCorrectText(question: Pick<Question, "type" | "answer">) {
  return answerToText(question.answer);
}

export function getAnswerContent(question: Pick<Question, "type" | "options">, value?: AnswerValue) {
  if (value === undefined || value === null || value === "") return "";
  if (question.type === "true_false") return answerToText(value);

  const keys = answerToKeys(value);
  const content = keys
    .map((key) => {
      const option = question.options?.find((item) => item.key === key);
      if (!option) return key;
      const display = getOptionDisplayText(option);
      return display || key;
    })
    .join("；");
  return content || answerToText(value);
}

export function getAnswerContentHtml(question: Pick<Question, "type" | "options">, value?: AnswerValue) {
  if (value === undefined || value === null || value === "") return "";
  if (question.type === "true_false") return escapeHtml(answerToText(value));
  const parts = answerToKeys(value).map((key) => {
    const option = question.options?.find((item) => item.key === key);
    if (!option) return escapeHtml(key);
    const html = normalizeQuestionHtml(option.text);
    return html || escapeHtml(getOptionDisplayText(option) || key);
  });
  return parts.filter(Boolean).join('<span class="answer-content-separator">；</span>');
}

export function getCorrectAnswerContent(question: Pick<Question, "type" | "answer" | "options">) {
  return getAnswerContent(question, question.answer);
}

export function getCorrectAnswerContentHtml(question: Pick<Question, "type" | "answer" | "options">) {
  return getAnswerContentHtml(question, question.answer);
}

export function hasUsefulExplanation(explanation = "") {
  const text = stripHtml(explanation);
  if (!text || text === "无") return false;
  if (/^来自\s*\d{4}年/.test(text)) return false;
  if (/^来自\s*.+(考试|真题|行测|申论)/.test(text) && text.length < 80) return false;
  return true;
}

export function getDisplayExplanation(question: Pick<Question, "explanation" | "type" | "answer" | "options">) {
  if (hasUsefulExplanation(question.explanation)) return stripHtml(question.explanation);
  return "";
}

export function getDisplayExplanationHtml(question: Pick<Question, "explanation" | "type" | "answer" | "options">) {
  if (hasUsefulExplanation(question.explanation)) return normalizeQuestionHtml(question.explanation);
  return "";
}

export function buildQuestionPromptText(question: Pick<Question, "question" | "options" | "dataMaterial">) {
  const options = question.options?.map((option) => {
    const display = getOptionDisplayText(option);
    return display ? `${option.key}. ${display}` : `${option.key}. （见题图或选项图）`;
  }).join("\n") || "无";
  const material = stripHtml(getQuestionMaterialHtml(question));
  return [
    material ? `材料：${material}` : "",
    `题目：${getQuestionText(question)}`,
    `选项：\n${options}`,
  ].filter(Boolean).join("\n\n");
}
