import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "gkzhenti_questions.json"
REPORT_PATH = ROOT / "data" / "gongji_6000_import_report.json"
CACHE_ROOT = ROOT / "data" / "gongji6000_ocr_cache"
OCR_SCRIPT = ROOT / "scripts" / "windows_ocr_pages.ps1"
SOURCE = "gongji_6000_notes"

PDF_CATEGORY_MAP = [
    ("法律", "法律基础", "法律篇"),
    ("公文", "公文写作与处理", "公文篇"),
    ("经济", "经济常识", "经济篇"),
    ("政治", "毛泽东思想/中特", "政治篇"),
    ("行政管理", "管理常识", "行政管理篇"),
    ("人文历史", "人文科技", "人文历史篇"),
    ("科技", "人文科技", "科技篇"),
    ("地理", "人文科技", "地理篇"),
]

OPTION_KEY_FIXES = {
    "ａ": "A",
    "ｂ": "B",
    "ｃ": "C",
    "ｄ": "D",
    "a": "A",
    "b": "B",
    "c": "C",
    "d": "D",
}


def find_pdf_root() -> Path:
    desktop = Path(os.environ["USERPROFILE"]) / "Desktop"
    candidates = [
        path
        for path in desktop.iterdir()
        if path.is_dir() and "6000" in path.name and any(path.glob("*.pdf"))
    ]
    if not candidates:
        raise SystemExit("Desktop folder not found: 公基6000题笔记合集")
    return candidates[0]


def category_for_pdf(path: Path) -> tuple[str, str]:
    name = path.stem
    for marker, sub_module, title in PDF_CATEGORY_MAP:
        if marker in name:
            return sub_module, title
    return "公共基础知识", path.stem


def slug_for_pdf(path: Path) -> str:
    name = path.stem
    for marker, _sub_module, title in PDF_CATEGORY_MAP:
        if marker in name:
            return re.sub(r"[^a-z0-9]+", "-", title.encode("pinyin", errors="ignore").decode("ascii", errors="ignore").lower()).strip("-") or marker
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:10]
    return f"pdf-{digest}"


def stable_slug(text: str) -> str:
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
    return digest


def safe_reset_dir(path: Path):
    resolved = path.resolve()
    cache_root = CACHE_ROOT.resolve()
    if cache_root not in resolved.parents and resolved != cache_root:
        raise RuntimeError(f"Refusing to remove path outside cache: {resolved}")
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def render_pdf_pages(pdf_path: Path, output_dir: Path, scale: float, page_limit: int | None):
    safe_reset_dir(output_dir)
    with fitz.open(str(pdf_path)) as doc:
        page_count = doc.page_count if page_limit is None else min(doc.page_count, page_limit)
        matrix = fitz.Matrix(scale, scale)
        for page_index in range(page_count):
            page = doc[page_index]
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            pix.save(str(output_dir / f"page_{page_index + 1:04d}.png"))
    return page_count


def run_windows_ocr(input_dir: Path, output_jsonl: Path):
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(OCR_SCRIPT),
        "-InputDir",
        str(input_dir),
        "-OutputJsonl",
        str(output_jsonl),
    ]
    subprocess.run(command, cwd=str(ROOT), check=True)


def ensure_ocr_for_pdf(pdf_path: Path, args) -> Path:
    slug = slug_for_pdf(pdf_path)
    jsonl_path = CACHE_ROOT / f"{slug}.jsonl"
    if jsonl_path.exists() and not args.force_ocr:
        return jsonl_path

    image_dir = CACHE_ROOT / "images" / slug
    page_count = render_pdf_pages(pdf_path, image_dir, args.scale, args.page_limit)
    print(f"Rendered {page_count} pages: {pdf_path.name}")
    run_windows_ocr(image_dir, jsonl_path)
    if not args.keep_images:
        safe_reset_dir(image_dir)
        image_dir.rmdir()
    return jsonl_path


def read_ocr_pages(jsonl_path: Path) -> list[dict]:
    pages = []
    with jsonl_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            pages.append(json.loads(line))
    return pages


