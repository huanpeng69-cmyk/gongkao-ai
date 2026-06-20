import type { Option, Question } from "./types";

export type AnswerValue = string | boolean | string[];

const IMG_TAG_RE = /<img\b[^>]*>/gi;

function normalizeSpace(value: string) {
  return value
    .replace(/\s*欢迎使用公开真题库[\s\S]*$/g, "")
    .replace(/\s*备案编号：[\s\S]*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function getImgSrc(imgTag: string) {
  return imgTag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "";
}

function normalizeImageUrl(url: string) {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export function getHtmlImageSources(html = "") {
  const seen = new Set<string>();
  const sources: string[] = [];
  const tags = html.match(IMG_TAG_RE) || [];

  tags.forEach((tag) => {
    const src = normalizeImageUrl(getImgSrc(tag));
    if (!src || seen.has(src)) return;
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

export function normalizeHtmlImages(html = "") {
  return html
    .replace(/\bsrc\s*=\s*["']\/\//gi, 'src="https://')
    .replace(/\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi, (_match, url) => `src="${url}"`)
    .replace(/<img\b([^>]*)>/gi, (_match, attrs) => {
      // 添加懒加载和优化属性
      const hasLoading = /\bloading\s*=/i.test(attrs);
      const hasDecoding = /\bdecoding\s*=/i.test(attrs);
      const loadingAttr = hasLoading ? '' : ' loading="lazy"';
      const decodingAttr = hasDecoding ? '' : ' decoding="async"';
      return `<img${attrs}${loadingAttr}${decodingAttr} style="max-width:100%;height:auto;" />`;
    });
}

export function stripHtml(input = "") {
  return normalizeSpace(
    decodeBasicEntities(
      input
        .replace(IMG_TAG_RE, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|section|table|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

export function getQuestionText(question: Pick<Question, "question">) {
  return stripHtml(question.question);
}

export function getQuestionMaterialHtml(question: Pick<Question, "question" | "dataMaterial">) {
  const material = normalizeHtmlImages(question.dataMaterial || "");
  const seen = new Set<string>();
  const parts: string[] = [];

  const addImages = (html: string) => {
    const tags = html.match(IMG_TAG_RE) || [];
    tags.forEach((tag) => {
      const src = normalizeImageUrl(getImgSrc(tag));
      if (!src || seen.has(src)) return;
      seen.add(src);
      parts.push(normalizeHtmlImages(tag.replace(/\bsrc\s*=\s*["'][^"']+["']/i, `src="${src}"`)));
    });
  };

  addImages(material);
  addImages(question.question || "");

  const textMaterial = material.replace(IMG_TAG_RE, "").trim();
  return [textMaterial, ...parts].filter(Boolean).join("\n").trim();
}

export function getOptionDisplayText(option: Option) {
  const text = stripHtml(option.text);
  return text.toUpperCase() === option.key.toUpperCase() ? "" : text;
}

export function getOptionDisplayHtml(option: Option) {
  if (!/<img\b/i.test(option.text || "")) return "";
  return normalizeHtmlImages(option.text);
}

export function answerToText(value?: AnswerValue) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "正确" : "错误";
  return Array.isArray(value) ? value.join("") : String(value);
}

export function getCorrectText(question: Pick<Question, "type" | "answer">) {
  if (question.type === "multi_choice") return (question.answer as string[]).join("");
  if (question.type === "true_false") return (question.answer as boolean) ? "正确" : "错误";
  return String(question.answer);
}

export function getAnswerContent(question: Pick<Question, "type" | "options">, value?: AnswerValue) {
  if (value === undefined || value === null || value === "") return "";
  if (question.type === "true_false") return answerToText(value);

  const keys = Array.isArray(value) ? value : String(value).split("").filter(Boolean);
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

export function getCorrectAnswerContent(question: Pick<Question, "type" | "answer" | "options">) {
  if (question.type === "multi_choice") return getAnswerContent(question, question.answer as string[]);
  if (question.type === "true_false") return getAnswerContent(question, question.answer as boolean);
  return getAnswerContent(question, String(question.answer));
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
