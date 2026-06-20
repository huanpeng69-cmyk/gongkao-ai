import json
import os
import re
import shutil
from collections import defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "gkzhenti_questions.json"
REPORT_PATH = ROOT / "data" / "desktop_question_bank_import_report.json"
DESKTOP_BANK = Path(os.environ["USERPROFILE"]) / "Desktop" / "\u9898\u5e93"


MODULES = [
    ("\u5e38\u8bc6\u5224\u65ad", "changshi"),
    ("\u8a00\u8bed\u7406\u89e3", "yanyu"),
    ("\u6570\u91cf\u5173\u7cfb", "shuliang"),
    ("\u5224\u65ad\u63a8\u7406", "panduan"),
    ("\u8d44\u6599\u5206\u6790", "ziliao"),
]

NOISE_PATTERNS = [
    r"\u6700\u5168\u516c\u8003\u5b66\u4e60\u8d44\u6599\u52a0\u5fae\u4fe1\w+",
    r"\u3010\u66f4\u591a\u8d44\u6599\u52a0\u5165\u8003\u7814\u9898\u5e93\u3011",
    r"\s*\d+\s*$",
]


def clean_text(text: str) -> str:
    text = text.replace("\r", "\n").replace("\u3000", " ")
    for pattern in NOISE_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.MULTILINE)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def compact(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def normalize_for_compare(text: str) -> str:
    text = strip_html(text)
    text = re.sub(r"[A-D]\s*[\.\uff0e\u3001]\s*", "", text)
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "", text, flags=re.UNICODE)
    return text.lower()


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "")


def has_useful_explanation(value: str) -> bool:
    text = compact(strip_html(value))
    if not text or text == "\u65e0":
        return False
    if text.startswith("\u6765\u81ea") and len(text) < 80:
        return False
    return True


def read_pdf_text(path: Path) -> str:
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("Missing PyMuPDF. Run: python -m pip install --user pymupdf") from exc

    with fitz.open(str(path)) as doc:
        return clean_text("\n".join(page.get_text("text") for page in doc))


def read_doc_text(path: Path) -> str:
    try:
        import win32com.client
    except Exception:
        return ""

    word = None
    doc = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        doc = word.Documents.Open(str(path), ReadOnly=True, AddToRecentFiles=False)
        return clean_text(doc.Content.Text)
    except Exception:
        return ""
    finally:
        if doc is not None:
            doc.Close(False)
        if word is not None:
            word.Quit()


def read_source_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        return read_pdf_text(path)
    if path.suffix.lower() == ".doc":
        return read_doc_text(path)
    if path.suffix.lower() == ".txt":
        return path.read_text("utf-8", errors="ignore")
    return ""


def paper_title_from_path(path: Path) -> str:
    title = path.stem
    title = re.sub(r"[\uff08(]?\u7b54\u6848[\u53ca\u548c]?\u89e3\u6790[\uff09)]?", "", title)
    title = re.sub(r"[\uff08(]?\u89e3\u6790[\uff09)]?", "", title)
    title = re.sub(r"\u53c2\u8003\u7b54\u6848[\u53ca\u548c]?\u89e3\u6790", "", title)
    title = re.sub(r"\u7b54\u6848$", "", title)
    title = re.sub(r"\u3010.*?\u3011", "", title)
    title = title.replace("_processed", "")
    return re.sub(r"\s+", " ", title).strip(" -_\u3000")


