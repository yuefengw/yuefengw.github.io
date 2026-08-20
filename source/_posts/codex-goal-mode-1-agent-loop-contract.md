---
title: "Codex Goal 模式（一）：它不是更长的 Prompt"
slug: codex-goal-mode-1-agent-loop-contract
date: 2026-08-20 10:10:00
updated: 2026-08-20 10:10:00
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
description: "从普通 Agent Loop 的终止边界出发，理解 Codex Goal 为什么是一份跨 turn 的完成契约，而不只是更强硬的提示词。"
---

从普通 Agent Loop 的终止边界出发，理解 Codex Goal 为什么是一份跨 turn 的完成契约，而不只是更强硬的提示词。

<!-- more -->

> 本系列基于 2026-08-20 的 Codex 源码（commit `312b62ac95335e1762b70ceb8910374965bd2785`）整理。官方指南用于解释设计意图，具体运行机制以该提交的源码为准。

这是一组关于 Codex Goal 模式的四篇文章：

1. 它解决了什么问题，与 Prompt、Plan 有什么区别；
2. Goal 如何持久化，以及六种状态如何流转；
3. Runtime 如何续跑、记账并处理并发；
4. 完成审计的真实边界、失败模式与实践方法。

## 1. 先给结论

如果只记住一句话，可以是：

> **Goal 不是让模型在一个 turn 里思考得更久，而是在普通 Agent Loop 外增加一层可持久化的目标生命周期。**

它把“本轮回答结束”和“整个任务已经完成”拆成两个不同事件。

普通模式下，在没有待处理输入或生命周期钩子要求继续时，模型不再请求工具并给出最终回复，一个 turn 就结束了。Goal 激活后，turn 结束只代表这轮执行告一段落；当 thread 再次空闲时，Goal Runtime 会读取持久化状态，Core 还会检查 active turn、可触发 turn 的排队输入与 Plan mode，再决定是否开启下一轮。预算不会在 idle 路径实时重算，而要先在记账 checkpoint 中反映为 `BudgetLimited`。

用一张简化图表示：

```text
普通模式

User prompt
    -> model reasoning
    -> tool call <-> environment
    -> final assistant message
    -> turn ends, wait for user

Goal 模式

User objective
    -> normal agent turn
    -> thread becomes idle
    -> Goal Runtime checks durable state and scheduling conditions
    -> start another turn when continuation is allowed
    -> repeat until the lifecycle changes
```

真正的变化发生在 Agent Loop 外面：模型仍然按原来的方式推理和调用工具，但是否继续，不再只由一次 assistant message 决定。

## 2. 普通 Agent Loop 停在哪

一个 coding agent 的单轮执行已经可以很长。模型能够读取文件、修改代码、运行测试、查看失败结果，再继续修改。在这一轮内部，循环大致是：

```text
LLM -> tool request -> tool result -> LLM -> ... -> final response
```

问题是，`final response` 只是一个局部停止信号。它表达的是“模型现在没有继续调用工具”，不天然等价于“用户的长期目标已经被证明完成”。

假设任务是：

```text
把认证模块迁移到新架构；
保持现有 API 行为兼容；
补充迁移测试；
运行完整测试并修复所有回归。
```

模型可能在第一轮完成中间件迁移，跑完一个局部测试，然后汇报这一阶段的结果。对于普通会话，这个行为完全合理；但对完整目标而言，它也许只完成了四分之一。

因此需要明确区分：

```text
Turn termination != Goal completion
```

Goal 模式处理的正是这个生命周期错位。它不改变工具循环的基本语义，而是让一个 thread 在多次 turn 之间仍然拥有“尚未完成什么”的持久状态。

## 3. Thread-scoped completion contract

OpenAI 的 Goal 指南把它概括为 **thread-scoped completion contract**，也就是“属于当前 thread 的完成契约”。这个定义的两个部分都很重要。

### 3.1 为什么属于 thread

Goal 不是全局记忆，也不是项目里的永久规则。它绑定在一个 thread 上，因为证明任务是否完成所需的工作上下文通常也在这个 thread 里：

- 看过哪些文件；
- 做过哪些修改；
- 哪些测试已经运行；
- 哪条路线失败过；
- 当前工作区和外部系统是什么状态。

把 Goal 绑定到 thread，可以让目标生命周期和这段工作的上下文处在同一个边界内。但要注意，**Goal 的持久化不等于完整工作记忆永久存在**。数据库能保存 objective、状态和用量，不代表上下文压缩后模型仍能逐字记住之前的所有推理。这一限制会在第三期专门讨论。

### 3.2 为什么叫完成契约

普通 Prompt 更像“下一步请做什么”，完成契约则关心“最终什么必须变成真的，以及如何证明”。一个适合长期执行的 objective，通常应该写清：

```text
Deliverables   最终要交付什么
Constraints    哪些边界不能破坏
Verification   用什么当前证据验收
Stop condition 何时才可以宣布结束
```

这里必须区分**写作模型**和**真实数据模型**。上面四项是编写目标时的建议，并不是 Codex 数据库里的四个结构化字段。当前 `create_goal` 的模型工具只接收 `objective` 和可选的 `token_budget`；“只有用户明确要求时才设置预算”写在模型工具说明中，handler 本身只校验参数是否合法，宿主配置也可以提供默认最大预算。交付物、约束和验收标准仍然都包含在 objective 文本中。

这一区分很关键。Goal 提供了持久生命周期，但不会自动把一句模糊愿望转换成严格的验收规范。

