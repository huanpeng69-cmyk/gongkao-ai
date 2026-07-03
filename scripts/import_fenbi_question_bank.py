#!/usr/bin/env python3
"""
Import Fenbi papers by matching the current question bank's sourceTitle values.

Usage:
  python scripts/import_fenbi_question_bank.py --dry-run
  set FENBI_COOKIE=your_edge_cookie_header
  python scripts/import_fenbi_question_bank.py

The script never replaces data/gkzhenti_questions.json unless it fetched at
least one real Fenbi question. A timestamped backup is written first.
"""

from __future__ import annotations

import argparse
import difflib
import html
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "gkzhenti_questions.json"
REPORT_PATH = ROOT / "data" / "fenbi_paper_match_report.json"

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
FENBI_REFERER = "https://www.fenbi.com/spa/tiku/"
BASE_API = "https://tiku.fenbi.com/api"
COMBINE_API = "https://tiku.fenbi.com/combine"

MODULE_MAP = [
    ("资料", ("资料分析", "ziliao")),
    ("数量", ("数量关系", "shuliang")),
    ("言语", ("言语理解与表达", "yanyu")),
    ("判断", ("判断推理", "panduan")),
    ("图形", ("判断推理", "panduan")),
    ("定义", ("判断推理", "panduan")),
    ("类比", ("判断推理", "panduan")),
    ("逻辑", ("判断推理", "panduan")),
    ("常识", ("常识判断", "changshi")),
    ("政治", ("常识判断", "changshi")),
]


def fetch_text(
    url: str,
    cookie: str = "",
    method: str = "GET",
    body: bytes | None = None,
    content_type: str = "application/json",
) -> str:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": FENBI_REFERER,
    }
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    if body is not None:
        request.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} for {url}: {text[:240]}") from error


def fetch_json(
    url: str,
    cookie: str = "",
    method: str = "GET",
    body: bytes | None = None,
    content_type: str = "application/json",
) -> object:
    text = fetch_text(url, cookie=cookie, method=method, body=body, content_type=content_type)
    return json.loads(text)


def normalize_title(value: str) -> str:
    text = re.sub(r"\s+", "", value or "")
    text = text.replace("试题", "题").replace("真题", "题")
    text = re.sub(r"[《》（）()·、,，.。:：/\\-]", "", text)
    text = text.replace("网友回忆版", "")
    return text


def read_source_titles(data_path: Path) -> list[str]:
    data = json.loads(data_path.read_text(encoding="utf-8"))
    questions = data.get("questions", data if isinstance(data, list) else [])
    seen: set[str] = set()
    titles: list[str] = []
    for question in questions:
        title = str(question.get("sourceTitle") or question.get("source") or "").strip()
        if title and title not in seen:
            seen.add(title)
            titles.append(title)
    return titles


def flatten_labels(labels: object) -> list[dict]:
    result: list[dict] = []
    if not isinstance(labels, list):
        return result
    for label in labels:
        if not isinstance(label, dict):
            continue
        result.append(label)
        result.extend(flatten_labels(label.get("childrenLabels")))
    return result


def label_matches_titles(label: dict, titles: list[str]) -> bool:
    name = str(label.get("name") or "")
    if not name:
        return False
    return any(name in title or title in name for title in titles)


