#!/usr/bin/env python3
"""
公考真题库抓取脚本
从 https://gwy.gkzhenti.cn 抓取行测真题，解析并转换为app格式
"""
import re, json, time, urllib.request, urllib.parse, sys, os

BASE_URL = "https://gwy.gkzhenti.cn"
CURRENT_YEAR = int(time.strftime("%Y"))
RECENT_YEAR_START = CURRENT_YEAR - 7
DEFAULT_PROVINCES = ["国考", "广东", "深圳", "广州"]

SECTION_MODULE_MAP = {
    "政治理论": ("常识判断", "changshi", "政治理论"),
    "常识判断": ("常识判断", "changshi", "常识判断"),
    "言语理解": ("言语理解与表达", "yanyu", "言语理解与表达"),
    "表达":     ("言语理解与表达", "yanyu", "言语理解与表达"),
    "数量关系": ("数量关系", "shuliang", "数量关系"),
    "数学运算": ("数量关系", "shuliang", "数学运算"),
    "数字推理": ("数量关系", "shuliang", "数字推理"),
    "判断推理": ("判断推理", "panduan", "判断推理"),
    "图形推理": ("判断推理", "panduan", "图形推理"),
    "定义判断": ("判断推理", "panduan", "定义判断"),
    "类比推理": ("判断推理", "panduan", "类比推理"),
    "逻辑判断": ("判断推理", "panduan", "逻辑判断"),
    "资料分析": ("资料分析", "ziliao", "资料分析"),
}


def guess_module_from_text(text):
    for kw, mod in SECTION_MODULE_MAP.items():
        if kw in text:
            return mod
    return ("常识判断", "changshi", "常识判断")