def normalize_line(line: str) -> str:
    line = line.replace("\r", "")
    line = re.sub(r"\s+", "", line)
    line = line.translate(str.maketrans({
        "．": ".",
        "。": ".",
        "，": ",",
        "、": ".",
        "（": "(",
        "）": ")",
        "【": "[",
        "】": "]",
        "：": ":",
        "；": ";",
        "？": "?",
        "！": "!",
        "０": "0",
        "１": "1",
        "２": "2",
        "３": "3",
        "４": "4",
        "５": "5",
        "６": "6",
        "７": "7",
        "８": "8",
        "９": "9",
        "Ａ": "A",
        "Ｂ": "B",
        "Ｃ": "C",
        "Ｄ": "D",
    }))
    for old, new in OPTION_KEY_FIXES.items():
        line = re.sub(rf"(?<![A-Za-z]){old}(?=[\.,])", new, line)
    return line.strip()


def detect_question_start(line: str) -> tuple[int, str] | None:
    match = re.match(r"^(\d{1,4})[\.,](.+)", line)
    if match:
        return int(match.group(1)), match.group(2)

    # Windows OCR sometimes reads the 8 in a question number as &.
    match = re.match(r"^(\d{1,3})[&＆](.+)", line)
    if match:
        return int(match.group(1) + "8"), match.group(2)

    return None


def ocr_pages_to_blocks(pages: list[dict]) -> list[dict]:
    blocks = []
    current = None

    for page in pages:
        page_no = int(page.get("page") or 0)
        raw_lines = str(page.get("text") or "").splitlines()
        for raw_line in raw_lines:
            line = normalize_line(raw_line)
            if not line or re.fullmatch(r"\d{1,4}", line):
                continue
            start = detect_question_start(line)
            if start:
                if current and current["lines"]:
                    blocks.append(current)
                num, rest = start
                current = {"num": num, "page": page_no, "lines": [rest]}
                continue
            if current:
                current["lines"].append(line)

    if current and current["lines"]:
        blocks.append(current)
    return blocks


ANSWER_RE = re.compile(r"[\(（]\s*([ABCD]{1,4})\s*[\)）]?")
OPTION_RE = re.compile(r"(?<![A-Za-z0-9])([ABCDabcd])[\.,](?=.)")


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", "", text or "")
    text = text.replace("（）", "( )")
    text = re.sub(r"考点[:：]?.*$", "", text)
    text = re.sub(r"点[:：]?P\d+.*$", "", text)
    text = re.sub(r"[。\.]{2,}", ".", text)
    return text.strip(" \n\t;；,，.。")


def first_answer(text: str) -> str:
    for match in ANSWER_RE.finditer(text):
        value = match.group(1).upper()
        if set(value) <= set("ABCD"):
            return value
    return ""


def strip_answer_from_stem(stem: str, answer: str) -> str:
    if not answer:
        return stem
    stem = re.sub(rf"[\(（]\s*{re.escape(answer)}\s*[\)）]?", "( )", stem, count=1)
    return stem


def parse_options(text: str):
    markers = []
    seen = set()
    for match in OPTION_RE.finditer(text):
        key = match.group(1).upper()
        if key not in "ABCD" or key in seen:
            continue
        seen.add(key)
        markers.append((key, match.start(), match.end()))
        if len(seen) == 4:
            break

    if len(markers) < 4:
        return None, None

    markers_by_pos = sorted(markers, key=lambda item: item[1])
    option_map = {}
    for index, (key, start, end) in enumerate(markers_by_pos):
        next_start = markers_by_pos[index + 1][1] if index + 1 < len(markers_by_pos) else len(text)
        value = clean_text(text[end:next_start])
        option_map[key] = value

    if any(key not in option_map or not option_map[key] for key in "ABCD"):
        return None, None

    first_option_pos = min(item[1] for item in markers_by_pos)
    options = [{"key": key, "text": option_map[key]} for key in "ABCD"]
    return first_option_pos, options


