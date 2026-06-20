import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from collections import Counter
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "three_color_cards_ocr"
OUTPUT_PATH = DATA_DIR / "three_color_memory_cards.json"
REPORT_PATH = DATA_DIR / "three_color_memory_cards_report.json"
OCR_SCRIPT = ROOT / "scripts" / "windows_ocr_pages.ps1"

TARGETS = [
    {"needle": "公基", "slug": "gongji", "category": "三色笔记·公基"},
    {"needle": "行测", "slug": "xingce", "category": "三色笔记·行测"},
]

XINGCE_SUBCATEGORIES = ["常识判断", "言语理解", "判断推理", "数量关系", "资料分析"]
GONGJI_PAGE_SUBCATEGORIES = [
    (3, 9, "马克思主义哲学"),
    (10, 11, "中共党史"),
    (12, 14, "毛泽东思想"),
    (15, 16, "习近平新时代中国特色社会主义思想"),
    (17, 19, "二十大"),
    (20, 23, "经济常识"),
    (24, 27, "管理常识"),
    (28, 31, "公文写作与处理"),
    (32, 47, "人文历史"),
    (48, 60, "科技常识"),
    (61, 64, "地理常识"),
    (65, 68, "宪法"),
    (69, 71, "行政法"),
    (72, 76, "民法"),
    (77, 81, "刑法"),
    (82, 85, "公务员法"),
]
GONGJI_BACK_LIMIT = 280
GONGJI_MAX_BACK = 3000
GONGJI_RULES = [
    ("法律基础", ["法律", "宪法", "民法", "刑法", "行政法", "法治", "司法", "执法", "权利", "义务"]),
    ("公文写作与处理", ["公文", "通知", "通报", "报告", "请示", "批复", "函", "纪要", "行文", "主送", "抄送"]),
    ("经济常识", ["经济", "市场", "财政", "货币", "通货", "供给", "需求", "价格", "GDP", "宏观", "微观"]),
    ("管理常识", ["管理", "行政", "决策", "组织", "领导", "控制", "公共管理", "事业单位"]),
    ("人文历史", ["历史", "文化", "文学", "诗", "朝代", "战国", "秦", "汉", "唐", "宋", "元", "明", "清"]),
    ("科技常识", ["科技", "科学", "物理", "化学", "生物", "医学", "航天", "计算机", "互联网"]),
    ("地理常识", ["地理", "气候", "地形", "地球", "河流", "经纬", "省份", "海洋", "季风"]),
    ("政治理论", ["党", "习近平", "社会主义", "马克思", "哲学", "毛泽东", "中特", "二十大", "会议", "人民", "意识", "物质", "运动", "认识", "真理", "矛盾", "规律", "实践"]),
]

DROP_LINE_PATTERNS = [
    r"^\d{1,4}$",
    r"^2024最新版$",
    r"^公考笔试不行.*",
    r"^航[=三]?色笔记$",
    r"^\(?适用于.*",
    r"^[-—一Hh|]*公基$",
]

BAD_GONGJI_FRONT_PARTS = [
    "超能基础升华",
    "真题示例",
    "公考笔试",
    "航=色笔记",
    "三色笔记",
]

GONGJI_FRONT_LABELS = {
    "习近平新时代中国特色社会主义思想": "新思想",
}