def title_tokens(title: str) -> set[str]:
    tokens = set(re.findall(r"20\d{2}|19\d{2}", title))
    for token in [
        "\u56fd\u5bb6", "\u56fd\u8003", "\u5e7f\u4e1c", "\u5e7f\u5dde", "\u6df1\u5733",
        "\u4e61\u9547", "\u53bf\u7ea7", "\u53bf\u7ea7\u4ee5\u4e0a", "\u4e0a\u534a\u5e74",
        "\u4e0b\u534a\u5e74", "\u4e00\u5377", "\u4e09\u5377", "\u9009\u8c03",
        "\u601d\u7ef4", "\u7efc\u5408", "\u884c\u653f\u6267\u6cd5", "\u884c\u6d4b1",
        "\u884c\u6d4b2", "\u53bf\u7ea7\u5377", "\u4e61\u9547\u5377",
    ]:
        if token in title:
            tokens.add(token)
    if "\u5e02\u8003" in title:
        tokens.add("\u5e02\u8003")
    if "\u884c\u6d4b" in title or "\u884c\u653f\u804c\u4e1a\u80fd\u529b" in title:
        tokens.add("\u884c\u6d4b")
    return tokens


def title_score(candidate: str, imported: str) -> int:
    c_tokens = title_tokens(candidate)
    i_tokens = title_tokens(imported)
    years_c = {t for t in c_tokens if re.fullmatch(r"\d{4}", t)}
    years_i = {t for t in i_tokens if re.fullmatch(r"\d{4}", t)}
    if years_c and years_i and not years_c.intersection(years_i):
        return -100
    score = len(c_tokens.intersection(i_tokens)) * 10
    c_compact = compact(candidate)
    i_compact = compact(imported)
    if c_compact and i_compact and (c_compact in i_compact or i_compact in c_compact):
        score += 20
    return score


def parse_answer_pdf(text: str) -> dict[int, dict[str, str]]:
    matches = list(re.finditer(r"(?:^|\n)\s*\u7b2c\s*(\d{1,3})\s*\u9898\s*", text))
    answers: dict[int, dict[str, str]] = {}
    for index, match in enumerate(matches):
        num = int(match.group(1))
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        segment = clean_text(text[match.start():end])
        ans_match = re.search(r"\u6b63\u786e\u7b54\u6848(?:\u662f|:|\uff1a)?\s*[\u3010\[]?([A-D])[\u3011\]]?", segment)
        if not ans_match:
            ans_match = re.search(r"\u6545\u6b63\u786e\u7b54\u6848\u4e3a\s*([A-D])", segment)
        if ans_match:
            answers[num] = {"answer": ans_match.group(1), "explanation": segment}
    return answers


def option_spans(segment: str):
    pattern = re.compile(r"(?:^|\n)\s*([A-D])\s*[\.\uff0e\u3001]\s*")
    return list(pattern.finditer(segment))


def infer_module(text_before: str) -> tuple[str, str]:
    last = ("\u5e38\u8bc6\u5224\u65ad", "changshi", -1)
    for name, key in MODULES:
        pos = text_before.rfind(name)
        if pos > last[2]:
            last = (name, key, pos)
    return last[0], last[1]


def parse_questions(text: str, title: str, answers: dict[int, dict[str, str]]) -> list[dict]:
    starts = list(re.finditer(r"(?:^|\n)\s*(\d{1,3})\s*[\.\uff0e\u3001]\s*", text))
    questions = []
    used_nums = set()
    for index, match in enumerate(starts):
        num = int(match.group(1))
        if num in used_nums:
            continue
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        segment = clean_text(text[match.end():end])
        spans = option_spans(segment)
        if len(spans) < 4 or [s.group(1) for s in spans[:4]] != ["A", "B", "C", "D"]:
            continue
        stem = clean_text(segment[:spans[0].start()])
        if len(compact(stem)) < 8:
            continue
        options = []
        for opt_index, span in enumerate(spans[:4]):
            opt_end = spans[opt_index + 1].start() if opt_index + 1 < 4 else len(segment)
            options.append({
                "key": span.group(1),
                "text": clean_text(segment[span.end():opt_end]),
            })
        if any(len(compact(option["text"])) == 0 for option in options):
            continue

        module, module_key = infer_module(text[:match.start()])
        answer_info = answers.get(num, {})
        answer = answer_info.get("answer")
        if not answer:
            continue

        year_match = re.search(r"(20\d{2}|19\d{2})", title)
        knowledge = [module, "\u684c\u9762\u9898\u5e93"]
        if year_match:
            knowledge.append(f"{year_match.group(1)}\u5e74\u771f\u9898")

        source_slug = re.sub(r"[^\w]+", "-", title, flags=re.UNICODE).strip("-").lower()
        questions.append({
            "id": f"desktop-{source_slug}-{num}",
            "num": num,
            "type": "single_choice",
            "module": module,
            "moduleKey": module_key,
            "subModule": module,
            "difficulty": 2,
            "question": stem,
            "options": options,
            "answer": answer,
            "dataMaterial": "",
            "explanation": answer_info.get("explanation", ""),
            "knowledgePoints": knowledge,
            "source": "desktop_question_bank",
            "sourceTitle": title,
            "year": int(year_match.group(1)) if year_match else None,
        })
        used_nums.add(num)
    return questions


