---
title: "Pi 的诗意 Harness：Session 与 Context 的记忆与遗忘"
slug: pi-harness-session-context
date: 2026-08-18 20:30:00
updated: 2026-08-19 14:30:00
categories:
  - "工程实践"
  - "Agent 系统"
tags:
  - "Agent"
  - "Session"
  - "Context"
  - "持久化"
  - "pi"
cover: /images/posts/astraflow-cover.webp
description: "解析 pi 的 AgentSession、树形会话存储和 Context 构建，理解 agent 的记忆、分支与遗忘机制。"
---

解析 pi 的 AgentSession、树形会话存储和 Context 构建，理解 agent 的记忆、分支与遗忘机制。

<!-- more -->

> 一席终有散，万念自留痕：Session 与 Context 的记忆与遗忘

## 0\. Harness：循环外面那台"整车"

前面几篇里见过的 `agent-loop.ts` 是一台裸发动机——只会转，不知道对话怎么存盘、上下文太长了怎么办、system prompt 从哪来。那谁把这些事管起来？

pi 在 `packages/agent/src/harness/` 目录下提供了一层叫 **AgentHarness** 的封装：

```
agent-loop（裸发动机）    ↑ 只认 context，闷头转harness/（整台车）    ├── agent-harness.ts    — 主类，协调下面所有模块    ├── session/            — 对话持久化（存盘、恢复、分支）    ├── compaction/         — 上下文压缩（太长时自动摘要）    ├── system-prompt.ts    — system prompt 动态拼装    ├── tools/              — 默认工具实现（read/write/edit/bash）    └── env/                — 文件系统抽象（可替换为虚拟 fs）
```

Harness 的英文原义是"马具"——把马（循环）套上缰绳和方向盘，让人能骑。`npm install @earendil-works/pi-agent-core` 之后，你直接用 `AgentHarness` 就能跑一个完整 agent，不用自己写 session 管理或压缩逻辑。它是 SDK 给第三方开发者的"开箱即用套装"。

**但 coding-agent（你正在用的 CLI）没有用 harness。** 它在 `packages/coding-agent/src/core/` 下自己实现了一套更复杂的版本——`AgentSession`。为什么？因为 CLI 产品有额外需求：TUI 渲染、权限弹窗、扩展系统、模型热切换。这些 harness 覆盖不了。

两套方案的关系：

| 对比维度 | Harness（agent 包） | AgentSession（coding-agent 包） |
| :-- | :-- | :-- |
| 面向谁 | SDK 用户（第三方嵌入） | CLI 终端用户 |
| 复杂度 | 够用就行（~1000 行） | 产品级（~3000 行） |
| 工具实现 | 通过 `env` 抽象，可替换 | 直接调 fs，带权限和 TUI |
| 扩展系统 | 无 | 完整的事件钩子和插件机制 |

这篇接下来讲的是 coding-agent 的 `AgentSession`——但每个概念（持久化、压缩、system prompt 拼装）在 harness 里都有对应的简化版。如果你想读更简单的参考实现，harness 是更好的入口。

* * *

## 1\. AgentSession：循环的管家

前面追调用链时见过 `AgentSession.prompt()` 是"前台接待"——做一堆预处理再把消息转交给 Agent。但 session 的职责远不止接待。它是 `coding-agent` 包里的**中枢协调者**——把 `agent` 包的通用循环和具体的编程助手产品缝在一起。

看它管什么：

```
// agent-session.ts 里 AgentSession 的核心职责（简化）class AgentSession {    // ─── 身份 ───    private _sessionManager: SessionManager;    // 持久化层    private _agent: Agent;                      // agent 包的通用引擎驱动器（不是循环本身）    private _extensionRunner: ExtensionRunner;  // 扩展系统    // ─── 配置 ───    private _model: Model;                      // 当前模型    private _thinkingLevel: string;             // 推理深度    private _tools: AgentTool[];                // 七件套 + 扩展工具    // ─── 状态 ───    private _isStreaming: boolean;              // agent 正在忙吗？    private _steeringQueue: AgentMessage[];     // 中途插话队列    private _followUpQueue: AgentMessage[];     // 散会追加队列}
```

### 先把 `_agent: Agent` 这一行说清楚

第 99 行那个 `Agent`，最容易误读成"`Agent` 就是那个循环"。不是。**循环是函数，`Agent` 是类**，两者在 `packages/agent` 里是分开的两个文件：

```
agent-loop.ts  →  runAgentLoop() / runLoop()    自由函数，无状态agent.ts       →  class Agent                   类，有状态
```

`runLoop` 无状态的意思很实在：给它一个 context，它转到停，返回，然后**什么都不记得**。可一次会话里 `runLoop` 会被调很多次——用户每发一次话就是一次。谁在这些调用之间把东西记住？`Agent`。

它是一个**长命对象**，身上挂三类东西：

```
// agent.ts，class Agent（简化）class Agent {    private _state: {                    // ① 状态，跨多次 runLoop 存活        systemPrompt: string;        messages: AgentMessage[];        // 循环跑完，新消息回写到这里        model: Model;        tools: AgentTool[];    };    private readonly steeringQueue: PendingMessageQueue;   // ② 两个插话队列    private readonly followUpQueue: PendingMessageQueue;    private activeRun: ... | null;       // ③ "正在跑"的牌子，防止同时开两个循环}
```

用户调 `agent.prompt("读一下 package.json")`，`Agent` 内部依次做：把字符串转成 `AgentMessage[]` → 从 `_state` 切一份浅拷贝当 context（就是本文后面会看到的 `createContextSnapshot()`）→ 把自己身上的属性组装成 `config` → 调 `runAgentLoop` → 循环跑完，通过事件把新消息回写进 `_state.messages`。

所以三层关系是这样，注意每一层跨过去时"知道的东西"都在变少：