CURATED_GONGJI_HUMANITIES = [
    ("第34页", "孔子与《诗经》", "孔子编订《诗经》。《诗经》又称“诗三百”，是我国最早的诗歌总集，分风、雅、颂，表现手法为赋、比、兴。"),
    ("第34页", "屈原与《离骚》", "屈原是伟大的爱国诗人，《离骚》是古代最长的政治抒情诗，开浪漫主义先河。《楚辞》收录屈原、宋玉等作品。"),
    ("第34页", "贾谊的代表作", "贾谊代表作有《过秦论》《吊屈原赋》，后世常与屈原并称“屈贾”。"),
    ("第34页", "司马相如的代表作", "司马相如代表作有《子虚赋》《上林赋》《长门赋》，另有琴曲《凤求凰》。"),
    ("第34页", "刘安与《淮南子》", "刘安组织编纂《淮南子》，其中保存女娲补天、后羿射日、嫦娥奔月、大禹治水等神话材料。"),
    ("第34页", "《孔雀东南飞》", "《孔雀东南飞》是我国古代最长叙事诗，写焦仲卿和刘兰芝爱情故事，与《木兰辞》并称“乐府双璧”。"),
    ("第35页", "曹操的文学标签", "曹操与曹丕、曹植合称“三曹”，代表作有《蒿里行》《短歌行》《龟虽寿》，典故有“横槊赋诗”。"),
    ("第35页", "曹丕的代表作", "曹丕《燕歌行》是现存最早完整文人七言诗；《典论》是现存最早文学专论。"),
    ("第35页", "曹植的代表作", "曹植代表作有《白马篇》《洛神赋》《七步诗》，名句有“本是同根生，相煎何太急”。"),
    ("第35页", "陶渊明的文学标签", "陶渊明字元亮，号五柳先生，是田园诗鼻祖，代表作有《归园田居》《桃花源记》《归去来兮辞》。"),
    ("第35页", "王勃的代表作", "王勃与杨炯、卢照邻、骆宾王并称“初唐四杰”，代表作《滕王阁序》《送杜少府之任蜀州》。"),
    ("第35页", "王维的文学标签", "王维字摩诘，被称为“诗佛”，山水田园诗代表。代表作《使至塞上》《送元二使安西》。"),
    ("第35页", "孟浩然的文学标签", "孟浩然世称“孟襄阳”，山水田园诗代表，代表作《春晓》《过故人庄》《望洞庭湖赠张丞相》。"),
    ("第35页", "岑参的文学标签", "岑参是边塞诗人，代表作《白雪歌送武判官归京》，名句“忽如一夜春风来，千树万树梨花开”。"),
    ("第35页", "王昌龄的文学标签", "王昌龄是边塞诗人，代表作《出塞》《芙蓉楼送辛渐》，名句“一片冰心在玉壶”。"),
    ("第35页", "高适的文学标签", "高适是边塞诗人，代表作《别董大》《燕歌行》，名句“莫愁前路无知己，天下谁人不识君”。"),
    ("第35页", "王之涣的代表作", "王之涣代表作《登鹳雀楼》《凉州词》，名句“羌笛何须怨杨柳，春风不度玉门关”。"),
    ("第35页", "李白的文学标签", "李白字太白，号青莲居士，被称为“诗仙”，浪漫主义诗人，代表作《蜀道难》《将进酒》。"),
    ("第35页", "杜甫的文学标签", "杜甫字子美，自号少陵野老，被称为“诗圣”，其诗称“诗史”，代表作有“三吏”“三别”、《春望》。"),
    ("第35页", "白居易的文学标签", "白居易字乐天，号香山居士，被称为“诗魔”，倡导新乐府运动，代表作《长恨歌》《琵琶行》。"),
    ("第35页", "刘禹锡的代表作", "刘禹锡代表作有《陋室铭》《乌衣巷》，名句“旧时王谢堂前燕，飞入寻常百姓家”。"),
    ("第36页", "韩愈的文学标签", "韩愈字退之，唐代古文运动倡导者，唐宋八大家之首，代表作《师说》。"),
    ("第36页", "柳宗元的代表作", "柳宗元是唐宋八大家之一，代表作《江雪》《永州八记》。"),
    ("第36页", "李贺的文学标签", "李贺被称为“诗鬼”，代表作《雁门太守行》《李凭箜篌引》。"),
    ("第36页", "孟郊的文学标签", "孟郊有“诗囚”之称，与贾岛并称“郊寒岛瘦”，代表作《游子吟》《登科后》。"),
    ("第36页", "李商隐的文学标签", "李商隐与杜牧合称“小李杜”，代表作《无题》《锦瑟》《夜雨寄北》。"),
    ("第36页", "杜牧的文学标签", "杜牧号樊川居士，代表作《过华清宫》《江南春》《赤壁》《阿房宫赋》。"),
    ("第36页", "欧阳修的文学标签", "欧阳修号醉翁，晚号六一居士，领导北宋诗文革新运动，代表作《醉翁亭记》。"),
    ("第36页", "范仲淹的代表作", "范仲淹代表作《岳阳楼记》《渔家傲·秋思》，名句“先天下之忧而忧，后天下之乐而乐”。"),
    ("第36页", "苏轼的文学标签", "苏轼字子瞻，号东坡居士，与苏洵、苏辙合称“三苏”，豪放派代表，代表作《赤壁赋》《念奴娇·赤壁怀古》。"),
    ("第36页", "柳永的文学标签", "柳永原名柳三变，婉约派代表，代表作《雨霖铃》《八声甘州》。"),
    ("第36页", "李清照的文学标签", "李清照号易安居士，婉约词派代表，我国第一位女词人，代表作《声声慢》《一剪梅》。"),
    ("第36页", "陆游的代表作", "陆游代表作《钗头凤·红酥手》《示儿》《卜算子·咏梅》。"),
    ("第36页", "辛弃疾的文学标签", "辛弃疾是南宋豪放派词人，有“词中之龙”之称，与苏轼合称“苏辛”。"),
    ("第36页", "文天祥的代表作", "文天祥是抗元名臣，代表作《正气歌》《过零丁洋》，名句“人生自古谁无死，留取丹心照汗青”。"),
    ("第36页", "关汉卿的文学标签", "关汉卿被誉为“曲圣”，元曲四大家之一，代表作《窦娥冤》《救风尘》《单刀会》。"),
    ("第36页", "马致远的代表作", "马致远是元曲四大家之一，代表作《汉宫秋》《天净沙·秋思》。"),
    ("第36页", "王实甫的代表作", "王实甫代表作《西厢记》，人物为崔莺莺和张生。"),
    ("第37页", "解缙的代表作", "解缙主持编撰《永乐大典》，这是世界有史以来规模很大的百科全书。"),
    ("第37页", "汤显祖的代表作", "汤显祖代表作“玉茗堂四梦”：《牡丹亭》《紫钗记》《邯郸记》《南柯记》。"),
    ("第37页", "冯梦龙的代表作", "冯梦龙代表作“三言”：《喻世明言》《警世通言》《醒世恒言》。"),
    ("第37页", "凌濛初的代表作", "凌濛初代表作“二拍”：《初刻拍案惊奇》《二刻拍案惊奇》。"),
    ("第37页", "施耐庵的代表作", "施耐庵代表作《水浒传》，写宋江等108位好汉梁山聚义及招安征战故事。"),
    ("第37页", "罗贯中的代表作", "罗贯中号湖海散人，被称为中国章回小说鼻祖，代表作《三国演义》。"),
    ("第37页", "吴承恩的代表作", "吴承恩代表作《西游记》，是我国优秀的浪漫主义神魔小说。"),
    ("第37页", "洪昇的代表作", "洪昇代表作《长生殿》，写唐玄宗和杨贵妃，与孔尚任并称“南洪北孔”。"),
    ("第37页", "孔尚任的代表作", "孔尚任代表作《桃花扇》，写侯方域和李香君，借离别之情写兴亡之感。"),
    ("第37页", "纪昀的文化成就", "纪昀主持编纂《四库全书》，分经、史、子、集四部。"),
    ("第37页", "曹雪芹的代表作", "曹雪芹代表作《红楼梦》，原名《石头记》，是古典小说巅峰之作。"),
    ("第37页", "蒲松龄的代表作", "蒲松龄世称聊斋先生，代表作文言短篇小说集《聊斋志异》。"),
    ("第37页", "吴敬梓的代表作", "吴敬梓代表作《儒林外史》，讽刺科举和士林弊病。"),
    ("第44页", "王羲之的书法标签", "王羲之有“书圣”之称，代表作《兰亭序》《快雪时晴帖》《黄庭经》，《兰亭序》称“天下第一行书”。"),
    ("第44页", "颜真卿的书法标签", "颜真卿楷书称“颜体”，端庄雄伟，代表作《多宝塔碑》《颜勤礼碑》，行书《祭侄稿》称“天下第二行书”。"),
    ("第44页", "柳公权的书法标签", "柳公权书法称“柳体”，有“颜筋柳骨”之说，代表作《玄秘塔碑》《神策军碑》。"),
]

