#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_DATA_PATH = path.join(ROOT, "data", "gkzhenti_questions.json");
const DEFAULT_MISSING_REPORT = path.join(ROOT, "data", "missing_explanations.csv");
const DEFAULT_UNMATCHED_REPORT = path.join(ROOT, "data", "explanation_import_unmatched.csv");

const ZH = {
  from: "\u6765\u81ea",
  year: "\u5e74",
  none: "\u65e0",
  exam: "\u8003\u8bd5",
  paper: "\u771f\u9898",
  xingce: "\u884c\u6d4b",
  shenlun: "\u7533\u8bba",
};

const FIELD_CANDIDATES = {
  id: [
    "id",
    "questionId",
    "question_id",
    "qid",
    "\u9898\u76eeID",
    "\u9898\u76eeid",
    "\u9898\u53f7ID",
  ],
  question: [
    "question",
    "questionText",
    "stem",
    "title",
    "content",
    "\u9898\u76ee",
    "\u9898\u5e72",
    "\u9898\u76ee\u5185\u5bb9",
  ],
  answer: [
    "answer",
    "correctAnswer",
    "correct_answer",
    "\u7b54\u6848",
    "\u6b63\u786e\u7b54\u6848",
    "\u6807\u51c6\u7b54\u6848",
  ],
  explanation: [
    "explanation",
    "analysis",
    "parse",
    "solution",
    "explain",
    "\u89e3\u6790",
    "\u7b54\u6848\u89e3\u6790",
    "\u9898\u76ee\u89e3\u6790",
    "\u7c89\u7b14\u89e3\u6790",
    "\u8be6\u7ec6\u89e3\u6790",
  ],
  sourceTitle: [
    "sourceTitle",
    "source",
    "paper",
    "paperTitle",
    "\u6765\u6e90",
    "\u8bd5\u5377",
    "\u8bd5\u5377\u540d\u79f0",
  ],
};

