---
title: "Pi 的加冕之路：循环之外的调度机制"
slug: pi-steering-followup-scheduling
date: 2026-08-05 19:22:00
updated: 2026-08-05 19:22:00
categories:
  - "工程实践"
  - "Agent 系统"
tags:
  - "Agent"
  - "TypeScript"
  - "LLM"
  - "调度"
  - "pi"
cover: /images/posts/astraflow-cover.webp
description: "解析 pi 的 steering 与 follow-up 队列，理解用户插话、任务追加和 agent 循环之外的调度机制。"
---

解析 pi 的 steering 与 follow-up 队列，理解用户插话、任务追加和 agent 循环之外的调度机制。

<!-- more -->

这一部分解析 pi 怎么让用户在 agent 干活时插话、以及在 agent 收工时追加任务。

pi 内部有两种"容器"做通信：steering/followUp 队列（本篇）是普通数组，循环**主动去查**；EventStream（下一篇《EventStream：异步事件队列》（敬请期待））是异步队列，消费者**被动等唤醒**。两者解决不同问题——先读哪个都行，但建议先读本篇 理解"循环怎么和外部交互"，再读 下一篇《EventStream：异步事件队列》（敬请期待） 理解"循环怎么通知 TUI"。

## 总览：三层关系

```
PendingMessageQueue（类，agent.ts 第 123 行）    ↑ 是什么：一个普通数组的包装类，提供 enqueue / drain 方法    │    ├── Agent.steeringQueue = new PendingMessageQueue(...)   // 实例1：steering 队列    └── Agent.followUpQueue = new PendingMessageQueue(...)   // 实例2：follow-up 队列              │              ↓ 包装成 config 传给循环    config.getSteeringMessages = () => this.steeringQueue.drain()    config.getFollowUpMessages = () => this.followUpQueue.drain()              │              ↓ 循环里调用    let pendingMessages = (await config.getSteeringMessages?.()) || [];
```

`PendingMessageQueue` 是类定义，`steeringQueue` 和 `followUpQueue` 是它的两个实例。

循环（agent-loop.ts）不直接碰这两个队列实例。它只认识 config 对象上的一个函数：`config.getSteeringMessages()`（config 是什么→见下面 config.getSteeringMessages 一节）。这个函数是 Agent 类提前写好的——内部调了 `this.steeringQueue.drain()`，但循环不知道里面是什么，它只管调、拿到数组就行。

```
Agent 类提前做的事：    config.getSteeringMessages = async () => this.steeringQueue.drain()    //                           ↑ 就是一个调了 drain 的函数循环里做的事：    const messages = await config.getSteeringMessages()    //              ↑ 循环只知道"调这个函数能拿到消息"    //                不知道也不关心背后是 PendingMessageQueue
```

* * *

## PendingMessageQueue：队列本尊

知道了三层关系，我们从最底层开始看——队列本尊长什么样。

```
// agent.ts 第 123 行class PendingMessageQueue {    private messages: AgentMessage[] = [];    enqueue(message) {        this.messages.push(message);      // 用户打字时往里存    }    drain(): AgentMessage[] {        const drained = this.messages.slice();  // 拷贝一份        this.messages = [];                      // 清空        return drained;                          // 返回    }}
```

就是一个普通数组的包装。不是 EventStream（下一篇《EventStream：异步事件队列》（敬请期待））那种异步队列——不需要"睡着等被唤醒"的机制，因为循环是**主动去查**的。两者的区别我们下一篇展开，敬请期待。

* * *

## Agent 类：队列的主人

队列本尊只是个数组包装——谁来创建它、谁往里塞消息、谁取走消息？全是 Agent 类的事。

`Agent` 类定义在 `packages/agent/src/agent.ts` 第 171 行。

**为什么需要这个类？** 因为 `runLoop` 是无状态的——你给它参数，它跑完就没了，不记得任何东西：

```
// runLoop：跑完 return，所有局部变量消失async function runLoop(context, newMessages, config, signal, emit, streamFn) {    // 不记得对话历史、不拥有队列、不持有模型配置    // 每次调用都要外面重新传一遍}
```

但 agent 产品需要在多次调用之间保持状态（对话历史、模型配置、steering/followUp 队列）。`Agent` 类就是那个"长命对象"，替你管这些：