CURATED_GONGJI_EXTRA = [
    ("人文历史", "第40页", "选官制度：军功授爵", "军功授爵主要适用于秦朝时期，打破奴隶主贵族世袭制，有利于新兴地主阶级势力增强。"),
    ("人文历史", "第40页", "选官制度：察举制", "察举制主要适用于两汉，以“乡举里选”为依据，重视乡里舆论对德才的评价；征辟是皇帝或公府、州郡自上而下征聘人才。"),
    ("人文历史", "第40页", "选官制度：九品中正制", "九品中正制适用于魏晋南北朝，重门第出身，后来形成“上品无寒门，下品无势族”的门阀局面。"),
    ("人文历史", "第40页", "选官制度：隋唐科举制", "隋文帝废九品中正制，开始分科取士；隋炀帝始设进士科，科举制形成；武则天首创武举和殿试。"),
    ("人文历史", "第40页", "选官制度：宋代科举制", "宋代科举分乡试、省试、殿试三级，殿试成为定制；建立糊名、誊录制度防止作弊。"),
    ("人文历史", "第40页", "选官制度：明清科举制", "明清科举试卷多从四书五经命题，按程朱理学作答，称“八股文”；清末光绪三十一年废除科举。"),
    ("人文历史", "第42页", "京剧：发展来源", "京剧形成于清代北京，起源于安徽徽剧，吸收湖北汉剧、江苏昆曲、陕西梆子等，主要唱腔为二黄、西皮，也称“皮黄”。"),
    ("人文历史", "第42页", "京剧：唱念做打", "京剧表演基本功为唱、念、做、打。唱讲唱腔，念为念白，做指身段表情，打为舞蹈化武术动作。"),
    ("人文历史", "第42页", "京剧：生旦净丑", "京剧角色分生、旦、净、丑。生多为男性角色；旦为女性角色；净多为有突出特征的男性人物；丑为喜剧角色。"),
    ("人文历史", "第42页", "京剧：代表剧目", "传统剧目有《打渔杀家》《空城计》《霸王别姬》；现代京剧有《红灯记》《沙家浜》《智取威虎山》《白毛女》。"),
    ("人文历史", "第46页", "天干地支：十天干", "十天干为：甲、乙、丙、丁、戊、己、庚、辛、壬、癸。"),
    ("人文历史", "第46页", "天干地支：十二地支", "十二地支为：子、丑、寅、卯、辰、巳、午、未、申、酉、戌、亥；纪年时天干在前、地支在后，六十年一循环。"),
    ("人文历史", "第46页", "二十四节气：节气歌", "节气歌：春雨惊春清谷天，夏满芒夏暑相连。秋处露秋寒霜降，冬雪雪冬小大寒。"),
    ("经济常识", "第20页", "通货膨胀与通货紧缩", "通货膨胀：社会总需求大于总供给，纸币供给量超过流通需要，引起物价上涨、货币贬值。通货紧缩：社会总需求小于总供给，物价持续下降，影响投资、销售和就业。"),
    ("经济常识", "第21页", "宏观调控：经济手段", "经济手段是政府依据价值规律，借助经济杠杆调控经济，主要包括经济计划和经济政策，如税收、财政、货币政策。"),
    ("经济常识", "第21页", "宏观调控：法律手段", "法律手段是政府依靠经济立法和司法，运用经济法规调节经济关系和经济活动。"),
    ("经济常识", "第21页", "财政收入的构成", "财政收入主要包括税、利、债、费。"),
    ("经济常识", "第21页", "财政支出：购买与转移支付", "财政支出包括政府购买和转移支付。政府购买如公共设施、政府消费；转移支付如社会保险、社会救济等。"),
    ("经济常识", "第22页", "货币政策工具", "常见货币政策工具包括公开市场业务、存款准备金率、再贴现率和利率。经济过热常提高准备金率或利率，经济衰退常降低。"),
    ("经济常识", "第22页", "扩张性与紧缩性货币政策", "扩张性货币政策用于经济衰退，常降低存款准备金率、再贴现率、利率；紧缩性货币政策用于经济过热，常提高这些指标。"),
    ("管理常识", "第26页", "公共产品：公共物品", "公共产品具有非竞争性和非排他性；公共管理的重要内容之一就是管理公共物品和公共资源。"),
    ("管理常识", "第26页", "公共产品：准公共产品", "准公共产品介于纯公共产品和私人产品之间，具有有限的非竞争性或非排他性，如教育、公园、拥挤公路等。"),
    ("管理常识", "第26页", "公共危机：四类事件", "公共危机常分为自然灾害、事故灾难、公共卫生事件和社会安全事件。"),
    ("管理常识", "第27页", "政府职能：文化职能", "文化职能包括发展科学技术、教育、文化事业、卫生体育等。"),
    ("管理常识", "第27页", "政府职能：社会职能", "社会职能包括调节社会分配、组织社会保障、保护生态环境和自然资源、促进社会化服务体系建立、提高人口质量等。"),
    ("行政法", "第69页", "行政处罚：一般程序", "行政处罚一般程序包括调查、审核、决定、送达。调查时执法人员通常不得少于2人。"),
    ("行政法", "第69页", "行政处罚：简易程序", "违法事实确凿且处罚较轻时可适用简易程序；执法人员当场查明事实后作出处罚决定，并送达决定书。"),
    ("行政法", "第69页", "行政处罚：罚款执行", "罚款原则上缴至指定银行或通过电子支付；当事人确有困难，经申请和批准，可以暂缓或分期缴纳。"),
    ("行政法", "第70页", "行政诉讼：不受理事项", "人民法院不受理国防、外交等国家行为，以及法律规定由行政机关最终裁决的行政行为等事项。"),
    ("民法", "第75页", "继承权丧失情形", "继承人故意杀害被继承人、为争夺遗产杀害其他继承人、遗弃或虐待被继承人情节严重、伪造篡改隐匿销毁遗嘱情节严重等，会丧失继承权。"),
    ("民法", "第75页", "遗嘱继承与遗赠", "遗嘱继承是继承人依合法有效遗嘱继承遗产；遗赠是自然人通过遗嘱将遗产无偿赠给国家、组织或法定继承人以外的人。"),
    ("民法", "第75页", "遗赠扶养协议", "自然人可与继承人以外的组织或个人签订遗赠扶养协议，对方承担生养死葬义务，并享有受遗赠权利。"),
    ("刑法", "第79页", "剥夺政治权利：适用对象", "剥夺政治权利主要适用于危害国家安全犯罪分子，以及故意杀人、强奸、放火、爆炸、抢劫等严重破坏社会秩序的犯罪分子。"),
    ("刑法", "第79页", "剥夺政治权利：期限", "附加于管制时与管制同时执行；附加于拘役、有期徒刑时从主刑执行完毕或假释之日起算；死刑、无期徒刑通常剥夺政治权利终身。"),
    ("刑法", "第80页", "侵占罪与抢夺罪", "侵占罪：非法占有代为保管、遗忘物或埋藏物，数额较大拒不交还。抢夺罪：乘人不备公开夺取数额较大的公私财物。"),
    ("刑法", "第80页", "贪污罪与受贿罪", "贪污罪：国家工作人员利用职务便利非法占有公共财物。受贿罪：国家工作人员索取或非法收受他人财物并为他人谋利。"),
    ("刑法", "第80页", "挪用公款罪", "挪用公款罪是国家工作人员利用职务便利，挪用公款归个人使用、进行非法活动，或数额较大用于营利活动、超过3个月未还。"),
    ("刑法", "第80页", "玩忽职守罪", "玩忽职守罪是国家机关工作人员严重不负责任，不履行或不正确履行职责，致公共财产、国家和人民利益遭受重大损失。"),
    ("刑法", "第80页", "徇私枉法罪", "徇私枉法罪是司法工作人员徇私、徇情枉法，对明知无罪的人追诉、对明知有罪的人包庇，或故意违背事实法律裁判。"),
    ("科技常识", "第56页", "血液成分：红细胞", "红细胞的主要功能是运输氧气，依靠血红蛋白实现；血红蛋白是高等生物体内负责载氧的蛋白质。"),
    ("科技常识", "第56页", "血液成分：白细胞", "白细胞是人体免疫系统的重要成员，相关疾病包括白细胞减少症、急性白血病、慢性白血病、恶性淋巴瘤等。"),
    ("科技常识", "第56页", "血液成分：血小板", "血小板在止血和凝血过程中起重要作用，相关出血性疾病包括紫癜、血友病等。"),
    ("科技常识", "第56页", "血型：输血常识", "AB型可接受多种血型输入，常称万能受血者；O型可输出给多种血型，常称万能输血者。实际输血仍需交叉配血。"),
    ("科技常识", "第56页", "营养元素：蛋白质", "蛋白质是生命活动主要物质基础，氨基酸是其基本单位；在热、酸碱、重金属盐、紫外线等作用下会变性。"),
    ("科技常识", "第56页", "营养元素：糖类", "糖类是人体重要供能物质；葡萄糖可直接吸收，淀粉等多糖需转化为单糖后被利用。"),
    ("科技常识", "第57页", "维生素D", "维生素D是人体可以少量合成的维生素，多晒太阳可促进合成，食物来源包括鱼肝油、蛋黄、乳制品等。"),
    ("科技常识", "第57页", "动物分类：鱼类", "鱼类为水栖变温动物，用鳃呼吸，代表如鲨鱼、鲤鱼。"),
    ("科技常识", "第57页", "动物分类：两栖动物", "两栖动物幼体多用鳃呼吸，成体可用肺和皮肤呼吸，代表如青蛙、娃娃鱼。"),
    ("科技常识", "第57页", "动物分类：鸟类与哺乳动物", "鸟类多为恒温、卵生；哺乳动物多为恒温、胎生、哺乳。"),
    ("科技常识", "第58页", "植物分类：藻类植物", "藻类植物构造简单，没有根、茎、叶分化，多生活在水中，代表如绿藻、海带。"),
    ("科技常识", "第58页", "植物分类：苔藓植物", "苔藓植物有茎叶分化但无真正根，代表如泥炭藓、葫芦藓。"),
    ("科技常识", "第58页", "植物分类：种子植物", "种子植物包括裸子植物和被子植物；被子植物种子外有果皮包被。"),
]