function parseArgs(argv) {
  const args = {
    importPath: "",
    dataPath: DEFAULT_DATA_PATH,
    missingReport: DEFAULT_MISSING_REPORT,
    unmatchedReport: DEFAULT_UNMATCHED_REPORT,
    dryRun: false,
    overwrite: false,
    reportOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    } else if (item === "--dry-run") {
      args.dryRun = true;
    } else if (item === "--overwrite") {
      args.overwrite = true;
    } else if (item === "--report-only") {
      args.reportOnly = true;
    } else if (item === "--data") {
      args.dataPath = path.resolve(argv[++i]);
    } else if (item === "--missing-report") {
      args.missingReport = path.resolve(argv[++i]);
    } else if (item === "--unmatched-report") {
      args.unmatchedReport = path.resolve(argv[++i]);
    } else if (!args.importPath) {
      args.importPath = path.resolve(item);
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }

  if (!args.importPath) args.reportOnly = true;
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/import_explanations.js
  node scripts/import_explanations.js path/to/easy-scraper-export.csv --dry-run
  node scripts/import_explanations.js path/to/easy-scraper-export.json

Options:
  --report-only              Only write data/missing_explanations.csv
  --dry-run                  Match records but do not modify the question bank
  --overwrite                Replace existing useful explanations too
  --data <path>              Question bank JSON path
  --missing-report <path>    Missing-explanation CSV output
  --unmatched-report <path>  Unmatched import rows CSV output

CSV/JSON import columns can use common names such as:
  id, question, answer, explanation, analysis, sourceTitle
  or Chinese headers like question stem / answer analysis / paper title.
`);
}

function readQuestionBank(dataPath) {
  if (!fs.existsSync(dataPath)) throw new Error(`Missing data file: ${dataPath}`);
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const questions = Array.isArray(data) ? data : data.questions || [];
  if (!Array.isArray(questions)) throw new Error("Question bank must be an array or { questions: [] }");
  return { data, questions, arrayRoot: Array.isArray(data) };
}

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(input = "") {
  return decodeBasicEntities(input)
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|table|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasUsefulExplanation(explanation = "") {
  const text = stripHtml(explanation);
  if (!text || text === ZH.none) return false;
  if (new RegExp(`^\\s*${ZH.from}\\s*\\d{4}${ZH.year}`).test(text)) return false;
  if (
    text.startsWith(ZH.from) &&
    text.length < 80 &&
    [ZH.exam, ZH.paper, ZH.xingce, ZH.shenlun].some((word) => text.includes(word))
  ) {
    return false;
  }
  return true;
}

function normalizeForMatch(value = "") {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function normalizeAnswer(value = "") {
  if (Array.isArray(value)) return value.join("");
  return String(value).replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase();
}

function getField(row, candidates) {
  const direct = candidates.find((key) => Object.prototype.hasOwnProperty.call(row, key));
  if (direct) return row[direct];

  const normalized = new Map(
    Object.keys(row).map((key) => [normalizeHeader(key), key]),
  );
  for (const candidate of candidates) {
    const found = normalized.get(normalizeHeader(candidate));
    if (found) return row[found];
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[\s_\-:：()（）]+/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((item) => item !== "")) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => stripBom(header).trim());
  return rows.slice(1).map((items) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = (items[index] || "").trim();
    });
    return record;
  });
}

function stripBom(value) {
  return String(value || "").replace(/^\uFEFF/, "");
}

function readImportRows(importPath) {
  const raw = fs.readFileSync(importPath, "utf8");
  if (/\.csv$/i.test(importPath)) return parseCsv(raw);

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  for (const key of ["rows", "data", "questions", "results", "items"]) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  throw new Error("JSON import must be an array or contain rows/data/questions/results/items");
}

function normalizeImportRow(row) {
  const explanation = cleanImportedExplanation(getField(row, FIELD_CANDIDATES.explanation));
  return {
    id: String(getField(row, FIELD_CANDIDATES.id) || "").trim(),
    question: String(getField(row, FIELD_CANDIDATES.question) || "").trim(),
    answer: getField(row, FIELD_CANDIDATES.answer),
    explanation,
    sourceTitle: String(getField(row, FIELD_CANDIDATES.sourceTitle) || "").trim(),
    raw: row,
  };
}

function cleanImportedExplanation(value) {
  return stripHtml(value).replace(/\n{3,}/g, "\n\n").trim();
}

function addUnique(map, key, question) {
  if (!key) return;
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, question);
  } else if (current && current.id !== question.id) {
    map.set(key, null);
  }
}

function buildIndexes(questions) {
  const byId = new Map();
  const byQuestionAnswer = new Map();
  const bySourceQuestion = new Map();
  const byQuestion = new Map();
  const byQuestionPrefix = new Map();

  for (const question of questions) {
    if (question.id) byId.set(String(question.id), question);
    const qKey = normalizeForMatch(question.question);
    const aKey = normalizeAnswer(question.answer);
    const sourceKey = normalizeForMatch(question.sourceTitle || question.source || "");
    addUnique(byQuestionAnswer, `${qKey}::${aKey}`, question);
    addUnique(bySourceQuestion, `${sourceKey}::${qKey}`, question);
    addUnique(byQuestion, qKey, question);
    addUnique(byQuestionPrefix, qKey.slice(0, 96), question);
  }

  return { byId, byQuestionAnswer, bySourceQuestion, byQuestion, byQuestionPrefix };
}

function findTarget(row, indexes) {
  if (row.id && indexes.byId.has(row.id)) return { question: indexes.byId.get(row.id), method: "id" };

  const qKey = normalizeForMatch(row.question);
  const aKey = normalizeAnswer(row.answer);
  const sourceKey = normalizeForMatch(row.sourceTitle);
  const probes = [
    ["question+answer", indexes.byQuestionAnswer.get(`${qKey}::${aKey}`)],
    ["source+question", indexes.bySourceQuestion.get(`${sourceKey}::${qKey}`)],
    ["question", indexes.byQuestion.get(qKey)],
    ["question-prefix", indexes.byQuestionPrefix.get(qKey.slice(0, 96))],
  ];

  for (const [method, question] of probes) {
    if (question) return { question, method };
    if (question === null) return { question: null, method: `${method}:ambiguous` };
  }
  return { question: null, method: "none" };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows, headers) {
  const text = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, text + "\n", "utf8");
}

function writeMissingReport(questions, reportPath) {
  const missing = questions
    .filter((question) => !hasUsefulExplanation(question.explanation))
    .map((question) => ({
      id: question.id || "",
      sourceTitle: question.sourceTitle || "",
      module: question.module || "",
      answer: normalizeAnswer(question.answer),
      question: stripHtml(question.question || "").slice(0, 240),
    }));

  writeCsv(reportPath, missing, ["id", "sourceTitle", "module", "answer", "question"]);
  return missing.length;
}

function backupFile(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = filePath.replace(/\.json$/i, `.before-explanation-import-${stamp}.json`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { data, questions, arrayRoot } = readQuestionBank(args.dataPath);

  const initialMissing = writeMissingReport(questions, args.missingReport);
  if (args.reportOnly) {
    console.log(`Question bank: ${questions.length}`);
    console.log(`Need explanation: ${initialMissing}`);
    console.log(`Missing report: ${args.missingReport}`);
    return;
  }

  const importRows = readImportRows(args.importPath).map(normalizeImportRow);
  const validRows = importRows.filter((row) => hasUsefulExplanation(row.explanation));
  const indexes = buildIndexes(questions);
  const stats = {
    importRows: importRows.length,
    validRows: validRows.length,
    matched: 0,
    updated: 0,
    skippedExisting: 0,
    unmatched: 0,
    ambiguous: 0,
  };
  const unmatchedRows = [];

  for (const row of validRows) {
    const { question, method } = findTarget(row, indexes);
    if (!question) {
      if (method.includes("ambiguous")) stats.ambiguous += 1;
      else stats.unmatched += 1;
      unmatchedRows.push({
        matchMethod: method,
        id: row.id,
        sourceTitle: row.sourceTitle,
        answer: normalizeAnswer(row.answer),
        question: stripHtml(row.question).slice(0, 240),
        explanation: row.explanation.slice(0, 240),
      });
      continue;
    }

    stats.matched += 1;
    if (!args.overwrite && hasUsefulExplanation(question.explanation)) {
      stats.skippedExisting += 1;
      continue;
    }

    question.explanation = row.explanation;
    stats.updated += 1;
  }

  writeCsv(args.unmatchedReport, unmatchedRows, [
    "matchMethod",
    "id",
    "sourceTitle",
    "answer",
    "question",
    "explanation",
  ]);

  let backupPath = "";
  if (!args.dryRun && stats.updated > 0) {
    backupPath = backupFile(args.dataPath);
    if (!arrayRoot) {
      data.meta = {
        ...(data.meta || {}),
        explanation_imported_at: new Date().toISOString(),
        explanation_import_summary: stats,
      };
    }
    fs.writeFileSync(args.dataPath, JSON.stringify(arrayRoot ? questions : data, null, 2), "utf8");
  }

  const finalMissing = args.dryRun
    ? initialMissing - stats.updated
    : writeMissingReport(questions, args.missingReport);

  console.log(JSON.stringify({
    ...stats,
    dryRun: args.dryRun,
    overwrite: args.overwrite,
    initialMissing,
    finalMissing,
    backupPath: backupPath || null,
    missingReport: args.missingReport,
    unmatchedReport: args.unmatchedReport,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