def fetch_course_papers(course: str, titles: list[str], all_labels: bool) -> list[dict]:
    papers: dict[int, dict] = {}

    def add_page(label_id: int | None, page: int) -> tuple[int, int]:
        # Fenbi's comptroller endpoint returns incomplete lists with larger page sizes.
        query = {"toPage": str(page), "pageSize": "3"}
        if label_id is not None:
            query["labelId"] = str(label_id)
        url = f"{BASE_API}/{course}/comptroller/papers?{urllib.parse.urlencode(query)}"
        payload = fetch_json(url)
        page_info = payload.get("pageInfo", {}) if isinstance(payload, dict) else {}
        for paper in payload.get("list", []) if isinstance(payload, dict) else []:
            if isinstance(paper, dict) and paper.get("id") is not None:
                if not all_labels and re.search(r"模拟|模考|预测|押题", str(paper.get("name") or "")):
                    continue
                paper = {**paper, "course": course}
                papers[int(paper["id"])] = paper
        return int(page_info.get("currentPage") or page), int(page_info.get("totalPage") or page)

    labels = []
    try:
        labels = flatten_labels(fetch_json(f"{BASE_API}/{course}/comptroller/subLabels"))
    except Exception as error:
        print(f"[WARN] labels failed for {course}: {error}")

    label_ids: list[int | None] = [None]
    for label in labels:
        label_id = label.get("id")
        if label_id is None:
            continue
        label_name = str(label.get("name") or "")
        paper_count = int((label.get("labelMeta") or {}).get("paperCount") or 0)
        if not all_labels and re.search(r"模拟题|模考", label_name):
            continue
        if not all_labels and paper_count > 80:
            continue
        if all_labels or label_matches_titles(label, titles):
            label_ids.append(int(label_id))

    for label_id in label_ids:
        page = 1
        while True:
            current, total = add_page(label_id, page)
            if current >= total:
                break
            page += 1
            time.sleep(0.08)

    return list(papers.values())


def match_papers(titles: list[str], papers: list[dict]) -> list[dict]:
    normalized = [(paper, normalize_title(str(paper.get("name") or ""))) for paper in papers]
    matches = []
    for title in titles:
        target = normalize_title(title)
        target_year = parse_year(title)
        target_region = region_key(title)
        best_paper = None
        best_score = 0.0
        for paper, paper_title in normalized:
            if not paper_title:
                continue
            score = 1.0 if target == paper_title else difflib.SequenceMatcher(None, target, paper_title).ratio()
            if target in paper_title or paper_title in target:
                score = max(score, 0.94)
            paper_year = parse_year(str(paper.get("name") or ""))
            if target_year and paper_year and target_year != paper_year:
                score *= 0.65
            paper_region = region_key(str(paper.get("name") or ""))
            if target_region and paper_region and target_region != paper_region:
                score *= 0.6
            if score > best_score:
                best_score = score
                best_paper = paper
        matches.append({
            "sourceTitle": title,
            "matched": best_score >= 0.82,
            "score": round(best_score, 4),
            "paper": best_paper,
        })
    return matches


def region_key(title: str) -> str:
    if "广州" in title:
        return "广州"
    if "深圳" in title:
        return "深圳"
    if "广东" in title:
        return "广东"
    if "国家" in title or "国考" in title:
        return "国考"
    return ""


def get_device_id(cookie: str) -> str:
    explicit = os.environ.get("FENBI_DEVICE_ID", "").strip()
    if explicit:
        return explicit
    match = re.search(r"(?:^|;\s*)device_id=([^;]+)", cookie)
    if match:
        return urllib.parse.unquote(match.group(1))
    if not cookie:
        return ""

    body = json.dumps({
        "pf": "web",
        "startupId": str(int(time.time() * 1000)),
        "extras": {"routecs": "xingce"},
    }).encode("utf-8")
    try:
        payload = fetch_json("https://login.fenbi.com/api/users/device/sid/create", cookie=cookie, method="POST", body=body)
        if isinstance(payload, dict):
            return str((payload.get("data") or {}).get("deviceId") or "")
    except Exception as error:
        print(f"[WARN] device id failed: {error}")
    return ""


def fenbi_common_params(device_id: str) -> dict[str, str]:
    params = {
        "kav": "125",
        "av": "127",
        "hav": "125",
        "app": "web",
        "apcid": "0",
        "gav": "2",
    }
    if device_id:
        params["deviceId"] = device_id
    return params


def fetch_sheet(course: str, paper_id: int) -> dict:
    return fetch_json(f"{BASE_API}/{course}/comptroller/papers/{paper_id}/sheet")


def add_query(url: str, params: dict[str, str]) -> str:
    parts = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    query.update(params)
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))


