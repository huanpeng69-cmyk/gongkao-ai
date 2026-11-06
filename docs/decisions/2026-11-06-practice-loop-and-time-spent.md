# 决策记录：学习闭环三件事（可重做、整卷模考、耗时记账）

- 日期：2026-11-06
- 状态：已采纳
- 影响文件：`lib/store.ts`、`app/quiz/page.tsx`、`app/mock/page.tsx`、`app/review/page.tsx`、`app/stats/page.tsx`
- 不涉及：`lib/types.ts`、服务端存储格式、数据迁移

## 背景

对抗式评审（请求 6）认定「学习闭环」断裂，其中三条必须动到数据语义：

1. 题库页把已答过的题从列表里**永久剔除**（`app/quiz/page.tsx` 原 `filteredQuestions` 里的 `answeredSet.has(...) → return false`），模考页也把已答题剔出可用题池，导致「5242 题的真题库」实际只出现一次、模考卷被切碎成残卷（原 `papers` 用 `count >= 20` 兜住碎片）。
2. 错题复习队列在 store 层被截断到 20 条（`getReviewPlan` 的 `dueToday.slice(0, 20)`），逾期多了就永远看不到后面的题。
3. `DailyRecord.timeSpentMinutes` 字段早就存在，但**从来没有被写入过**（只在构造对象时初始化成 0），所以「今日学习时长」是恒 0 的死字段。

第 1 条一旦放开，`recordAnswer` 会被同一道题反复调用。所以先要定的是**统计口径**，否则打开重做就会污染正确率。

## 决策一：统计采用「首刷口径」

**做法**：`recordAnswer` 内部用 `answeredIds.includes(question.id)` 判定是否首刷。只有首刷才累加：

- `user.totalQuestions` / `user.totalCorrect`
- `user.todayDone` / `user.todayCorrect`
- `user.knowledgeProfile[module]` 的 `total` / `correct` / `level`
- `DailyRecord.totalDone` / `totalCorrect` / `moduleBreakdown`

重复作答仍然会：写入 `DailyRecord.timeSpentMinutes`、写错题本（答错时，且题目不在错题本里时新建条目）。`answeredIds` 每次都是「不在则 push」，行为等价于原来。

**为什么**：

- 若二刷也累加，用户把同一套卷做三遍，正确率与题量会被自己刷出来，`/stats` 和首页掌握度全部失真；这比「二刷不计入」更难接受。
- 备选方案 A「全部累加、另开首刷字段」需要改 `UserData` 结构并做迁移（老数据没有该字段，首刷基线无法回填），成本与风险都高于收益。
- 备选方案 B「二刷覆盖首刷结果」会让历史正确率随时间漂移，更不可解释。

**代价**（如实记录）：

- 二刷不再增加「今日做题数」，所以靠重复刷同一套卷凑 `dailyGoal` 不再有效。这是有意的：目标衡量的是新题覆盖。
- 二刷答对**不会**把题从错题本移除。当前错题本只由 `recordReview` 的遗忘曲线推进，`recordAnswer` 不管移除。此行为本次未改（原行为即如此），避免顺带改变错题本语义。

## 决策二：耗时直接写入已有字段，不改结构

**做法**：

- `recordAnswer(question, userAnswer, isCorrect, moduleKey?, minutesSpent = 0)` 新增第 5 个可选参数（分钟，小数）。内部 `Math.round(minutes * 10) / 10` 保留 1 位小数，避免浮点噪声累积。
- 新增 `addStudyMinutes(minutes)`：用于整卷模考这种「一次性结算」的场景，只累加当天 `timeSpentMinutes`。
- 单题耗时在**页面层**采集：题库页在进入某个练习项（单题或材料题组）时记下 `Date.now()`，提交时算差值并 `delete` 该题的时间戳；材料题组里同组多题共享组进入时刻。

**为什么复用 `DailyRecord.timeSpentMinutes` 而不是新增字段**：

- 该字段在 `lib/types.ts` 已存在且语义完全一致，新增字段等于重复建模。
- 不新增字段 = 老数据零迁移：旧数据该字段为 `0`，读了就是 0，不需要写迁移脚本。
- 精度取舍：只存到日粒度、1 位小数。做题过程本来就不需要秒级审计，也不需要跨设备合并区间。

**为什么不用 `studySessions` 推算**：

- `startStudySession` / `endStudySession` 在题库页和模考页都没有被调用（全仓库无人调用），`studySessions` 实际是空数组。靠它估算等于恒 0。
- 所以 `/stats` 的「今日学习时长」改为**优先读 `dailyHistory[今天].timeSpentMinutes`**，为 0 时才回落到 `studySessions` 的区间估算（保留原有兜底，不删旧逻辑）。

## 决策三：模考按整卷出题，用时用快照

**做法**：

- `availableQuestions` 不再过滤 `answeredIds`，只排除 `essay`（申论题没有客观答案，无法自动判分）。于是每套卷的题量就是原始题量。
- 删掉 `papers` 的 `count >= 20` 兜底门槛：它本来是为了藏住「被切碎的小卷」，整卷之后不再需要；保留反而会隐藏真实的小卷。
- 交卷用时用 `examTotalSeconds - remainingSeconds` 计算，`examTotalSeconds` 在 `startExam` 时快照。**不在交卷时实时读 `durationMinutes`**，因为交卷后时长输入框解锁、可以被改，读它会让报告数字在用户改输入框后漂移。

**为什么不在`recordAnswer` 里做幂等之外的整卷聚合**：

- 整卷得分/模块正确率属于展示层派生数据，一次 `useMemo` 就能从 `examQuestions + answers` 算出来，没必要进存储。存起来反而要和「重开本卷」的重置逻辑保持同步。

## 决策四：错题重练走 `/quiz?ids=`

**做法**：`getReviewPlan().reviewQueue` 去掉 `slice(0, 20)`，返回全部到期错题；复习页用 `useMemo` 在页面内算错因 facet 并筛选，重练按钮把筛选结果的 id 拼成 `/quiz?ids=a,b,c`。

- 题库页读 `ids` 时把 `practiceView` 初值设为 `all` 并跳过视图过滤，同时在工具栏显示「正在按指定题集练习 N 题」和清除按钮。
- 不在 store 里加 `getErrorTypeFacets()`：facet 是纯展示派生，页面内算即可，避免为了一个筛选器扩大 store 的返回契约。

## 验收标准

1. 同一道题连答两次：`totalQuestions`、`todayDone`、`knowledgeProfile[module].total` 只 +1；`timeSpentMinutes` 两次都累加。
2. 题库页「未做 / 已做 / 全部」三档切换后，已答题仍可见（「已做」档）。
3. 模考任选一套卷，题目数 = 该卷在题库里的原始题量；交卷报告含总题数、已答、正确、正确率、实际用时、模块正确率表。
4. 造 25 条到期错题，`getReviewPlan().reviewQueue.length === 25`。
5. `/stats` 显示今日学习分钟数，且与 `dailyHistory` 当日 `timeSpentMinutes` 一致。