```
AgentSession   (pi-coding-agent)  知道文件、权限、扩展、持久化、TUI     ↓ this.agent.prompt(messages)         ← 跨包：从产品层进引擎层Agent          (pi-agent-core)    只知道 messages / tools / 队列 / 状态     ↓ runAgentLoop(...) → runLoop(...)runLoop        (pi-agent-core)    只知道这一次的 context 和一组回调
```

两个"管家"挡的是不同的东西：`AgentSession` 挡**产品关注点**（compaction、扩展钩子、权限确认），`Agent` 挡**调度关注点**（队列、重入保护、状态在多次 run 之间的延续）。第 99 行的意思因此是：session 持有一个通用引擎的驱动器，自己把编程助手那套逻辑处理干净，再交给它去开循环。

session 做的事，一句话：**把"编程助手"这个产品的所有具体关注点（持久化、扩展、模型选择、权限检查）挡在循环外面，只给循环一个干净的 context 和一组它不知道实现的回调。**

### "挡在外面"具体什么意思？

用 mini-pi 对比就清楚了。mini-pi 的循环**直接碰一切**——模型写死在循环里、API key 从环境变量来、messages 数组在内存里关掉就没了：

```
// mini-pi：循环既是引擎又是底盘又是方向盘const model = getModel("anthropic", "claude-sonnet-4-6");  // 模型写死const context = { messages: [...], tools: [...] };          // 内存里，关掉就没while (true) {    const message = await complete(model, context);         // 直接调 API    // ...执行工具（直接 readFileSync）    // ...结果 push 进 context}// 进程退出，所有对话历史消失
```

pi 的循环拿到的是**两个参数**，先看清它们的分工——这是整个分层的机制所在：

```
// agent-loop.ts 里的 runLoop：async function runLoop(context, config, ...) {    // context = 数据，往里传。循环读它、往 messages 里 push、拿它去调 LLM    //   { systemPrompt: "...", messages: [...], tools: [...] }    //    // config  = 回调 + 少量配置，往外调。循环在预定时刻回头问外面    //   beforeToolCall / afterToolCall      ← 工具调用前后问一声    //   transformContext / convertToLlm     ← 发给 LLM 前改写    //   getSteeringMessages / getFollowUp   ← 有人插话吗？    //   prepareNextTurn / shouldStopAfterTurn ← 下一轮换模型吗？该停了吗？    //   model / toolExecution / reasoning   ← 纯配置，直接读}
```

关键在于：`config` 里那些函数，循环**只知道签名，不知道实现**。拿 `getSteeringMessages` 走一遍，两边的代码摆在一起就清楚了：

```
// 循环这边（agent-loop.ts）——它只会这一句：let pendingMessages = (await config.getSteeringMessages?.()) || [];//                           ↑ 知道"调这个能拿回一批消息"，仅此而已// Agent 这边（agent.ts，createLoopConfig 方法）——填实现：return {    model: this._state.model,    getSteeringMessages: async () => this.steeringQueue.drain(),    //                               ↑ 箭头函数，this 锁死在 Agent 实例上    getFollowUpMessages: async () => this.followUpQueue.drain(),    // ... 其他回调};
```

循环不知道背后是 `PendingMessageQueue`、是普通数组、还是从 Redis 拉的——换掉右边这行实现，循环一个字不用改。`beforeToolCall` 同理：循环知道"调工具前先问一声、可能被拒"，不知道那背后是权限确认弹窗加一整条扩展链。

这就是**依赖倒置**——循环定义口子，外面填实现。所以"挡在外面"分两种走法：

```
用户按回车  │  ↓ ① 循环启动前就处理完，成品塞进 context：  │  - 从 .jsonl 读历史 → context.messages         ← 持久化  │  - 上下文太长？压缩旧消息 → context.messages   ← compaction  │  - CLAUDE.md + 技能 + cwd → context.systemPrompt ← 动态构建  │  循环看到的是结果，全然不知过程  │  ↓ ② 循环每轮回头问，答案由 config 的回调给：  │  - config.beforeToolCall()   → 扩展/权限说 allow 还是 block  │  - config.prepareNextTurn()  → 用户中途换模型了吗  │  - config.getSteeringMessages() → 有人插话吗  │  循环知道该在哪问，不知道谁在答  │  ↓ runLoop() 闷头转
```

一句话收束：**循环只认一个 context 和一组它不知道实现的回调。** 前者是数据边界，后者是行为边界——产品的复杂性要么在边界之前被消化成数据，要么被藏在回调背后。

**好处：循环可以复用。** 你想做一个不是"编程助手"的 agent——比如客服机器人——你用同一个 `runLoop`，只是 `context` 换成从数据库读的历史加客服话术、`config.beforeToolCall` 换成你自己的风控逻辑、工具换成查订单接口。循环一行不改。

现在可以把三个角色摆到一张表里收束了。注意**三列而不是两列**——`Agent` 和 `runLoop` 是两个不同的东西，前面那节讲的就是这件事，混成一列是最容易懵的地方：

| 对比维度 | `runLoop`（函数） | `Agent`（类） | `AgentSession`（类） |
| :-- | :-- | :-- | :-- |
| 住在哪 | `packages/agent`<br>`agent-loop.ts` | `packages/agent`<br>`agent.ts` | `packages/coding-agent`<br>`agent-session.ts` |
| 知道什么 | 这一次的 context、一组回调签名 | messages、tools、两个插话队列、谁在跑 | 文件系统、终端、API key、扩展、用户偏好 |
| 不知道什么 | 消息从哪来、回调背后是谁 | 什么是"文件"、什么是"bash" | 循环内部怎么转 |
| 有没有状态 | 无——跑完什么都不记得 | 有——`_state` 跨多次 run 存活 | 有——整个会话的完整历史树 |
| 活多久 | 一次 run（跑到停就没了） | 整个进程（会开很多次 run） | 整个会话，可能跨天（存在磁盘上） |
| 对 context 的态度 | 收一个快照，往里 push，用完就扔 | 持有 `_state`，每次 run 切一份快照给循环 | 拥有完整历史树，按需拍平成线性快照 |