TR = str.maketrans(
    {
        "（": "(",
        "）": ")",
        "【": "【",
        "】": "】",
        "〖": "【",
        "〗": "】",
        "：": ":",
        "；": ";",
        "，": "，",
        "。": "。",
        "．": ".",
        "、": ".",
        "／": "/",
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
    }
)


def find_targets() -> list[Path]:
    study = Path(os.environ["USERPROFILE"]) / "Desktop" / "study"
    files = []
    for target in TARGETS:
        match = next(
            (
                path
                for path in study.glob("*.pdf")
                if "三色笔记" in path.name and target["needle"] in path.name
            ),
            None,
        )
        if not match:
            raise SystemExit(f"Missing PDF in {study}: {target['needle']}")
        files.append(match)
    return files


def reset_dir(path: Path):
    resolved = path.resolve()
    cache = CACHE_DIR.resolve()
    if resolved != cache and cache not in resolved.parents:
        raise RuntimeError(f"Refusing to clear non-cache path: {resolved}")
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def render_pdf(pdf_path: Path, image_dir: Path, scale: float, page_limit: int | None) -> int:
    reset_dir(image_dir)
    with fitz.open(str(pdf_path)) as doc:
        count = doc.page_count if page_limit is None else min(doc.page_count, page_limit)
        matrix = fitz.Matrix(scale, scale)
        for index in range(count):
            pix = doc[index].get_pixmap(matrix=matrix, alpha=False)
            pix.save(str(image_dir / f"page_{index + 1:04d}.png"))
        return count


