---
title: "Pi 加冕之路：EventStream 实时事件通信机制"
slug: pi-event-stream
date: 2026-08-07 16:52:00
updated: 2026-08-07 16:52:00
categories:
  - "工程实践"
  - "Agent 系统"
tags:
  - "Agent"
  - "TypeScript"
  - "EventStream"
  - "异步编程"
  - "pi"
cover: /images/posts/astraflow-cover.webp
description: "解析 pi 的 EventStream 异步事件队列，理解 agent 循环与 TUI 之间的实时事件通信。"
---

解析 pi 的 EventStream 异步事件队列，理解 agent 循环与 TUI 之间的实时事件通信。

<!-- more -->

这一部分解析 pi 的异步事件队列——循环和 TUI 之间的"取号排队系统"。

**三个角色：**

```
生产者 = 厨房/循环（做好一份菜就放到取餐台，喊一个号）消费者 = 顾客/TUI（等叫号，叫到就去取）EventStream = 取号排队系统（管理"谁在等"和"哪些菜还没人取"）
```

EventStream 自己不做菜也不吃菜——它管两件事：菜做好了没人取就存着（queue），顾客来了没菜就让他等着叫号（waiting）。

**完整对应表：**

```
顾客         = 消费者（TUI）菜           = event（事件对象，比如 { type: "turn_start" }）号           = resolve（叫号时调它，顾客就醒了去取菜）取餐台       = queue 数组（菜放这里等人来取）叫号本       = waiting 数组（号码存这里等菜来喊）顾客来了没菜 → 领个号坐下等      = this.waiting.push(resolve)厨房出菜     → 喊号             = waiter({ value: event, done: false })顾客听到号   → 去取菜            = await 醒了，拿到 eventdone: false  = 餐厅还在营业，后面还会出菜（for await 继续等下一道）done: true   = 餐厅打烊了，没菜了（for await 退出循环）
```

**对应到代码：**

```
// 生产者：循环往 EventStream 里放事件void runAgentLoopContinue(context, config, async (event) => {    stream.push(event);  // ← 厨房出菜，放到取餐台});// 消费者：TUI 从 EventStream 里取事件for await (const event of stream) {  // ← 顾客等叫号，叫到就取    if (event.type === "turn_start")     显示转圈动画();    if (event.type === "message_update") 追加文字到屏幕();    if (event.type === "agent_end")      停止动画();}// EventStream 自己：不生产事件，也不消费事件// 只管"有人放就存着，有人取就给它，没人取就等着"
```

上一篇《Pi的加冕之路：循环之外的调度机制》 讲的 steering/followUp 队列是**普通数组**——循环每轮主动去查一次。本章节讲的 EventStream 是**异步队列**——消费者不用主动查，有事件时自动被唤醒。两者解决不同问题：

-   steering/followUp：循环和用户输入之间的通信（可以等一轮再看）
-   EventStream：循环和 TUI 之间的通信（必须实时通知，不能等）

## EventStream vs 普通数组的选择

好，角色认清了。但你可能会问：为什么不直接用普通数组？上一篇的 steering 队列不就是普通数组吗，也能通信啊？

区别在"实时性"——pi 里两种"容器"各有分工：

|  | 普通数组 | EventStream |
| :-- | :-- | :-- |
| 用在哪 | newMessages, steeringQueue, followUpQueue | agent 事件流（给 TUI） |
| 读取方式 | 主动查（drain / shift / 循环结束后一次性拿） | 被动等（for await，有事件自动醒） |
| 为什么选它 | 不需要实时通知，定时查就够 | 需要实时通知 TUI 渲染 |

**经验法则：** 如果消费者能接受"等一会儿再看"→ 普通数组。如果消费者必须"一来就知道"→ EventStream。

* * *

## EventStream 完整解析

知道了"为什么要用"，现在来看"怎么实现的"。整个实现只有 67 行（`packages/ai/src/utils/event-stream.ts`），我们一步步拆。

### 为什么不能用普通数组

