#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "gkzhenti_questions.json");

function stripHtml(value = "") {
  return String(value)
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|table|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, limit) {
  const text = stripHtml(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/[，,；;。:\s]+$/g, "")}...`;
}

function answerText(value) {
  if (typeof value === "boolean") return value ? "正确" : "错误";
  if (Array.isArray(value)) return value.join("");
  return String(value ?? "");
}

function optionText(question, key) {
  const option = (question.options || []).find((item) => item.key === key);
  if (!option) return "";
  const text = stripHtml(option.text);
  return text.toUpperCase() === String(key).toUpperCase() ? "" : text;
}

function correctContent(question) {
  if (question.type === "true_false") return "";
  const keys = Array.isArray(question.answer)
    ? question.answer
    : String(question.answer || "").split("").filter(Boolean);
  return keys.map((key) => optionText(question, key)).filter(Boolean).join("；");
}

function topic(question, explanation) {
  const type = String(explanation || "").match(/【题型判断】([^\n]+)/)?.[1]?.trim();
  if (type) return type;
  return [question.module, question.subModule].filter(Boolean).join(" - ") || "本题";
}

function sourceOnly(value = "") {
  const text = stripHtml(value);
  return !text || text === "无" || /^来自\s*.+/.test(text);
}

function shortReason(question, explanation) {
  const text = String(explanation || "");
  const step = text.match(/本题正确答案为\s*([^。]+)。?/)?.[1]?.trim();
  const content = correctContent(question);
  const t = topic(question, explanation);

  if (question.type === "true_false") {
    return `本题考查${t}，题干表述${question.answer ? "符合" : "不符合"}相关知识点。`;
  }

  if (content) {
    return `本题考查${t}，正确项为“${truncate(content, 90)}”。`;
  }

  if (step) {
    return `本题考查${t}，${truncate(step, 100)}。`;
  }

  return `本题考查${t}，按题干关键词和选项表述判断即可。`;
}

function simplify(question) {
  const answer = answerText(question.answer);
  const content = correctContent(question);
  const answerPart = content ? `答案：${answer}（${truncate(content, 80)}）。` : `答案：${answer}。`;
  const reason = shortReason(question, question.explanation);
  return `${answerPart}解析：${reason}`;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = DATA_PATH.replace(/\.json$/i, `.before-simple-explanations-${stamp}.json`);
  fs.copyFileSync(DATA_PATH, backupPath);

  let updated = 0;
  let sourcePlaceholders = 0;
  for (const question of data.questions || []) {
    if (sourceOnly(question.explanation)) sourcePlaceholders += 1;
    const next = simplify(question);
    if (next && next !== question.explanation) {
      question.explanation = next;
      updated += 1;
    }
  }

  data.meta = {
    ...(data.meta || {}),
    explanations_simplified_at: new Date().toISOString(),
    explanations_simplified_summary: {
      updated,
      sourcePlaceholders,
      style: "answer_plus_one_sentence",
    },
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
  console.log(JSON.stringify({ updated, sourcePlaceholders, backupPath }, null, 2));
}

main();