def run_ocr(image_dir: Path, jsonl_path: Path):
    cmd = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(OCR_SCRIPT),
        "-InputDir",
        str(image_dir),
        "-OutputJsonl",
        str(jsonl_path),
    ]
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def target_for_pdf(pdf_path: Path) -> dict:
    for target in TARGETS:
        if target["needle"] in pdf_path.name:
            return target
    raise ValueError(pdf_path.name)


def ensure_ocr(pdf_path: Path, args) -> Path:
    target = target_for_pdf(pdf_path)
    jsonl_path = CACHE_DIR / f"{target['slug']}.jsonl"
    if jsonl_path.exists() and not args.force_ocr:
        return jsonl_path

    image_dir = CACHE_DIR / "images" / target["slug"]
    pages = render_pdf(pdf_path, image_dir, args.scale, args.page_limit)
    print(f"Rendered {pages} pages from {pdf_path.name}")
    run_ocr(image_dir, jsonl_path)
    if not args.keep_images:
        reset_dir(image_dir)
        image_dir.rmdir()
    return jsonl_path


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def normalize_line(line: str) -> str:
    line = (line or "").replace("\r", "").translate(TR)
    line = re.sub(r"\s+", "", line)
    line = line.replace("一一一", "——").replace("一一", "——")
    line = line.replace("O", "0") if re.fullmatch(r"[O0-9.()（）]+", line) else line
    return line.strip()


def should_drop_line(line: str) -> bool:
    if not line:
        return True
    return any(re.match(pattern, line) for pattern in DROP_LINE_PATTERNS)


def page_lines(page: dict) -> list[str]:
    lines = []
    for raw in str(page.get("text") or "").splitlines():
        line = normalize_line(raw)
        if not should_drop_line(line):
            lines.append(line)
    return lines


def detect_xingce_subcategory(text: str) -> str:
    for item in XINGCE_SUBCATEGORIES:
        if item in text:
            return item
    return "行测方法"


def detect_gongji_subcategory(text: str) -> str:
    scores = Counter()
    for name, words in GONGJI_RULES:
        for word in words:
            if word in text:
                scores[name] += text.count(word)
    return scores.most_common(1)[0][0] if scores else "公共基础知识"


def detect_gongji_subcategory_by_page(page_no: int) -> str:
    for start, end, name in GONGJI_PAGE_SUBCATEGORIES:
        if start <= page_no <= end:
            return name
    return "公共基础知识"


def clean_heading(line: str) -> str:
    line = re.sub(r"^&+", "", line)
    line = re.sub(r"^[(（]?[一二三四五六七八九十]+[)）、.，,]", "", line)
    line = re.sub(r"^[(（]?\d+[)）、.，,]", "", line)
    line = re.sub(r"^[①②③④⑤⑥⑦⑧⑨⑩]", "", line)
    line = re.sub(r"^[Iil1][.、]", "", line)
    return line.strip(":-— ")


def is_option_line(line: str) -> bool:
    return bool(re.match(r"^[A-D][.、]", line))


def is_heading(line: str) -> bool:
    if is_option_line(line) or "真题示例" in line:
        return False
    if "笔航点拨" in line:
        return True
    if len(line) > 90 or len(line) < 3:
        return False
    patterns = [
        r"^&+.+",
        r"^[(（]?[一二三四五六七八九十]+[)）、.，,].+",
        r"^[(（]?\d+[)）、.，,].+",
        r"^[Iil1][.、].+",
        r"^[①②③④⑤⑥⑦⑧⑨⑩].+",
    ]
    if any(re.match(pattern, line) for pattern in patterns):
        return True
    return ("——" in line or line.endswith(":")) and len(line) <= 70


def trim_back(text: str) -> str:
    text = re.sub(r"【真题示例】.*", "", text)
    text = re.sub(r"\s+", "", text)
    text = text.replace("【笔航点拨】", "笔航点拨：")
    text = re.sub(r"(因此，)?选择[A-D]选项。?$", "", text)
    text = re.sub(r"(故)?(正确答案|本题答案)为?[A-DO0]+。?$", "", text)
    text = re.sub(r"，?选[A-DCO0]+。?$", "", text)
    text = text.strip(":-—，。；; ")
    return text


def tidy_gongji_text(text: str) -> str:
    text = text.replace("0927", "1927")
    text = text.replace("一", "-") if re.fullmatch(r"[\d一\-()（）]+", text) else text
    text = text.replace("(1921一1927)", "(1921-1927)")
    text = text.replace("(1927一1935)", "(1927-1935)")
    text = text.replace("(1935一1945)", "(1935-1945)")
    return text