```
没有 Agent 类时：    你自己管 messages 数组    你自己管 steering/followUp 队列    你自己每次组装 config    你自己调 runLoop    跑完后自己把新消息同步回来有 Agent 类时：    agent.prompt("读一下 package.json")  ← 一行搞定    Agent 内部帮你：      - 把 prompt 变成 message（normalizePromptInput）      - 从 _state 组装 context snapshot      - 从自己的属性组装 config（含 steeringQueue.drain）      - 调 runAgentLoop → 内部调 runLoop      - 跑完后通过事件把新消息同步回 _state.messages
```

一句话：**Agent = 一个长命对象，在 runLoop 的多次调用之间保持状态。**

**谁 new 它？**`coding-agent/src/core/sdk.ts` 第 294 行：

```
agent = new Agent({    initialState: { systemPrompt: "", model, thinkingLevel, tools: [] },    convertToLlm: convertToLlmWithBlockImages,    streamFn: async (model, context, options) => {        return modelRuntime.streamSimple(model, context, { ... });    },    transformContext: async (messages) => { ... },    beforeToolCall: ...,    afterToolCall: ...,    sessionId: sessionManager.getSessionId(),    steeringMode: settingsManager.getSteeringMode(),    followUpMode: settingsManager.getFollowUpMode(),});
```

**Agent 类内部（全在同一个类里）：**

```
// agent.ts 第 171 行class Agent {    private readonly steeringQueue: PendingMessageQueue;    private readonly followUpQueue: PendingMessageQueue;    // 第 224 行：构造函数——创建队列（带配置但内容为空）    // options.steeringMode 从用户设置读取（settingsManager.getSteeringMode()）    // ?? "one-at-a-time" = 没配就默认一次取一条    constructor(options) {        this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");        this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");    }    // "one-at-a-time" vs "all"：    //   "one-at-a-time" = 用户连打3条，每轮循环只取1条，分3轮处理    //   "all"           = 一次全取出来给模型    // 第 276 行：外部调这两个方法往队列里塞消息    steer(message)    { this.steeringQueue.enqueue(message); }    followUp(message) { this.followUpQueue.enqueue(message); }
```

**构造函数里的队列看起来"没用到"？** 因为创建和使用分散在不同时间点：

```
new Agent()                          → 创建两个空队列（构造时）    ... 用户提交 prompt ...agent.prompt() → runAgentLoop()      → 循环开始跑    ... 用户中途打字 ...agent.steer(message)                 → 往 steeringQueue 里 enqueue（运行中）    ... 循环某一轮结束 ...config.getSteeringMessages()         → steeringQueue.drain()（运行中取出来）
```

构造函数只是"造了个空柜子"，后面的 `steer()` 往里放东西，循环里的 `drain()` 把东西取走。三步分布在不同时刻。

* * *

## 调用链：从 prompt() 到 runLoop

Agent 类管了这么多东西，用户调一下 `agent.prompt()` 之后到底要穿过几层才能到达那个 while(true)？让我们数数看。

```
agent.prompt("读一下 package.json")        ← 输入是字符串    ↓ normalizePromptInput()               ← 转成 AgentMessage[]    ↓runPromptMessages(messages)                ← messages 已经是 AgentMessage[]    ↓runWithLifecycle(executor)    ↓runAgentLoop(messages, context, config, emit, signal, streamFn)    ↓runLoop(...)  ← 真正的 while(true) 循环
```

**每一层做什么（从外到内）：**

| 层 | 住在哪 | 职责 |
| :-- | :-- | :-- |
| `prompt()` | Agent 类 | 检查没在跑 + 把输入转成 AgentMessage |
| `runPromptMessages()` | Agent 类 | 把 Agent 身上的属性组装成参数 |
| `runWithLifecycle()` | Agent 类 | 管"同时只能跑一个"（见下面解释） |
| `runAgentLoop()` | agent-loop.ts | 发几个事件（agent\_start 等）然后调 runLoop |
| `runLoop()` | agent-loop.ts | 真正的 while(true) 循环 |

**`normalizePromptInput` 做了什么？**

`prompt()` 支持三种输入格式，这个函数统一转成 `AgentMessage[]`：

```
// 格式1：字符串（最常用）agent.prompt("读一下 package.json")→ [{ role: "user", content: [{ type: "text", text: "读一下 package.json" }], timestamp: 1722412800000 }]// 格式2：一条现成的 AgentMessageagent.prompt({ role: "user", content: [...], timestamp: ... })→ [那条消息]   // 直接包成数组// 格式3：多条 AgentMessage 的数组agent.prompt([msg1, msg2, msg3])→ [msg1, msg2, msg3]   // 原样返回
```

所以 `runPromptMessages(messages)` 收到的永远是 `AgentMessage[]`——不管你传给 `prompt()` 的是什么格式。