先搞清楚问题：循环和 TUI 是两段独立运行的代码——循环在不停地调 LLM、执行工具，TUI 在不停地渲染屏幕。它们需要一个通信管道。普通数组为什么不行？

```
普通数组：  push → 数据进去了  但没人通知消费者"有新数据"  消费者要么一直检查（忙等，烧 CPU），要么等跑完EventStream（取号排队系统）：  厨房出菜（push）→ 有顾客在等叫号？直接喊号，顾客取走                  → 没人叫号？菜放取餐台上（queue），等顾客来  顾客来取（for-await）→ 取餐台有菜？直接拿走                       → 没菜？领个号坐着等（waiting），厨房出菜时喊你
```

### 前提：JS 单线程 + 事件循环

好，取号系统的比喻到此为止——接下来得理解一个关键前提，否则后面的代码会看不懂。

**`await` 只停当前函数，不停整个程序。** 如果整个程序都停了，谁来调 push？没人——所以 await 必须只停自己。

用取号的例子走一遍：

```
t0: 顾客来了，取餐台没菜    → 顾客领个号坐下（this.waiting.push(resolve)）    → 顾客开始刷手机等着（await，这个函数暂停）    注意！只有顾客停了，餐厅没停。    厨房还在炒菜——JS 引擎去执行其他代码了。t1: 厨房炒好了一道菜    → stream.push(event) 被调用    → 取出顾客的号（this.waiting.shift()）    → 喊号（调 resolve，把事件传进去）t2: 顾客听到喊号    → await 结束，拿到事件    → 继续执行后面的代码（yield result.value）
```

对应到代码：

```
// 顾客来了，没菜——坐下等：const result = await new Promise(resolve => {    this.waiting.push(resolve);});// ← 函数停在这行。但 JS 引擎去干别的了（跑循环的代码）。// ... 厨房出菜，调了 stream.push(event)，里面调了 resolve ...// 顾客被叫醒，继续执行：yield result.value;  // ← 从这里恢复
```

"让出控制权"就是这个意思：**我不跑了，你们继续，有人叫我再回来。**

两个前提条件：

-   **事件循环**：await 让出控制权后，别的代码（push）才有机会跑
-   **Promise 机制**：能把"等"和"通知"分到不同代码路径（下面有例子）

理解了"await 只停自己"之后，下一个问题来了：那个被停住的函数，怎么知道什么时候该醒？答案是 Promise 的 resolve。先看一个最小例子：

```
let 叫醒他: (msg: string) => void;  // 先声明，还没赋值// ─── 消费者 ───async function 等消息() {    const msg = await new Promise<string>(resolve => {        叫醒他 = resolve;  // 把 resolve 存到外面的变量里        // await 在这里睡着了    });    console.log("收到：", msg);  // 醒了之后执行}// ─── 生产者（3 秒后调用）───setTimeout(() => {    叫醒他("你好");  // 调 resolve → 消费者的 await 醒了 → 打印"收到：你好"}, 3000);等消息();  // 启动消费者
```

看到了吗？消费者把 resolve 存起来，3 秒后生产者来调它——消费者就醒了。EventStream 做的事和这个一模一样，只是换了两个地方。对照着看：

```
// ═══ 最小例子 ═══// 存 resolve 的地方：一个变量let 叫醒他 = resolve;// 通知的方式：setTimeout 3 秒后调setTimeout(() => {    叫醒他("你好");}, 3000);// ═══ EventStream ═══// 存 resolve 的地方：一个数组（因为可能有多个消费者排队等）this.waiting.push(resolve);// 通知的方式：循环调 stream.push(event) 时push(event) {    const waiter = this.waiting.shift();  // 从数组里取出第一个 resolve    waiter({ value: event, done: false }); // 调它，消费者就醒了}
```

变量变数组，setTimeout 变 stream.push——原理没变，只是支持了"多人排队"。

**`waiter` 就是 `resolve`，就是同一个函数：**

```
t0: new Promise 自动造了一个函数    ↓ 参数名叫 resolve    ↓ this.waiting.push(resolve)   ← 存进数组t1: stream.push(event) 被调用    ↓ const waiter = this.waiting.shift()   ← 从数组取出来，变量名叫 waiter    ↓ waiter(...)   ← 调它 = 调 resolve = await 醒了
```