def is_bad_gongji_front(front: str) -> bool:
    if not front or any(part in front for part in BAD_GONGJI_FRONT_PARTS):
        return True
    if not re.search(r"[\u4e00-\u9fff]", front):
        return True
    if re.fullmatch(r"[\d.()（）一\-—]+", front):
        return True
    return False


def has_option_or_answer_noise(text: str) -> bool:
    return bool(
        re.search(
            r"[A-D][.、．]|【?真题示例】?|故正确答案|正确答案|故本题|本题答案|选择[A-D]选项|选[A-DCO0]+[.。]?",
            text,
        )
    )


def point_topic(rest: str, back: str, subcategory: str, page_no: int) -> str:
    text = rest or back
    text = re.sub(r"^本题考查", "", text)
    text = re.split(r"[。；;]|因此|故正确答案|故本题|所以", text, maxsplit=1)[0]
    text = text.strip(":-—，。；; ")
    return compact_topic(text, subcategory, page_no)


def compact_topic(text: str, subcategory: str, page_no: int) -> str:
    text = tidy_gongji_text(clean_heading(text))
    text = re.sub(r"(故)?(正确答案|本题答案)为?.*$", "", text)
    text = re.sub(r"，?选[A-DCO0]+$", "", text)
    text = text.strip(":-—，。；; ")
    if not text:
        return f"{subcategory}第{page_no}页"

    first_clause = re.split(r"[。；;，,]|(?<=[\u4e00-\u9fff])[.]|因此|所以", text, maxsplit=1)[0].strip(":-—，。；; ")
    if 4 <= len(first_clause) <= 34:
        return first_clause

    for marker in ["是", "指", "包括", "为", "要", "应"]:
        if marker in text:
            candidate = text.split(marker, 1)[0].strip(":-—，。；; ")
            if 4 <= len(candidate) <= 34:
                return f"{candidate}的要点"

    if len(text) <= 42:
        return text
    return f"{text[:34].strip(':-—，。；; ')}的要点"


def shorten_gongji_front_body(front: str, back: str, subcategory: str) -> str:
    source = f"{front}{back}"
    rules = [
        ("习近平新时代中国特色社会主义思想", "十四个坚持", "十四个坚持"),
        ("习近平新时代中国特色社会主义思想", "最本质的特征", "十个明确：党的领导"),
        ("习近平新时代中国特色社会主义思想", "总任务是实现社会主义现代化和中华民族伟大复兴", "十个明确：总任务"),
        ("习近平新时代中国特色社会主义思想", "凸任务是实现社会主义现代化和中华民族伟大复兴", "十个明确：总任务"),
        ("习近平新时代中国特色社会主义思想", "社会主要矛盾", "十个明确：社会主要矛盾"),
        ("习近平新时代中国特色社会主义思想", "总体布局", "十个明确：总体布局和战略布局"),
        ("习近平新时代中国特色社会主义思想", "全面深化改革总目标", "十个明确：全面深化改革总目标"),
        ("习近平新时代中国特色社会主义思想", "法治国总目标", "十个明确：全面依法治国总目标"),
        ("习近平新时代中国特色社会主义思想", "基本经济制度", "十个明确：基本经济制度"),
        ("习近平新时代中国特色社会主义思想", "强军目标", "十个明确：强军目标"),
        ("习近平新时代中国特色社会主义思想", "中国特色大国外交", "十个明确：大国外交"),
        ("习近平新时代中国特色社会主义思想", "全面从严治党", "十个明确：全面从严治党"),
        ("习近平新时代中国特色社会主义思想", "核心要义", "真题点拨：核心要义"),
        ("二十大", "三个务必", "三个务必"),
        ("二十大", "五史", "新时代十年的伟大变革"),
        ("二十大", "三件大事", "三件大事"),
        ("二十大", "第二个答案", "第二个答案：自我革命"),
        ("二十大", "归根到底两个行", "归根到底两个行"),
        ("二十大", "两个结合", "两个结合"),
        ("二十大", "六个必须坚持", "六个必须坚持"),
        ("二十大", "坚持胸怀天下", "六个必须坚持：胸怀天下"),
        ("二十大", "中国共产党的中心任务", "中心任务"),
        ("二十大", "中国式现代化", "中国式现代化"),
        ("二十大", "首要任务", "高质量发展：首要任务"),
        ("二十大", "基础性.战略性支撑", "教育科技人才的战略支撑"),
        ("二十大", "应有之义", "全过程人民民主"),
        ("二十大", "长久保障", "法治：长久保障"),
        ("二十大", "精神力量", "文化自信：精神力量"),
        ("二十大", "生活品质", "民生与共同富裕"),
        ("二十大", "战略要求", "建军一百年奋斗目标"),
        ("二十大", "安全保障", "国家安全与社会稳定"),
        ("二十大", "两步走战略安排", "两步走战略安排"),
        ("二十大", "五个必由之路", "五个必由之路"),
        ("公务员法", "中央机关及其直属机构公务员的录用", "公务员录用的组织机关"),
        ("公务员法", "公示期满", "公务员录用备案与审批"),
        ("民法", "故意杀害被继承人", "继承权丧失情形"),
        ("刑法", "侵占罪", "侵占罪与抢夺罪"),
        ("刑法", "贪污罪", "贪污罪与受贿罪"),
        ("刑法", "挪用公款罪", "挪用公款罪"),
        ("刑法", "玩忽职守罪", "玩忽职守罪"),
        ("刑法", "徇私枉法罪", "徇私枉法罪"),
        ("管理常识", "扁平结构", "组织结构：扁平结构"),
        ("管理常识", "锥形结构", "组织结构：锥形结构"),
        ("管理常识", "纯公共产品", "公共产品：纯公共产品"),
        ("管理常识", "准公共产品", "公共产品：准公共产品"),
        ("管理常识", "文化职能", "政府职能：文化与社会职能"),
        ("经济常识", "总需求指", "总供给与总需求"),
        ("经济常识", "法律手段", "宏观调控：法律手段"),
        ("经济常识", "财政收入", "财政收入的构成"),
        ("行政法", "在边远.水上.交通不便地区", "行政处罚：当场收缴罚款"),
        ("行政法", "人民法院受理", "行政诉讼：受案范围"),
        ("科技常识", "血红蛋白", "血液成分与营养元素"),
        ("科技常识", "唯——种人体可以少量合成的维", "维生素与动物分类"),
        ("科技常识", "保持镇静", "电梯被困自救"),
        ("科技常识", "如没有警铃或对讲机", "电梯被困求救"),
        ("科技常识", "强行扒门", "电梯/火灾避险"),
        ("科技常识", "房屋不要建在沟口", "泥石流避险"),
        ("科技常识", "出现紧急情况", "飞机紧急撤离"),
        ("科技常识", "双臂平举", "飞机滑梯撤离"),
        ("马克思主义哲学", "感性认", "认识：感性认识与理性认识"),
        ("马克思主义哲学", "2基本特征", "马克思主义哲学的基本特征"),
        ("马克思主义哲学", "绝对运动", "运动与静止"),
        ("马克思主义哲学", "物质决定意识", "物质与意识的辩证关系"),
        ("马克思主义哲学", "三大规律", "辩证法三大规律"),
        ("马克思主义哲学", "质变", "量变与质变"),
        ("毛泽东思想", "毛泽东思想的形成和发展", "毛泽东思想形成发展阶段"),
        ("毛泽东思想", "萌芽时期", "毛泽东思想：萌芽时期"),
        ("毛泽东思想", "形成时期", "毛泽东思想：形成时期"),
        ("毛泽东思想", "成熟时期", "毛泽东思想：成熟时期"),
        ("毛泽东思想", "继续发展", "毛泽东思想：继续发展"),
    ]
    for rule_subcategory, needle, replacement in rules:
        if subcategory == rule_subcategory and needle in source:
            return replacement
    return front