**`runPromptMessages` 做什么？**

把 Agent 实例上的属性拆下来，组装成 `runAgentLoop` 需要的 6 个参数：

```
// agent.ts 第 398 行private async runPromptMessages(messages, options) {    await this.runWithLifecycle(async (signal) => {        await runAgentLoop(            messages,                        // 用户的 prompt            this.createContextSnapshot(),    // 从 _state 拼出 { systemPrompt, messages, tools }            this.createLoopConfig(options),  // 从自身属性拼出 config（含 steeringQueue.drain）            (event) => this.processEvents(event),  // emit：把事件广播给订阅者            signal,                          // AbortSignal（runWithLifecycle 创建的）            this.streamFunction,             // 调哪家 LLM API 的函数        );    });}
```

它自己不包含任何循环逻辑——只是个**参数组装层**。

* * *

## activeRun：为什么同时只能跑一个

调用链里有个 `runWithLifecycle`——听名字很唬人，干的事很朴素：防止两个循环同时跑。

**`runWithLifecycle` 做什么？**

保证"同时只能有一个循环在跑"，以及循环结束后自动清理：

```
// agent.ts 第 471 行private async runWithLifecycle(executor) {    // 1. 创建 AbortController（用户按 Esc 时调 abort）    const abortController = new AbortController();    // 2. 设置 activeRun 标志（prompt() 检查这个来防止重入）    this.activeRun = { abortController, ... };    this._state.isStreaming = true;    try {        // 3. 执行传入的函数（里面调了 runAgentLoop）        await executor(abortController.signal);    } catch (error) {        // 4. 出错了 → 构造一条错误消息记录到历史        await this.handleRunFailure(error, ...);    } finally {        // 5. 不管成功还是失败：清除 activeRun、设 isStreaming=false        this.finishRun();    }}
```

用人话说：**进门挂"工作中"牌子 → 干活 → 出门摘牌子。** 别人看到牌子就知道不能再调 `prompt()`。

`runWithLifecycle` 开头设置 `this.activeRun = { ... }`（挂牌子），结束时 `finishRun()` 把它清掉（摘牌子）。`prompt()` 开头看这个牌子在不在：

```
// agent.ts 第 339 行async prompt(input) {    if (this.activeRun) {  // ← 牌子在 = 有循环正在跑        throw new Error("Agent is already processing a prompt. ...");        // 不让进！    }    // 牌子不在 → 可以进 → 走 runPromptMessages → runWithLifecycle 挂牌子}
```

**为什么不能同时跑两个？** Agent 只有一份 `_state.messages`。两个循环同时往里 push，对话历史就乱了。JS 虽然是单线程，但 `await` 会让出执行权——如果没有这个检查，理论上两段 async 代码可以交替操作同一个数组。

**那循环运行中用户想说话怎么办？** 用 `steer()` 或 `followUp()`——它们不启动新循环，只往队列里塞消息：

```
agent 正在跑时：    agent.prompt("再来一个")     → 抛异常！不能启动第二个循环    agent.steer("顺便看测试")    → 合法，塞进 steeringQueue，循环下一轮取到    agent.followUp("完了帮我改") → 合法，塞进 followUpQueue，循环结束前取到
```

* * *

## prompt / steer / followUp / continue 四个方法的分工

既然同时只能跑一个循环，那用户想插嘴怎么办？循环停了又想让它接着干怎么办？别急，四个方法各管一种场景。

| 方法 | 什么时候能调 | 干什么 |
| :-- | :-- | :-- |
| `prompt()` | 只能在 idle 时 | 启动新循环 |
| `steer()` | 随时 | 往正在跑的循环里插话 |
| `followUp()` | 随时 | 给正在跑的循环追加收尾任务 |
| `continue()` | 只能在 idle 时 | 循环已经停了，把它拉回来继续跑 |

* * *

## continue()：循环停了怎么拉回来

`steer` 和 `followUp` 是循环在跑时往里塞消息。但如果循环已经停了呢？消息躺在队列里，没人取——这时候就轮到 `continue()` 出场了。

**用一个时间线理解：**

```
t0: agent.prompt("检查 bug")    → 循环开始跑    → 模型读文件、分析、回复"发现2个bug"    → stopReason = "stop"，没有更多工具调用    → 循环结束，agent 变成 idlet1: 现在 agent 是 idle 的（没有循环在跑）    SDK 代码调了 agent.steer("顺便看安全漏洞")    → steeringQueue.enqueue(那条消息)    → 但没有循环在跑！没人会调 getSteeringMessages()！    → 这条消息就静静躺在队列里，永远不会被取走t2: agent.continue()    → continue() 发现 steeringQueue 里有货    → 取出来喂给循环    → agent 重新跑起来，处理那条消息
```