def fetch(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/json,*/*",
                "Accept-Language": "zh-CN,zh;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            if i < retries - 1:
                time.sleep(2 * (i + 1))
            else:
                print(f"  [ERROR] {url}: {e}", file=sys.stderr)
                return None


def fetch_paper_list(cls_str="行测", province="国考"):
    url = f"{BASE_URL}/api/json?cls={urllib.parse.quote(cls_str)}&province={urllib.parse.quote(province)}"
    data = fetch(url)
    if data:
        return json.loads(data)
    return []


def parse_answers(html):
    answers = {}
    matches = re.findall(r'(\d+)[、。．.]\s*([A-D])', html)
    for num, ans in matches:
        answers[int(num)] = ans
    return answers


def fix_img_src(src):
    if src.startswith("//"):
        return "https:" + src
    elif src.startswith("/"):
        return "https://gwy.gkzhenti.cn" + src
    return src


def parse_year(title):
    m = re.search(r'(20\d{2})', title or "")
    return int(m.group(1)) if m else 0


def strip_tags(html):
    text = re.sub(r'<br\s*/?>', '\n', html or "", flags=re.I)
    text = re.sub(r'<img[^>]*>', ' ', text, flags=re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def select_recent_papers(papers, province):
    """Keep recent 8 calendar years; if a province has no such papers,
    keep the latest eight available so legacy city papers can still be used.
    """
    with_year = []
    for paper in papers:
        title = paper.get("Title", "")
        year = parse_year(title)
        if year:
            with_year.append((year, paper))

    recent = [paper for year, paper in with_year if year >= RECENT_YEAR_START]
    if recent:
        return recent

    fallback = [paper for _, paper in sorted(with_year, key=lambda item: item[0], reverse=True)[:8]]
    if fallback:
        print(f"  [INFO] {province} 暂无 {RECENT_YEAR_START}-{CURRENT_YEAR} 试卷，改用源站可用的最近 {len(fallback)} 套")
    return fallback


def build_material_map(content):
    """Extract material groups from sub2title markers.
    Returns dict: {question_num: material_html} for all questions in each group.
    """
    sub2titles = list(re.finditer(r'class="col-xs-12 sub2title">(.*?)</div>', content))
    num_marker = re.compile(r'<div class="col-xs-1 left">(\d+)</div>')
    markers = list(num_marker.finditer(content))

    material_map = {}
    for st in sub2titles:
        st_pos = st.end()
        # Find the first question number after this sub2title
        first_q = None
        for m in markers:
            if m.start() > st_pos:
                first_q = m
                break
        if not first_q:
            continue

        # Material is between sub2title end and first question
        mat_html = content[st_pos:first_q.start()]
        # Clean outer row divs
        mat_html = re.sub(r'<div class="row">', '', mat_html)
        # Fix image URLs
        mat_html = re.sub(r'<img[^>]*src="([^"]*)"[^>]*/?\s*>',
                          lambda m: f'<img src="{fix_img_src(m.group(1))}" style="max-width:100%;height:auto;" />',
                          mat_html)

        # Extract text
        mat_text = re.sub(r'<[^>]+>', ' ', mat_html)
        mat_text = re.sub(r'\s+', ' ', mat_text).strip()

        if not mat_text and 'img' not in mat_html.lower():
            continue

        # Build material block with header
        label = st.group(1).strip()
        material_block = f'<div class="ziliao-material" style="margin-bottom:12px;padding:12px;background:var(--surface,#f8f9fa);border-radius:8px;border:1px solid var(--hairline,#e5e7eb);"><div style="font-weight:600;margin-bottom:8px;color:var(--text-secondary,#666);font-size:13px;">【阅读材料 {label}】</div>'
        if mat_text:
            material_block += f'<div style="line-height:1.8;margin-bottom:8px;">{mat_text}</div>'
        # Add raw HTML for tables/images
        imgs_and_tables = re.findall(r'<img[^>]*/?\s*>', mat_html)
        if imgs_and_tables:
            material_block += '\n'.join(imgs_and_tables)
        material_block += '</div>'

        # Map to questions in this group
        q_nums = []
        for m in markers:
            if m.start() > st_pos:
                q_nums.append(int(m.group(1)))
                if len(q_nums) >= 6:
                    break
        for qn in q_nums:
            material_map[qn] = material_block

    return material_map


def parse_questions(html):
    pc_start = html.find('id="printcontent"')
    if pc_start < 0:
        return [], None

    content = html[pc_start:]

    title_match = re.search(r'<h3[^>]*>(.*?)</h3>', content)
    title = title_match.group(1) if title_match else ""

    sections = []
    for m in re.finditer(r'class="col-xs-12 subtitle">(.*?)</div>', content):
        sections.append((m.start(), m.group(1).strip()))

    sub2titles = list(re.finditer(r'class="col-xs-12 sub2title">(.*?)</div>', content))
    num_marker = re.compile(r'<div class="col-xs-1 left">(\d+)</div>')
    markers = list(num_marker.finditer(content))
    boundary_positions = [pos for pos, _ in sections] + [m.start() for m in sub2titles]

    # Build material map for grouped questions (资料分析, etc.)
    material_map = build_material_map(content)

    questions = []
    for i, m in enumerate(markers):
        num = int(m.group(1))
        start = m.end()
        end_candidates = []
        if i + 1 < len(markers):
            end_candidates.append(markers[i + 1].start())
        end_candidates.extend(pos for pos in boundary_positions if pos > start)
        end = min(end_candidates) if end_candidates else len(content)
        q_html = content[start:end]

        module_info = None
        q_pos = m.start()
        for s_pos, s_text in reversed(sections):
            if s_pos < q_pos:
                s_clean = re.sub(r'[。.].*$', '', re.sub(r'^[一-鿿]+[、.]?\s*', '', s_text))
                module_info = guess_module_from_text(s_clean)
                break
        if not module_info:
            module_info = ("常识判断", "changshi", "常识判断")

        p_texts = re.findall(r'<p>(.*?)</p>', q_html, re.DOTALL)
        question_text = "\n".join(strip_tags(t) for t in p_texts if strip_tags(t))
        if not question_text:
            tmp = re.sub(r'<div class="col-xs-\d+"[^>]*>.*?</div>', '', q_html, flags=re.DOTALL)
            tmp = re.sub(r'<img[^>]*>', '', tmp)
            question_text = strip_tags(tmp)

        opt_text = re.sub(r'<[^>]+>', ' ', q_html)
        options = []
        for opt_m in re.finditer(r'(?:^|\s)([A-D])[、。．.\s]\s*(.*?)(?=(?:\s[A-D][、。．.\s])|$)', opt_text):
            key = opt_m.group(1)
            text = opt_m.group(2).strip()
            if text and key not in [o["key"] for o in options]:
                options.append({"key": key, "text": text})

        # Question-specific images. When all four answer choices are images,
        # keep them as option HTML instead of mixing them into the material.
        img_tags = re.findall(r'<img[^>]*src="([^"]*)"[^>]*/?\s*>', q_html)
        imgs_html = [
            f'<img src="{fix_img_src(src)}" style="max-width:100%;height:auto;" />'
            for src in img_tags
        ]
        option_keys = {o["key"] for o in options}
        options_look_broken = len(options) < 4 or option_keys != {"A", "B", "C", "D"} or any(
            re.match(r'^[A-D][、。．.]?\s*$', o["text"]) for o in options
        )
        option_image_count = 0
        if options_look_broken and len(imgs_html) >= 4:
            options = [{"key": key, "text": imgs_html[idx]} for idx, key in enumerate(["A", "B", "C", "D"])]
            option_image_count = 4

        q_imgs = "\n".join(imgs_html[option_image_count:])

        # Combine group material + non-option question images.
        data_material = ""
        if num in material_map:
            data_material = material_map[num]
        if q_imgs:
            data_material += f'\n<div style="margin-top:8px;">{q_imgs}</div>' if data_material else q_imgs

        if not options:
            continue

        questions.append({
            "num": num,
            "question": question_text,
            "options": options,
            "module": module_info[0],
            "moduleKey": module_info[1],
            "subModule": module_info[2],
            "dataMaterial": data_material,
        })

    return questions, title


def convert_to_app_format(questions, answers, paper_title, paper_url="", province=""):
    result = []
    paper_id = paper_url.rstrip("/").split("/")[-1] if paper_url else re.sub(r'\W+', '-', paper_title)[:24]
    for q in questions:
        num = q["num"]
        answer = answers.get(num, "A")
        total = len(questions)
        if total > 0:
            ratio = num / total
            difficulty = 2 if ratio < 0.3 else (3 if ratio < 0.7 else 4)
        else:
            difficulty = 3

        result.append({
            "id": f"gkzhenti-{paper_id}-{num}",
            "type": "single_choice",
            "module": q["module"],
            "moduleKey": q["moduleKey"],
            "subModule": q["subModule"],
            "difficulty": difficulty,
            "question": q["question"],
            "options": q["options"],
            "answer": answer,
            "dataMaterial": q.get("dataMaterial", ""),
            "explanation": f"来自 {paper_title}",
            "knowledgePoints": [q["module"], q["subModule"], f"{province or '公考'}真题"],
            "source": "gkzhenti",
            "sourceTitle": paper_title,
            "province": province,
        })
    return result


def scrape_paper(paper_url, paper_title, delay=1):
    paper_id = paper_url.rstrip("/").split("/")[-1]
    print(f"  抓取: {paper_title[:50]}...")

    paper_html = fetch(paper_url)
    if not paper_html:
        return []

    questions, _ = parse_questions(paper_html)
    if not questions:
        print(f"    [WARN] 未解析到题目")
        return []

    time.sleep(delay)

    answer_url = f"{BASE_URL}/answer/{paper_id}"
    answer_html = fetch(answer_url)
    answers = parse_answers(answer_html) if answer_html else {}
    time.sleep(delay)

    app_questions = convert_to_app_format(questions, answers, paper_title, paper_url, province="")
    print(f"    OK: {len(questions)}题, 答案匹配{len(answers)}个")
    return app_questions


def save_progress(questions, stats):
    out_dir = os.path.dirname(os.path.abspath(__file__))
    out_file = os.path.join(out_dir, "..", "data", "gkzhenti_questions.json")
    os.makedirs(os.path.dirname(out_file), exist_ok=True)

    output = {
        "meta": {
            "source": "gwy.gkzhenti.cn",
            "scraped_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "total_papers": stats["papers"],
            "total_questions": stats["questions"],
        },
        "questions": questions,
    }

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  [保存] {len(questions)}题 -> {out_file}")
    return out_file


def scrape_paper_for_province(paper_url, paper_title, province, delay=1):
    qs = scrape_paper(paper_url, paper_title, delay)
    for q in qs:
        q["province"] = province
        q["knowledgePoints"] = [q["module"], q["subModule"], f"{province}真题"]
    return qs


def main():
    provinces = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_PROVINCES
    delay = float(os.environ.get("GKZHENTI_DELAY", "0.35"))
    all_questions = []
    stats = {"papers": 0, "questions": 0}
    seen_ids = set()

    for province in provinces:
        print(f"\n=== 抓取 [{province}] 行测真题 ===")
        papers = fetch_paper_list("行测", province)
        papers = select_recent_papers(papers, province)
        print(f"  选取 {len(papers)} 套试卷（近八年范围：{RECENT_YEAR_START}-{CURRENT_YEAR}；无近年数据则取源站最新）")

        for i, paper in enumerate(papers):
            title = paper.get("Title", "")
            url = paper.get("No", "")
            if not url:
                continue

            print(f"\n[{i+1}/{len(papers)}] {title}")
            qs = scrape_paper_for_province(url, title, province, delay=delay)
            for q in qs:
                if q["id"] in seen_ids:
                    continue
                seen_ids.add(q["id"])
                all_questions.append(q)
            stats["papers"] += 1
            stats["questions"] = len(all_questions)

            if (i + 1) % 5 == 0:
                save_progress(all_questions, stats)

    output_file = save_progress(all_questions, stats)
    print(f"\n=== 完成 ===")
    print(f"  试卷: {stats['papers']}套")
    print(f"  题目: {stats['questions']}道")
    print(f"  输出: {output_file}")


if __name__ == "__main__":
    main()
