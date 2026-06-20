const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "gkzhenti_questions.json");
const outDir = path.join(root, "public", "mobile-data");
const outPath = path.join(outDir, "gkzhenti_questions.min.json");

function formatBytes(value) {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value > 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Missing question bank: ${sourcePath}`);
}

const raw = fs.readFileSync(sourcePath, "utf8");
const data = JSON.parse(raw);
const questions = Array.isArray(data.questions) ? data.questions : [];

fs.mkdirSync(outDir, { recursive: true });
const compact = JSON.stringify({
  meta: {
    ...data.meta,
    mobileBuiltAt: new Date().toISOString(),
    total: questions.length,
  },
  questions,
});
fs.writeFileSync(outPath, compact);

const before = Buffer.byteLength(raw);
const after = Buffer.byteLength(compact);
const saved = before - after;

console.log(`Mobile question bank: ${formatBytes(before)} -> ${formatBytes(after)} (${formatBytes(saved)} saved)`);