**`continue()` 存在的原因：** 有些消息是在循环结束*之后*才塞进队列的，这时候没有循环在跑去取它们。`continue()` 就是"重新启动循环，把队列里攒的东西处理掉"。

**如果没有 `continue()`：** 那些消息就永远不会被处理——除非用户再调一次 `prompt()`，但那语义上是"新对话"。

**什么时候用 `continue()` 而不是 `prompt()`？**

| 场景 | 用什么 |
| :-- | :-- |
| 用户输入了新的问题 | `prompt()` |
| SDK 代码在循环结束后追加任务，要让 agent 接着跑 | `continue()` |
| 循环被 abort 打断了，想恢复 | `continue()` |

在终端产品里（你用的 pi CLI），用户按回车走的是 `prompt()`。`continue()` 主要是给 SDK 开发者用的——比如写了一个自动化脚本，在 agent 完成一个任务后自动追加下一个。

**代码逻辑分两种情况：**

```
// agent.ts 第 350 行async continue(): Promise<void> {    const lastMessage = this._state.messages[this._state.messages.length - 1];    if (lastMessage.role === "assistant") {        // 情况1：循环正常结束过（最后是 assistant 消息）        // 看 steeringQueue 里有没有消息        const queuedSteering = this.steeringQueue.drain();        if (queuedSteering.length > 0) {            // 有 → 取出来当 prompts 喂给循环            await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });            return;        }        // steering 没有？看 followUp...        const queuedFollowUps = this.followUpQueue.drain();        if (queuedFollowUps.length > 0) {            await this.runPromptMessages(queuedFollowUps);            return;        }        // 都没有？那没事了    }    // 情况2：最后不是 assistant（比如是 toolResult——循环被中断了）    // 不需要新 prompt，让循环从当前位置继续跑    await this.runContinuation();}
```

**`skipInitialSteeringPoll: true` 为什么需要？（SDK 细节，可跳过）**

这只影响 SDK 开发者调 `continue()` 的场景。终端用户（pi CLI）不需要考虑——因为终端用户按回车走的是 `prompt()`，`prompt()` 不会提前 drain 队列，所以 runLoop 启动时正常 drain 就行，不存在"重复 drain"的问题。

问题：`continue()` 手动 drain 了队列，然后把消息当 prompts 传给 runAgentLoop。但 runLoop 启动时第一行又会调一次 `getSteeringMessages()`——如果不 skip，会重复 drain（队列已空）或在缝隙里取走新消息导致顺序乱。

```
continue() 内部：    步骤A: drain() → 取出 ["看安全漏洞"]    ← 中间有 await（createContextSnapshot 等）→    ← SDK 代码可能在这里又调了 steer("看下性能") →    步骤B: runLoop 启动 → getSteeringMessages()        不 skip → drain 取走 "看下性能" → 它可能在 "看安全漏洞" 之前被模型看到（顺序乱）        skip   → 返回 [] → "看下性能" 留着，下一轮正常取 → 顺序对
```

skip 的作用：让 runLoop 启动时跳过第一次 drain，避免和 `continue()` 的手动 drain 冲突。

* * *

## config.getSteeringMessages：循环怎么取队列

绕了一大圈，回到最初那个让人困惑的问题——循环里那行 `(await config.getSteeringMessages?.()) || []`，这个 config 到底是什么、从哪来的？现在我们知道了 Agent 类和队列的关系，谜底可以揭开了。

同一个 Agent 类里的 `createLoopConfig()` 方法（第 434 行）构建传给循环的 config 对象：

```
    // Agent 类里面，第 434 行    private createLoopConfig(options): AgentLoopConfig {        let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;        return {            model: this._state.model,            // ... 其他配置 ...            getSteeringMessages: async () => {            //                          ↑ 箭头函数：this 继承外层 = Agent 实例                if (skipInitialSteeringPoll) {                    skipInitialSteeringPoll = false;                    return [];  // 第一次调用时跳过（闭包捕获了这个变量）                }                return this.steeringQueue.drain();                //     ↑ this = Agent 实例，能访问它的 steeringQueue            },            getFollowUpMessages: async () => this.followUpQueue.drain(),        };    }}
```

**为什么用箭头函数 `() =>`：**

