#!/usr/bin/env python3
"""Append recent Fenbi Shenlun papers to the local question bank."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import time
import urllib.parse
from pathlib import Path

from import_fenbi_question_bank import BASE_API, fetch_json, fix_html, parse_year, text_from_any

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "gkzhenti_questions.json"
REPORT_PATH = ROOT / "data" / "fenbi_shenlun_import_report.json"

TARGET_LABELS = {"guokao": 101, "guangdong": 106}
BLOCK_WORDS = ("模考", "模拟", "预测", "押题", "小模考")


def fetch_label_papers(label_id: int) -> list[dict]:
    papers: list[dict] = []
    page = 1
    total = 1
    while page <= total:
        payload = fetch_json(
            f"{BASE_API}/shenlun/comptroller/papers?{urllib.parse.urlencode({'toPage': page, 'pageSize': 3, 'labelId': label_id})}"
        )
        total = int((payload.get("pageInfo") or {}).get("totalPage") or page)
        papers.extend(payload.get("list") or [])
        page += 1
        time.sleep(0.05)
    return [paper for paper in papers if not any(word in str(paper.get("name") or "") for word in BLOCK_WORDS)]


def recent_papers(papers: list[dict], years: int) -> list[dict]:
    dated = [paper for paper in papers if parse_year(str(paper.get("name") or ""))]
    max_year = max(parse_year(str(paper.get("name") or "")) or 0 for paper in dated)
    min_year = max_year - years + 1
    return [paper for paper in dated if min_year <= (parse_year(str(paper.get("name") or "")) or 0) <= max_year]


def classify_submodule(text: str) -> str:
    if re.search(r"文章|议论文|写一篇|自拟题目", text):
        return "申发论述"
    if re.search(r"讲话|发言|倡议书|公开信|短评|简报|提纲|方案|报道|宣传", text):
        return "贯彻执行"
    if re.search(r"建议|措施|对策|做法", text):
        return "提出对策"
    if re.search(r"理解|认识|评价|分析", text):
        return "综合分析"
    return "归纳概括"


def build_material_html(materials: list[dict]) -> str:
    parts = []
    for index, material in enumerate(materials, 1):
        content = fix_html(str(material.get("content") or ""))
        if content:
            parts.append(f"<p><strong>【给定资料{index}】</strong></p>{content}")
    return "\n".join(parts)


def build_explanation(solution: dict) -> str:
    parts = []
    base = text_from_any(solution.get("solution"))
    if base:
        parts.append(f"<p><strong>解析</strong></p>{base}")
    label_names = {
        "reference": "参考答案",
        "demonstrate": "粉笔示范解析",
        "analysis": "解析",
        "comment": "点评",
    }
    for accessory in solution.get("solutionAccessories") or []:
        if not isinstance(accessory, dict):
            continue
        content = text_from_any(accessory.get("content"))
        if content:
            label = label_names.get(str(accessory.get("label") or ""), str(accessory.get("label") or "解析"))
            parts.append(f"<p><strong>{label}</strong></p>{content}")
    return "\n".join(parts)


def convert_paper(paper: dict, cookie: str) -> list[dict]:
    paper_id = int(paper["id"])
    sheet = fetch_json(f"{BASE_API}/shenlun/papers/{paper_id}/sheet", cookie=cookie)
    sheet_type = str(sheet.get("type") or paper.get("type") or "1")
    questions_payload = fetch_json(f"{BASE_API}/shenlun/universal/questions?paperId={paper_id}&type={sheet_type}", cookie=cookie)
    solutions_payload = fetch_json(f"{BASE_API}/shenlun/universal/solutions?paperId={paper_id}&type={sheet_type}", cookie=cookie)
    material_html = build_material_html(questions_payload.get("materials") or solutions_payload.get("materials") or [])
    solutions = {str(item.get("id")): item for item in solutions_payload.get("solutions") or [] if isinstance(item, dict)}
    source_title = str(paper.get("name") or sheet.get("name") or "")
    result: list[dict] = []

    for index, question in enumerate(questions_payload.get("questions") or [], 1):
        qid = str(question.get("id") or "")
        if not qid:
            continue
        prompt = text_from_any(question.get("content"))
        explanation = build_explanation(solutions.get(qid, {}))
        if not prompt or not explanation:
            continue
        sub_module = classify_submodule(prompt)
        result.append({
            "id": f"fenbi-shenlun-{paper_id}-{qid}",
            "type": "essay",
            "module": "申论",
            "moduleKey": "shenlun",
            "subModule": sub_module,
            "difficulty": int(question.get("difficulty") or 4),
            "question": prompt,
            "dataMaterial": material_html,
            "answer": "参考答案",
            "explanation": explanation,
            "knowledgePoints": ["申论", sub_module, "粉笔真题"],
            "source": "fenbi-shenlun",
            "sourceTitle": source_title,
            "year": parse_year(source_title),
            "fenbiPaperId": paper_id,
            "fenbiQuestionId": qid,
            "num": index,
        })
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default=str(DATA_PATH))
    parser.add_argument("--years", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cookie = os.environ.get("FENBI_COOKIE", "").strip()
    if not cookie:
        print("[NEED COOKIE] Set FENBI_COOKIE from Edge CDP before importing Shenlun.")
        return 2

    target_papers: list[dict] = []
    label_reports = {}
    for name, label_id in TARGET_LABELS.items():
        papers = recent_papers(fetch_label_papers(label_id), args.years)
        label_reports[name] = [{"id": item.get("id"), "name": item.get("name")} for item in papers]
        target_papers.extend({**paper, "label": name} for paper in papers)

    imported: list[dict] = []
    paper_reports = []
    for paper in target_papers:
        try:
            questions = convert_paper(paper, cookie)
            imported.extend(questions)
            paper_reports.append({"paperId": paper.get("id"), "name": paper.get("name"), "questions": len(questions)})
            print(f"OK {paper.get('name')}: {len(questions)} questions")
            time.sleep(0.15)
        except Exception as error:
            paper_reports.append({"paperId": paper.get("id"), "name": paper.get("name"), "error": str(error)[:500]})
            print(f"[WARN] {paper.get('name')}: {error}")

    report = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "labels": label_reports,
        "paper_reports": paper_reports,
        "imported_questions": len(imported),
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.dry_run:
        print(f"Dry run Shenlun questions: {len(imported)}. Report: {REPORT_PATH}")
        return 0
    if not imported:
        print(f"[ABORT] No Shenlun questions fetched. Report: {REPORT_PATH}")
        return 2

    data_path = Path(args.data)
    data = json.loads(data_path.read_text(encoding="utf-8"))
    questions = data.get("questions", []) if isinstance(data, dict) else []
    kept = [q for q in questions if not str(q.get("id") or "").startswith("fenbi-shenlun-")]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = data_path.with_name(f"{data_path.stem}.before-fenbi-shenlun-{stamp}{data_path.suffix}")
    shutil.copy2(data_path, backup)
    data["questions"] = kept + imported
    data["meta"] = {
        **(data.get("meta", {}) if isinstance(data, dict) else {}),
        "fenbi_shenlun_imported_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "fenbi_shenlun_import_summary": {
            "papers": len(target_papers),
            "imported_questions": len(imported),
            "backup": str(backup),
        },
        "total_questions": len(data["questions"]),
    }
    data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Appended {len(imported)} Shenlun questions from {len(target_papers)} papers.")
    print(f"Backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