同一个函数，存的时候叫 `resolve`，取的时候叫 `waiter`。名字不同，东西是同一个。

### 核心机制：两个数组，互斥排队

好，最小例子理解了、waiter 和 resolve 的关系理解了。现在可以看 EventStream 内部的完整逻辑了。

它内部有两个数组，**永远不会同时有东西**：

```
queue[]    → 事件排队的地方（事件来了但没人取）waiting[]  → 消费者排队的地方（消费者来了但没有事件）
```

为什么不会同时有东西？因为只要两边都有，就会立刻配对消掉：

```
queue 有事件 + waiting 有消费者 → 不可能！消费者会直接从 queue 取走queue 有事件 + waiting 空       → 事件在排队，等消费者来queue 空    + waiting 有消费者  → 消费者在排队，等事件来queue 空    + waiting 空       → 大家都没事干
```

**两种时序，走不同分支：**

```
时序A：事件先到，消费者后到─────────────────────────────t0: stream.push(event)    → 看 waiting：空的（没有消费者在等）    → 事件存进 queuet1: 消费者 for-await 来取    → 看 queue：有货！    → 直接 queue.shift() 取走，不用等时序B：消费者先到，事件后到─────────────────────────────t0: 消费者 for-await 来取    → 看 queue：空的    → 消费者没东西可取，怎么办？    → 造一个 Promise，把 resolve 存进 waiting，然后 await（睡着）    → waiting 里现在有一个 resolve 函数t1: stream.push(event)    → 看 waiting：有东西！（有消费者的 resolve 在排队）    → 取出 resolve，调用它，把 event 传进去    → 消费者的 await 醒了，拿到 event    → 事件没进 queue，直接交付
```

**`waiting` 里存的到底是什么？**

当消费者来取事件但 queue 为空时，它做了这件事：

```
// 消费者（asyncIterator 里）：const result = await new Promise<IteratorResult<T>>(resolve => {//                                                  ↑ new Promise 自动造的函数//                                                    调它一次 → await 就醒    this.waiting.push(resolve);//                    ↑ 把这个函数存进 waiting 数组//                      相当于消费者留了一张"通知单"：//                      "有事件了请调这个函数叫醒我"});// 执行到 await 就停在这了——直到有人调 resolve
```

**生产者 `stream.push(event)` 做的事：**

```
push(event: T): void {    const waiter = this.waiting.shift();    //    ↑ 从 waiting 里取出第一个 resolve（消费者留的"通知单"）    if (waiter) {        waiter({ value: event, done: false });        // ↑ 调用 resolve，把事件传进去        //   消费者的 await 醒了，result = { value: event, done: false }    } else {        this.queue.push(event);        // 没有消费者在等 → 事件存进 queue    }}
```

**一句话总结：**`waiting` 是消费者留的"叫醒我"通知单列表。生产者来了看列表——有人等就叫醒它、把事件给它；没人等就把事件存进 queue。

* * *

### 两个 push 的区别

代码里出现了两个 push，名字一样但完全不同：

```
this.waiting.push(resolve)   → Array.push（JS 原生）：往数组里加一个元素stream.push(event)           → EventStream.push（自己写的方法）：放入事件 + 可能唤醒消费者
```

`EventStream.push` 内部会检查 `waiting` 数组并可能调用 `Array.shift`（取出 resolve）。两者是不同层级的东西。

* * *

### Promise 在这里的角色

**经典 Promise 用法——等 I/O 完成：**

```
const data = await fetch("https://api.example.com");// fetch 内部会在响应回来时自动调 resolve// 你不用管"谁来 resolve"，系统帮你做了
```

**EventStream 的用法——等另一段代码通知：**

```
const result = await new Promise(resolve => {    this.waiting.push(resolve);  // 不是等 I/O，是等"另一段代码来调我"});// 没有 I/O 会自动 resolve 它// 只有 stream.push() 被调用时，里面手动调 resolve，这里才会醒
```

