---
title: "Codex Goal 模式（四）：完成审计、失败模式与实践方法"
slug: codex-goal-mode-4-audit-failures-practice
date: 2026-08-20 10:40:00
updated: 2026-08-20 10:40:00
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
description: "从 Continuation Prompt、完成与阻塞审计出发，分析 Codex Goal 的失败边界，并给出可验收目标的写法与源码阅读地图。"
---

前三期分别回答了 Goal 是什么、状态如何持久化，以及 Runtime 怎样自动续跑。本期收束整个系列，讨论一个更难的问题：Agent 凭什么宣布“已经完成”，又应该在什么时候承认“无法继续”？

<!-- more -->

> 本文基于 Codex commit [`312b62ac95335e1762b70ceb8910374965bd2785`](https://github.com/openai/codex/commit/312b62ac95335e1762b70ceb8910374965bd2785)。源码仍在快速演进，文中的“当前”均指该提交。

系列导航：[第一期：它不是更长的 Prompt](/posts/codex-goal-mode-1-agent-loop-contract/) ｜ [第二期：持久化目标与六态状态机](/posts/codex-goal-mode-2-persistence-state-machine/) ｜ [第三期：Idle 续跑、预算记账与并发边界](/posts/codex-goal-mode-3-runtime-continuation-budget/)

## 1. Continuation Prompt 不只是“请继续”

Active Goal 在 thread idle 后获得续跑机会时，Runtime 不会简单重发用户的第一句话，而是根据持久化 Goal 构造一条 continuation steering。当前模板做了四件事：

1. 把原始 objective 重新放回视野，并明确它是用户数据，不是更高优先级指令。
2. 要求模型保留完整范围，不能把长期目标偷换成这一轮容易完成的小任务。
3. 要求以当前 worktree 和外部状态为准，而不是相信先前 turn 的记忆。
4. 在调用 `update_goal` 之前执行 Completion Audit 或 Blocked Audit。

这段 steering 主要对抗三种漂移：做着做着缩小原目标的 **Goal drift**，完成部分工作就宣布结束的 **Completion drift**，以及为了让现有测试更容易通过而选择局部最优解的 **Local-optimum drift**。

它的重要性很高，但它仍然是一段给模型的行为政策。Runtime 负责在合适的生命周期边界注入模板、提供受限工具并持久化状态；是否逐条检查要求、证据是否足够，当前仍由模型判断。

## 2. Completion Audit：把完成当成待证明命题

Continuation Prompt 对“完成”采用的是 **prompt-driven proof obligation**：默认 Goal 尚未完成，Agent 必须为完成声明举证。可以把审计过程压缩成：

```text
从 objective 和引用材料中派生全部要求
        ↓
为每个交付物、约束、测试和不变量寻找权威证据
        ↓
检查当前文件、命令输出、运行行为或外部状态
        ↓
证据完整且范围匹配？
   ├── 否：继续工作
   └── 是：update_goal(status="complete")
```

这里有两个容易被忽略的限定。

第一，证据必须描述 **current state**。模型记得“刚才测试通过”并不够，因为后续修改可能已经引入回归；“我已经写了代码”也不等于代码已被正确集成。源码、最新测试结果、实际页面、benchmark 数据或远端 PR 状态，才是对应任务的证据面。

第二，验证范围必须匹配声明范围。一个单元测试只能说明它覆盖的路径，不能证明“整个支付系统完全兼容”；搜索不到旧类名，也不能单独证明迁移完整。测试、manifest、lint 和绿色 CI 都是证据，但只有先确认其覆盖要求，才能支撑完成结论。

不同任务也应选择不同证据面。代码修复通常需要相关源码、回归测试和真实运行行为共同支撑；性能优化需要固定环境、固定负载、修改前后数据与正确性测试，不能只截取一次更快的结果；大型迁移既要证明新路径已经接管流量，也要检查旧实现是否移除、公开接口是否兼容；研究型任务则要核对一手资料覆盖范围、相互冲突的来源和最终产物。证据不是越多越好，而是每项关键声明都能找到与其范围相称、可以复查的依据。

### 它不是独立 verifier

这是理解当前 Goal 最关键的边界：**Completion Audit 不是 Runtime 内实现的 `Verify(goal, state)` 函数，也没有自动启动第二个 verifier 模型。**

`update_goal` 的 schema 只允许模型提交 `complete` 或 `blocked`，handler 会拒绝其他状态；但它不会读取测试报告、逐项核对 objective，或判断证据质量。审计规则写在 continuation prompt 中，最终仍是工作 Agent 自己检查、自己调用工具、自己给出结论。

因此，状态写入和参数枚举是硬约束，“有充分证据才允许 Complete”则是模型侧 proof obligation。高风险发布仍应叠加机器验收、独立 review 或人工审批，不能因为 Goal 状态变成 `Complete` 就跳过原有质量门禁。

## 3. Blocked Audit：困难不等于阻塞

另一个审计用于回答“何时可以停下来求助”。当前 prompt 要求：同一个阻塞条件至少连续出现在三个 Goal turn 中，并且没有用户输入或外部状态变化就确实无法产生有意义进展，模型才应调用：

```json
{ "status": "blocked" }
```

任务很难、进展很慢、结果不确定，或者“问一下用户会更省事”，都不满足这个条件。Goal 从 `Blocked` 恢复后，新的运行阶段重新进行三轮审计，不能把上一次的失败次数永久继承下来。

但“三轮”同样不是数据库不变量。当前没有持久化 blocker identity 或计数器，tool handler 也不会重放三个 turn 验证模型是否诚实遵守。它是一条 prompt 规则。与此同时，非重试型 turn error 或重试耗尽时，Runtime 为阻止错误循环，可以不经过三轮模型审计而直接把 Active Goal 置为 `Blocked`。两条路径写入同一状态，触发者和保证强度不同。

## 4. 八类常见失败模式

Goal 延长了执行生命周期，却不会把一个开放问题自动变成可靠流程。实践中至少要注意以下八类风险。

### 4.1 自我验证偏差

同一个 Agent 既施工又验收，容易漏掉要求、过度相信测试，或者把“没有发现问题”当成“已经证明正确”。缓解方式是预先写清验收命令，并让关键结果经过独立检查。

### 4.2 目标含糊

“优化项目”“把体验做好”没有确定终态。Runtime 可以持续调度，却无法替用户发明唯一正确的完成定义。最好把对象、指标、交付物和不可破坏的约束写进 objective。

### 4.3 验证面不完整

要求覆盖整套系统，Agent 却只能看到一个模块；要求验证线上行为，环境中却只有单元测试。这时证据上限低于声明范围，即使所有可运行检查都通过，也不应 Complete。

### 4.4 Context degradation

Goal persistence 保存的是 objective、status、budget、usage 和时间信息，不是任务过程中学到的全部知识。长任务经过 compaction、resume 或多轮错误摘要后，工作上下文仍可能退化。重要决策应落到代码、计划、测试或可重新读取的文档里。

### 4.5 工具与权限约束

Goal 不会凭空获得生产数据库、私有 API、登录态或用户审批。遇到权限边界时，应先寻找权限内的验证路径；确实依赖外部变化并满足审计条件后，再进入 `Blocked`。

### 4.6 局部错误不断累积

错误假设可能先产生错误修改，再让后续 turn 把错误状态当成新基础。长程执行更需要短反馈环：每完成一个可独立验证的增量，就检查行为和不变量，而不是把验证全部推到最后。

### 4.7 把长期责任伪装成有限目标

“永远保持代码质量”“持续改进产品”没有天然停止条件，适合定期流程或人工治理，不适合一次 Goal。更合理的写法是限定版本、范围、指标与截止验收面，使它成为 finite, auditable objective。

### 4.8 Active 但没有自动续跑

`Active` 表示持久化状态允许继续，不代表后台有一个永不停止的守护进程。Plan mode、会触发 turn 的 mailbox item、Goal 工具不可见、live thread 不可用、fork continuation deferral，以及 `start_turn_if_idle` 拒绝提交，都可能让 Goal 保持 Active 却不产生下一 turn；如果条件一直不恢复，这种状态也可能长期持续。诊断时要同时检查状态机和调度条件。

## 5. 怎样写一个可验收的 Goal

当前模型侧 `create_goal` 只有两个输入：`objective` 与可选的 `token_budget`。Deliverables、Constraints、Verification 和 Stop condition 并不是结构化字段，都要写入 objective 文本。工具说明要求模型只有在用户明确提出 token budget 时才主动传入该参数；这是模型侧行为规则，不是 handler 对授权历史的硬校验。参数省略后，host 仍可能把配置的 `max_goal_token_budget` 用作默认上限。当前没有 time budget 字段，`time_used_seconds` 只是累计用时。

弱 Goal 通常只有方向：

```text
优化 checkout 接口性能。
```

它没有基准负载、目标数值、正确性边界和最终产物。一个更强的版本是：

```text
目标：在现有 checkout benchmark 的固定负载下，
将 checkout API 的 p95 延迟降低到 120 ms 以下。

交付物：完成必要的实现、测试和 benchmark 记录。

约束：
1. 不改变公开 API schema；
2. 不关闭缓存一致性检查；
3. correctness test suite 必须保持全绿。

验收：
1. 使用仓库现有 benchmark 命令复测；
2. 报告修改前后的 p50、p95 与样本条件；
3. 运行测试、lint 和类型检查；
4. 当前证据满足全部条件后才可 Complete。
```

这个目标可以被展开成明确逻辑：`p95 < 120 ms`，同时 API 不变、一致性约束保留、测试通过、对比数据可复查。它不要求模型猜测“优化到什么程度才够”。

### 可复用模板

```text
目标：<最终要成立的可观察状态>

范围与交付物：
- <必须修改、创建或交付的对象>

约束：
- <不能破坏的接口、行为、安全或兼容性条件>

验收证据：
- <命令、测试、指标、运行行为或外部状态>
- <每项证据必须覆盖的范围>

停止条件：
- 全部要求被当前证据证明后 Complete；
- 缺少证据时继续推进；
- 仅在满足严格阻塞审计时 Blocked。
```

可以把它当成一张能够交给资深工程师关闭的 Issue：如果无法回答“什么证据允许 Close”，这个目标通常还不适合进入长程执行。

## 6. 作者视角：把 Goal 看作不完全闭环控制

下面是帮助理解的类比，不是 Codex 源码里的正式模型：objective 类似设定值，仓库与外部环境是被观察状态，工具像执行器，测试和日志像传感器，continuation 负责安排下一次反馈，budget 则限制控制成本。

这个类比的价值，在于把“继续生成文字”改写成“观察当前状态、采取动作、重新测量”。但不能据此声称 Runtime 实现了误差信号或 `Verify(G, S)`：当前 Completion Audit 仍由模型完成。更准确地说，Goal Runtime 提供调度、生命周期、持久化和预算控制，模型承担语义判断与闭环中的主要决策。

## 7. 哪些能力仍属于展望

从当前边界出发，后续自然会想到四类增强：

- **独立 verifier**：让 worker 的完成声明经过另一个模型、规则引擎或人工 gate，而不是自动自审自批。
- **结构化验收字段**：把 criteria、required commands、invariants、artifacts 从 objective prose 提升为可单独跟踪的状态。
- **Goal 专属的上下文重建**：Codex 已有通用 transcript 恢复、compaction summary 与 fork history copy；仍可增强的是在这些边界后，以结构化、可预测的方式重建 objective、audit protocol 和关键进展。
- **层级 Goal**：为父目标拆分子目标、依赖和预算，并支持并行调度。

这里描述的是 Goal Runtime 的增强方向，不是当前统一具备的一组功能。尤其是独立 verifier、结构化验收字段和层级 Goal，目前都没有实现；通用上下文恢复的存在，也不等于已经具备 Goal 专属、确定性的审计状态重建。现在的完成状态是机器可读的，但完成证据没有作为 `ThreadGoal` 字段被独立持久化或校验；存储模型以 `thread_id` 为主键，一个 thread 只有一条当前 Goal，也没有父子 Goal 关系。讨论未来设计时，应把架构推演与已发布能力分开。

## 8. 源码阅读地图：先看当前实现，再看历史 PR

推荐从普通 Agent Loop 开始，再进入 Goal：

1. 阅读固定提交的 `core/src/session/turn.rs`，理解 turn、tool call、assistant message 与结束边界。
2. 看 `codex-rs/ext/goal/` 下的 `extension.rs`、`runtime.rs`、`accounting.rs`、`steering.rs`、`spec.rs`、`tool.rs` 和 continuation template。
3. 看 `state/src/model/thread_goal.rs`、`state/src/runtime/goals.rs` 与 `state/goals_migrations/`，核对状态、持久化和 continuation deferral。
4. 看 App Server protocol 与 `core/src/session/turn_input.rs`，理解用户控制面和 idle submission 的拒绝条件。

Goal 最初由五段 PR 引入，适合阅读设计演进：

1. [#18073 Add goal persistence foundation (1 / 5)](https://github.com/openai/codex/pull/18073)
2. [#18074 Add goal app-server API (2 / 5)](https://github.com/openai/codex/pull/18074)
3. [#18075 Add goal model tools (3 / 5)](https://github.com/openai/codex/pull/18075)
4. [#18076 Add goal core runtime (4 / 5)](https://github.com/openai/codex/pull/18076)
5. [#18077 Add goal TUI UX (5 / 5)](https://github.com/openai/codex/pull/18077)

这些 PR 是历史设计，不应代替当前源码。今天的 Goal 已迁到 `ext/goal`，持久化使用独立 `goals_1.sqlite`，模型工具也已支持 `blocked`；早期 migration、状态集合和 continuation 细节与当前 main 存在差异。

## 结语

Goal 真正改变的不是单次推理长度，而是任务的完成语义：一个 turn 可以结束，thread 里的完成契约仍然存在；Runtime 可以继续调度，模型却必须对完整目标负责。

它的可靠性来自分层配合：状态、权限、预算和调度由 Runtime 约束，目标理解、行动选择和证据审计由模型承担。也正因为如此，Goal 不是“保证任务完成”的按钮。写清可验证终态、构造与声明范围匹配的证据面，并为高风险任务保留独立验收，才是把长程执行从持续尝试变成工程流程的关键。

## 系列回顾

- [第一期：Codex Goal 模式（一）：它不是更长的 Prompt](/posts/codex-goal-mode-1-agent-loop-contract/)
- [第二期：Codex Goal 模式（二）：持久化目标与六态状态机](/posts/codex-goal-mode-2-persistence-state-machine/)
- [第三期：Codex Goal 模式（三）：Idle 续跑、预算记账与并发边界](/posts/codex-goal-mode-3-runtime-continuation-budget/)

## 源码索引与官方参考

- [OpenAI Cookbook：Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)：Goal 的官方概念与使用方式；部分运行细节早于当前实现，应结合源码阅读。
- [`core/src/session/turn.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/core/src/session/turn.rs)：普通 Agent Turn、tool-call 结果回传与结束边界。
- [`templates/goals/continuation.md`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/templates/goals/continuation.md)：Completion Audit 与 Blocked Audit 的模型侧规则。
- [`ext/goal/src/spec.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/spec.rs)：`create_goal`、`get_goal`、`update_goal` 的 schema。
- [`ext/goal/src/tool.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/tool.rs)：Goal 工具 handler 与状态更新边界。
- [`ext/goal/src/runtime.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/runtime.rs)：idle continuation、恢复与系统错误收尾。
- [`ext/goal/src/extension.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/extension.rs)：thread、turn、tool 与 token 生命周期钩子。
- [`state/src/model/thread_goal.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/state/src/model/thread_goal.rs)：当前 Goal 状态模型。
- [`state/goals_migrations/0001_thread_goals.sql`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/state/goals_migrations/0001_thread_goals.sql)：独立 goals DB 的当前核心表。
- [`state/goals_migrations/0002_thread_goal_continuation_deferrals.sql`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/state/goals_migrations/0002_thread_goal_continuation_deferrals.sql)：continuation deferral 持久化。
