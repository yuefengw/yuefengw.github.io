---
title: "Codex Goal 模式（二）：持久化目标与六态状态机"
slug: codex-goal-mode-2-persistence-state-machine
date: 2026-08-20 10:20:00
updated: 2026-08-20 10:20:00
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
description: "从 goals_1.sqlite、六态状态机与工具权限边界，理解 Codex 如何把目标变成可恢复的运行时状态。"
---

普通对话把目标写在消息里，Goal 模式则把它写进独立状态。本期从当前 Codex 源码出发，拆解目标存储、六种状态、模型工具权限，以及 `expected_goal_id` 能做和不能做的事。

<!-- more -->

> 本文基于 Codex commit [`312b62ac95335e1762b70ceb8910374965bd2785`](https://github.com/openai/codex/commit/312b62ac95335e1762b70ceb8910374965bd2785)。源码仍在快速演进，文中的“当前”均指该提交。

系列导航：[上一期：它不是更长的 Prompt](/posts/codex-goal-mode-1-agent-loop-contract/) ｜ [下一期：Idle 续跑、预算记账与并发边界](/posts/codex-goal-mode-3-runtime-continuation-budget/)

## 1. 为什么目标不能只留在对话里

上一篇把 Goal 定义为 thread-scoped completion contract：它属于一个 thread，并规定什么才算真正完成。这个契约如果只存在于首条用户消息里，会遇到两个直接问题。

第一，长对话会压缩上下文。早期消息可能被摘要，原始目标的细节不再稳定地出现在模型输入中。第二，thread 可以退出后再恢复。仅靠模型“回忆”目标，等于把生命周期状态托付给一次次临时生成的上下文。

Codex 的处理方式是把目标从 transcript 中抽出来，形成独立的持久状态：

```text
TUI / App Client
    └── thread/goal/set|get|clear ──> GoalService

Model
    └── get_goal|create_goal|update_goal ──> GoalToolExecutor

Goal Runtime
    └── accounting / continuation / error handling

以上路径最终都通过 GoalStore 访问 goals_1.sqlite
```

因此，对话压缩与 Goal 删除是两件事；恢复 thread 时，也不需要先让模型从历史消息里猜出当前目标。这里的持久化解决的是**控制状态**，不是让模型获得无限上下文。

## 2. `goals_1.sqlite` 里存了什么

当前实现把 Goal 放在 SQLite home 下的独立文件 `goals_1.sqlite`。启动时，state runtime 会为它单独打开连接池，再构造 `GoalStore`。当前迁移中的核心表可以简化为：

```sql
CREATE TABLE thread_goals (
    thread_id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    token_budget INTEGER,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    time_used_seconds INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
```

最关键的约束不是 `goal_id`，而是 `thread_id` 上的主键：**一个 thread 在表中最多只有一条“当前 Goal”记录**。它不是 Goal 历史表，也不支持同一 thread 同时调度 Goal A、B、C。完成目标可以被 `create_goal` 覆盖；其他未完成状态则要先编辑或清除。

各字段分成四组：

- `thread_id` 决定目标属于哪个 thread。
- `goal_id` 标识这一版目标，用于部分并发路径识别“我更新的还是不是刚才那一个”。
- `objective` 与 `status` 描述目标内容和生命周期。
- budget、usage 与时间戳记录资源约束、累计消耗和更新时间。

### 编辑一行与替换一行

“只有一行”不代表每次修改 objective 都会生成新 Goal。当前 store 把两个动作分得很清楚：

```text
update existing goal
  保留 goal_id、tokens_used、time_used_seconds、created_at

replace/create next goal
  生成新 goal_id，usage 从 0 开始，created_at 重新计算
```

这个区别会直接影响用户体验和并发语义。修正文案、调整预算，通常应被视为对同一完成契约的编辑，已有消耗不能凭空归零；结束旧任务后开始一个真正的新目标，则应获得新身份，旧 turn 的结算也不该被算到新任务上。

单行设计也主动放弃了一些能力。数据库本身不会保存一个 thread 的 Goal A、B、C 历史列表；它也没有优先级、依赖边或多目标预算分摊。相关变更可以通过 rollout event 或上层日志观察，但 `thread_goals` 的职责始终只是回答一个问题：**这个 thread 此刻受哪个完成契约约束？** 这种保守模型牺牲了多目标编排，却显著降低了自动续跑时的归因复杂度。

### `goal_id` 是内部字段

这里有一个容易被忽略的边界：数据库模型含有 `goal_id`，但对模型返回的 `ThreadGoal` 以及 App Server v2 的 `ThreadGoal` 都没有这个字段。模型通常看到的是：

```json
{
  "threadId": "...",
  "objective": "完成迁移并通过验收测试",
  "status": "active",
  "tokenBudget": 100000,
  "tokensUsed": 28400,
  "timeUsedSeconds": 3120,
  "createdAt": 1787180000,
  "updatedAt": 1787183120
}
```

也就是说，`goal_id` 更像 persistence/runtime 内部的版本戳，而不是交给模型自行操作的乐观锁参数。

### 存储层经历过拆分

从仓库里的 migration 还能看到演进轨迹：早期 `thread_goals` 位于主 state DB，最初只允许 `active`、`paused`、`budget_limited`、`complete`；后续 migration 加入 `blocked` 与 `usage_limited`，再从主库删除该表。当前独立 goals migration 一次性建立六态表。

能从当前源码确认的是这个结构变化；至于它精确对应哪个发布版本，应以相关 PR 或 release note 为准，不宜仅凭文件顺序猜测。

## 3. 六种状态不是六个同义的“停止”

当前 `ThreadGoalStatus` 有六个取值：

```text
Active
  ├── Paused          用户或客户端主动暂停
  ├── Blocked         当前无法继续，需要输入或外部变化
  ├── UsageLimited    账户或服务额度限制
  ├── BudgetLimited   Goal 的 token budget 已触线
  └── Complete        目标已经完成

Paused / Blocked / UsageLimited
  └── 显式 resume 后可回到 Active

BudgetLimited / Complete
  └── 停止当前自动运行；仍可通过编辑目标或预算重新激活
```

状态模型里的 `is_terminal()` 定义得非常精确：

```rust
pub fn is_terminal(self) -> bool {
    matches!(self, Self::BudgetLimited | Self::Complete)
}
```

这里的 terminal 应理解为**当前自动运行的终止状态**，不能理解成数据库记录从此不可修改。App Server 的 set 接口可以携带六种状态；TUI 编辑一个 `BudgetLimited` 或 `Complete` Goal 时，也会尝试把它转回 `Active`。如果原 Goal 已超过预算，还必须提高或清除预算，存储层才会允许它真正恢复为 Active。

另一方面，`Paused`、`Blocked`、`UsageLimited` 虽然不被 `is_terminal()` 归类为 terminal，runtime 也不会在这些状态下自动续跑。它们表达的是“可恢复地停下”，恢复动作仍需由用户或客户端显式发起。当前源码没有“额度恢复后自动把 UsageLimited 改回 Active”的后台状态转换。

还要区分两种 Blocked 来源。模型调用 `update_goal(status="blocked")` 时，工具描述要求同一阻塞连续出现三个 Goal turn；但 terminal turn error 的系统处理路径可以直接把 Active Goal 置为 Blocked。两者最终写入同一状态，触发条件却不同。

因此，上面的文本图是运行语义摘要，不是数据库强制执行的完整 transition table。`ThreadGoalStatus` 只定义合法值，App Server 的 set 接口负责表达外部意图，store 再结合当前 usage 与 budget 决定最终结果。例如，一个已经超出预算的 Goal 即使收到 Active，也可能继续保持 BudgetLimited；提高或移除预算后，同样的激活动作才有意义。

从运行角度看，更实用的分类其实有两层。第一层是“能否自动继续”：只有 Active 可以。第二层才是“为何停止”：Paused 是人为暂停，Blocked 是任务条件受阻，UsageLimited 是服务条件受阻，BudgetLimited 是本 Goal 的资源约束，Complete 是成功结束。六态的价值正是保留这些原因，而不是用一个笼统的 Stopped 抹平后续处理策略。

## 4. App Server 与模型看到的控制面不同

Goal 有两组入口，不能混为一谈。

App Server 暴露的是 thread 级生命周期接口：

```text
thread/goal/set    创建、编辑目标，或设置状态与预算
thread/goal/get    读取当前目标
thread/goal/clear  删除当前目标
```

`thread/goal/set` 的 `status` 类型包含全部六态。TUI 的 `/goal pause` 和 `/goal resume`，本质上分别通过这条路径设置 `Paused` 和 `Active`。需要注意，“interrupt 会暂停 Goal”是 TUI 主动补做的行为：通用的 turn abort hook 只结算进度，并不会天然把任意客户端的 interrupt 转成 Paused。

模型侧只有三个工具：

```text
get_goal()
create_goal(objective, token_budget?)
update_goal(status: "complete" | "blocked")
```

`update_goal` 的 JSON schema 只允许 `complete` 与 `blocked`，handler 还会进行第二次检查。因此模型不能借这个工具自行 pause、resume、clear，也不能把目标标记为 usage-limited 或 budget-limited。这些动作由用户界面、App Server 客户端或 runtime 系统路径管理。

`create_goal` 也有持久层约束：如果当前 thread 已有未完成 Goal，插入会失败。SQL 只允许覆盖状态为 `complete` 的旧记录。一个容易混淆的细节是，`BudgetLimited` 虽属于 `is_terminal()`，却仍不满足 `create_goal` 的直接覆盖条件。

这种分面并不是为了让 App Server “权力更大”，而是为了让不同主体只拿到完成工作所需的控制面。模型需要报告成功或真实阻塞，所以得到 Complete、Blocked；用户需要随时收回执行权，所以 TUI 拥有 Pause、Resume、Clear；runtime 能观测预算与服务错误，所以由系统写入 BudgetLimited、UsageLimited。App Server 是这些客户端与 runtime 共用的协议入口，本身并不等价于某一种用户身份。

## 5. 哪些权限是硬边界，哪些只是模型约束

读 Agent 工具定义时，必须区分 schema/handler 能强制的规则与写在 description 里的行为要求。

下面这些是硬边界：

- `update_goal` 的参数枚举只有 Complete 和 Blocked，handler 还会拒绝其他状态。
- `thread_id` 主键保证一个 thread 只有一条当前记录。
- `create_goal` 不能静默替换未完成 Goal。
- objective、token budget 会经过格式和上限校验。

下面这些目前主要是软约束：

- “只有用户或系统明确要求时才能创建 Goal”写在工具说明里，handler 无法从一次函数调用证明此前是否真的获得授权。
- “同一阻塞连续三轮后才能标记 Blocked”也是工具说明，不存在持久化的三轮计数器，handler 只验证最终状态值。
- “有充分证据才能 Complete”依赖模型遵循审计提示，并没有独立 verifier 在数据库写入前裁决证据质量。

这不意味着软约束没有价值。模型会读取工具说明，它们是行为策略的重要组成部分；但做安全分析时，不能把 prompt 文案当成 runtime invariant。

## 6. `expected_goal_id`：有条件的 stale-update 防护

考虑一个典型竞态：turn 读取到 Goal A，用户随后清除 A 并创建 Goal B，旧 turn 的异步结果最后才返回。如果更新语句只按 `thread_id` 写入，它可能把 B 错标为 Complete。

`GoalStore::update_thread_goal` 为此提供可选的 `expected_goal_id`。传入它后，SQL 条件相当于：

```sql
UPDATE thread_goals
SET status = ?
WHERE thread_id = ?
  AND goal_id = ?;
```

当前外部 Goal API 的读后写、runtime 的错误收尾，以及 token/time 记账快照都会携带预期 Goal 身份。仓库测试也覆盖了“旧 goal_id 的更新返回 None，不能修改替代 Goal”的情况。

这类保护的本质是比较后更新：调用方先记住读取时的身份，写入时声明“只有当前仍是它才执行”。如果受影响行数为零，调用方得到的是未更新结果，而不是悄悄把条件退化为只按 thread 写入。它特别适合 usage accounting，因为工具完成钩子和 turn 收尾可能晚于目标替换发生；快照中的 `expected_goal_id` 能避免把旧 turn 的 token 与耗时记到新目标。

但它不是全局自动生效的 CAS。模型 `update_goal` 最终调用 `update_thread_goal` 时，当前代码传的是 `expected_goal_id: None`。而且 `goal_id` 本身也不向模型暴露。因此准确结论是：

> GoalStore 提供 goal-id 条件更新，若干关键 runtime/API 路径使用了它；当前实现不能被概括为“所有迟到更新都必然不会覆盖新 Goal”。

更完整的并发控制还包括 per-thread semaphore、进度结算锁，以及从读取 Goal 到 `start_turn_if_idle` 的临界区。这些会留到下一期讨论。

## 7. 从这套设计得到什么

Goal persistence 的价值不只是“多存一张表”。它把三个过去容易混在 prompt 里的概念拆开了：

```text
objective  = 要完成什么
status     = 当前为何继续或停止
authority  = 谁可以触发生命周期变化
```

单 thread 单行让当前完成契约保持唯一；六态把暂停、受阻、额度不足、预算耗尽和成功完成分开；模型工具与 App Server 控制面的差异，则避免 Agent 拥有全部生命周期权限。

同时，源码也提醒我们不要过度解读这些抽象：terminal 不等于永远不可修改，三轮 Blocked 不是数据库约束，`expected_goal_id` 也不是覆盖所有路径的万能锁。真正可靠的 Agent Runtime，需要同时说明“设计意图”和“代码实际强制了什么”。

## 本期边界

本期只讨论 Goal 的持久化结构、状态语义与权限边界，没有展开以下问题：

- thread idle 后如何触发下一轮 continuation；
- token 与 wall-clock usage 如何结算；
- budget 触线时怎样阻止继续消耗；
- Goal state lock、accounting semaphore 与 `start_turn_if_idle` 如何协作。

这些内容将在[下一期：Idle 续跑、预算记账与并发边界](/posts/codex-goal-mode-3-runtime-continuation-budget/)中继续。

## 源码索引与参考资料

- [`state/src/sqlite.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/state/src/sqlite.rs#L29-L73)：`goals_1.sqlite` 与独立 goals DB 配置。
- [`state/goals_migrations/0001_thread_goals.sql`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/state/goals_migrations/0001_thread_goals.sql)：当前 `thread_goals` schema 与六态约束。
- [`state/src/model/thread_goal.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/state/src/model/thread_goal.rs#L12-L71)：内部 Goal model、`goal_id` 与 `is_terminal()`。
- [`protocol/src/protocol.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/protocol/src/protocol.rs#L3807-L3847)：对模型与事件暴露的状态及 Goal 字段。
- [`ext/goal/src/spec.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/spec.rs)：三个模型工具的 schema 与行为说明。
- [`ext/goal/src/tool.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/tool.rs#L185-L298)：模型工具 handler 与状态写入。
- [`ext/goal/src/api.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/ext/goal/src/api.rs#L131-L328)：App Server 使用的 Goal service 与外部变更路径。
- [`state/src/runtime/goals.rs`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/state/src/runtime/goals.rs#L20-L418)：单行写入、状态更新及 `expected_goal_id` 条件。

系列导航：[← 上一期：它不是更长的 Prompt](/posts/codex-goal-mode-1-agent-loop-contract/) ｜ [下一期：Idle 续跑、预算记账与并发边界 →](/posts/codex-goal-mode-3-runtime-continuation-budget/)