区别：经典用法里 resolve 被系统自动调用；EventStream 里 resolve 被**你自己的另一段代码**手动调用。这就把 Promise 从"等 I/O"变成了"等通知"——一种代码之间的通信工具。

* * *

### `IteratorResult<T>` 是什么

JS/TS 内置的类型，不需要 import，全局可用。就两种状态：

```
// TS 标准库里自带的定义（你不用写）：type IteratorResult<T> =    | { value: T, done: false }      // 有东西给你    | { value: undefined, done: true } // 没了，结束// 对应到 EventStream：// 正常 push 事件时：waiter({ value: event, done: false });    // 告诉消费者"有东西"// end() 关闭流时：waiter({ value: undefined, done: true }); // 告诉消费者"没了"
```

消费者通过 `result.done` 判断：醒了之后是有事件可用，还是流结束了该退出。

`Promise<IteratorResult<T>>` 的泛型决定了 resolve 只能接受这种格式：

```
resolve({ value: event, done: false })   ✓resolve("hello")                          ✗  类型不对
```

### 完整源码（带注释）

前面一点点拆解完了。现在把整个 EventStream 类放在一起看——你应该能认出每一行了：

```
// packages/ai/src/utils/event-stream.tsclass EventStream<T, R = T> implements AsyncIterable<T> {    private queue: T[] = [];    // queue：存还没被取走的事件（缓冲区）    // 生产者 push 快于消费者取时，多余的存在这里    private waiting: ((value: IteratorResult<T>) => void)[] = [];    // waiting：存正在等事件的消费者的 resolve（唤醒按钮）    private done = false;    // 两处变 true：push 终结事件时 / 外部调 end() 时    private isComplete: (event: T) => boolean;    // 判断"这个事件是不是终结事件"的函数（创建时传入）    // 具体：(event) => event.type === "agent_end"    private extractResult: (event: T) => R;    // 从终结事件里提取最终结果的函数（创建时传入）    // 具体：(event) => event.type === "agent_end" ? event.messages : []    // ─── 构造方法 ───    constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {        this.isComplete = isComplete;        this.extractResult = extractResult;        // 还创建了一个 Promise，用于 stream.result() 返回最终结果        // （消费者可以 await stream.result() 拿到循环跑完后的 messages）    }    // 例：createAgentStream() 里传的是：    //   isComplete = (event) => event.type === "agent_end"    //   extractResult = (event) => event.messages    push(event: T): void {        if (this.done) return;                        // 已结束，不再接受        if (this.isComplete(event)) {            this.done = true;                         // 终结事件（如 agent_end）        }        const waiter = this.waiting.shift();          // 有人在等吗？        if (waiter) {            waiter({ value: event, done: false });    // 有 → 直接给它（按按钮，唤醒 await）            // 事件没经过 queue，直接从生产者到消费者——零延迟        } else {            this.queue.push(event);                   // 没有 → 存进队列等取            // 消费者可能正忙着渲染上一个事件，还没来取下一个        }    }    end(result?: R): void {        this.done = true;                             // 手动关闭        while (this.waiting.length > 0) {             // 唤醒所有等着的消费者            this.waiting.shift()!({ value: undefined, done: true });  // 告诉它们"没了"        }    }    async *[Symbol.asyncIterator]() {    // async * = 异步生成器（能暂停 + 能等待的函数）    // [Symbol.asyncIterator] = JS 协议，有了它就能 for await    // yield = "给消费者一个值，暂停等它下次来取"        while (true) {            if (this.queue.length > 0) {                yield this.queue.shift()!;            // 队列有货 → 直接给            } else if (this.done) {                return;                               // 结束了 → 退出            } else {                // 队列空了 → 造一个 Promise，把 resolve 存起来，睡着                const result = await new Promise<IteratorResult<T>>(resolve =>                    this.waiting.push(resolve)                    // 存进 waiting → await 挂起（不烧 CPU）                    // 直到 push() 从 waiting 取出 resolve 并调用它                );                if (result.done) return;              // 被唤醒但告知"没了" → 退出                yield result.value;                   // 被唤醒且有事件 → 给消费者            }        }    }}
```