从右往左读是"知道的越来越少"，从左往右读是"活得越来越久"。这两个方向刚好相反，就是分层的全部：**越靠内的东西越无知、越短命，因此越可复用。**

三者的传递关系用一句话串起来：

```
AgentSession 拥有历史树 ──拍平──▶ Agent 持有 _state ──切快照──▶ runLoop 转一次就扔
```

这个分层是 pi 架构里我觉得最值得抄的设计——`runLoop` 是可复用的引擎，`Agent` 是让引擎能连着开好几次的驱动器，`AgentSession` 是把整套东西装进"编程助手"这个具体车型的底盘。

* * *

## 2\. Session 持久化：追加式树形存储

### 为什么不是普通数组？

最直觉的做法是把对话存成一个 JSON 数组——`[msg1, msg2, msg3, ...]`。问题来了：用户说"刚才那个方向不对，我要从第 3 轮重新来"。数组怎么办？删掉后面的？那旧分支就没了。保留两个数组？三个？

pi 的解法：**把对话存成一棵树。** 每条消息是一个节点，有 `id` 和 `parentId`。"从第 3 轮分叉"就是从第 3 个节点长出一条新分支——旧分支还在。

### 磁盘格式：JSONL

文件住在 `.pi/sessions/` 目录下，每个 session 一个文件：

```
.pi/sessions/2026-06-14T10-23-01_abc123.jsonl
```

格式是 JSONL\[1\]——每行一个独立的 JSON 对象，追加写入（append-only）。为什么选 JSONL 而不是一整个 JSON 文件？因为追加操作是**原子的**——写一行要么成功要么没有，不存在"写到一半断电文件损坏"的中间态。

看一个真实文件长什么样：

```
{"type":"session","version":3,"id":"abc123","cwd":"/Users/you/project","timestamp":"2026-06-14T10:23:01"}{"type":"message","id":"entry_001","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"读一下 package.json"}],"timestamp":1718345678000}}{"type":"message","id":"entry_002","parentId":"entry_001","message":{"role":"assistant","content":[{"type":"text","text":"我来帮你读取..."},{"type":"toolCall","id":"toolu_01ABC","name":"read","arguments":{"path":"package.json"}}],"stopReason":"toolUse"}}{"type":"message","id":"entry_003","parentId":"entry_002","message":{"role":"toolResult","toolCallId":"toolu_01ABC","content":[{"type":"text","text":"{\"name\":\"my-project\"}"}],"isError":false}}{"type":"message","id":"entry_004","parentId":"entry_003","message":{"role":"assistant","content":[{"type":"text","text":"项目名字是 my-project。"}],"stopReason":"stop"}}
```

每一行都有 `id` 和 `parentId`，形成一条链。session 还记着一个 `leafId`——当前分支的末端。

### 分支怎么工作

```
entry_001 (user: "读 package.json")  └── entry_002 (assistant: toolCall read)       └── entry_003 (toolResult)            └── entry_004 (assistant: "项目名字是...")  ← leafId 原来指这里                 └── entry_005 (user: "帮我改名字")     ← 分支 A            └── entry_006 (user: "现在看看依赖")        ← 分支 B（用户"回退"后新开的方向）
```

用户说"回到第 3 轮"时，pi 做的事：

1.  把 `leafId` 指向 `entry_003`
2.  用户的新输入变成 `entry_006`，`parentId` 指向 `entry_003`
3.  `leafId` 更新为 `entry_006`

旧分支（entry\_004 → entry\_005）还静静躺在文件里——**文件只追加，永不删改**。分支不是通过删除实现的，而是通过移动 `leafId` 指针。

这个设计的好处：

-   **安全**——永远不丢数据。写坏了大不了丢最后一行。
-   **可审计**——完整的操作历史，包括被放弃的方向。
-   **简单**——读的时候从 leaf 往根走就行，不需要理解全树。

### `/tree`：这棵树的方向盘

上面讲的"移动 `leafId`"听起来是个内部机制，其实它有一个直接暴露给你的入口——**`/tree` 命令**。这可能是 pi 最被低估的功能：树形存储的全部价值，都是通过它兑现的。

在 pi 里敲 `/tree`，弹出的就是当前会话那棵树：

```
├─ user: "Hello, can you help..."│  └─ assistant: "Of course! I can..."│     ├─ user: "Let's try approach A..."│     │  └─ assistant: "For approach A..."│     │     └─ user: "That worked..."  ← active│     └─ user: "Actually, approach B..."│        └─ assistant: "For approach B..."
```

上下键选，回车跳过去，然后从那个点继续——**不新建文件，两条分支都留在同一个 session 里**。这就是 `leafId` 指针在 UI 上的样子：你在界面上"回退"，底层就是把那个指针挪个位置，旧分支一个字节都没动。

按键、过滤模式、以及它和 `/fork`、`/clone` 的分工，属于使用手册的范畴，sessions.md\[2\] 里写得很全。这里只留一条和存储机制直接相关的：切走一条分支时 pi 会问你要不要给放弃的那条做个摘要——选了就写一条 `branchSummary` entry 挂在新位置上（就是下面那张类型表里的一行）。这样你换到分支 B 之后模型仍知道"A 试过什么"，而不必把 A 的全部消息重放一遍。

### entry 的类型不止消息

除了 `message` 类型，JSONL 里还会出现：