def stems_match(existing_text: str, imported_text: str) -> bool:
    existing = normalize_for_compare(existing_text)
    imported = normalize_for_compare(imported_text)
    if len(existing) < 12 or len(imported) < 12:
        return False

    short_existing = existing[:140]
    short_imported = imported[:140]
    if short_existing[:60] in imported or short_imported[:60] in existing:
        return True

    window = min(len(short_existing), len(short_imported), 180)
    return SequenceMatcher(None, short_existing[:window], short_imported[:window]).ratio() >= 0.72


def sorted_by_id_order(items: list[dict]) -> list[dict]:
    def key(item):
        match = re.search(r"-(\d+)$", item.get("id", ""))
        return int(match.group(1)) if match else 10**6
    return sorted(items, key=key)


def find_best_existing_title(imported_title: str, titles: list[str]) -> tuple[str | None, int]:
    best_title = None
    best_score = -100
    for title in titles:
        score = title_score(title, imported_title)
        if score > best_score:
            best_title = title
            best_score = score
    return best_title, best_score


def is_answer_file(path: Path) -> bool:
    name = path.stem
    return "\u7b54\u6848" in name or "\u89e3\u6790" in name


def find_best_question_file(imported_title: str, question_files: list[Path]) -> tuple[Path | None, int]:
    best_file = None
    best_score = -100
    for path in question_files:
        score = title_score(paper_title_from_path(path), imported_title)
        if score > best_score:
            best_file = path
            best_score = score
    return best_file, best_score


