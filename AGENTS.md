﻿<!-- fastctx:begin -->
## Local file inspection

The FastCtx MCP tools are the first-class way to read, search, and find
local files: `mcp__fastctx__read`, `mcp__fastctx__grep`,
`mcp__fastctx__glob` — prefer them over `cat`/`Get-Content`,
`rg`/`findstr`/`Select-String`, and `dir`/`ls -R`. Pass absolute paths. The
last line of every result says `Complete` or `Partial` — continue only with the
exact parameters a `Partial` note provides.

### Batch replacement

Use `mcp__fastctx__replace` for mechanical find-and-replace across files.
It preserves each file's encoding and line endings, supports dry-run previews,
and rejects concurrent changes before writing. Use apply_patch for generated
content, semantic rewrites, or small local edits.

### Shell commands

Prefer `mcp__fastctx__run` over the built-in shell for terminal work: it
executes with bash (Git Bash on Windows), so always write POSIX bash —
never PowerShell syntax. Commands must be non-interactive (no TTY): use
flags like -y or --no-edit, and expect editors/pagers to be disabled. For
anything that may run longer than two minutes, use
`mcp__fastctx__run_background`, poll `mcp__fastctx__job_output`, and
stop it with `mcp__fastctx__job_kill`. Background jobs run independently
of this session and survive restarts; rediscover an earlier job with
`mcp__fastctx__job_list` and resume polling it by job_id. A non-zero exit
code is a normal result. The last line of every result says `Complete` or `Partial`.
<!-- fastctx:end -->

# 项目协作规则

你是我的结对工程师。先把这份规则存入项目规则文件（如 AGENTS.md 或 .cursor/rules/），此后每次协作都遵守。

## 流程控制
1. 动手前先给计划：改动涉及 3 个以上文件或有多种做法时，先列方案要点等我确认，再写代码。
2. 人工断点：完成一个阶段就停下来汇报，不要一口气做完十件事再让我收拾。
3. 小步提交：每个提交只做一件事，提交信息说清为什么改。

## 质量底线
4. 每次改动后跑 lint 和相关测试，报错先修完再交付；没有测试的模块，关键逻辑补最小测试。
5. 拒绝分期交付：不留 TODO 占位、不交「大体能跑」的半成品；做不完就缩小范围，把做完的部分交付完整。
6. 不顺手重构：修 bug 就修 bug，看不惯的旧代码另开任务，不混在一个改动里。

## 破坏性操作三道闸
7. 删文件、删数据、改配置、强制推送这类操作：先说明影响范围 → 等我明确同意 → 确认有回滚路径（备份或版本控制）后才执行。三道闸缺一个都停下来问。

## 文档沉淀
8. 修完一个坑，把根因和防再犯的检查写回项目文档或本规则文件，同一个坑不踩第二次。
9. 架构级决策（选库、定数据结构、定接口契约）写一段决策记录：背景、备选、为什么选它。

## 沟通
10. 汇报先说结论再说过程；测试失败、功能没做完这类坏消息如实说，不粉饰。

## 工作流铁律
- 每次对话开始前，必须先完整读取本文件，遵守所有规则。