| type | 干什么 | 例子 |
| :-- | :-- | :-- |
| `message` | 对话消息 | user / assistant / toolResult |
| `compaction` | 压缩摘要（后面会讲） | 替换掉的旧消息的摘要 |
| `modelChange` | 用户中途换了模型 | "从 Sonnet 换到 Opus" |
| `thinkingLevelChange` | 用户改了推理深度 | "从 medium 改到 high" |
| `label` | 书签 | 用户给某个时刻起了名字 |
| `branchSummary` | 被放弃的分支的摘要 | "之前那个方向试了什么" |
| `custom` | 扩展数据（不参与 LLM） | 扩展私有状态 |
| `customMessage` | 扩展数据（参与 LLM） | 扩展注入的消息 |

关键区分：`custom` 存了但**不会**出现在发给模型的 messages 里；`customMessage` 存了**且会**出现。这让扩展既能持久化自己的状态，又能决定模型该不该看到它。

最后两行光看表格太抽象，各给一个真例子。

**`custom`——扩展的私有记事本。** 场景：你写了个索引扩展，启动时扫了 17 个文件建了个符号表。这个"扫过什么"的状态得存下来，不然重开会话又得扫一遍；但模型完全不需要看到 `{count: 17}` 这种簿记数据。写它用 `pi.appendEntry()`：

```
pi.appendEntry("my-state", { count: 42 });// 重开会话时把状态捞回来pi.on("session_start", async (_event, ctx) => {  for (const entry of ctx.sessionManager.getEntries()) {    if (entry.type === "custom" && entry.customType === "my-state") {      // 从 entry.data 重建你的内存状态    }  }});
```

落到 JSONL 里就是一行（`customType` 是你的扩展身份标识，重载时靠它认领自己的 entry）：

```
{"type":"custom","id":"h8i9j0k1","parentId":"g7h8i9j0","timestamp":"2024-12-03T14:20:00.000Z","customType":"my-extension","data":{"count":42}}
```

**`customMessage`——扩展替用户说的话。** 场景：扩展系统那类插件，比如检测到 context 快满了，想插一句"当前上下文已用 85%，考虑收尾"给模型看——这句话必须进 LLM context，否则模型不知道。写它用 `pi.sendMessage()`：

```
pi.sendMessage({  customType: "my-extension",  content: "Message text",  display: true,          // true = 在 TUI 里也显示出来，false = 只给模型看，界面上不出现  details: { ... },       // 扩展自己的元数据，这部分不发给 LLM}, {  deliverAs: "steer",     // 流式中排队，本轮工具跑完、下次调 LLM 前送达  triggerTurn: true,      // agent 空闲时立刻触发一次回应});
```

对应的 JSONL 行（注意 `content` 字段——这就是会被拍进 messages 数组的那部分）：

```
{"type":"custom_message","id":"i9j0k1l2","parentId":"h8i9j0k1","timestamp":"2024-12-03T14:25:00.000Z","customType":"my-extension","content":"Injected context...","display":true}
```

`deliverAs` 三档决定这句话什么时候送到，正好对应上面刚讲的两个队列（第三档不进队列）：

| `deliverAs` | 什么时候送达 | 进哪个队列 |
| :-- | :-- | :-- |
| `"steer"`（默认） | 当前 assistant 轮次的工具跑完、下次调 LLM 前 | steering |
| `"followUp"` | 等 agent 彻底闲下来（没有待执行工具） | follow-up |
| `"nextTurn"` | 挂到下一次用户提问，不打断、不触发任何东西 | 都不进 |

一句话记住这对兄弟：**`appendEntry` 是写给自己看的，`sendMessage` 是写给模型看的。** 两者都落盘、都在树上占一个节点、都能活过重启——区别只在 `buildSessionContext()` 拍平这棵树时，会不会把它捡进 messages 数组。

### 懒持久化

一个有意思的细节：session 文件不是用户一按回车就创建的。pi 推迟到**第一条 assistant 消息到达时**才写文件（session-manager.ts 第 910 行\[3\]）。

为什么？因为用户可能按了回车又立刻按 Esc 取消。如果每次都创建文件，`.pi/sessions/` 目录会塞满空壳。等确认模型真的在回答了，再落盘——避免了垃圾文件。

* * *

## 3\. 从磁盘到上下文：buildSessionContext

文件里躺着一棵树。循环需要的是一个线性的消息数组。谁来做这个转换？

`buildSessionContext()`（session-manager.ts 第 325 行\[3\]）：

```
export function buildSessionContext(    entries: SessionEntry[],    leafId?: string | null,    byId?: Map<string, SessionEntry>,): SessionContext
```

算法分三步：

**第一步：从叶到根回溯，拿到当前分支的路径。**

```
// 伪代码const path: SessionEntry[] = [];let current = byId.get(leafId);while (current) {    path.unshift(current);        // 从后往前插，保持时间顺序    current = byId.get(current.parentId);}// path 现在是 [root, ..., leaf]，就是当前分支的完整链路
```

这步之后，不在当前分支上的 entry（其他分支的节点）全部被丢弃——循环不需要看它们。

**第二步：沿路径提取配置。**

路径上可能有 `modelChange` 和 `thinkingLevelChange` 类型的 entry。每遇到一个就更新当前配置——最后一个生效的就是当前设置。

**第三步：处理 compaction（如果有的话）。**

如果路径上有 `compaction` 类型的 entry，说明更早的消息已经被压缩过了。此时：

```
返回的 messages = [compaction 摘要消息] + [compaction 之后保留的消息]
```

如果没有 compaction entry，返回路径上所有 `message` 类型 entry 的消息，按时间顺序排列。

返回值：

```
interface SessionContext {    messages: AgentMessage[];       // 线性的消息数组，可以直接交给循环    thinkingLevel: string;          // 当前推理深度    model: { ... } | null;          // 当前模型（如果中途换过）}
```

从这里到循环还有一步。`Agent.createContextSnapshot()` 把 session context 的 messages 和当前的 tools、system prompt 组装成最终的 `AgentContext`：

