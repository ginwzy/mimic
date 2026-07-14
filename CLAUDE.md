<!-- BEGIN BEADS INTEGRATION (br / beads_rust) -->
## Beads Issue Tracker (br)

This project uses **br (beads_rust)** for issue tracking — a local-first
tracker backed by SQLite with JSONL export for git collaboration.
Run `br robot-docs` to see the concise command reference for agents.

### Quick Reference

```bash
br ready                # Find available work (open, unblocked, not deferred)
br show <id>            # View issue details
br update <id> --claim  # Atomically claim work (assignee=you + in_progress)
br close <id>           # Complete work
br q "<title>"          # Quick capture a new issue, prints ID

Rules

- Use br for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run br robot-docs (and br capabilities) for the full command reference and contracts
- For persistent knowledge use issue fields/comments — br update <id> --notes "..."
or br comments — do NOT use MEMORY.md files. Durable contracts go in docs/spec/

Session Completion

When ending a work session, you MUST complete ALL steps below. Work is NOT
complete until git push succeeds.

MANDATORY WORKFLOW:

1. File issues for remaining work - Create issues for anything that needs follow-up (br create / br q)
2. Run quality gates (if code changed) - Tests, linters, builds
3. Update issue status - Close finished work (br close), update in-progress items
4. PUSH TO REMOTE - This is MANDATORY. br sync NEVER runs git, so you must:
br sync --flush-only   # export SQLite DB -> .beads/*.jsonl
git add .beads/
git pull --rebase
git add -A             # stage code + JSONL changes
git commit -m "<message>"   # if there is anything to commit
git push
git status             # MUST show "up to date with origin"
5. Clean up - Clear stashes, prune remote branches
6. Verify - All changes committed AND pushed
7. Hand off - Provide context for next session

CRITICAL RULES:
- Work is NOT complete until git push succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


Task Tracking

This project uses br (beads_rust) only for task tracking and cross-session
context. Create, claim, update, and close work with br; do not create
parallel task artifacts in markdown or another workflow system.

Knowledge sinks:

- Short decisions / cross-session context → issue notes/comments
(br update <id> --notes, br comments).
- Durable technical contracts and coding guidance → docs/spec/.

Session close: follow the br "PUSH TO REMOTE" protocol above. Work is not
complete until the git branch is pushed.

## 注释规约(Comment Discipline)

反检测代码里"为什么"几乎无法由代码自表达,注释是核心资产。但**简洁优先**。

### 1. 写"为什么",只写一次,尽量短

- 只解释代码读不出的东西(根因 / 检测向量 / 不变量 / 跨层契约)。
  能由命名和结构自解释的代码不配注释。
- 同一机制**只在一处权威说明**,旁处一句指针(`见 X`)即可。
- **散文宁短不宁全**:一句断言 + 根因,胜过多段推导。举一个代表 + "N 种形态",
  胜过逐一列全。多行 JSDoc 能压成单行 `/** ... */` 的就压。
- 头注(模块 / 函数)讲根因 + 策略;行内只留一句标记,不各自推导同一机制。
- 新增注释前自问:"删掉这行,下一个读者会困惑吗?" 不会则不写。

### 2. 不把 beads issue-id 写进 prose 注释

源码注释里**禁止** issue-id(`yvq.N` 等)—— issue 瞬态而源码长寿。
把"为什么"写成自解释散文。

### 3. 不写 inline TODO/FIXME;stub 只陈述现状

**禁止** `TODO/FIXME/XXX/HACK`,未尽功能进 br issue。
stub 只陈述事实("当前为 stub"),不写成待办祈使句。

### 4. 保留的优秀实践

`[实测]` 标经验证根因;`对照 sdenv` 标移植来源;原语分工只在定义处讲全,调用点不重复。