def parse_block(block: dict, sub_module: str, category_title: str):
    text = "\n".join(block["lines"])
    answer = first_answer(text)
    if not answer or len(answer) != 1:
        return None, "missing_answer"

    first_option_pos, options = parse_options(text)
    if first_option_pos is None:
        return None, "missing_options"

    stem = clean_text(strip_answer_from_stem(text[:first_option_pos], answer))
    if len(stem) < 6:
        return None, "short_stem"

    if answer not in {option["key"] for option in options}:
        return None, "bad_answer"

    question_key = stable_slug(f"{category_title}|{block['num']}|{stem}")
    return {
        "id": f"gongji6000-{question_key}",
        "num": block["num"],
        "type": "single_choice",
        "module": "公共基础知识",
        "moduleKey": "ggjc",
        "subModule": sub_module,
        "difficulty": 2,
        "question": stem,
        "options": options,
        "answer": answer,
        "dataMaterial": "",
        "explanation": f"来源：公基6000题笔记合集 - {category_title}；OCR导入，原 PDF 第 {block['page']} 页，答案 {answer}。",
        "knowledgePoints": ["公共基础知识", sub_module, category_title, "公基6000题"],
        "source": SOURCE,
        "sourceTitle": f"公基6000题笔记合集-{category_title}",
        "province": "公基",
        "page": block["page"],
    }, ""


def compact_key(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "", text)
    return text[:120]


def load_questions():
    data = json.loads(DATA_PATH.read_text("utf-8"))
    questions = data.get("questions", data if isinstance(data, list) else [])
    return data, questions


def write_questions(data, questions, report):
    stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    backup_path = DATA_PATH.with_name(f"gkzhenti_questions.before-gongji6000-import-{stamp}.json")
    shutil.copy2(DATA_PATH, backup_path)

    if isinstance(data, list):
        output = questions
    else:
        data["questions"] = questions
        data["meta"] = {
            **data.get("meta", {}),
            "gongji_6000_imported_at": datetime.now().isoformat(),
            "gongji_6000_import_summary": {
                "added": report["added"],
                "parsed": report["parsed"],
                "skipped": report["skipped"],
            },
        }
        output = data

    DATA_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), "utf-8")
    report["backup_path"] = str(backup_path)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-ocr", action="store_true")
    parser.add_argument("--keep-images", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--pdf-limit", type=int)
    parser.add_argument("--page-limit", type=int)
    parser.add_argument("--scale", type=float, default=2.4)
    args = parser.parse_args()

    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    pdf_root = find_pdf_root()
    pdfs = sorted(pdf_root.glob("*.pdf"))
    if args.pdf_limit is not None:
        pdfs = pdfs[: args.pdf_limit]

    data, existing_questions = load_questions()
    base_questions = [q for q in existing_questions if q.get("source") != SOURCE]
    existing_keys = {compact_key(q.get("question", "")) for q in base_questions}

    imported = []
    report = {
        "pdf_root": str(pdf_root),
        "pdf_count": len(pdfs),
        "parsed": 0,
        "added": 0,
        "skipped": 0,
        "skip_reasons": {},
        "by_pdf": [],
    }

    for pdf_path in pdfs:
        sub_module, category_title = category_for_pdf(pdf_path)
        print(f"\n=== {pdf_path.name} -> {sub_module} ===")
        jsonl_path = ensure_ocr_for_pdf(pdf_path, args)
        pages = read_ocr_pages(jsonl_path)
        blocks = ocr_pages_to_blocks(pages)
        parsed_items = []
        skip_counter = Counter()

        for block in blocks:
            item, reason = parse_block(block, sub_module, category_title)
            if not item:
                skip_counter[reason] += 1
                continue
            key = compact_key(item["question"])
            if not key or key in existing_keys:
                skip_counter["duplicate"] += 1
                continue
            existing_keys.add(key)
            parsed_items.append(item)

        imported.extend(parsed_items)
        report["by_pdf"].append({
            "file": str(pdf_path),
            "category": category_title,
            "subModule": sub_module,
            "pages": len(pages),
            "blocks": len(blocks),
            "parsed": len(parsed_items),
            "skipped": sum(skip_counter.values()),
            "skip_reasons": dict(skip_counter),
        })
        report["parsed"] += len(parsed_items)
        report["skipped"] += sum(skip_counter.values())
        for key, value in skip_counter.items():
            report["skip_reasons"][key] = report["skip_reasons"].get(key, 0) + value
        print(f"Parsed {len(parsed_items)} questions; skipped {sum(skip_counter.values())}.")

    final_questions = base_questions + imported
    report["added"] = len(imported)
    report["total_before"] = len(existing_questions)
    report["total_after"] = len(final_questions)
    report["removed_previous_import"] = len(existing_questions) - len(base_questions)
    report["category_counts"] = dict(Counter(q["sourceTitle"] for q in imported))

    if args.dry_run:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    write_questions(data, final_questions, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