```
// agent.tsprivate createContextSnapshot(): AgentContext {    return {        systemPrompt: this._state.systemPrompt,        messages: this._state.messages.slice(),   // 浅拷贝——循环不能改原件        tools: this._state.tools.slice(),    };}
```

`slice()` 是关键——循环会往 messages 里 push 新消息，但那是它自己的副本。session 拥有的原始数组不受影响。循环结束后，新消息通过事件机制回写到 session。

* * *

## 4\. Compaction：优雅地遗忘

### 问题

Claude 的上下文窗口是 200k tokens。一轮对话平均消耗多少 token？粗略估算：

-   用户消息：~50 tokens
-   assistant 消息：~200 tokens
-   工具调用 + 结果：~500–2000 tokens（读一个文件可能就几千）

跑个 20 轮带文件读取的对话，轻松吃掉 30k–50k tokens。跑 50 轮？100k。加上 system prompt 本身可能 10k+，上下文窗口的天花板很快就到了。

到了之后怎么办？两个选择：

-   **撞墙**：API 返回 `"error": "context_length_exceeded"`，循环死掉。
-   **主动遗忘**：在撞墙之前，把旧的对话摘要成一段短文，释放空间。

pi 选了后者。这就是 compaction。

### 触发条件

compaction.ts 第 219 行\[4\]：

```
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {    return contextTokens > contextWindow - settings.reserveTokens;}
```

三个数字：

-   `contextTokens` — 当前上下文占了多少 token
-   `contextWindow` — 模型的窗口大小（比如 200000）
-   `reserveTokens` — 留给回复的空间（默认 16384）

算一下：200000 - 16384 = 183616。当上下文超过 183616 tokens 时，触发压缩。

> **⚠️ 注意**
> 
> token 估算不是精确的。pi 优先用上一条 assistant 消息返回的 `usage.input`（API 告诉你这次请求用了多少 input tokens），只对这之后新增的消息用 `字符数 / 4` 的启发式估算。这意味着估算可能偏低——如果连续几轮全是大文件读取，实际 token 可能比估算多，留的 reserveTokens 余量就是保险。

### 切割算法

触发压缩后，需要决定：哪些消息压缩成摘要，哪些保留原文？

pi 的切割逻辑（`findCutPoint()`）：

1.  **从最新的消息往前走**，逐条累加 token 估算
2.  **累加到 `keepRecentTokens`（默认 20000）时停下**——这个位置就是切割点
3.  切割点必须落在**消息边界**上——不能切在工具调用和工具结果之间（那会让模型看到一个 toolCall 却没有对应的 toolResult，它会困惑）

```
消息数组：[msg1, msg2, msg3, ... msg15, msg16, msg17, msg18, msg19, msg20]                                    ↑ 切割点                    ┌───────────────┘                    │          要压缩的（→ 变成一段摘要）          保留原文的
```

### 压缩怎么做

切割完之后，pi **再调一次 LLM**——专门用来生成摘要。这次调用和平时的对话完全隔离：`cacheRetention: "none"`、临时生成一个新 `sessionId`（源码注释解释了为什么——摘要是一次独立请求，不该写进那份用不上的缓存里）。

发给摘要 LLM 的 prompt 是写死在源码里的常量 `SUMMARIZATION_PROMPT`，不是随手拼的。它长这样（原文照抄，摘自 compaction.ts\[4\]；我核对的是本机装的 0.84.2，那份里在第 467 行）：

```
The messages above are a conversation to summarize. Create a structuredcontext checkpoint summary that another LLM will use to continue the work.Use this EXACT format:## Goal[What is the user trying to accomplish? Can be multiple items if thesession covers different tasks.]## Constraints & Preferences- [Any constraints, preferences, or requirements mentioned by user]- [Or "(none)" if none were mentioned]## Progress### Done- [x] [Completed tasks/changes]### In Progress- [ ] [Current work]### Blocked- [Issues preventing progress, if any]## Key Decisions- **[Decision]**: [Brief rationale]## Next Steps1. [Ordered list of what should happen next]## Critical Context- [Any data, examples, or references needed to continue]- [Or "(none)" if not applicable]Keep each section concise. Preserve exact file paths, function names,and error messages.
```

这段 prompt 有几个地方值得逐一咂摸——它是全项目里 prompt engineering 密度最高的一处：

-   **第一句就点明读者是谁**："another LLM will use to continue the work"。摘要不是给人看的报告，是给下一个 LLM 用的交接文档。这句话决定了后面所有格式选择。
-   **`EXACT format` 全大写**，还给了每一节的填空说明。摘要要被机器稳定消费，格式漂移是灾难。
-   **`Progress` 分三档**（Done / In Progress / Blocked），用的还是 markdown 复选框 `- [x]` / `- [ ]`。为什么不写成一段话？因为"哪件事做完了、哪件事卡住了"是新 LLM 最需要一眼看清的东西。
-   **`- [Or "(none)" if none were mentioned]`** ——明确要求"没有就写 none"。留空会让下一个模型分不清"没约束"和"忘了写"。
-   **最后一句是全篇最要紧的**：`Preserve exact file paths, function names, and error messages.` 摘要的天性是抽象，而抽象恰恰会毁掉 agent 最需要的东西——`src/config.ts` 被概括成"配置文件"，模型就得重新去找一遍。这一句把"精确的字符串"从压缩里豁免出去。

配套的 system prompt（`SUMMARIZATION_SYSTEM_PROMPT`）只有三句，专治一个具体的失败模式：

```
You are a context summarization assistant. Your task is to read aconversation between a user and an AI assistant, then produce astructured summary following the exact format specified.Do NOT continue the conversation. Do NOT respond to any questions inthe conversation. ONLY output the structured summary.
```