```
// 箭头函数版（pi 实际用的）：getSteeringMessages: async () => {    return this.steeringQueue.drain();    //     ↑ this = Agent 实例（定义时外层的 this，锁死了）}// 如果换成普通函数（会出 bug）：getSteeringMessages: async function() {    return this.steeringQueue.drain();    //     ↑ this = config 对象（因为调用时是 config.getSteeringMessages()）    //       config 上没有 steeringQueue → 报错 undefined}
```

```
普通函数：this = 谁调用了我（运行时决定）箭头函数：this = 我写在哪里（定义时锁死）
```

* * *

## 用户打字怎么进入队列

知道了循环怎么取，反过来看——用户手指敲下键盘的那一刻，字是怎么一步步走到 `steeringQueue.enqueue()` 的？

```
用户在终端打字（agent 正在干活时）    ↓TUI 捕获键盘输入    ↓AgentSession._queueSteer(text)     // coding-agent 层    ↓agent.steer({ role: "user", content: [...] })   // agent-core 层    ↓this.steeringQueue.enqueue(message)   // 就是 messages.push(message)
```

* * *

## 循环什么时候去查队列

消息乖乖躺在队列里了。那循环什么时候来取走它？

两个时机，用同一个 `drain()`：

**时机1：循环开始前（防漏）**

```
用户按回车启动 agent    ↓用户立刻又打了一行字 → enqueue 进 steeringQueue    ↓循环开始，第一行代码：let pendingMessages = (await config.getSteeringMessages?.()) || [];    ↓drain() → 拿到那行字    ↓注入 context，模型第一轮就能看到
```

这就是源码注释 "user may have typed while waiting" 的含义——循环启动前先摸一次，防止漏掉。

**时机2：每轮工具执行完后（常规）**

```
循环正在跑（模型在回复 / 工具在执行）    ↓用户中途打字 → enqueue 进 steeringQueue    ↓这一轮工具执行完后：pendingMessages = (await config.getSteeringMessages?.()) || [];    ↓drain() → 拿到那行字    ↓下一轮开头注入 context，模型能看到
```

* * *

## steering vs follow-up 的区别

两种队列用的是同一个 `PendingMessageQueue` 类，差别只在循环查它们的时机。

|  | steering | follow-up |
| :-- | :-- | :-- |
| 什么时候查 | 每轮工具执行完后 | 内层循环结束后（模型本来要散会时） |
| 效果 | 模型还在干活时插一句 | 模型刚要收工时追加新任务 |
| 类比 | 你在它干活时凑过去说"顺便也看下测试" | 它说"好了"的瞬间你递张纸条"还有一件事" |

两者用的是同一种 `PendingMessageQueue`，查的时机不同。

* * *

## "one-at-a-time" vs "all"

最后一个小细节：`drain()` 每次取几条出来？一把全拿还是一次拿一个？取决于创建队列时传入的模式。

`drain()` 的行为取决于创建队列时传入的模式：

```
drain(): AgentMessage[] {    if (this.mode === "all") {        const drained = this.messages.slice();  // 全取        this.messages = [];        return drained;    }    // "one-at-a-time"：只取第一条    const first = this.messages[0];    if (!first) return [];    this.messages = this.messages.slice(1);    return [first];}
```

| 模式 | 行为 | 适合场景 |
| :-- | :-- | :-- |
| `"one-at-a-time"` | 每轮只取 1 条，分多轮处理 | 消息之间有先后依赖或可能互相矛盾 |
| `"all"` | 一次全取出来给模型 | 消息是并列的，互不依赖 |

**例子——`"one-at-a-time"`（默认）：**

```
用户连打3条：  "改一下 main.ts"  "等等，先看测试"  "算了，还是先改 main.ts"第1轮取出："改一下 main.ts" → 模型开始改第2轮取出："等等，先看测试" → 模型转去看测试第3轮取出："算了，还是先改 main.ts" → 模型又回来改每条都能看到上一条的结果再决定下一步
```

**例子——`"all"`：**

```
用户连打3条：  "检查 auth 模块"  "检查 payment 模块"  "检查 logging 模块"一次性全部取出 → 模型同时看到3条指令，统一规划
```

**pi 默认两个队列都是 `"one-at-a-time"`** — 更安全。

## 下一篇预告

**《EventStream：异步事件队列》**——循环和 TUI 之间的实时通信机制。

本篇讲的 steering/followUp 队列是普通数组，循环主动去查。下一篇讲的 EventStream  是异步队列——消费者不用主动查，有事件时自动被唤醒。它用区区几十行代码实现了"不烧 CPU 的等待"，是 pi  里打字机效果、实时工具执行进度的底层基础。

敬请期待。