def main():
    if not DESKTOP_BANK.exists():
        raise SystemExit(f"Desktop question bank not found: {DESKTOP_BANK}")
    data = json.loads(DATA_PATH.read_text("utf-8"))
    questions = data.get("questions", data if isinstance(data, list) else [])
    by_title = defaultdict(list)
    for question in questions:
        by_title[question.get("sourceTitle") or question.get("source") or ""].append(question)

    pdf_and_doc = [
        path for path in DESKTOP_BANK.rglob("*")
        if path.is_file() and path.suffix.lower() in {".pdf", ".doc", ".txt"}
    ]
    answer_files = [path for path in pdf_and_doc if is_answer_file(path)]
    question_files = [path for path in pdf_and_doc if not is_answer_file(path)]

    parsed_answers: dict[str, dict[int, dict[str, str]]] = {}
    report = {
        "desktop_bank": str(DESKTOP_BANK),
        "answer_files": len(answer_files),
        "question_files": len(question_files),
        "answer_files_with_text": 0,
        "existing_explanations_updated": 0,
        "new_questions_added": 0,
        "skipped_scanned_or_empty": [],
        "skipped_without_question_text_check": [],
        "content_mismatch": [],
        "matched_existing": [],
        "new_papers": [],
    }

    for path in answer_files:
        text = read_source_text(path)
        if len(compact(text)) < 80:
            report["skipped_scanned_or_empty"].append(str(path))
            continue
        answers = parse_answer_pdf(text)
        if not answers:
            continue
        report["answer_files_with_text"] += 1
        title = paper_title_from_path(path)
        parsed_answers[title] = answers

        question_file, question_file_score = find_best_question_file(title, question_files)
        imported_questions_by_num = {}
        if question_file and question_file_score >= 20:
            question_text = read_source_text(question_file)
            if len(compact(question_text)) >= 80:
                imported_questions_by_num = {
                    item["num"]: item
                    for item in parse_questions(question_text, paper_title_from_path(question_file), answers)
                }

        if not imported_questions_by_num:
            report["skipped_without_question_text_check"].append({
                "answer_file": str(path),
                "reason": "No readable paired question file; explanations were not imported by order only.",
            })
            continue

        existing_title, score = find_best_existing_title(title, list(by_title.keys()))
        if not existing_title or score < 20:
            continue

        paper_questions = sorted_by_id_order(by_title[existing_title])
        updated = 0
        for num, info in answers.items():
            if num < 1 or num > len(paper_questions):
                continue
            question = paper_questions[num - 1]
            if str(question.get("answer", "")).upper() != info["answer"]:
                continue
            imported_question = imported_questions_by_num.get(num)
            if not imported_question or not stems_match(question.get("question", ""), imported_question.get("question", "")):
                report["content_mismatch"].append({
                    "answer_file": str(path),
                    "existing_title": existing_title,
                    "num": num,
                    "existing_question": strip_html(question.get("question", ""))[:120],
                    "imported_question": strip_html((imported_question or {}).get("question", ""))[:120],
                })
                continue
            if has_useful_explanation(question.get("explanation", "")):
                continue
            question["explanation"] = info["explanation"]
            updated += 1
        if updated:
            report["existing_explanations_updated"] += updated
            report["matched_existing"].append({
                "answer_file": str(path),
                "imported_title": title,
                "existing_title": existing_title,
                "score": score,
                "updated": updated,
            })

    existing_compact_titles = {compact(title) for title in by_title.keys()}
    existing_question_keys = {
        compact(strip_html(question.get("question", "")))[:120]
        for question in questions
    }

    for path in question_files:
        title = paper_title_from_path(path)
        if compact(title) in existing_compact_titles:
            continue
        existing_title, existing_score = find_best_existing_title(title, list(by_title.keys()))
        if existing_title and existing_score >= 20:
            continue
        best_answer_title, score = find_best_existing_title(title, list(parsed_answers.keys()))
        if not best_answer_title or score < 20:
            continue
        text = read_source_text(path)
        if len(compact(text)) < 80:
            report["skipped_scanned_or_empty"].append(str(path))
            continue
        new_items = []
        for item in parse_questions(text, title, parsed_answers[best_answer_title]):
            key = compact(strip_html(item.get("question", "")))[:120]
            if key in existing_question_keys:
                continue
            existing_question_keys.add(key)
            new_items.append(item)
        if new_items:
            questions.extend(new_items)
            report["new_questions_added"] += len(new_items)
            report["new_papers"].append({
                "question_file": str(path),
                "answer_title": best_answer_title,
                "added": len(new_items),
            })

    stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    backup_path = DATA_PATH.with_name(f"gkzhenti_questions.before-desktop-import-{stamp}.json")
    shutil.copy2(DATA_PATH, backup_path)

    if isinstance(data, list):
        output = questions
    else:
        data["questions"] = questions
        data["meta"] = {
            **data.get("meta", {}),
            "desktop_question_bank_imported_at": datetime.now().isoformat(),
            "desktop_question_bank_import_summary": {
                "existing_explanations_updated": report["existing_explanations_updated"],
                "new_questions_added": report["new_questions_added"],
            },
        }
        output = data

    DATA_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), "utf-8")
    report["backup_path"] = str(backup_path)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