后面那两个 `Do NOT` 是有来由的：你把一段对话原样塞给模型，它的本能是**接着往下聊**——尤其当历史最后一条是个问句时。为了同一个目的，pi 还在代码层面加了一道保险：`serializeConversation()` 把消息数组**拍平成纯文本**（`[User]: ...` / `[Assistant]: ...` 这种前缀行），再用 `<conversation>` 标签包起来当**一条 user 消息**发出去。模型收到的不是"一段待续的对话"，而是"一份要处理的资料"。

最终拼出来的 prompt 结构是：

```
<conversation>[User]: 帮我看看这个项目[Assistant]: read(path="package.json")...</conversation>[如果是第二次压缩，这里还有 <previous-summary>...</previous-summary>]The messages above are a conversation to summarize. ...（上面那段）
```

摘要 LLM 返回的结果被包装成一条 `compactionSummary` 类型的消息，替换掉原来的旧消息：

```
压缩前 context.messages（30 条，150k tokens）：  [user1, assistant1, toolResult1, user2, ..., user20, assistant20]压缩后 context.messages（12 条，25k tokens）：  [compactionSummary: "之前的对话中：用户要求分析项目架构...",   user16, assistant16, toolResult16, ..., user20, assistant20]
```

模型看到 `compactionSummary` 就知道"之前发生过什么"。不需要完整历史，摘要里有足够的上下文。

### 迭代压缩

如果对话特别长，压缩可能触发多次。第二次压缩时，messages 开头已经有一条旧的 `compactionSummary` 了。pi 不会"对摘要再摘要"——它会把新的信息**合并进**已有的摘要，而不是从头再来。这避免了多轮压缩后信息退化（像复印的复印，越来越模糊）。

机制很朴素：`generateSummary()` 里一个三元表达式，有旧摘要就换一套 prompt。

```
let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
```

第二套 prompt 干的是**增量更新**：旧摘要放进 `<previous-summary>` 标签，要求模型保留已有信息、把新消息里的进展加进去、完成的条目从 In Progress 挪到 Done——格式还是那六节，只是原地往前推一版。

### 文件操作追踪

压缩有个隐藏的坑：被压缩掉的轮次里，模型可能读过 / 改过一些文件。压缩之后模型看不到那些 toolResult 了——它怎么知道"我之前改过 `src/main.ts`"？

pi 的解法：压缩时记录被压缩轮次里的所有文件操作（读过哪些、改过哪些），存在 `CompactionDetails` 里：

```
interface CompactionDetails {    filesRead: string[];        // ["package.json", "src/main.ts", ...]    filesModified: string[];    // ["src/config.ts"]    tokensBefore: number;       // 压缩前多少 token    tokensAfter: number;        // 压缩后多少 token    firstKeptEntryId: string;   // 保留的消息从哪个 entry 开始}
```

摘要文本里会包含这些文件列表，确保模型在压缩后仍然知道"哪些文件是我之前碰过的"。

### 扩展可以介入 Compaction（但 Compaction 本身不依赖扩展）

pi 原生的 compaction 是内置功能——不装任何扩展也能正常工作。但扩展可以通过 `session_before_compact` 事件**介入**它：

```
pi.on("session_before_compact", async (event, ctx) => {    const { preparation, branchEntries, reason, signal } = event;    // 选择1：自己生成摘要（替代 pi 内置的 LLM 摘要）    return {        compaction: {            summary: "你自己生成的摘要...",            firstKeptEntryId: preparation.firstKeptEntryId,            tokensBefore: preparation.tokensBefore,        }    };    // 选择2：取消这次压缩（比如你觉得现在不该压）    return { cancel: true };    // 选择3：什么都不返回 → 走 pi 内置逻辑（安全降级）});
```

三种结果：

| 扩展返回什么 | 效果 |
| :-- | :-- |
| `{ compaction: { summary: "..." } }` | 用扩展的摘要，跳过内置 LLM 调用 |
| `{ cancel: true }` | 这次不压缩 |
| `undefined`（不返回） | 走 pi 内置逻辑，和没装扩展一样 |

**为什么要自定义？** **内置逻辑用当前模型做摘要——如果你用的是 Opus（$15/M），摘要本身就很贵。扩展可以换成 Haiku 做摘要，或者用本地规则提取关键信息，省钱又快。**

* * *

## 5\. System Prompt：每轮重建的“性格”

手写那个百来行的 mini-pi 时，system prompt 是一句写死的字符串。pi 的 system prompt 是**每轮开始前动态拼装的**——内容取决于当前环境。

干这件事的是 `buildSystemPrompt()`（system-prompt.ts 第 28 行\[5\]），它从头到尾就是在往一个字符串上 `+=`。下表按**它实际拼接的顺序**列出每一段——顺序不是装饰，模型读到的就是这个次序：

| 顺序 | 这一段是什么 | 内容长什么样 | 谁提供的 |
| :-- | :-- | :-- | :-- |
| ① | 基础指令 + 可用工具清单 + 行为准则 | `You are an expert coding assistant operating inside pi...`<br>后面跟 `Available tools:` （一行一个工具）和 `Guidelines:` （若干条准则） | 硬编码在 `system-prompt.ts` 里的模板字符串 |
| ② | 追加段（`appendSystemPrompt`） | 任意文本，扩展想写什么写什么 | 扩展的 `before_agent_start`，或命令行 `--append-system-prompt` |
| ③ | `<project_context>` 项目指令 | `<project_instructions path="CLAUDE.md">` 包住文件原文 | 磁盘上的 `CLAUDE.md` / `AGENTS.md` 等上下文文件 |
| ④ | 技能描述 | `.pi/skills/` 里每个技能的名字和用途 | 扫 `.pi/skills/` 目录得到；**只在 `read` 工具可用时才拼**（技能要靠模型自己去读文件） |
| ⑤ | `Current working directory: /Users/you/project` | 就这一行 | 调用方传进来的 `cwd` |