### 使用方式（pi 实际代码）

源码看完了。最后看看 pi 实际是怎么用 EventStream 的——把它和循环、TUI 连起来。

上一篇《Pi的加冕之路：循环之外的调度机制》 讲过循环需要一个 `emit` 函数参数。这个 emit 的具体实现取决于谁在调循环：

-   `Agent.prompt()` 路径：emit = `(event) => this.processEvents(event)`（广播给 listener）
-   `agentLoopContinue()` 路径：emit = `async (event) => stream.push(event)`（推进 EventStream）

**第一种路径里的 listener 是谁？** 在 pi CLI 里只有一个主要的——`AgentSession._handleAgentEvent`：

```
循环 emit(event)  → Agent.processEvents(event)    → 更新 Agent._state（内存里的对话状态）    → 调 listener = AgentSession._handleAgentEvent      → 扩展系统收到事件（你的 pi.on("message_end", ...) 等钩子）      → TUI 收到事件（渲染打字机效果、转圈动画）      → SessionManager 写 .jsonl（持久化到磁盘）
```

关于 Session 和 SessionManager 的持久化机制（对话怎么存盘、怎么恢复、怎么分支），后续篇章会展开。

下面展示的是第二种路径——直接用 EventStream 接收事件（SDK 场景）：

```
// ─── 生产者（循环）───// agent-loop.ts 第 145 行，用工厂函数创建 stream：function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {    return new EventStream(        (event) => event.type === "agent_end",                        // 参数1：判断终结事件        (event) => (event.type === "agent_end" ? event.messages : []), // 参数2：从终结事件提取最终结果    );}const stream = createAgentStream();void runAgentLoopContinue(context, config, async (event) => {    stream.push(event);  // 循环每发生一件事就 push}).then((messages) => {    stream.end(messages);  // 循环跑完了，关闭 stream});// ─── 消费者（TUI）───for await (const event of stream) {    if (event.type === "turn_start")     显示转圈动画();    if (event.type === "message_update") 追加文字到屏幕();    if (event.type === "agent_end")      停止动画();}// for await 退出 → stream 已关闭
```

`for await` 和普通 `for...of` 的区别：

```
// 普通 for...of（同步，值已经在那了）：for (const x of [1, 2, 3]) { ... }// for await（异步，值可能还没来）：for await (const event of stream) {    // 有事件 → 处理    // 没事件 → 自动 await 等，不用你写等待逻辑}
```

### 时间线

把上面所有东西串起来，看一次完整的事件从生产到消费的全过程：

```
循环(生产者)           stream(队列)          TUI(消费者)    |                     |                    |    | push(turn_start) →  |                    |    |                     | ← for-await 取走   |    |                     |                    | 显示转圈    | push(text_delta) →  |                    |    |                     | ← for-await 取走   |    |                     |                    | 追加文字    | push(agent_end) →   |                    |    |                     | ← for-await 取走   |    |                     |                    | 停止动画    |                     |          for-await 退出循环
```

关键：循环 push 不会被 TUI 的渲染速度拖慢。TUI 慢了，事件堆在 queue 里；TUI 快了，它就在 await 里等着。

### done 什么时候变 true

最后一个问题：餐厅什么时候打烊？也就是 `for await` 什么时候退出循环？

两种方式：

1.  **自动**：push 了一个"终结事件"。创建 EventStream 时传入判断函数：
    
    ```
    new EventStream(    (event) => event.type === "agent_end",  // ← 这个事件标志结束);// push({ type: "agent_end" }) 时 → isComplete 返回 true → done = true// 之后消费者的 for-await 取完最后一个事件后退出
    ```
    
2.  **手动**：外部调 `stream.end()`。pi 里在 `runAgentLoopContinue` 跑完后调用：
    
    ```
    void runAgentLoopContinue(...).then((messages) => {    stream.end(messages);  // 循环跑完了，关闭 stream});
    ```
    

* * *