def create_and_submit_exercise(paper: dict, cookie: str) -> dict:
    body = urllib.parse.urlencode({
        "type": "1",
        "paperId": str(paper.get("id")),
        "exerciseTimeMode": "2",
    }).encode("utf-8")
    course = str(paper.get("course") or "xingce")
    exercise = fetch_json(
        f"{BASE_API}/{course}/exercises",
        cookie=cookie,
        method="POST",
        body=body,
        content_type="application/x-www-form-urlencoded",
    )
    if not isinstance(exercise, dict) or not exercise.get("key") or not exercise.get("id"):
        raise RuntimeError(f"unexpected exercise response: {str(exercise)[:240]}")
    fetch_text(
        f"{BASE_API}/{course}/async/exercises/{exercise['id']}/submit",
        cookie=cookie,
        method="POST",
        body=b"status=1",
        content_type="application/x-www-form-urlencoded",
    )
    return exercise


def fetch_paper_solution(paper: dict, sheet: dict, cookie: str, device_id: str) -> object:
    exercise = create_and_submit_exercise(paper, cookie)
    course = str(paper.get("course") or "xingce")
    params = {
        "format": "html",
        "key": str(exercise["key"]),
        "routecs": course,
        **fenbi_common_params(device_id),
    }
    solution = fetch_json(f"{COMBINE_API}/exercise/getSolution?{urllib.parse.urlencode(params)}", cookie=cookie)
    if not isinstance(solution, dict):
        raise RuntimeError(f"unexpected solution response: {str(solution)[:240]}")
    urls = (((solution.get("data") or {}).get("staticUrl") or {}).get("urls") or [])
    if not urls:
        raise RuntimeError(f"solution static url missing: {str(solution)[:240]}")
    return fetch_json(add_query(str(urls[0]), {
        "routecs": course,
        "type": str((solution.get("data") or {}).get("sheetType") or sheet.get("type") or "1"),
        **fenbi_common_params(device_id),
    }), cookie=cookie)


