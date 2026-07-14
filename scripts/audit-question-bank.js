#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataPath = path.resolve(process.argv[2] || path.join(root, "data", "gkzhenti_questions.json"));
const reportPath = path.join(root, "data", "question-bank-audit-report.json");
const payload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const questions = Array.isArray(payload) ? payload : payload.questions;
if (!Array.isArray(questions)) throw new Error("Question bank does not contain a questions array.");

const imageTags = (html = "") => String(html).match(/<img\b[^>]*>/gi) || [];
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || "";
const plain = (html = "") => String(html)
  .replace(/<img\b[^>]*flag=["']?tex[^>]*>/gi, "[FORMULA]")
  .replace(/<img\b[^>]*>/gi, "[IMAGE]")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const ids = new Map();
const errors = [];
const warnings = [];
const stats = {
  totalQuestions: questions.length,
  explanationImages: 0,
  explanationFormulaImages: 0,
  questionImages: 0,
  questionFormulaImages: 0,
  materialImages: 0,
  materialFormulaImages: 0,
  optionImages: 0,
  optionsWithImages: 0,
  correctOptionsWithImages: 0,
  sourceIncompletePlaceholders: 0,
  shortExplanations: 0,
};

function auditImages(questionId, field, html) {
  for (const tag of imageTags(html)) {
    const src = attr(tag, "src");
    if (!src) errors.push({ questionId, field, issue: "image_missing_src" });
    if (src && !/^(https?:)?\/\//i.test(src) && !/^data:image\//i.test(src)) {
      warnings.push({ questionId, field, issue: "non_absolute_image_src", src });
    }
  }
}

for (const q of questions) {
  const id = String(q.id || "").trim();
  if (!id) errors.push({ questionId: "", field: "id", issue: "missing_id" });
  if (ids.has(id)) errors.push({ questionId: id, field: "id", issue: "duplicate_id", firstIndex: ids.get(id) });
  else ids.set(id, ids.size);

  const stemText = plain(q.question);
  const explanationText = plain(q.explanation);
  if (!stemText) errors.push({ questionId: id, field: "question", issue: "empty_question" });
  if (!explanationText) errors.push({ questionId: id, field: "explanation", issue: "empty_explanation" });
  if (explanationText.length < 20) stats.shortExplanations += 1;
  if (/题目缺失|正在征集|暂以A项代替/.test(`${stemText} ${explanationText}`)) stats.sourceIncompletePlaceholders += 1;

  const options = Array.isArray(q.options) ? q.options : [];
  const optionKeys = new Set(options.map((o) => String(o.key || "").toUpperCase()).filter(Boolean));
  if (["single_choice", "multi_choice"].includes(q.type)) {
    const answer = Array.isArray(q.answer) ? q.answer.join("") : String(q.answer || "").toUpperCase();
    if (!answer) errors.push({ questionId: id, field: "answer", issue: "missing_answer" });
    else if (!/^[A-Z]+$/.test(answer)) errors.push({ questionId: id, field: "answer", issue: "invalid_answer_format", value: q.answer });
    else for (const key of new Set(answer.split(""))) {
      if (!optionKeys.has(key)) errors.push({ questionId: id, field: "answer", issue: "answer_key_not_in_options", key });
    }
    if (!options.length) errors.push({ questionId: id, field: "options", issue: "missing_options" });
  }

  const explanationTags = imageTags(q.explanation);
  const questionTags = imageTags(q.question);
  const materialTags = imageTags(q.dataMaterial);
  stats.explanationImages += explanationTags.length;
  stats.explanationFormulaImages += explanationTags.filter((tag) => /flag=["']?tex|\/formulas(?:\?|["'])|[?&]latex=/i.test(tag)).length;
  stats.questionImages += questionTags.length;
  stats.questionFormulaImages += questionTags.filter((tag) => /flag=["']?tex|\/formulas(?:\?|["'])|[?&]latex=/i.test(tag)).length;
  stats.materialImages += materialTags.length;
  stats.materialFormulaImages += materialTags.filter((tag) => /flag=["']?tex|\/formulas(?:\?|["'])|[?&]latex=/i.test(tag)).length;

  for (const option of options) {
    const tags = imageTags(option.text);
    if (tags.length) stats.optionsWithImages += 1;
    stats.optionImages += tags.length;
    const answer = Array.isArray(q.answer) ? q.answer.join("") : String(q.answer || "");
    if (tags.length && answer.includes(String(option.key))) stats.correctOptionsWithImages += 1;
    auditImages(id, `option.${option.key}`, option.text);
  }
  auditImages(id, "question", q.question);
  auditImages(id, "dataMaterial", q.dataMaterial);
  auditImages(id, "explanation", q.explanation);
}

const report = {
  generatedAt: new Date().toISOString(),
  dataPath,
  ok: errors.length === 0,
  stats,
  errors,
  warnings,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: report.ok, ...stats, errors: errors.length, warnings: warnings.length, reportPath }, null, 2));
if (errors.length) process.exitCode = 1;