def format_gongji_front(front: str, back: str, subcategory: str, page_no: int) -> str:
    front = tidy_gongji_text(front)
    if front.startswith("笔航点拨"):
        rest = front.split(":", 1)[-1] if ":" in front else ""
        front = f"真题点拨：{point_topic(rest, back, subcategory, page_no)}"
    front = shorten_gongji_front_body(front, back, subcategory)
    if len(front) > 24 or re.search(r"[。，；;]|(正确答案|本题答案|故选|选[A-DCO0])", front):
        front = compact_topic(front, subcategory, page_no)
    if not front.startswith("【"):
        label = GONGJI_FRONT_LABELS.get(subcategory, subcategory)
        front = f"【{label}】{front}"
    return front


def is_low_value_card(front: str, back: str) -> bool:
    front_body = re.sub(r"^【[^】]+】", "", front).strip(":-—，。；; ")
    normalized_front = re.sub(r"\s+", "", front_body)
    normalized_back = re.sub(r"\s+", "", back.strip(":-—，。；; "))
    if normalized_front == normalized_back:
        return True
    if len(normalized_back) <= len(normalized_front) + 8 and normalized_back.startswith(normalized_front):
        return True
    if len(normalized_back) < 40 and normalized_back.endswith(("必须", "安排", "特色:", "特色：")):
        return True
    return False


def apply_known_table_fixes(front: str, back: str) -> str:
    if "毛泽东思想的形成和发展" in front and "萌芽时期形成时期成熟时期" in back:
        return "\n".join(
            [
                "毛泽东思想形成发展阶段：",
                "① 萌芽时期：中共成立至第一次国共合作破裂，代表会议/节点为中共一大、八七会议。",
                "② 形成时期：土地革命战争前期，标志是探索工农武装割据道路，节点到遵义会议前后。",
                "③ 成熟时期：土地革命战争后期和抗日战争时期，代表节点为遵义会议、中共七大。",
                "④ 继续发展：解放战争和新中国成立后，围绕社会主义革命和建设继续发展。",
            ]
        )
    return back


def make_card_id(source_slug: str, page: int, index: int, front: str) -> str:
    digest = hashlib.sha1(front.encode("utf-8")).hexdigest()[:8]
    return f"three-color-{source_slug}-{page:04d}-{index:02d}-{digest}"


def split_back(back: str, limit: int = 520) -> list[str]:
    if len(back) <= limit:
        return [back]
    chunks = []
    current = ""
    prepared = re.sub(r"(?<!^)(?=(?:\(\d+\)|[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.，,]|[一二三四五六七八九十]是))", "§", back)
    parts = re.split(r"(?<=[。；;])|§", prepared)
    for part in parts:
        if not part:
            continue
        part = part.strip("§")
        if not part:
            continue
        if len(part) > limit:
            if current:
                chunks.append(current)
                current = ""
            clauses = re.split(r"(?<=[，,、])", part)
            clause_buffer = ""
            for clause in clauses:
                if not clause:
                    continue
                if clause_buffer and len(clause_buffer) + len(clause) > limit:
                    chunks.append(clause_buffer.strip("，,、；; "))
                    clause_buffer = clause
                else:
                    clause_buffer += clause
            if clause_buffer:
                chunks.append(clause_buffer.strip("，,、；; "))
            continue
        if current and len(current) + len(part) > limit:
            chunks.append(current)
            current = part
        else:
            current += part
    if current:
        chunks.append(current)
    return [chunk.strip("，,、；; ") for chunk in chunks if chunk.strip("，,、；; ")] or [back]


