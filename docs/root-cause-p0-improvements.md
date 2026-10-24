# 根因与防再犯记录：P0 体验改善

日期：2026-06-16
范围：方案 A 的三项 P0 改动（① 薄弱专项练习入口、② 错因回填+重练、③ 言语模块掌握度统计 bug）

---

## 缺陷 ③：言语模块「知识点掌握度」永远 0（统计失真）

### 根因
`lib/store.ts` 的 `getDefaultData()` 把默认掌握度键写成 `"言语理解"`，但题库与真实题目
的 `Question.module` 值是 `"言语理解与表达"`。`recordAnswer` 用 `question.module` 作为键去
`knowledgeProfile` 查找，永远命中不了默认键，于是 `kp` 为 `undefined` → 该模块的正确/总数
永远不被累计。其余 6 个模块名称恰好一致，所以只有言语受影响，问题被长期掩盖。

这是典型的「枚举/键名漂移」：默认数据里的字符串字面量与真实数据源的枚举值是两套，
没有单一事实来源（single source of truth）。

### 修复
1. 把默认键改为 `"言语理解与表达"`，与题库 `module` 对齐。
2. `recordAnswer` 改为自愈式查找：
   ```ts
   const kp = data.user.knowledgeProfile[question.module]
     || (data.user.knowledgeProfile[question.module] = { correct: 0, total: 0, level: "中等" });
   ```
   旧数据若缺键，作答时自动创建，不再静默写丢。

### 防再犯
- 不要用 `MODULES` 名称去初始化 `knowledgeProfile`（保持 store 对 UI 常量零耦合，符合 Occam）。
  但应在 CI 里加一条断言：把 `knowledgeProfile` 的默认键集合与题库真实出现的 `module` 集合求差，
  若默认键中出现「题库里没有的模块」或「题库里有但默认缺的模块」就报错。
- 已加回归测试 `scripts/verify-client-store.mjs`：断言默认含 `"言语理解与表达"`、不含旧键、
  言语题作答后 `total===1`、缺失键自愈。

---

## 缺陷 ②：错因被硬编码，AI 真实错因从未落库

### 根因
`recordAnswer` 在生成错题时把 `errorType` 写死成 `"思路偏差"`。AI 接口 `/api/ai`（analyze 模式）
会返回真实错因（知识盲区/概念混淆/审题失误/计算·推理错误/思路偏差/时间压力），但前端拿到后
只用于展示，**从未写回**错题本的 `ErrorEntry.errorType`。结果：
- 错题本里所有错题的错因都是 `"思路偏差"`；
- `getErrorTypeDistribution()`（统计页错因分布）与复习页按错因归类全部失真。

这是「展示与持久化分离」的遗漏：展示层消费了数据，但写回层缺了一环。

### 修复
1. `lib/store.ts` 新增受约束的回填函数：
   ```ts
   export const KNOWN_ERROR_TYPES = ["知识盲区","概念混淆","审题失误","计算/推理错误","思路偏差","时间压力"];
   export function updateErrorType(questionId: string, errorType: string) {
     if (!KNOWN_ERROR_TYPES.includes(errorType as ErrorType)) return;   // 拒绝垃圾值
     const err = data.errors.find((e) => e.questionId === questionId);
     if (!err) return;                                                 // 只回填真实答错的题
     err.errorType = errorType as ErrorType;
     saveData(data);
   }
   ```
2. `app/quiz/page.tsx` 的 `requestAiAnalysis` 在「命中缓存」与「实时调用」两条分支都把 AI 返回的
   错因回写；`网络错误` 这种非业务错因不写回。

### 防再犯
- 错因是封闭枚举，回填入口必须白名单校验，避免被任意字符串污染 `errorType`。
- 已加回归测试：已知错因可写回、未知错因被拒、非真实错题不被写入。

---

## 缺陷 ①：薄弱专项练习「卡片不能点」（需求缺口，非 bug）

主页「薄弱知识点」卡片原来是纯 `<div>`，点不动，用户不知道可以针对弱项专练。
`app/error-book/page.tsx` 只是 `redirect("/review")`，并没有独立的错因筛选/重练页。

### 修复
- 主页弱项卡片改为 `<Link href={/quiz?module=<key>}>`；`key` 由 `MODULES` 名称反查得到。
- `app/quiz/page.tsx` 读取 `?module=`（`useSearchParams`），初始化 `moduleFilter` 预设到该模块，
  直接进入对应专项练习，无需新增页面或组件（避免重复题库 UI，符合 Occam）。

> 说明：本方案未做「复习页按错因筛选 + 一键重练入口」（属 P0 的 ② 衍生项）。当前错因已能正确回填，
> 复习页 `app/review/page.tsx` 后续可在不改动 store 的前提下直接消费 `errorType` 做筛选。
> 是否补这步请确认范围。

---

## 本轮回填期间踩到的两个工具坑（已修复，列入预防）

1. **Edit 工具覆盖多行会吞掉相邻 import**：用 `PUT 18.=19:` 之类的「整块替换」时，只给新行、
   没有保留被替换区间里仍需要的旧 import，导致 `import ... from "@/lib/store"` 与
   `import { toDisplayList, toDisplayText } from "@/lib/ai-display"` 被误删，引发大量
   `Cannot find name` 级联错误。**预防**：凡涉及 import 区的改动，用「插入」（`PUT >N:`）而非
   「整块覆盖」，改完立即跑 `tsc --noEmit` 验证。
2. **编码漂移为 UTF-16LE**：编辑操作使 `app/page.tsx` 被写成 UTF-16 LE（BOM `FF FE`）。
   `tsc` 能识别 BOM 正常通过，但 `next build` 的 webpack 按 UTF-8 读 → `stream did not contain
   valid UTF-8` 编译失败。**预防**：改完含中文的 JSX 文件后，必须以 `next build` 作为最终权威校验
   （不能只信 `tsc`）。CI 已用 `npm test`；后续可在 CI 增加 `next build` 或文件编码断言。
