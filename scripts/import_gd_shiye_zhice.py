#!/usr/bin/env python3
"""
Import Guangdong public-institution vocational aptitude papers from gkzhenti.

The source list page for this category does not return data through the older
JSON endpoint, so this script reads the saved HTML snapshot first and only
fetches individual public paper/answer pages at a low rate.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests

BASE_URL = "https://gwy.gkzhenti.cn"
ROOT = Path(__file__).resolve().parents[1]
LIST_SNAPSHOT = ROOT / "data" / "gkzhenti_guangdong_shiye_zhice_page.html"
QUESTION_BANK = ROOT / "data" / "gkzhenti_questions.json"
CACHE_DIR = ROOT / "data" / "gkzhenti_cache" / "gd_shiye_zhice"
CURRENT_YEAR = int(time.strftime("%Y"))
RECENT_YEAR_START = CURRENT_YEAR - 7

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Connection": "keep-alive",
    }
)


SECTION_MODULE_MAP: list[tuple[str, tuple[str, str, str]]] = [
    ("公共基础知识", ("公共基础知识", "ggjc", "公共基础知识")),
    ("综合基础知识", ("公共基础知识", "ggjc", "公共基础知识")),
    ("综合知识", ("公共基础知识", "ggjc", "公共基础知识")),
    ("公基", ("公共基础知识", "ggjc", "公共基础知识")),
    ("政治理论", ("常识判断", "changshi", "政治理论")),
    ("常识应用", ("常识判断", "changshi", "常识应用")),
    ("常识判断", ("常识判断", "changshi", "常识判断")),
    ("言语表达与理解", ("言语理解与表达", "yanyu", "言语理解与表达")),
    ("言语理解与表达", ("言语理解与表达", "yanyu", "言语理解与表达")),
    ("言语理解", ("言语理解与表达", "yanyu", "言语理解与表达")),
    ("表达", ("言语理解与表达", "yanyu", "言语理解与表达")),
    ("数量关系", ("数量关系", "shuliang", "数量关系")),
    ("数学运算", ("数量关系", "shuliang", "数学运算")),
    ("数字推理", ("数量关系", "shuliang", "数字推理")),
    ("资料分析", ("资料分析", "ziliao", "资料分析")),
    ("图形推理", ("判断推理", "panduan", "图形推理")),
    ("定义判断", ("判断推理", "panduan", "定义判断")),
    ("类比推理", ("判断推理", "panduan", "类比推理")),
    ("逻辑判断", ("判断推理", "panduan", "逻辑判断")),
    ("判断推理", ("判断推理", "panduan", "判断推理")),
]


def strip_tags(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.I)
    value = re.sub(r"<img\b[^>]*>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def fix_img_src(src: str) -> str:
    return urljoin(BASE_URL, html.unescape(src or ""))


def parse_year(title: str) -> int:
    match = re.search(r"(20\d{2})", title or "")
    return int(match.group(1)) if match else 0


def clean_section_name(section: str) -> str:
    text = strip_tags(section)
    text = re.sub(r"^[一二三四五六七八九十]+[、.．]\s*", "", text)
    text = re.sub(r"。.*$", "", text)
    return text.strip()


def guess_module(section: str) -> tuple[str, str, str]:
    clean = clean_section_name(section)
    for keyword, module in SECTION_MODULE_MAP:
        if keyword in clean:
            return module
    return ("常识判断", "changshi", "常识判断")


def is_true_false_section(section: str) -> bool:
    clean = clean_section_name(section)
    return "判断题" in clean or "判断下列" in clean or "正误" in clean


def is_multi_section(section: str) -> bool:
    clean = clean_section_name(section)
    return "多选题" in clean or "多项选择" in clean or "两个或两个以上" in clean


def public_foundation_module() -> tuple[str, str, str]:
    return ("公共基础知识", "ggjc", "公共基础知识")


def fetch_text(url: str, cache_path: Path | None = None, delay: float = 1.2) -> str:
    if cache_path and cache_path.exists():
        return cache_path.read_text(encoding="utf-8", errors="replace")

    time.sleep(delay)
    response = SESSION.get(url, timeout=25)
    response.raise_for_status()
    response.encoding = response.encoding or "utf-8"
    text = response.text
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(text, encoding="utf-8")
    return text


def ensure_list_snapshot(delay: float) -> str:
    if LIST_SNAPSHOT.exists():
        return LIST_SNAPSHOT.read_text(encoding="utf-8", errors="replace")

    url = (
        f"{BASE_URL}/paper?cls=%E4%BA%8B%E4%B8%9A%E5%8D%95%E4%BD%8D-"
        "%E8%81%8C%E6%B5%8B&province=%E5%B9%BF%E4%B8%9C"
    )
    text = fetch_text(url, None, delay)
    LIST_SNAPSHOT.write_text(text, encoding="utf-8")
    return text


def extract_papers(list_html: str, start_year: int, end_year: int) -> list[dict[str, Any]]:
    papers: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in re.finditer(r'<a[^>]+href="(/paper/(\d+))"[^>]*>(.*?)</a>', list_html, re.S):
        href, paper_id, raw_title = match.group(1), match.group(2), match.group(3)
        title = strip_tags(raw_title)
        year = parse_year(title)
        if paper_id in seen or not (start_year <= year <= end_year):
            continue
        if "广东" not in title and "深圳" not in title and "广州" not in title and "东莞" not in title and "湛江" not in title:
            continue
        seen.add(paper_id)
        papers.append(
            {
                "id": paper_id,
                "url": f"{BASE_URL}{href}",
                "answer_url": f"{BASE_URL}/answer/{paper_id}",
                "title": title,
                "year": year,
            }
        )
    papers.sort(key=lambda item: (item["year"], item["id"]), reverse=True)
    return papers


def extract_printcontent(page_html: str) -> str:
    start = page_html.find('id="printcontent"')
    return page_html[start:] if start >= 0 else page_html


def parse_answers(answer_html: str) -> dict[int, str]:
    content = extract_printcontent(answer_html)
    answers: dict[int, str] = {}
    for num, answer in re.findall(r"(\d+)[、.．]\s*([ABCD]{1,4}|[√×对错正确错误])", content):
        normalized = answer.strip().upper()
        if normalized in {"√", "对", "正确"}:
            normalized = "A"
        elif normalized in {"×", "错", "错误"}:
            normalized = "B"
        answers[int(num)] = normalized
    return answers


def build_material_map(content: str) -> dict[int, str]:
    sub2titles = list(re.finditer(r'class="col-xs-12 sub2title">(.*?)</div>', content, re.S))
    markers = list(re.finditer(r'<div class="col-xs-1 left">(\d+)</div>', content))
    material_map: dict[int, str] = {}

    for title_match in sub2titles:
        first_question = next((item for item in markers if item.start() > title_match.end()), None)
        if not first_question:
            continue

        material_html = content[title_match.end() : first_question.start()]
        material_text = strip_tags(material_html)
        images = re.findall(r'<img[^>]*src="([^"]*)"[^>]*/?\s*>', material_html, re.S)
        if not material_text and not images:
            continue

        label = strip_tags(title_match.group(1))
        parts = [
            '<div class="ziliao-material" style="margin-bottom:12px;padding:12px;background:var(--surface,#f8f9fa);border-radius:8px;border:1px solid var(--hairline,#e5e7eb);">',
            f'<div style="font-weight:600;margin-bottom:8px;color:var(--text-secondary,#666);font-size:13px;">【阅读材料】{html.escape(label)}</div>',
        ]
        if material_text:
            parts.append(f'<div style="line-height:1.8;margin-bottom:8px;">{html.escape(material_text)}</div>')
        for src in images:
            parts.append(f'<img src="{fix_img_src(src)}" style="max-width:100%;height:auto;" />')
        parts.append("</div>")
        block = "".join(parts)

        for marker in markers:
            if marker.start() > title_match.end():
                material_map[int(marker.group(1))] = block
                if len([n for n in material_map if n >= int(first_question.group(1))]) >= 6:
                    break
    return material_map


def parse_options(q_html: str) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []

    div_options = re.findall(
        r'<div class="col-xs-\d+"[^>]*>\s*([A-D])[、.．]\s*(.*?)</div>',
        q_html,
        flags=re.S,
    )
    for key, raw_text in div_options:
        text = normalize_option_html(raw_text)
        if text and key not in {item["key"] for item in options}:
            options.append({"key": key, "text": text})

    if len(options) >= 2:
        return options

    opt_text = strip_tags(q_html)
    for match in re.finditer(r"(?:^|\s)([A-D])[、.．]\s*(.*?)(?=(?:\s[A-D][、.．])|$)", opt_text):
        key, text = match.group(1), match.group(2).strip()
        if text and key not in {item["key"] for item in options}:
            options.append({"key": key, "text": text})

    return options


def normalize_option_html(raw: str) -> str:
    raw = raw.strip()
    raw = re.sub(
        r'<img[^>]*src="([^"]*)"[^>]*/?\s*>',
        lambda item: f'<img src="{fix_img_src(item.group(1))}" style="max-width:100%;height:auto;" />',
        raw,
        flags=re.S,
    )
    if "<img" in raw.lower():
        text = re.sub(r">\s+<", "><", raw)
        return html.unescape(text).strip()
    return strip_tags(raw)


def question_images(q_html: str, option_image_count: int) -> str:
    images = re.findall(r'<img[^>]*src="([^"]*)"[^>]*/?\s*>', q_html, re.S)
    rendered = [
        f'<img src="{fix_img_src(src)}" style="max-width:100%;height:auto;" />'
        for src in images[option_image_count:]
    ]
    return "\n".join(rendered)


def parse_questions(paper_html: str) -> tuple[list[dict[str, Any]], str]:
    content = extract_printcontent(paper_html)
    title_match = re.search(r"<h3[^>]*>(.*?)</h3>", content, re.S)
    title = strip_tags(title_match.group(1)) if title_match else ""

    sections: list[tuple[int, str]] = []
    for match in re.finditer(r'class="col-xs-12 subtitle">(.*?)</div>', content, re.S):
        sections.append((match.start(), strip_tags(match.group(1))))

    markers = list(re.finditer(r'<div class="col-xs-1 left">(\d+)</div>', content))
    sub2titles = list(re.finditer(r'class="col-xs-12 sub2title">(.*?)</div>', content, re.S))
    boundary_positions = [pos for pos, _ in sections] + [match.start() for match in sub2titles]
    material_map = build_material_map(content)

    questions: list[dict[str, Any]] = []
    for index, marker in enumerate(markers):
        num = int(marker.group(1))
        start = marker.end()
        end_candidates: list[int] = []
        if index + 1 < len(markers):
            end_candidates.append(markers[index + 1].start())
        end_candidates.extend(pos for pos in boundary_positions if pos > start)
        end = min(end_candidates) if end_candidates else len(content)
        q_html = content[start:end]

        section = ""
        for section_pos, section_text in reversed(sections):
            if section_pos < marker.start():
                section = section_text
                break

        p_texts = re.findall(r"<p[^>]*>(.*?)</p>", q_html, re.S)
        question_text = "\n".join(text for text in (strip_tags(item) for item in p_texts) if text)
        if not question_text:
            without_options = re.sub(r'<div class="col-xs-\d+"[^>]*>.*?</div>', " ", q_html, flags=re.S)
            question_text = strip_tags(without_options)

        options = parse_options(q_html)
        image_count = len(options) if options and all("<img" in item["text"].lower() for item in options) else 0
        q_images = question_images(q_html, image_count)
        data_material = material_map.get(num, "")
        if q_images:
            data_material = f'{data_material}\n<div style="margin-top:8px;">{q_images}</div>' if data_material else q_images

        questions.append(
            {
                "num": num,
                "section": section,
                "question": question_text,
                "options": options,
                "moduleInfo": guess_module(section),
                "dataMaterial": data_material,
            }
        )

    return questions, title


def infer_question_type(question: dict[str, Any], answer: str) -> tuple[str, Any, tuple[str, str, str]]:
    section = question.get("section", "")
    options = question.get("options") or []
    module_info = question.get("moduleInfo") or ("常识判断", "changshi", "常识判断")

    if is_true_false_section(section) or (not options and answer in {"A", "B"}):
        return "true_false", answer == "A", public_foundation_module()

    if is_multi_section(section) or len(answer) > 1:
        return "multi_choice", sorted(list(answer)), public_foundation_module()

    return "single_choice", answer, module_info


def build_app_questions(
    parsed_questions: list[dict[str, Any]],
    answers: dict[int, str],
    paper: dict[str, Any],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    total = len(parsed_questions)
    for item in parsed_questions:
        num = item["num"]
        answer = answers.get(num)
        if not answer:
            continue

        q_type, app_answer, module_info = infer_question_type(item, answer)
        options = item.get("options") or []
        if q_type in {"single_choice", "multi_choice"} and not options:
            continue

        module, module_key, sub_module = module_info
        difficulty = 2 if total and num / total < 0.3 else (3 if total and num / total < 0.7 else 4)
        question: dict[str, Any] = {
            "id": f"gkzhenti-shiye-gd-{paper['id']}-{num}",
            "type": q_type,
            "module": module,
            "moduleKey": module_key,
            "subModule": sub_module,
            "difficulty": difficulty,
            "question": item["question"],
            "answer": app_answer,
            "dataMaterial": item.get("dataMaterial", ""),
            "explanation": f"来自 {paper['title']}",
            "knowledgePoints": [
                "广东事业单位",
                module,
                sub_module,
                f"{paper['year']}年真题",
            ],
            "source": "gkzhenti",
            "sourceTitle": paper["title"],
            "province": "广东",
            "year": paper["year"],
        }
        if q_type != "true_false":
            question["options"] = options
        result.append(question)
    return result


def load_bank() -> dict[str, Any]:
    return json.loads(QUESTION_BANK.read_text(encoding="utf-8"))


def backup_bank() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = QUESTION_BANK.with_name(f"gkzhenti_questions.before-gd-shiye-zhice-{stamp}.json")
    shutil.copy2(QUESTION_BANK, backup)
    return backup


def merge_questions(bank: dict[str, Any], imported: list[dict[str, Any]]) -> tuple[int, int]:
    questions = bank.setdefault("questions", [])
    existing_ids = {item.get("id") for item in questions}
    existing_source_nums = {
        (item.get("sourceTitle"), item.get("question"))
        for item in questions
        if item.get("sourceTitle") and item.get("question")
    }

    added = 0
    skipped = 0
    for question in imported:
        key = (question.get("sourceTitle"), question.get("question"))
        if question["id"] in existing_ids or key in existing_source_nums:
            skipped += 1
            continue
        questions.append(question)
        existing_ids.add(question["id"])
        existing_source_nums.add(key)
        added += 1
    return added, skipped


def summarize(questions: list[dict[str, Any]]) -> dict[str, int]:
    summary = {"single_choice": 0, "multi_choice": 0, "true_false": 0, "ggjc": 0}
    for question in questions:
        summary[question["type"]] = summary.get(question["type"], 0) + 1
        if question.get("moduleKey") == "ggjc":
            summary["ggjc"] += 1
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=RECENT_YEAR_START)
    parser.add_argument("--end-year", type=int, default=CURRENT_YEAR)
    parser.add_argument("--delay", type=float, default=1.2)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    list_html = ensure_list_snapshot(args.delay)
    papers = extract_papers(list_html, args.start_year, args.end_year)
    if args.limit:
        papers = papers[: args.limit]
    print(f"selected papers: {len(papers)} ({args.start_year}-{args.end_year})")

    imported: list[dict[str, Any]] = []
    paper_reports: list[dict[str, Any]] = []
    for index, paper in enumerate(papers, start=1):
        print(f"[{index}/{len(papers)}] {paper['title']}")
        try:
            paper_html = fetch_text(
                paper["url"],
                CACHE_DIR / f"{paper['id']}.paper.html",
                delay=args.delay,
            )
            answer_html = fetch_text(
                paper["answer_url"],
                CACHE_DIR / f"{paper['id']}.answer.html",
                delay=args.delay,
            )
            parsed, parsed_title = parse_questions(paper_html)
            answers = parse_answers(answer_html)
            app_questions = build_app_questions(parsed, answers, paper)
            imported.extend(app_questions)
            report = summarize(app_questions)
            report.update({"paper_id": paper["id"], "year": paper["year"], "total": len(app_questions)})
            paper_reports.append(report)
            print(
                f"  parsed={len(parsed)} answers={len(answers)} imported={len(app_questions)} "
                f"tf={report['true_false']} multi={report['multi_choice']} ggjc={report['ggjc']}"
            )
            if parsed_title and parsed_title != paper["title"]:
                print(f"  title on page: {parsed_title}")
        except Exception as exc:  # noqa: BLE001 - keep importing the remaining public pages.
            print(f"  ERROR: {exc}", file=sys.stderr)

    import_summary = summarize(imported)
    print("import candidate summary:", import_summary, "total", len(imported))
    if args.dry_run:
        return 0

    bank = load_bank()
    backup = backup_bank()
    added, skipped = merge_questions(bank, imported)
    now = datetime.now().isoformat(timespec="seconds")
    bank.setdefault("meta", {})["gd_shiye_zhice_imported_at"] = now
    bank["meta"]["total_questions"] = len(bank["questions"])
    bank["meta"]["gd_shiye_zhice_import_summary"] = {
        "source": "gwy.gkzhenti.cn",
        "category": "事业单位-职测",
        "province": "广东",
        "year_range": [args.start_year, args.end_year],
        "papers_selected": len(papers),
        "candidate_questions": len(imported),
        "new_questions_added": added,
        "duplicates_skipped": skipped,
        "type_summary": import_summary,
        "paper_reports": paper_reports,
        "backup": str(backup),
    }
    QUESTION_BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"backup: {backup}")
    print(f"added={added} skipped={skipped} total={len(bank['questions'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