几个容易记错的点，对着表看一眼就清楚了：

-   **cwd 在最后，不在中间。** 系统提示的最后一行永远是当前目录。
-   **扩展的追加段在 CLAUDE.md 前面**（第 ② 段），不是最后。想让自己的规则压过 CLAUDE.md 的说法？位置上你压不过——后写的离模型更近。
-   **技能那一段可能整段不出现。** 条件是 `hasRead && skills.length > 0`。
-   还有一条岔路：调用方要是传了 `customPrompt`，第 ① 段被**整个替换**掉，②③④⑤ 照常往后拼。`pi --system-prompt "你只回答 SQL 问题"` 走的就是这条路。

**这就是你在项目根目录放 `CLAUDE.md` 的原理。** 不是魔法——第 ③ 段每轮调 LLM 前会读这个文件，把内容原样包在 `<project_instructions>` 标签里塞进 system prompt。模型因此"知道"你的项目用什么技术栈、有什么约定。

### 扩展注入的具体例子：emitBeforeAgentStart

上面那一格是怎么填上去的？在 `AgentSession.prompt()` 里——也就是你按下回车后、循环还没开始转的那一小段时间——有这么一步：

```
// agent-session.ts：用户消息已经入库，循环还没启动，先问一圈扩展const result = await this._extensionRunner.emitBeforeAgentStart(expandedText, ...);if (result?.systemPrompt) this.agent.state.systemPrompt = result.systemPrompt;
```

时机是关键：这一行发生在**用户消息已经写进 session、但 `runLoop` 还没被调用**的空档里。所以扩展改掉的 `systemPrompt`，正好赶上这一轮的第一次 LLM 请求；改晚一步（循环已经开始）就只能等下一轮了。

`emitBeforeAgentStart` 给所有注册了 `before_agent_start` 事件的扩展一个机会。返回值有两个字段（extensions.md 的 before\_agent\_start 一节\[6\]）：

-   `systemPrompt` — 替换这一轮的 system prompt
-   `message` — 注入一条 custom message（存进 session、发给 LLM），字段是 `customType` / `content` / `display`

> **⚠️ 注意**
> 
> 下面两段代码是**我为了讲解写的示例，不是 pi 自带的功能**——`.pi/extensions/` 目录默认是空的，你不放文件进去，pi 什么额外的事都不做。想让它们生效，得自己把文件创建在 `~/.pi/agent/extensions/`（全局，所有项目生效）或项目根的 `.pi/extensions/`（只对这个项目生效）；项目级的那份还要等项目被 trust 之后才加载。放好后 `/reload` 热加载，或者临时试一下用 `pi -e ./inject-git-status.ts`。
> 
> pi **自带**的例子在装好的包里：`examples/extensions/` 下有四十来个可直接跑的文件，`claude-rules.ts` 就是一个正经的 `before_agent_start` 实现（扫 `.claude/rules/` 把规则清单拼进 system prompt）。下面第二段代码就是照它的写法改的。

**场景 1：每次对话开始时自动注入 git 状态。** 用户不需要说"我在哪个分支"——扩展替他说了：

```
// 你自己创建：.pi/extensions/inject-git-status.tsimport type { ExtensionAPI } from "@earendil-works/pi-coding-agent";export default function (pi: ExtensionAPI) {    pi.on("before_agent_start", async (_event, ctx) => {        // 注意 exec 的签名：命令和参数分开传，不是一整个字符串        const branch = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd });        const dirty = await pi.exec("git", ["diff", "--name-only"], { cwd: ctx.cwd });        return {            message: {                customType: "git-status",                content:                    `当前分支: ${branch.stdout.trim()}` +                    (dirty.stdout ? `\n未提交的文件:\n${dirty.stdout}` : ""),                display: true,      // 界面上也显示出来；false 就只给模型看            },        };    });}
```

模型每次启动时都能看到 git 状态。这就是上一节讲的 `custom_message`——它进 LLM 上下文，也留在 JSONL 里。

**场景 2：检测到 Rust 项目时追加 Rust 规则到 system prompt：**

```
// 你自己创建：.pi/extensions/rust-mode.tsimport * as fs from "node:fs";import * as path from "node:path";import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";export default function (pi: ExtensionAPI) {    pi.on("before_agent_start", async (event, ctx) => {        if (!fs.existsSync(path.join(ctx.cwd, "Cargo.toml"))) return;  // 不是 Rust 项目，不改        return {            systemPrompt:                event.systemPrompt +                "\n\n# Rust 项目额外规则\n" +                "- 改完代码后运行 `cargo clippy` 检查\n" +                "- 不要用 unwrap()，用 ? 或 expect() 带说明\n" +                "- 测试用 `cargo nextest run`",        };    });}
```

注意它是**拼接**（`event.systemPrompt + ...`）而不是覆盖——把 Rust 规则追加到已有 system prompt 后面。如果你返回一个全新的字符串而忘了带原有内容，前面表里 ①～⑤ 那几段就全丢了。

**多个扩展都注册了 `before_agent_start`？** 按注册顺序跑，**链式**处理——`event.systemPrompt` 这个字段的官方说明就是"包含前面几个 handler 改过的结果"，所以你拿到的不一定是 pi 原装的那份，可能已经被别的扩展加过料了。这和 `beforeToolCall` 的安检通道逻辑一样。区别是：`beforeToolCall` 是拦截（block/pass），`before_agent_start` 是注入（往 context 里加东西）。一个是门卫，一个是后勤——在循环开始前把补给送到位。

### 为什么每轮重建

为什么**每轮重建**而不是只在 session 开始时建一次？

