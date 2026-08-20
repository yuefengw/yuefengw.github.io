---
title: "Codex Goal 模式（三）：Idle 续跑、预算记账与并发边界"
slug: codex-goal-mode-3-runtime-continuation-budget
date: 2026-08-20 10:30:00
updated: 2026-08-20 10:30:00
categories:
  - "工程实践"
  - "Agent 系统"
tags:
  - "Codex"
  - "Goal"
  - "Agent"
  - "Rust"
  - "Agent Runtime"
cover: /images/posts/codex-goal-cover.webp
toc_number: false
description: "从当前 Codex 源码出发，拆解 Goal 如何在 thread idle 时续跑、如何精确记账并处理预算、错误、并发与 compaction 边界。"
---

前两期已经把 Goal 的定位、持久化模型和状态机讲清楚了。真正让一个持久目标“自己继续”的，是本期要看的 Runtime：它不延长单次模型调用，而是在普通 Agent Turn 结束、线程重新进入 idle 后，判断能否安全地再启动一轮。

<!-- more -->

> 本文核对的是 `openai/codex` 提交 [`312b62ac95335e1762b70ceb8910374965bd2785`](https://github.com/openai/codex/commit/312b62ac95335e1762b70ceb8910374965bd2785)。Goal 仍在快速演进，早期 PR、2026 年 5 月的官方指南与当前源码可能存在版本差异；涉及行为判断时，应以正在使用的源码版本为准。

上一篇：[Codex Goal 模式（二）：持久化目标与六态状态机](/posts/codex-goal-mode-2-persistence-state-machine/)

## 1. Goal 的外层循环不在模型内部

普通 Codex Agent Turn 内部本来就有一个循环：模型产生工具调用，Runtime 执行工具，把结果放回上下文，再请求模型继续推理。模型最终只返回文本、不再调用工具时，这个 Turn 就会结束。

Goal 增加的是更外面一层调度：

```text
普通 Turn 结束
  -> thread 进入 idle
  -> GoalExtension.on_thread_idle
  -> GoalRuntime.continue_if_idle
  -> thread.start_turn_if_idle
  -> 启动一个新的普通 Turn
```

因此它不是下面这种占住线程的死循环：

```python
while goal.status == "active":
    run_agent()
```

更接近事件驱动的状态机：每轮释放控制权，等线程生命周期报告 idle，再尝试一次 continuation。用户输入、工具执行、错误处理和状态变更都仍然经过原有 Thread/Turn 生命周期。

`continue_if_idle()` 首先确认 Goal 工具对当前线程可见，然后取得 `goal_state_lock`；接着检查 continuation 是否因 fork 暂时延后，取得仍然存活的 thread，读取数据库中的 Goal。只有状态仍为 `Active`，它才构造 continuation steering，并调用 `start_turn_if_idle()`。

这里的 steering 不是把用户最初的话简单重放一遍。它会重新带入 objective、已用 token、预算和剩余额度，并提醒模型保持原始范围、继续产生实际进展、在完成前检查证据。但要注意：这些 completion/blocked audit 是 **prompt 与工具协议**，不是独立验证器。Runtime 不会亲自判断测试是否真的覆盖全部要求，也不会验证模型提交的完成证据。

## 2. “Idle”需要通过两层检查

看到 `on_thread_idle`，很容易把它理解成“只要收到 idle 事件就一定续跑”。源码实际更谨慎。

第一层在 Core 发出 idle 生命周期事件之前：

- 当前不能已有 active turn；
- input queue 里不能有会触发 Turn 的 mailbox item；
- interrupt 状态会被转换为对应的 idle cause。

第二层在 `start_turn_if_idle()` 真正提交自动工作时再次检查：

- mailbox 是否出现了更应优先处理的 trigger-turn 消息；
- 当前 collaboration mode 是否为 Plan；
- active turn 是否已经被其他请求抢先占用；
- 应用设置后是否会进入 Plan mode。

其中 active turn 的检查与占位发生在同一把锁下。即使 Goal 在第一层检查后到第二层之前遇到用户消息，也可能得到 `NotIdle`、`PendingTriggerTurn` 或 `PlanMode`，而不是并发启动两个 Turn。

这比一句“没有更高优先级工作时才续跑”更准确：当前源码明确识别的是 active turn、trigger-turn mailbox work 和 Plan mode，最终原子决定权在 `start_turn_if_idle()`。不要把它扩大解释为一个能理解所有业务优先级的通用调度器。

还有一个较少见的分支是 continuation deferral。fork 一个带 Goal 的 thread 时，调用方可以要求先在新 thread 中显式运行一轮，再恢复自动 continuation。这个标记存入状态库，`continue_if_idle()` 看到后直接返回；下一次 Turn 开始时，`on_turn_start` 才清除它。它解决的是 fork 后“自动 Goal Turn 抢在用户指定的首轮之前启动”的次序问题，与 anti-spin 或预算限制无关。

### 当前没有“无工具调用就停止续跑”的 gate

早期 Goal Core Runtime PR 和 2026 年 5 月的指南曾描述过一种 anti-spin 保护：如果自动 continuation turn 没有工具调用，就不再自动开启下一轮。这个设计很合理，它能阻止模型连续输出“我接下来会检查”却不采取行动。

但是，在本文核查的当前实现中，`on_thread_idle -> continue_if_idle` 路径没有读取“上一轮是否调用过工具”，也没有相应的 per-turn gate。只要 Goal 仍为 `Active`，后续 idle 事件仍可再次尝试 continuation。

所以不能把“无工具调用则停止”当作当前 Runtime 的保证。它至多是早期版本出现过的策略，也提醒我们：官方文章、PR 描述与持续演进的源码应分别看待。当前防止无限消耗的主要硬边界，是 Goal 状态、预算限制、系统错误熔断以及用户控制，而不是这个已经不存在的 gate。

### 一次续跑中的控制权如何交接

把一次正常 continuation 展开，会更容易看清“自动”不等于“无条件”：

```text
Turn N 正常结束
  -> Core 清理 active turn
  -> 检查 trigger-turn mailbox
  -> 发出 ThreadIdle
  -> Goal 读取 Active 状态并准备 steering
  -> start_turn_if_idle 预留新的 active turn
  -> 再查一次 mailbox
  -> 创建 Turn N+1
```

第二次 mailbox 检查尤其关键。第一次检查之后，用户消息仍可能恰好到达；如果预留 active turn 后发现这种工作，Core 会撤销预留，并让 mailbox 的任务先运行。Goal continuation 不是一个比用户输入优先级更高的后台进程，它只是在“此刻确实没有别的 Turn 应启动”时填补 idle。

同样，`continue_if_idle()` 调用失败或收到 `NotSubmitted` 时只记录并跳过，并不会绕开 Core 强行启动。后续是否再尝试，取决于 thread 是否再次产生 idle 生命周期事件，以及 Goal 届时是否仍然 `Active`。

## 3. 两把锁解决的是两类竞态

Goal Runtime 中有两个容易混淆的单许可 `Semaphore`。

### `goal_state_lock`：保护“读状态 -> 采取动作”

设想 Runtime 刚读到 Goal A 为 `Active`，用户同时把它 clear 或替换成 Goal B。如果继续使用旧快照启动 Turn，就会出现“目标已经不存在，旧 continuation 仍然开跑”的竞态。

`goal_state_lock` 因而覆盖 continuation 的读取与启动窗口，也用于外部状态修改、terminal error 停止等关键路径。它串行化的是 Goal 生命周期决策，不是所有线程工作。

数据库更新还可以携带 `expected_goal_id`：只有当前行仍是预期的那个 Goal 才更新，避免 Goal A 的迟到结果覆盖 Goal B。不过这项保护不是所有调用路径都强制使用，例如模型侧 `update_goal` 的当前实现没有传入 expected id，因此更准确的说法是“关键异步路径支持 stale-update protection”，而不是“任何更新都绝不会过期”。

### `progress_accounting_lock`：防止同一增量重复收费

一个 Turn 里可能有多个工具完成 hook 几乎同时触发。每个 hook 如果都读取同一个 token baseline，再分别写入数据库，同一段 token 和时间就会被累计两次。

`progress_accounting_lock` 从“取得 progress snapshot”一直持有到“持久化成功并推进 baseline”。因此并发 hook 只能依次结算：后一个看到的是前一个已经更新过的基线。

两把锁的职责可以概括为：

```text
goal_state_lock
  在参与该锁的 continuation / external set-clear / error-stop 路径中，
  防止状态决定跨越对应的生命周期竞态

progress_accounting_lock
  保证同一段 token / wall-clock delta 只结算一次
```

它们也不能互相替代。只用状态锁，两个工具 hook 仍可能重复结算；只用记账锁，用户 clear 之后仍可能启动基于旧 Goal 的 continuation。把“生命周期变更”和“资源增量提交”分成两条临界区，能让锁的持有范围保持清晰，也减少一个全局大锁把所有异步路径串死的风险。

## 4. Token 回调只记内存，checkpoint 才写入 Goal

Goal 的记账不是在 Turn 结束时用 `total_tokens` 粗略相减。Turn 开始时，`GoalAccountingState` 记录当前累计 usage 作为 baseline；之后每次 `on_token_usage` 回调只是更新内存中的 `current_token_usage`。

真正写入持久化 Goal 的 checkpoint 包括：

- 符合条件的工具调用完成后；
- Turn 正常停止、被 abort 或发生 terminal error 时；
- 外部修改 Goal、fork 前需要 flush 时；
- 模型调用 `update_goal` 前。

可以用下面的伪代码表示：

```text
on_token_usage(total_usage):
    update_in_memory_total(total_usage)

on_qualifying_tool_finish():
    persist_token_and_time_delta()
    maybe_set_budget_limited()
    maybe_inject_wrap_up_steering()

on_turn_stop_or_abort_or_error():
    flush_remaining_delta()
```

当前 token 口径是：

```text
uncached input tokens + output tokens
= (input_tokens - cached_input_tokens) + output_tokens
```

它没有直接拿 `total_tokens` 收费，也不重复计算 cached input。使用饱和减法和非负输出，也能避免累计计数回退造成负扣费。

更严格地说，当前公式只显式读取 `input_tokens`、`cached_input_tokens` 与 `output_tokens`，不会再把 `reasoning_output_tokens` 单独加一次。这里关心的是 Goal 的计费口径，而不是供应商账单的所有字段；两者不应在没有核对代码的情况下画等号。

Plan Turn 不计入 Goal token：`start_turn()` 会根据 collaboration mode 设置 `account_tokens`，Plan mode 为 false，并清掉当前 Turn 的 Goal 归属。这与前面的调度约束一致：自动 Goal 工作不会进入 Plan，用户主动进行的规划也不应偷偷消耗 Goal 预算。

`time_used_seconds` 则记录 Runtime 把该 Goal 标记为 current active 期间的 wall-clock 增量，使用进程内 `Instant` 维护上次结算点。它可能包含两轮之间仍保持 active 的 idle 时间，但不等于从 `created_at` 到现在的自然历时，进程离线期间也不会凭空补记。当前 schema 只有 `token_budget`，没有 time budget；时间会被记账，不会因为达到某个秒数自动停止。

为什么不在每次 token callback 里直接写数据库？一方面，流式响应可能产生大量 usage 更新，每次落库会放大锁竞争和 I/O；另一方面，工具完成、Turn 结束、状态修改这些边界本来就需要形成一致快照。当前设计先在内存里高频采样，再在有业务意义的 checkpoint 低频提交。代价也很明确：数据库中的 `tokens_used` 在两个 checkpoint 之间会暂时落后于真实累计值。

例如，一个 Turn 先生成 2,000 token，完成工具 A 时结算；随后又生成 1,500 token，工具 B 与 Turn stop 几乎同时到达。记账 semaphore 会让两个结算串行，先到者提交从上次 baseline 起的 1,500，后到者看到 baseline 已推进，便不会重复收费。若最后还有未结算的少量输出，Turn stop 的 flush 会补齐。

## 5. `BudgetLimited` 是 soft stop，但不是即时断路器

当持久化 checkpoint 发现累计 token 达到预算，数据库会把状态切换为 `BudgetLimited`。**达到预算不会自动等同于完成**，也不会强杀正在执行的 Turn；它阻止的是后续自动 continuation，让当前 Turn 有机会说明已经完成什么、还剩什么。如果当前 Turn 此时已经真正完成整个 objective，模型仍可显式调用 `update_goal(status="complete")`，把该 Goal 从 `BudgetLimited` 更新为 `Complete`。

不过“soft stop”有两个很重要的实现边界。

第一，预算判断不发生在每次 token callback。模型可能在两个 checkpoint 之间继续生成内容，因此实际用量可以越过预算线。预算更像结算点触发的上限控制，不是逐 token 的硬配额。

第二，wrap-up steering 只在一次 **符合条件的工具完成** 后发现状态刚变为 `BudgetLimited` 时注入，而且同一 Goal 只报告一次。如果预算首次在 Turn stop/abort 的 flush 中被观察到，Runtime 会更新状态，却没有仍在运行的 Turn 可接收这条 steering；此时不会补发同样的收尾指令。

假设预算还剩 800 token：模型生成 900 token 后立刻发起工具调用，token callback 只更新内存；工具结束时的 checkpoint 才看见越界，把状态改为 `BudgetLimited`，再向仍运行的 Turn 注入收尾指令。如果模型生成完 900 token 后直接结束而没有工具调用，越界会在 Turn stop 才落库，此时不会再启动一个专门的收尾 Turn。这个例子也解释了为什么实际消耗可能略高于预算，以及为什么两条路径的最终展示并不完全相同。

因此下列描述才贴近源码：

```text
token callback       -> 只更新内存累计值
tool finish checkpoint
                     -> 结算并可能 BudgetLimited
                     -> 若 Turn 仍在运行，尝试注入一次 wrap-up
turn stop checkpoint -> 结算并可能 BudgetLimited
                     -> 不保证还有 wrap-up steering
```

`BudgetLimited` 对自动续跑属于 terminal 状态，但并非数据库层面不可逆。用户或客户端仍可调整预算并恢复状态；如果 `tokens_used >= token_budget`，只把状态设为 `Active` 仍会保持 `BudgetLimited`，必须先提高或清除预算，再激活，或在同一次 set 中一起完成。它表达的是“当前资源边界下停止继续”，而不是“目标已经成功”。

## 6. 系统错误会立即熔断

如果 terminal error 后还保持 `Active`，idle continuation 会再次启动，然后撞上同一个错误。compaction error、不可重试错误或重试耗尽都可能形成昂贵的失败循环。

当前 `on_turn_error` 因而不等待所谓“同一 blocker 连续三轮”：

```text
UsageLimitExceeded -> UsageLimited
其他 CodexErrorInfo -> Blocked
```

状态更新前会先 flush 本 Turn 尚未结算的进度，并带 `expected_goal_id` 防止旧 Turn 停掉一个后来创建的新 Goal。一次 terminal error 就足以触发 Runtime 熔断。

这里需要把两种 `Blocked` 分开理解。模型主动调用 `update_goal(blocked)` 时，continuation prompt 要求同一阻塞条件连续出现至少三个 Goal Turn；这是模型侧的审计契约，当前没有持久化 blocker identity 或三轮计数器去硬校验。系统错误转 `Blocked` 则完全不经过该门槛。

`UsageLimited` 也不会在服务额度恢复后自行回到 `Active`。恢复需要用户或客户端明确执行 resume/状态更新；否则自动续跑保持停止。这可以避免 Runtime 猜测“限制是否已经解除”并反复探测。

## 7. 持久化 Goal 不等于永久上下文

Goal 的 objective、status、budget 和 usage 在对话之外持久化，但模型的 working context 仍受 context window 限制。每次 continuation 生成的 Goal 指令，会作为来源为 `goal` 的 contextual user fragment 注入当前 Turn。

当前 compaction 路径有一个值得警惕的边界：contextual user message 被排除在 conversation snapshot 之外，remote compaction 也不会把这类 fragment 当作真实用户消息保留；Goal Extension 目前没有注册专门的 context contributor，在压缩后重建这段协议。

这意味着 mid-turn compaction 之后，本轮余下推理可能仍保留目标摘要，却丢失精确的 scope preservation、completion audit 和 blocked audit 指令。只要 Goal 仍为 `Active`，下一次新的自动 Goal Turn 会重新生成 continuation steering；但不能说这些约束在被压缩的当前 Turn 中始终存在。

错误熔断对这里也很重要：如果 compaction 本身以 terminal error 结束，Runtime 会把 Goal 转为 `Blocked`，而不是不断自动续跑、不断重试同一个压缩错误。

## 8. 把当前 Runtime 压缩成一段伪代码

```text
on_thread_idle:
    core rejects active-turn / trigger-mailbox cases
    goal runtime acquires goal_state_lock
    load current goal
    if goal.status != Active: return
    build continuation steering
    start_turn_if_idle()  # 再次检查 mailbox、Plan mode、active turn

on_token_usage:
    record cumulative usage in memory

on_tool_finish:
    acquire progress_accounting_lock
    persist uncached-input + output and wall-clock delta
    if checkpoint crosses budget:
        status = BudgetLimited
        inject one wrap-up steering if the turn is still active

on_turn_stop_or_abort:
    flush remaining usage

on_terminal_error:
    flush remaining usage
    UsageLimitExceeded ? UsageLimited : Blocked
```

这段流程展示了 Goal 的核心价值：模型仍然负责推理和使用工具，Runtime 则负责何时再运行、哪些工作必须让路、资源如何归属，以及什么情况下停止自动推进。

## 本期边界

本期只讨论当前 Goal Runtime 的调度、并发、记账、预算、错误和上下文边界，没有把 continuation prompt 中的 completion audit 当成硬验证器，也没有讨论怎样设计一个高质量 Goal。下一期会专门分析审计机制、常见失败模式和目标写法。

下一篇：[Codex Goal 模式（四）：完成审计、失败模式与实践方法](/posts/codex-goal-mode-4-audit-failures-practice/)

## 源码索引

- `codex-rs/ext/goal/src/extension.rs`：idle、Turn、Token 与 Tool 生命周期入口
- `codex-rs/ext/goal/src/runtime.rs`：continuation、状态锁、错误停止与持久化记账
- `codex-rs/ext/goal/src/accounting.rs`：usage baseline、记账锁、token/time delta
- `codex-rs/state/src/runtime/goals.rs`：usage 持久化、BudgetLimited 转换与 continuation deferral
- `codex-rs/core/src/tasks/lifecycle.rs`：发出 thread idle 前的检查
- `codex-rs/core/src/session/turn_input.rs`：`start_turn_if_idle` 的最终原子提交
- `codex-rs/ext/goal/src/steering.rs`：continuation 与 budget-limit steering
- `codex-rs/core/src/context_manager/history.rs`、`compact_remote_request.rs`、`compact_remote.rs`：上下文快照、remote compaction 输入与结果过滤

## 参考资料

1. [Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)
2. [Goal Core Runtime 初始 PR #18076](https://github.com/openai/codex/pull/18076)
3. [Goal Runtime 当前源码](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/runtime.rs)
4. [Goal Extension 当前源码](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/extension.rs)
5. [Goal Accounting 当前源码](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/accounting.rs)
6. [Goal Continuation Prompt](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/templates/goals/continuation.md)
