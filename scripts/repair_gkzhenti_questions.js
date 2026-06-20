const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "gkzhenti_questions.json");
const backupPath = path.join(__dirname, "..", "data", "gkzhenti_questions.before-option-repair.json");

function stripHtml(input = "") {
  return String(input)
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|table|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function materialBodyStart(html = "") {
  const text = stripHtml(html).replace(/^【阅读材料\s*[^】]+】\s*/, "").trim();
  return text.length >= 28 ? text.slice(0, 48) : "";
}

function trimAtKnownStarts(text = "", starts = []) {
  let next = String(text);
  for (const start of starts) {
    if (!start || start.length < 20) continue;
    const probes = [start, start.slice(0, 36), start.slice(0, 28)];
    for (const probe of probes) {
      const index = next.indexOf(probe);
      if (index > 0) {
        next = next.slice(0, index).trim();
      }
    }
  }
  return next;
}

function trimBoundaryText(text = "") {
  return String(text)
    .replace(/\s{2,}[（(][一二三四五六七八九十]+[）)][\s\S]*$/g, "")
    .replace(/\s{2,}[一二三四五六七八九十]+、[^。]{0,120}。[\s\S]*$/g, "")
    .replace(/\s{2,}六、资料分析。[\s\S]*$/g, "")
    .trim();
}

function normalizeOptionText(text = "", starts = []) {
  return trimBoundaryText(trimAtKnownStarts(text, starts))
    .replace(/^[A-D][、。．.]\s*(?=$)/, "")
    .trim();
}

function optionHasBoundary(text = "") {
  return /[（(][一二三四五六七八九十]+[）)]/.test(text) ||
    /[一二三四五六七八九十]+、[^。]{0,120}。/.test(text) ||
    /六、资料分析。/.test(text);
}

function getTrailingQuestionImages(material = "") {
  const match = material.match(/\n?<div style="margin-top:8px;">([\s\S]*?)<\/div>\s*$/i);
  if (!match) return null;
  const imgs = [...match[1].matchAll(/<img\b[^>]*>/gi)].map((item) => item[0]);
  const srcs = imgs.map((img) => img.match(/\bsrc="([^"]+)"/i)?.[1] || "").filter(Boolean);
  return { block: match[0], imgs, srcs };
}

function getStandaloneImages(material = "") {
  if (/ziliao-material/i.test(material)) return null;
  const imgs = [...String(material).matchAll(/<img\b[^>]*>/gi)].map((item) => item[0]);
  return imgs.length >= 4 ? imgs : null;
}

function sameKeys(options = []) {
  return options.length === 4 && options.map((item) => item.key).join("") === "ABCD";
}

function looksMalformed(question) {
  const options = question.options || [];
  return !sameKeys(options) ||
    options.some((option) => optionHasBoundary(option.text || "")) ||
    options.some((option) => /^[A-D][、。．.]?\s*$/.test(String(option.text || "").trim()));
}

if (!fs.existsSync(dataPath)) {
  throw new Error(`Missing data file: ${dataPath}`);
}

if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(dataPath, backupPath);
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const questions = data.questions || [];

let trimmedQuestions = 0;
let trimmedOptions = 0;
let imageOptionsFixed = 0;

for (let i = 0; i < questions.length; i += 1) {
  const question = questions[i];
  const currentStart = materialBodyStart(question.dataMaterial || "");
  const nextStarts = [];

  for (let j = i + 1; j < Math.min(questions.length, i + 8); j += 1) {
    const next = questions[j];
    if (next.sourceTitle !== question.sourceTitle) break;
    const start = materialBodyStart(next.dataMaterial || "");
    if (start && start !== currentStart && !nextStarts.includes(start)) nextStarts.push(start);
  }

  const nextQuestion = trimBoundaryText(trimAtKnownStarts(question.question || "", nextStarts));
  if (nextQuestion && nextQuestion !== question.question) {
    question.question = nextQuestion;
    trimmedQuestions += 1;
  }

  if (Array.isArray(question.options)) {
    question.options = question.options.map((option) => {
      const nextText = normalizeOptionText(option.text || "", nextStarts);
      if (nextText !== option.text) trimmedOptions += 1;
      return { ...option, text: nextText };
    }).filter((option) => option.text || /<img\b/i.test(option.text || ""));
  }

  const trailing = getTrailingQuestionImages(question.dataMaterial || "");
  if (trailing && trailing.imgs.length >= 4 && looksMalformed(question)) {
    question.options = ["A", "B", "C", "D"].map((key, index) => ({
      key,
      text: trailing.imgs[index],
    }));
    question.dataMaterial = (question.dataMaterial || "").replace(trailing.block, "").trim();
    imageOptionsFixed += 1;
  } else if (looksMalformed(question)) {
    const standaloneImages = getStandaloneImages(question.dataMaterial || "");
    if (standaloneImages) {
      question.options = ["A", "B", "C", "D"].map((key, index) => ({
        key,
        text: standaloneImages[index],
      }));
      question.dataMaterial = standaloneImages.length > 4 ? standaloneImages.slice(4).join("\n") : "";
      imageOptionsFixed += 1;
    }
  } else if (trailing && trailing.srcs.length > 0) {
    const duplicatedInNextMaterial = questions
      .slice(i + 1, Math.min(questions.length, i + 8))
      .some((next) => next.sourceTitle === question.sourceTitle && trailing.srcs.every((src) => (next.dataMaterial || "").includes(src)));

    if (duplicatedInNextMaterial) {
      question.dataMaterial = (question.dataMaterial || "").replace(trailing.block, "").trim();
    }
  }
}

const beforeFilterCount = questions.length;
data.questions = questions.filter((question) => (question.options || []).map((option) => option.key).join("") === "ABCD");
const removedMalformedOptions = beforeFilterCount - data.questions.length;

data.meta = {
  ...(data.meta || {}),
  repaired_at: new Date().toISOString(),
  repair_summary: {
    trimmedQuestions,
    trimmedOptions,
    imageOptionsFixed,
    removedMalformedOptions,
  },
};

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf8");

console.log(JSON.stringify(data.meta.repair_summary, null, 2));