-   用户可能中途改了 `CLAUDE.md`
-   用户可能切换了模型（不同模型的 system prompt 可能不同）
-   扩展可能在运行中动态注入新内容
-   工具列表可能在运行中变化（某些工具只在特定条件下启用）

重建的开销很低——读几个文件、拼几段字符串。比起一次 LLM 调用的延迟（1-3 秒），这点时间可以忽略。

> **💬 闲话**
> 
> pi  的 system prompt 在生产环境里通常有 8000–15000 tokens。对比 mini-pi 那一行字符串的 ~30  tokens——这也是"玩具"和"产品"之间的一个典型差距。那些额外的 token  买的是：更精确的行为（减少模型犯蠢的概率）和项目级的上下文感知。

* * *

## 6\. 两阶段消息变换：transformContext → convertToLlm

拆循环源码时提过，调 LLM 前有两步预处理。现在我们知道 session 和压缩是怎么回事了，可以把完整的管道画出来：

```
SessionManager (JSONL on disk)       │       ↓ buildSessionContext()       │AgentMessage[]  ← 这是 pi 内部的消息格式，可能包含自定义类型       │       ↓ transformContext()    ← 第一阶段：在 AgentMessage 层面变换       │AgentMessage[]  ← 可能被扩展裁剪过、修改过、注入过       │       ↓ convertToLlm()       ← 第二阶段：转成 LLM 认识的格式       │Message[]       ← 只有 user / assistant / toolResult，没有自定义类型       │       ↓ HTTP POST       │  LLM API
```

**第一阶段 `transformContext`** — 在 AgentMessage 层面操作。谁实现它？**扩展链。** coding-agent 把这个钩子接到扩展运行器：

```
// sdk.ts 第 351 行transformContext: async (messages) => {    const runner = extensionRunnerRef.current;    if (!runner) return messages;    return runner.emitContext(messages);},
```

扩展运行器里，所有注册了 `context` 事件的扩展**按顺序**跑一遍，每个都拿到前一个的输出：

```
// runner.ts 第 914 行async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {    let currentMessages = structuredClone(messages);  // 深拷贝！防止扩展互相踩    for (const ext of this.extensions) {        const handlers = ext.handlers.get("context");        for (const handler of handlers) {            const event = { type: "context", messages: currentMessages };            const result = await handler(event, ctx);            if (result?.messages) {                currentMessages = result.messages;            }        }    }    return currentMessages;}
```

注意 `structuredClone`——深拷贝。每个扩展拿到的是一份独立的副本，改了不会影响别人。这和 `validateToolArguments` 里的 `structuredClone` 是同一个思路：对不可信代码（扩展可以是任何人写的），先拷贝再交出去。

**第二阶段 `convertToLlm`** — 把 `AgentMessage` 转成 LLM 认识的 `Message`。干什么？

-   过滤掉 LLM 不认识的自定义消息类型（通知、状态更新、扩展私有消息）
-   去掉 `timestamp` 等 LLM 不需要的字段
-   把内部的 `toolCall` / `toolResult` 格式转成具体 provider 的格式（Anthropic 叫 `tool_use` / `tool_result`，OpenAI 叫 `function_call` / `function`）

两阶段的分离让关注点正交：

-   `transformContext` 关心"哪些信息该给模型看"——**领域逻辑**
-   `convertToLlm` 关心"怎么把信息编码成 API 要的格式"——**协议适配**

改一个不用碰另一个。你想加一条"自动注入最近 git log"？写个扩展注册 `context` 事件。你想支持新的 LLM 提供商？改 `convertToLlm` 的实现。两件事互不干扰。

* * *

## 7\. 完整的上下文生命周期——一张图

把所有系统串起来：

```
用户打开 pi，继续昨天的 session  │  ↓ SessionManager.open(path)  │ 读 .jsonl 文件，解析所有 entry，找到 leafId  │  ↓ buildSessionContext(entries, leafId)  │ 从 leaf 往根回溯 → 线性 path  │ 提取 model/thinkingLevel 配置  │ 如果有 compaction entry → [摘要 + 后续消息]  │ 返回 SessionContext { messages, thinkingLevel, model }  │  ↓ buildSystemPrompt()  │ 基础指令 + 扩展追加段 + CLAUDE.md + 技能 + cwd  │  ↓ createContextSnapshot()  │ { systemPrompt, messages: [...], tools: [...] }  │  ↓ runAgentLoop(context, ...)  │  ├─→ 内层循环第一轮  │   ├─→ transformContext(messages) → 扩展链处理  │   ├─→ convertToLlm(messages) → 去掉自定义类型  │   ├─→ HTTP POST → Anthropic API  │   ├─→ 流式接收 → assistant 消息  │   ├─→ executeToolCalls → toolResult  │   ├─→ push 进 context.messages  │   └─→ 检查 steering → 继续  │  ├─→ 内层循环第 N 轮...  │  ↓ 循环结束  │  ↓ 新消息通过事件回写到 SessionManager  │ append 到 .jsonl 文件  │  ↓ 下一次 prompt() 时：  │ 检查 shouldCompact()  │ 如果 contextTokens > threshold → 触发压缩  │   ├─→ prepareCompaction() → 整理出压缩方案（含 findCutPoint 决定切哪里）  │   ├─→ generateSummary() → 拼 prompt、调 LLM 生成摘要  │   ├─→ 摘要作为 compaction entry 追加到 .jsonl  │   └─→ 下次 buildSessionContext 会用摘要替换旧消息  │  ↓ 重新 buildSessionContext → createContextSnapshot → runAgentLoop
```

**循环从不知道上面这些。** 它收到的永远是一个干净的 `{ systemPrompt, messages, tools }`——不管 messages 是 5 条还是经过压缩的 50 条，不管 systemPrompt 是怎么拼出来的。每一层只管自己的事，这是分层架构最朴素也最有力的好处。

* * *

## 接下来去哪

我也不知道.....