## 4. 它是一套 Runtime 能力

把 Goal 理解成下面几层，会比“给 system prompt 加一句坚持完成”准确得多：

```text
UI / App Server
    -> 创建、暂停、恢复或编辑 Goal

Goal persistence
    -> 保存 thread 当前 Goal 的 objective、状态、预算和用量

Goal extension + runtime
    -> 监听 turn 生命周期和 thread idle
    -> 决定能否发起 continuation
    -> 记账并处理错误状态

Goal steering
    -> 自动 continuation turn 重新注入 objective 和审计要求
    -> objective 编辑时，可能提示正在运行的 turn

Normal Codex turn
    -> 模型推理、调用工具、观察真实环境
```

当 Goal extension 已启用且当前 thread 具备相应 tool capability 时，工作模型能看到三个 Goal 工具：`get_goal`、`create_goal` 和 `update_goal`。不过工具权限是刻意收窄的，例如模型侧 `update_goal` 当前只能请求 `complete` 或 `blocked`；暂停、恢复、额度受限等生命周期动作由用户、客户端或 Runtime 控制。

所以 Goal 横跨持久化、协议、工具、调度和界面。Continuation Prompt 很重要，但它只是一层，不是整个功能。

## 5. Prompt、Plan 与 Goal 的边界

这三个概念解决不同问题：

| 机制 | 核心问题 | 生命周期 | 当前实现中的关键差异 |
| :-- | :-- | :-- | :-- |
| 普通 Prompt | 下一轮做什么 | 通常以一个 turn 为边界 | final response 后等待用户 |
| Plan | 打算怎么做 | 组织路径与步骤 | Plan turn 不计入 Goal 用量，也不会触发 Goal 的 idle 自动工作 |
| Goal | 何时才算整个目标完成 | 跨多个 turn 持久存在 | 有独立状态、续跑调度和用量记账 |

实践中常见的合理顺序是先用 Plan 澄清范围，再由用户显式创建 Goal 执行。但这是一种工作方法，不是 Runtime 强制流程。

Goal 也经常被拿来和 Ralph Loop 一类外部循环比较。两者都试图克服“模型过早停止”，但不能简单画等号。外部脚本可以反复启动独立执行，Goal 则嵌在 Codex 的 thread 生命周期里，通过 idle 事件尝试启动后续 turn，并复用该 thread 的状态。具体的上下文保留方式取决于各自实现，不能泛化成“Ralph 一定冷启动，Goal 一定保留全部记忆”。

## 6. 一个有用但有限的控制系统类比

从工程视角，可以把 Goal 看作一个松散的闭环：

```text
objective -> model chooses actions -> tools change environment
     ^                                      |
     |                                      v
     +-------- current evidence and state --+
```

这个类比有助于说明模型不是系统的全部：

- 模型负责生成策略；
- 工具负责执行动作；
- 工作区和外部服务构成真实环境；
- Runtime 负责持久状态、调度、预算与生命周期；
- continuation 文本要求模型根据当前证据重新审视完成度。

但不要把类比误读成源码中存在一个数学意义上的 `Verify(goal, state)`。当前实现没有独立 verifier，也不会在 `update_goal(complete)` 时自动检查测试覆盖率或逐项验收。所谓 Completion Audit，是交给工作线程中模型执行的证明义务；状态更新 handler 本身并不验证这些证据。

换句话说，Goal 加强了“持续工作直到满足契约”的控制结构，却没有消除模型的自验证偏差。

## 7. Goal 现在能保证什么

更准确的说法是：Goal 为长期任务提供了更强的**持续性基础设施**，而不是成功保证。

它能够提供：

- 一个独立于普通对话文本的 thread 级目标记录；
- 明确的生命周期状态；
- thread 空闲时的事件驱动续跑；
- token 与耗时记账；
- 完成与阻塞的模型侧报告协议，以及 Runtime 管理的状态转换；
- 自动 continuation turn 重新锚定 objective 的 steering；
- 在符合条件的工具 checkpoint 触发预算线时，尝试向仍运行的 turn 注入一次收尾提示。

它不能独自保证：

- objective 本身没有歧义；
- 模型收集了足够的验证证据；
- 每次 idle 都一定能成功启动下一轮；
- 上下文压缩后所有工作知识都完整保留；
- 模型不会做出错误的局部修改；
- 完成判断经过独立验证器确认。

这也是阅读 Goal 源码时最重要的分界：**哪些是 Runtime 的硬约束，哪些只是 Prompt 对模型提出的行为要求。**

下一期会进入持久化层，具体看 `goals_1.sqlite`、一个 thread 当前只有一个 Goal 的数据模型、六种状态，以及用户、模型和 Runtime 各自能改变什么。

## 本期边界

本文讨论的是 Goal 的动机和抽象，没有展开状态迁移、预算 checkpoint 与锁的实现。控制系统和 completion contract 用于建立心智模型，不代表数据库中存在对应的全部结构化字段或独立验证组件。

## 源码与参考资料

- [Using goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)：官方概念指南，其中部分机制描述可能早于本文核对的源码版本。
- [Codex 普通 turn 的实现](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/core/src/session/turn.rs)
- [Goal extension 生命周期入口](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/extension.rs)
- [Goal Runtime](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/runtime.rs)
- [Goal 模型工具定义](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/spec.rs)

**系列导航：** 本篇为第一期 · [下一期：持久化目标与六态状态机](/posts/codex-goal-mode-2-persistence-state-machine/)