def fix_html(value: str) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r'\bsrc=["\']//', 'src="https://', text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def text_from_any(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return fix_html(value)
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return "\n".join(filter(None, (text_from_any(item) for item in value)))
    if isinstance(value, dict):
        for key in ("content", "text", "analysis", "solution", "explanation", "value", "html", "title"):
            if key in value:
                text = text_from_any(value.get(key))
                if text:
                    return text
        return "\n".join(filter(None, (text_from_any(v) for v in value.values() if isinstance(v, (str, list, dict)))))
    return ""


def collect_question_payloads(payload: object, question_ids: set[str]) -> dict[str, dict]:
    collected: dict[str, dict] = {qid: {} for qid in question_ids}

    def visit(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return

        raw_id = node.get("id") or node.get("questionId") or node.get("question_id") or node.get("key")
        qid = str(raw_id) if raw_id is not None else ""
        if qid in question_ids:
            collected[qid].update(node)
        for value in node.values():
            if isinstance(value, (list, dict)):
                visit(value)

    visit(payload)
    return {qid: item for qid, item in collected.items() if item}


def build_material_lookup(payload: object) -> dict[str, str]:
    if not isinstance(payload, dict):
        return {}
    materials = payload.get("materials")
    if not isinstance(materials, list):
        return {}
    by_key = {}
    for material in materials:
        if not isinstance(material, dict):
            continue
        text = text_from_any(material.get("content"))
        for key in (material.get("globalId"), material.get("id")):
            if key is not None and text:
                by_key[str(key)] = text

    lookup: dict[str, str] = {}

    def visit(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        key = node.get("key")
        material_keys = node.get("materialKeys")
        if key and isinstance(material_keys, list):
            text = "\n".join(filter(None, (by_key.get(str(item), "") for item in material_keys)))
            if text:
                lookup[str(key)] = text
        for value in node.values():
            if isinstance(value, (list, dict)):
                visit(value)

    visit(payload.get("card"))
    return lookup


def module_from_chapter(name: str) -> tuple[str, str, str]:
    for keyword, (module, module_key) in MODULE_MAP:
        if keyword in name:
            sub = "政治理论" if keyword == "政治" else name
            return module, module_key, sub
    return "公共基础知识", "ggjc", name or "综合知识"


def build_chapter_lookup(sheet: dict) -> dict[str, tuple[str, str, str]]:
    ids = [str(item) for item in sheet.get("questionIds", [])]
    chapters = sheet.get("chapters", []) if isinstance(sheet.get("chapters"), list) else []
    lookup: dict[str, tuple[str, str, str]] = {}
    offset = 0
    for chapter in chapters:
        count = int(chapter.get("questionCount") or 0)
        module = module_from_chapter(str(chapter.get("name") or ""))
        for qid in ids[offset: offset + count]:
            lookup[qid] = module
        offset += count
    return lookup


def extract_options(question: dict) -> list[dict]:
    raw = question.get("options") or question.get("choices") or question.get("optionList") or []
    if not raw:
        for accessory in question.get("accessories") or []:
            if isinstance(accessory, dict) and accessory.get("options"):
                raw = accessory.get("options")
                break
    options: list[dict] = []
    if isinstance(raw, dict):
        raw = [{"key": key, "content": value} for key, value in raw.items()]
    if not isinstance(raw, list):
        return options
    for index, item in enumerate(raw):
        key = chr(ord("A") + index)
        text = text_from_any(item)
        if isinstance(item, dict):
            key = str(item.get("key") or item.get("name") or item.get("label") or item.get("option") or key)
            text = text_from_any(item.get("content") or item.get("text") or item.get("value") or item)
        key = key.strip().upper()[:1]
        text = re.sub(r"^[A-Z][、.．]\s*", "", text).strip()
        if key and text:
            options.append({"key": key, "text": text})
    return options


def answer_to_key(value: object, options: list[dict]) -> str | list[str] | bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, dict):
        for key in ("choice", "choices", "answer", "answers", "correctAnswer", "value"):
            if key in value:
                return answer_to_key(value.get(key), options)
        return ""
    if isinstance(value, list):
        keys = [answer_to_key(item, options) for item in value]
        flat = [str(item) for item in keys if isinstance(item, str) and item]
        unique = sorted(set("".join(flat)))
        return unique if len(unique) > 1 else (unique[0] if unique else "")
    text = str(value or "").strip().upper()
    if not text:
        return ""
    letters = re.findall(r"[A-Z]", text)
    if letters:
        keys = [letter for letter in letters if any(opt["key"] == letter for opt in options)]
        return "".join(sorted(set(keys))) if keys else letters[0]
    if text.isdigit() and options:
        num = int(text)
        index = num if 0 <= num < len(options) else num - 1
        if 0 <= index < len(options):
            return options[index]["key"]
    return text


def first_present(question: dict, keys: tuple[str, ...]) -> object:
    for key in keys:
        if key in question and question.get(key) not in (None, ""):
            return question.get(key)
    return None


def convert_questions(paper: dict, sheet: dict, payload: object) -> list[dict]:
    ids = [str(item) for item in sheet.get("questionIds", [])]
    payloads = collect_question_payloads(payload, set(ids))
    chapter_lookup = build_chapter_lookup(sheet)
    material_lookup = build_material_lookup(payload)
    result: list[dict] = []

    for index, qid in enumerate(ids, 1):
        raw = payloads.get(qid)
        if not raw:
            continue

        options = extract_options(raw)
        answer = answer_to_key(first_present(raw, ("answer", "correctAnswer", "correctAnswers", "answerKey", "answers")), options)
        explanation = text_from_any(first_present(raw, ("solution", "analysis", "explanation", "answerAnalysis", "officialAnalysis", "solutions")))
        stem = text_from_any(first_present(raw, ("content", "question", "stem", "title")))
        material = text_from_any(first_present(raw, ("material", "materials", "materialContent", "passage")))
        material = material or material_lookup.get(str(raw.get("globalId") or ""), "")
        if not stem or not options or not answer:
            continue

        module, module_key, sub_module = chapter_lookup.get(qid, module_from_chapter(""))
        q_type = "multi_choice" if isinstance(answer, list) or len(str(answer)) > 1 else "single_choice"
        result.append({
            "id": f"fenbi-{paper.get('course')}-{paper.get('id')}-{qid}",
            "type": q_type,
            "module": module,
            "moduleKey": module_key,
            "subModule": sub_module,
            "difficulty": 3,
            "question": stem,
            "options": options,
            "answer": answer,
            "dataMaterial": material,
            "explanation": explanation,
            "knowledgePoints": [module, sub_module, "粉笔真题"],
            "source": "fenbi",
            "sourceTitle": str(paper.get("name") or ""),
            "year": parse_year(str(paper.get("name") or "")),
            "fenbiPaperId": paper.get("id"),
            "fenbiQuestionId": qid,
        })
    return result


def parse_year(title: str) -> int | None:
    match = re.search(r"(20\d{2})", title or "")
    return int(match.group(1)) if match else None


def write_report(report: dict) -> None:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default=str(DATA_PATH))
    parser.add_argument("--courses", default="xingce")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--all-labels", action="store_true")
    parser.add_argument("--limit-papers", type=int, default=0)
    args = parser.parse_args()

    data_path = Path(args.data)
    titles = read_source_titles(data_path)
    courses = [item.strip() for item in args.courses.split(",") if item.strip()]
    print(f"Source papers: {len(titles)}")
    print(f"Fenbi courses: {', '.join(courses)}")

    papers: list[dict] = []
    for course in courses:
        course_papers = fetch_course_papers(course, titles, args.all_labels)
        papers.extend(course_papers)
        print(f"  {course}: {len(course_papers)} candidate papers")

    matches = match_papers(titles, papers)
    matched = [item for item in matches if item["matched"] and item["paper"]]
    if args.limit_papers:
        matched = matched[: args.limit_papers]
    print(f"Matched papers: {len(matched)}/{len(titles)}")

    cookie = os.environ.get("FENBI_COOKIE", "").strip()
    device_id = get_device_id(cookie)
    report = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "titles": len(titles),
        "candidate_papers": len(papers),
        "matched": len(matched),
        "has_cookie": bool(cookie),
        "has_device_id": bool(device_id),
        "matches": matches,
        "imported_questions": 0,
        "paper_reports": [],
    }

    if not cookie:
        write_report(report)
        print(f"[NEED COOKIE] Set FENBI_COOKIE to fetch question text and explanations. Report: {REPORT_PATH}")
        return 0 if args.dry_run else 2

    imported: list[dict] = []
    for item in matched:
        paper = item["paper"]
        try:
            sheet = fetch_sheet(paper["course"], int(paper["id"]))
            payload = fetch_paper_solution(paper, sheet, cookie, device_id)
            questions = convert_questions(paper, sheet, payload)
            imported.extend(questions)
            report["paper_reports"].append({
                "sourceTitle": item["sourceTitle"],
                "fenbiTitle": paper.get("name"),
                "paperId": paper.get("id"),
                "questions": len(questions),
            })
            print(f"  OK {paper.get('name')}: {len(questions)} questions")
            time.sleep(0.2)
        except Exception as error:
            report["paper_reports"].append({
                "sourceTitle": item["sourceTitle"],
                "fenbiTitle": paper.get("name"),
                "paperId": paper.get("id"),
                "error": str(error)[:500],
            })
            print(f"  [WARN] {paper.get('name')}: {error}")

    report["imported_questions"] = len(imported)
    write_report(report)

    if args.dry_run:
        print(f"Dry run imported candidates: {len(imported)}. Report: {REPORT_PATH}")
        return 0
    if not imported:
        print(f"[ABORT] No Fenbi questions fetched; existing bank was not changed. Report: {REPORT_PATH}")
        return 2

    old = json.loads(data_path.read_text(encoding="utf-8"))
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = data_path.with_name(f"{data_path.stem}.before-fenbi-import-{stamp}{data_path.suffix}")
    shutil.copy2(data_path, backup)
    output = {
        "meta": {
            **(old.get("meta", {}) if isinstance(old, dict) else {}),
            "source": "fenbi.com",
            "fenbi_imported_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "fenbi_import_summary": {
                "matched_papers": len(matched),
                "imported_questions": len(imported),
                "backup": str(backup),
            },
            "total_questions": len(imported),
        },
        "questions": imported,
    }
    data_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Replaced question bank with {len(imported)} Fenbi questions.")
    print(f"Backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