def extract_page_cards(page: dict, target: dict, subcategory: str | None = None) -> list[dict]:
    lines = page_lines(page)
    full_text = "".join(lines)
    page_no = int(page.get("page") or 0)
    if subcategory:
        pass
    elif target["slug"] == "xingce":
        subcategory = detect_xingce_subcategory(full_text)
    else:
        subcategory = detect_gongji_subcategory_by_page(page_no)

    cards = []
    current_front = ""
    current_body: list[str] = []
    is_gongji = target["slug"] == "gongji"

    def flush():
        nonlocal current_front, current_body
        front = clean_heading(current_front)
        back = trim_back("".join(current_body))
        current_front = ""
        current_body = []
        if not front or "真题示例" in front:
            return
        if has_option_or_answer_noise(front) or has_option_or_answer_noise(back):
            return
        if is_gongji and is_bad_gongji_front(front):
            return
        if len(front) < 4 or not re.search(r"[\u4e00-\u9fff]", front):
            return
        back = apply_known_table_fixes(front, back) if is_gongji else back
        if is_gongji:
            front = format_gongji_front(front, back, subcategory, page_no)
        elif len(front) > 90:
            front = front[:88] + "..."
        if len(back) < 18:
            return
        if is_low_value_card(front, back):
            return
        max_back = GONGJI_MAX_BACK if is_gongji else 1800
        split_limit = GONGJI_BACK_LIMIT if is_gongji else 520
        if len(back) > max_back:
            back = back[:max_back]
        parts = split_back(back, split_limit)
        for part_index, part in enumerate(parts):
            suffix = f"（{part_index + 1}）" if len(parts) > 1 else ""
            cards.append(
                {
                    "id": make_card_id(target["slug"], page_no, len(cards) + 1, front + suffix),
                    "category": target["category"],
                    "subcategory": subcategory,
                    "front": front + suffix,
                    "back": part,
                    "tags": [target["needle"], subcategory, "三色笔记", f"第{page_no}页"],
                }
            )

    skipping_example = False
    for line in lines:
        if "真题示例" in line:
            skipping_example = True
            continue
        if "笔航点拨" in line:
            flush()
            current_front = ""
            current_body = []
            skipping_example = True
            continue
        if is_heading(line):
            skipping_example = False
            flush()
            current_front = line
            if is_gongji:
                current_body.append(clean_heading(line))
            continue
        if skipping_example:
            continue
        if current_front:
            current_body.append(line)

    flush()
    return cards


def dedupe_cards(cards: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for card in cards:
        key = re.sub(r"\s+", "", card["front"] + card["back"])[:240]
        if key in seen:
            continue
        seen.add(key)
        result.append(card)
    return result


def make_curated_card(target: dict, page_tag: str, index: int, front_body: str, back: str) -> dict:
    front = f"【人文历史】{front_body}"
    page_no_match = re.search(r"\d+", page_tag)
    page_no = int(page_no_match.group(0)) if page_no_match else 0
    return {
        "id": make_card_id(target["slug"], page_no, 80 + index, front),
        "category": target["category"],
        "subcategory": "人文历史",
        "front": front,
        "back": back,
        "tags": [target["needle"], "人文历史", "三色笔记", page_tag],
    }


def is_replaced_humanities_card(card: dict) -> bool:
    if card.get("subcategory") != "人文历史":
        return False
    front = card.get("front", "")
    tags = card.get("tags") or []
    page_tag = tags[-1] if tags else ""
    replaced_pages = {"第34页", "第35页", "第36页", "第37页", "第44页"}
    replaced_front_parts = [
        "先秦文学",
        "秦汉文学",
        "三国两晋南北朝文学",
        "唐代文学",
        "宋代文学",
        "元代文学",
        "明清文学",
        "汉字字体的演变",
    ]
    return page_tag in replaced_pages and any(part in front for part in replaced_front_parts)


def enhance_gongji_cards(cards: list[dict], target: dict) -> list[dict]:
    result = [card for card in cards if not is_replaced_humanities_card(card)]
    result.extend(
        make_curated_card(target, page_tag, index, front_body, back)
        for index, (page_tag, front_body, back) in enumerate(CURATED_GONGJI_HUMANITIES, 1)
    )
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-ocr", action="store_true")
    parser.add_argument("--keep-images", action="store_true")
    parser.add_argument("--page-limit", type=int)
    parser.add_argument("--scale", type=float, default=2.0)
    args = parser.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    all_cards = []
    report = {"files": [], "total_cards": 0}
    for pdf_path in find_targets():
        target = target_for_pdf(pdf_path)
        print(f"\n=== {pdf_path.name} ===")
        jsonl = ensure_ocr(pdf_path, args)
        pages = read_jsonl(jsonl)
        file_cards = []
        current_xingce_subcategory = "行测方法"
        for page in pages:
            subcategory = None
            if target["slug"] == "xingce":
                detected = detect_xingce_subcategory("".join(page_lines(page)))
                if detected != "行测方法":
                    current_xingce_subcategory = detected
                subcategory = current_xingce_subcategory
            elif target["slug"] == "gongji":
                subcategory = detect_gongji_subcategory_by_page(int(page.get("page") or 0))
            file_cards.extend(extract_page_cards(page, target, subcategory))
        file_cards = dedupe_cards(file_cards)
        if target["slug"] == "gongji":
            file_cards = dedupe_cards(enhance_gongji_cards(file_cards, target))
        all_cards.extend(file_cards)
        report["files"].append(
            {
                "file": str(pdf_path),
                "pages": len(pages),
                "cards": len(file_cards),
                "subcategories": dict(Counter(card["subcategory"] for card in file_cards)),
            }
        )
        print(f"Cards: {len(file_cards)}")

    all_cards = dedupe_cards(all_cards)
    all_cards.sort(key=lambda card: (card["category"], card["subcategory"], card["id"]))
    report["total_cards"] = len(all_cards)
    report["subcategories"] = dict(Counter(f"{card['category']} / {card['subcategory']}" for card in all_cards))

    OUTPUT_PATH.write_text(json.dumps(all_cards, ensure_ascii=False, indent=2), "utf-8")
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
