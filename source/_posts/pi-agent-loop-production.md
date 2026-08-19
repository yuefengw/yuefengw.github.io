---
title: "读懂 Pi，你就是 AI 应用之王"
slug: pi-agent-loop-production
date: 2026-08-01 15:00:00
updated: 2026-08-01 15:00:00
categories:
  - "工程实践"
  - "Agent 系统"
tags:
  - "Agent"
  - "TypeScript"
  - "LLM"
  - "Agent Loop"
  - "Tool Calling"
  - "pi"
cover: /images/posts/astraflow-cover.webp
description: "逐段解析 pi 的 agent-loop.ts，理解双层循环、工具调用、流式响应和事件广播等生产级机制。"
---

逐段解析 pi 的 agent-loop.ts，理解双层循环、工具调用、流式响应和事件广播等生产级机制。

<!-- more -->

之前我们亲手写了 100 行的 mini-pi，理解了 agent 循环的骨架。这一部分我们不再写新代码——**直接打开 pi 的 `agent-loop.ts`\[1\]，逐段读它的生产级实现。**

你会发现你在 Part 1 写的每一行都有对应物，但 pi 在每个关键位置都多了一层保护。这些"多出来的"不是过度设计——它们是被真实用户的真实 bug 逼出来的。

## 这 743 行只做一件事

在拆任何零件之前，先理解整体：**agent-loop.ts 就是一个"对话推进器"**——它反复执行"问模型→执行工具→把结果喂回去→再问模型"这个循环，直到模型说"我没有工具要调了"为止。

它面对的所有复杂性，都来自**三个"如果"**：

1.  **如果模型瞎编怎么办？** → 三道关卡（prepareToolCall）在执行前拦截
2.  **如果用户中途插话怎么办？** → steering 队列让用户随时注入新指令
3.  **如果模型说完了但还有活儿怎么办？** → follow-up 队列把 agent 拉回来继续

其他所有东西——并行执行、流式响应、abort 信号、afterToolCall 改写、prepareNextTurn 换模型——都是在这个基本循环上的**保护层**和**优化层**。不是 8 个并列的模块，而是一个洋葱：

```
最内层：while 循环（问模型 → 执行工具 → 喂回去）     ← Part 1 你写的 mini-pi第二层：三道关卡 + 错误自愈                           ← 防止模型瞎编第三层：steering + follow-up                         ← 允许人类介入第四层：流式 + 并行 + abort                           ← 性能和体验优化最外层：prepareNextTurn + shouldStopAfterTurn         ← 生命周期管理
```

**从内往外读：** 每一层都是在前一层"够用但不够好"的基础上加的。你在 Part 1 写的 mini-pi 就是最内层——能跑，但模型瞎编你没辙、用户插不上话、工具一个一个串行等。pi 的 743 行就是把这四层保护一层一层包上去。

## 一次完整迭代的全景图

带着"洋葱"的心智模型，再看一轮完整的循环经过了哪些步骤——你会发现每个方框都属于某一层：

每个方框对应源码中一个明确的函数或代码段。下面我们按执行顺序逐个拆解。

* * *

## 1\. runLoop：双层 while 循环（第 155–269 行）

你在 mini-pi 里写的是一个 `while (true)`。pi 写了**两层**：

```
// 第 170 行起// pendingMessages —— 等待注入的消息（用户中途打的字）// 循环开始前先摸一次队列：用户可能在你启动 agent 的那一瞬间就打了字let pendingMessages = (await config.getSteeringMessages?.()) || [];// getSteeringMessages() 就是去摸"用户输入队列"——有就取出来，没有就返回空数组// ═══ 外层循环 ═══// 职责：处理 follow-up（agent 打算散会时追加的任务）while (true) {    // hasMoreToolCalls —— 内层循环用这个变量判断"模型是不是还在调工具"    // 初始设为 true 是为了让内层循环至少跑一次    let hasMoreToolCalls = true;    // ═══ 内层循环 ═══    // 职责：处理 tool calls + steering（用户中途插话）    // 条件：只要模型还在调工具 OR 有用户插话，就继续转    while (hasMoreToolCalls || pendingMessages.length > 0) {        // ... 一轮完整的流程：        //   1. 把 pendingMessages 注入 context（模型下次调用就能看到）        //   2. 调 LLM（streamAssistantResponse）        //   3. 检查返回的消息里有没有 toolCall        //   4. 有 → 执行工具：        //      - 如果所有工具都返回 terminate: true → hasMoreToolCalls = false（虽然有工具调用，但主动要求停）        //      - 否则 → hasMoreToolCalls = true → 循环继续        //      没有 → hasMoreToolCalls = false        //   5. 再摸一次 steering 队列 → 有新消息的话 pendingMessages 不为空 → 循环继续        pendingMessages = (await config.getSteeringMessages?.()) || [];    }    // 到这里说明内层循环结束了——没有 tool calls，也没有 pending messages    // 最后检查：有没有 follow-up 消息？    // getFollowUpMessages() 和 getSteeringMessages() 是两个不同的队列    const followUpMessages = (await config.getFollowUpMessages?.()) || [];    if (followUpMessages.length > 0) {        // 有后续任务 → 当作 pendingMessages 注入 → 重新进入内层循环        pendingMessages = followUpMessages;        continue;    }    break;  // 两个队列都空了，真的没事了，散会}
```

**为什么一层不够？** 因为有两种"继续"的理由，生命周期不同。在说理由之前，先解释两个你会在源码注释里频繁看到的英文词：

-   **Steering（转向）** = 用户在 agent 干活中途打进来的话。就像开车时扭方向盘——agent 正在读文件，你突然说"别管 test/ 目录"，这句话就叫 steering 消息。
-   **Follow-up（后续）** = agent 本来已经要收工了，但有人递了张纸条说"还有活儿"——不用重启，接着干。

现在看两层循环各管什么：

|  | 内层循环 | 外层循环 |
| :-- | :-- | :-- |
| 继续的理由 | 模型还在调工具 / 用户中途插了话（steering） | agent 本来要散会，但有后续任务（follow-up） |
| 什么时候检查 | 每轮 tool execution 之后 | 内层循环彻底结束之后 |
| 类比 | "资本家还在发指令，或有人凑过来说了一句" | "资本家说完了，但突然有人递了张纸条" |

内层条件 `hasMoreToolCalls || pendingMessages.length > 0` 的意思是：只要模型还在调工具（`hasMoreToolCalls`），**或者**用户在中途插了话（`pendingMessages`），就继续转。只留 `hasMoreToolCalls` 会丢掉"用户中途插话"的能力。

**`hasMoreToolCalls` 的赋值比你想的更微妙。** 看实际代码（第 206–210 行）：

```
hasMoreToolCalls = false;  // 先假设没有if (toolCalls.length > 0) {    const executedToolBatch = await executeToolCalls(...);    toolResults.push(...executedToolBatch.messages);    hasMoreToolCalls = !executedToolBatch.terminate;  // 关键：有工具调用，但全部 terminate → 仍然是 false}
```

不是"有 tool call → hasMoreToolCalls = true"这么简单。如果一批工具调用里**所有**工具都返回了 `terminate: true`，`executedToolBatch.terminate` 为 `true`，`hasMoreToolCalls` 就是 `false`——虽然模型确实调了工具，但工具们主动要求"到此为止"。

对比你的 mini-pi：

```
// mini-pi：只有一层，只看 stopReasonwhile (true) {    ...    if (message.stopReason !== "toolUse") break;    ...}
```

你的版本在 `stopReason !== "toolUse"` 时立刻散会——中途没法插话，散会后也没法续命。pi 的双层结构让两种"继续"各有自己的入口。

* * *

## 2\. prepareToolCall：执行之前的三道关卡（第 562–626 行）

mini-pi 里工具执行就一行：`runTool(call.name, call.arguments)`——信任模型给的一切。pi 在执行之前过了**三道关**。

`prepareToolCall` 返回两种结果，用 `kind` 字段区分：

```
// 情况 1：关卡没过——结果立刻就有了（错误消息），不需要真正执行工具{ kind: "immediate", result: createErrorToolResult("Tool xxx not found"), isError: true }// 情况 2：三关全过——准备好了，等着后面真正执行 tool.execute(){ kind: "prepared", toolCall, tool, args: validatedArgs }
```

`immediate` = "立即有结果"（跳过执行），`prepared` = "准备好了"（等待执行）。下游代码根据 `kind` 分流：

```
const preparation = await prepareToolCall(...);if (preparation.kind === "immediate") {    // 已经有结果了（错误）→ 直接用，跳过执行    finalized = preparation;} else {    // kind === "prepared" → 真正去调 tool.execute()    const executed = await executePreparedToolCall(preparation, signal, emit);    ...}
```

现在看图里的两条路径——左边三个 ❌ 都走 `immediate`（当场返回错误），只有右边 ✓ 走 `prepared`（进入真正的执行阶段）。

先看代码里出现的几个变量长什么样——这些是真实运行时的数据，不是抽象概念：

```
// toolCall —— 模型生成的一次工具调用请求（从 assistant 消息的 content 里取出来的）{  type: "toolCall",  id: "toolu_01XFDUDYJgAACzvnptvVer6C",   // API 生成的唯一 ID  name: "read_file",                        // 模型想调哪个工具  arguments: { path: "package.json" },      // 模型生成的参数}// tool —— 你注册的工具声明（从 context.tools 数组里 find 出来的）// 工具怎么注册的？→ 见 Part 6"给资本家添工具：registerTool"（part-06.md#给资本家添工具registertoolpart-1-的线在这里合龙）{  name: "read_file",  label: "Read File",  description: "读取项目里一个文本文件的完整内容。",  parameters: {                            // TypeBox 生成的 JSON Schema    type: "object",    properties: { path: { type: "string", description: "..." } },    required: ["path"],  },  execute: async (id, args, signal) => { ... },  // 真正干活的函数}// validatedArgs —— 校验（可能还转换过类型）之后的参数{ path: "package.json" }   // 和 toolCall.arguments 可能一样，也可能 "5000" 被转成了 5000
```

现在看 `prepareToolCall` 拿这些数据过三道关：

```
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {    // 关卡 1：工具存在吗？    // 用 toolCall.name（"read_file"）去 context.tools 数组里找    const tool = currentContext.tools?.find((t) => t.name === toolCall.name);    if (!tool) {        // 模型编了个不存在的工具名 → 回报"查无此工具"        return { kind: "immediate", result: createErrorToolResult(`Tool ${toolCall.name} not found`), isError: true };    }    // 例：toolCall.name 是 "read_file"，找到了上面那个 tool 对象 ✓    // 关卡 2：参数合法吗？    // 2a. prepareToolCallArguments —— 工具自己的预处理（大多数工具没有，直通）    //     如果工具定义了 prepareArguments 函数，先让它修正参数。    //     比如：路径规范化 "./src/../src/main.ts" → "src/main.ts"    //     没定义的话？原样返回 toolCall，什么都不做。    const preparedToolCall = prepareToolCallArguments(tool, toolCall);    // 2b. validateToolArguments —— 用 TypeBox schema 严格校验    //     内部两步：Value.Convert（宽容转换："42"→42）+ validator.Check（严格校验）    //     通过 → 返回校验后的参数    //     不通过 → 抛异常，外层 catch 住变成错误回报    const validatedArgs = validateToolArguments(tool, preparedToolCall);    // 例：schema 说 path 必须是 string，arguments.path 是 "package.json" ✓    // 如果模型传了 { path: 123 } → 校验失败 → 抛异常 → 被 catch 变成错误回报    // 关卡 3：策略允许吗？（beforeToolCall 钩子）    if (config.beforeToolCall) {        const beforeResult = await config.beforeToolCall(            { assistantMessage, toolCall, args: validatedArgs, context: currentContext },            signal,        );        if (beforeResult?.block) {            return { kind: "immediate", result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"), isError: true };        }    }    // 三关全过 → 返回 "prepared"，让后面真正执行    return { kind: "prepared", toolCall, tool, args: validatedArgs };}
```

**关卡 3 里 `beforeToolCall` 收到了什么、做了什么？**

它收到的参数是一个对象，包含做决策所需的全部信息：

```
{  assistantMessage,   // 模型的完整回复（万一你想看它说了什么话再决定）  toolCall,           // 原始的工具调用请求（name + id + arguments）  args: validatedArgs,// 已经校验过的干净参数（你该看这个而不是 toolCall.arguments）  context,            // 当前整个对话状态（所有历史消息、所有工具列表）}
```

钩子函数拿到这些信息之后做一个判断：**这次调用允不允许？** 返回值只有两种：

-   返回 `undefined` 或 `{ block: false }` → 放行，继续执行
-   返回 `{ block: true, reason: "不允许读 .env" }` → 拦住，reason 会被包装成错误回报喂给模型

### 策略规则在哪里定义的？

**不在 `agent-loop.ts` 里。** 循环只提供"这里可以拦"的插入点（`beforeToolCall` 钩子），具体拦什么由上层决定。

最简单的用法——直接写 if/else：

```
agent.beforeToolCall = async ({ toolCall, args }) => {    if (toolCall.name === "bash" && args.command.includes("rm -rf")) {        return { block: true, reason: "不让删" };    }    return undefined;  // 放行};
```

pi 的产品没有这么直接写——它用了一个**扩展系统**，让用户往 `.pi/extensions/` 目录放插件文件来定义拦截规则。扩展系统的完整实现（插件怎么加载、`pi.on()` 背后是什么、extension/runtime 对象的内部结构、jiti 动态加载、两阶段时间线）见 **Part 6 — 扩展系统的内部实现\[2\]**。

这里你只需要知道一件事：**`beforeToolCall` 就是一个函数，谁提供它、内部怎么判断，agent-loop 不关心。**

**返回值为什么是 `toolCall` 而不是 `preparedToolCall`？**

最后一行 `return { kind: "prepared", toolCall, tool, args: validatedArgs }` 返回了原始的 `toolCall` 而不是处理过的 `preparedToolCall`。原因是：

-   **参数已经被 `validatedArgs` 取代了** — 后续执行工具用的是 `args`，不会再碰 `toolCall.arguments`
-   **`toolCall` 只是带着 `id` 和 `name` 往下传** — 下游需要 `toolCall.id` 来构造 `toolResult` 消息（对应"这是对你哪条指令的答复"）
-   `toolCall` 和 `preparedToolCall` 的 `id`/`name` 完全一样，只有 `arguments` 不同 — 而 arguments 已经不用了

简单说：`toolCall` 在这里是个"身份证"（带 id），不是"参数来源"。参数来源是独立的 `args` 字段。

三道关卡各管一件事：

| 关卡 | 问的问题 | 失败时 |
| :-- | :-- | :-- |
| 1\. 工具存在 | 模型是不是在编工具名？ | 回报"查无此工具" |
| 2\. 参数校验 | 参数格式对吗？类型对吗？ | 回报"参数不合格 + 具体哪里错" |
| 3\. 策略钩子 | 这个操作允不允许？ | 回报"被拦截 + 原因" |

**关键设计：三道关卡全都不抛异常到外层——它们返回 `kind: "immediate"` 带着错误结果。** 调用方把这个结果包装成 `toolResult` 喂回模型。模型收到后通常会自愈：换个工具名、修正参数、或者换个策略。

### validateToolArguments 做了什么

这个函数住在 validation.ts 第 292 行\[3\]，做三件事：

1.  **深拷贝参数** — 不动原对象，避免后面的修改影响到调用方
2.  **宽容转换** — 用 `Value.Convert` 把模型的小毛病修正掉（比如把 `"42"` 转成 `42`）
3.  **严格校验** — 转换完之后再检查格式是否合规，不合规就抛异常

```
export function validateToolArguments(tool, toolCall) {    const args = structuredClone(toolCall.arguments);    Value.Convert(tool.parameters, args);    const validator = getValidator(tool.parameters);    if (validator.Check(args)) {        return args;    }    const errors = validator.Errors(args).map(...).join("\n");    throw new Error(`Validation failed for tool "${toolCall.name}":\n${errors}`);}
```

**`structuredClone`** — JavaScript 内置的深拷贝函数。为什么要拷贝？因为下一步 `Value.Convert` 会直接修改对象内容（把 `"42"` 改成 `42`）。如果不拷贝，调用方那边的原始数据也跟着变了。

**`Value.Convert(tool.parameters, args)`** — TypeBox 的类型强制转换。两个参数的角色：

-   `tool.parameters` = **规则**（schema），描述每个字段应该是什么类型
-   `args` = **数据**（模型传来的参数），可能有类型错误

Convert 做的事：按照规则逐字段检查数据，能转就转，转不了就不动（不报错）。**它直接修改 args 对象本身**，不是返回新对象——这就是为什么前面要先 `structuredClone` 拷贝。

`Value.Convert` 的两个参数长什么样——给一个具体例子：

```
// 第一个参数 tool.parameters（规则）——TypeBox 生成的 JSON Schema：{  type: "object",  properties: {    path:      { type: "string" },    timeout:   { type: "number" },    recursive: { type: "boolean" },  },  required: ["path", "timeout"]}// 第二个参数 args（数据）——模型传来的参数，有毛病：{ path: "main.ts", timeout: "5000", recursive: "true" }//                          ^^^^^^              ^^^^^^//                     应该是数字但写成了字符串    应该是布尔但写成了字符串// 执行 Value.Convert(tool.parameters, args) 后，args 被直接修改成：{ path: "main.ts", timeout: 5000, recursive: true }//                          ^^^^              ^^^^//                       变成数字了          变成布尔了
```

Convert 逐字段对比规则和数据：

-   `path`：规则说 string，实际是 string → 不动
-   `timeout`：规则说 number，实际是 `"5000"` → 转成 `5000`
-   `recursive`：规则说 boolean，实际是 `"true"` → 转成 `true`

**`validator.Check(args)`** — 真正的格式校验。Convert 之后如果参数还是不合格（比如必填字段缺失），这里会返回 false，然后下面收集所有错误信息抛出异常。

**完整走一遍三步——场景 1：模型把数字写成了字符串（常见的小毛病）：**

```
// 进来的数据：toolCall.arguments = { path: "src/main.ts", timeout: "5000" }// 第 1 步：structuredClone → 拷贝一份，不动原对象args = { path: "src/main.ts", timeout: "5000" }  // 新对象// 第 2 步：Value.Convert(tool.parameters, args)// schema 说 timeout 应该是 number，args.timeout 是 "5000"// → +"5000" = 5000 → 直接把 args.timeout 改成 5000args = { path: "src/main.ts", timeout: 5000 }  // "5000" 变成了 5000// 第 3 步：validator.Check(args)// path 是 string ✓，timeout 是 number ✓，两个 required 都在 ✓// → 返回 true → 校验通过 → 返回 args
```

**场景 2：模型漏掉了必填字段（真正的错误）：**

```
// 进来的数据：toolCall.arguments = {}  // path 和 timeout 都没有！// 第 1 步：structuredCloneargs = {}// 第 2 步：Value.Convert(tool.parameters, args)// 没有字段可转 → args 还是 {}// 第 3 步：validator.Check(args)// path 是 required 但不存在 → 返回 false// → 收集错误 → 抛出异常：//   "Validation failed for tool "read_file"://     - /path: Required property//     - /timeout: Required property//   Received arguments: {}"// → 异常被外层 catch → 变成 isError: true 的回报喂回模型// → 模型看到"参数缺了"→ 自己重新生成一份带 path 的参数
```

**设计哲学：先宽容（Convert），再严格（Check）。** 容忍模型的小毛病（类型写错），不放过真正的错误（字段缺失）。

> **注意：** 上面是简化版本。实际代码在 Convert 和 Check 之间还有一层 JSON Schema 兼容处理（`coerceWithJsonSchema`）——用于不带 TypeBox metadata 的 plain JSON Schema 工具定义。如果你只用 TypeBox 定义工具参数（pi 的标准做法），这段逻辑不会触发。感兴趣的话看 validation.ts 第 297–309 行\[3\]。

### beforeToolCall 钩子的用途

这就是 Claude Code 里"要执行 `rm -rf`，允许吗？"弹窗背后的机制。钩子拿到完整上下文（哪个工具、什么参数、当前对话），返回 `{ block: true, reason: "..." }` 就拦住执行。

模型**不知道**有这个钩子存在——它只看到一条 `toolResult` 说"操作被拒，原因是 X"。对模型来说这和"文件不存在"没区别——都是带 `isError: true` 的回报，它会根据回报调整策略。

* * *

## 3\. executeToolCallsParallel：并行执行（第 451–516 行）

```
流程：并行执行的三个阶段阶段1 准备（顺序）:  prepareToolCall A → B → C阶段2 执行（并发）:  execute A | execute B | execute C阶段3 结果（按原序）: toolResult A → toolResult B → toolResult C
```

模型可以在一条消息里同时发出多个工具调用。比如模型的一条 assistant 消息长这样：

```
// 模型返回的 message.content（一条消息里三个工具调用）[  { type: "text", text: "我来同时查看这三个文件：" },  { type: "toolCall", id: "toolu_01A", name: "list_files", arguments: { path: "." } },  { type: "toolCall", id: "toolu_01B", name: "read_file", arguments: { path: "README.md" } },  { type: "toolCall", id: "toolu_01C", name: "read_file", arguments: { path: "package.json" } },]
```

三个 `toolCall` 挤在一起——mini-pi 用 `for` 循环逐个执行；pi 默认并行。

但不是无脑 `Promise.all`——有个微妙的先后关系：

```
async function executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit) {    // finalizedCalls 这个数组最终会装两种东西：    //   - 已经有结果的（被拦截的）：直接是一个结果对象    //   - 还没执行的（通过了三关的）：一个 async 函数，调它才真正执行    const finalizedCalls: FinalizedToolCallEntry[] = [];    // ═══ 阶段 1：准备——逐个过三道关卡 ═══    // 为什么这里是 for 循环（顺序）而不是并发？    // 因为 beforeToolCall 钩子可能有状态——比如"同一批次只允许一个写操作"    for (const toolCall of toolCalls) {        // 通知外面"我要开始处理这个工具了"        await emit({ type: "tool_execution_start", toolCallId: toolCall.id, toolName: toolCall.name, args: toolCall.arguments });        // 过三道关卡（工具存在？参数合法？策略允许？）        const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);        if (preparation.kind === "immediate") {            // "immediate" = 三道关卡里被拦住了，已经有错误结果了            // 不需要真正执行，直接记录这个错误结果            finalizedCalls.push(preparation);            continue;        }        // "prepared" = 三关全过，可以执行        // 但不是现在执行——包成一个函数，等阶段 2 并发调用        finalizedCalls.push(async () => {            // executePreparedToolCall = 真正调 tool.execute()，读文件/跑命令            const executed = await executePreparedToolCall(preparation, signal, emit);            // finalizeExecutedToolCall = 跑 afterToolCall 钩子（可选的结果改写）            return finalizeExecutedToolCall(currentContext, assistantMessage, preparation, executed, config, signal);        });    }    // ═══ 阶段 2：执行——并发 ═══    // 数组里有两种元素：对象（已有结果）和函数（需要执行）    // Promise.all 同时调用所有函数，等全部完成    // 关键：Promise.all 保持数组顺序——第 0 个 toolCall 的结果一定在第 0 位    const orderedFinalizedCalls = await Promise.all(        finalizedCalls.map((entry) =>            typeof entry === "function"                ? entry()                    // 是函数 → 调用它，并发执行                : Promise.resolve(entry)     // 是对象 → 已经有结果了，直接用        )    );    // 此时三个工具（list_files、read_file×2）全部执行完毕    // ═══ 阶段 3：把结果按原始顺序推回对话 ═══    // 即使 read_file("package.json") 比 list_files 先完成，    // 结果数组里 list_files 仍然排第一——保证对话历史稳定    for (const finalized of orderedFinalizedCalls) {        // 把工具执行结果包装成 toolResult 消息        const toolResultMessage = createToolResultMessage(finalized);        // 通知外面"这个工具有结果了"+ 推进对话历史        await emitToolResultMessage(toolResultMessage, emit);        messages.push(toolResultMessage);    }}
```

**用一个例子看 `finalizedCalls` 数组的变化：**

假设模型同时请求了三个工具：`[list_files, read_file("a.ts"), read_file("b.ts")]`，其中第二个被 `beforeToolCall` 拦截了。

```
阶段 1 结束后，finalizedCalls 长这样（半成品数组，混着两种东西）：finalizedCalls = [    async () => { ... },                    // list_files：三关全过，等待执行    { toolCall, result: "被拦截", isError: true },  // read_file("a.ts")：被 beforeToolCall 拦了，已有结果    async () => { ... },                    // read_file("b.ts")：三关全过，等待执行]阶段 2：await Promise.all(...) 把函数都执行完，拆开所有 Promise：orderedFinalizedCalls = [    { toolCall, result: "目录列表...",   isError: false },  // list_files 执行完了    { toolCall, result: "被拦截",        isError: true },   // 原封不动（本来就是对象）    { toolCall, result: "b.ts 的内容",   isError: false },  // read_file("b.ts") 执行完了]现在全是对象，没有函数，没有 Promise。阶段 3：for 循环逐个包装成 toolResultMessage，push 进 context.messages。
```

**为什么准备阶段要顺序？** 因为 `beforeToolCall` 钩子可能有状态——比如"同一批次里只允许一个写操作"。如果并发 prepare，钩子看到的状态可能不一致。

**为什么结果要按原始顺序？** 因为下一轮 LLM 调用时模型会看到这些 toolResult——它期望"我请求的第 0 个工具的结果排第 0 位"，乱了会混淆。`Promise.all` 天然保持输入数组的索引顺序，不管谁先 resolve。

**什么时候回退到顺序执行？** 看第 381–384 行：

```
const hasSequentialToolCall = toolCalls.some(    (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",);if (config.toolExecution === "sequential" || hasSequentialToolCall) {    return executeToolCallsSequential(...);}
```

两种情况会回退顺序：全局配置 `config.toolExecution === "sequential"`，或者这批里有工具标了 `executionMode: "sequential"`。

实际情况：pi 内置的七个工具都**没有**标 sequential——write 和 edit 内部用了一个按文件路径的队列（`file-mutation-queue.ts`），同一文件的写操作自动串行，不同文件并行，所以不需要在工具级别强制整批顺序。

`executionMode: "sequential"` 给什么场景用？pi 官方示例里有两个例子：

-   **`question.ts`** — "问用户问题"工具。模型可能一次发两个 question 调用，并行的话两个弹窗同时出现，用户懵了。标 sequential → 一个一个弹。
-   **`tic-tac-toe.ts`** — 井字棋。模型在一条消息里发 `[move_right, move_down, play]` 三个调用，它们共享同一个游戏光标。并行的话 `play` 可能在 `move` 之前执行，棋子落错位置。标 sequential → 动作按顺序生效。

共同模式：**工具之间共享可变状态**（UI 焦点、游戏光标），且模型在同一条消息里对同一个工具连续调用多次，调用之间有顺序依赖。

### 工具执行中的流式更新（tool\_execution\_update）

工具不是黑盒——执行过程中可以通过 `onUpdate` 回调 emit 中间状态。看 `executePreparedToolCall`（第 628 行）：

```
const result = await prepared.tool.execute(    prepared.toolCall.id,    prepared.args,    signal,    (partialResult) => {        // onUpdate 回调——工具每有新输出就调一次        emit({            type: "tool_execution_update",            toolCallId: prepared.toolCall.id,            toolName: prepared.toolCall.name,            args: prepared.toolCall.arguments,            partialResult,   // 中间结果，比如 bash 命令已输出的 stdout        });    },);
```

典型场景：bash 工具执行 `npm test`，测试跑了 30 秒——每当有新输出行时，通过 `onUpdate` 推送中间结果，UI 就能实时显示测试进度，而不是等 30 秒后一次性吐出全部输出。

* * *

## 4\. streamAssistantResponse：流式 + 事件广播（第 275–368 行）

mini-pi 用 `complete()` 干等——模型想 3 秒，你的终端就死寂 3 秒。pi 用流式接口，模型每生成一点就推过来一点，UI 能实时显示。

这个函数只做一件事：**发一次 LLM 请求，返回一条完整的 assistant 消息。** 过程分四步：

| 步骤 | 做什么 | 解释 |
| :-- | :-- | :-- |
| 1. `transformContext` | 裁剪对话历史（可选） | 对话太长时只保留最近 N 条，防止超 context window。不改原始数据，只影响这一次请求 |
| 2. `convertToLlm` | 内部格式 → LLM 格式 | pi 内部有自定义消息类型（通知、压缩摘要等），LLM 不认识。这一步过滤/转换，只留 LLM 认识的 user/assistant/toolResult |
| 3. `streamFunction` | 发起流式请求 | 把消息发给  LLM API，拿回一个"水管"（async iterable）——服务端返回 SSE（Server-Sent Events）流，每个  event 是一个 JSON 块，模型每生成一点就推过来一点。pi 不需要和服务端协商"一次推多大"，收到就处理 |
| 4. `for await` | 逐事件处理 | 从水管里一个一个接事件，每接到一个就 emit 给外面的 UI，同时更新 context.messages |

先看代码，再用 trace 例子走一遍：

```
async function streamAssistantResponse(context, config, signal, emit, streamFn) {    // 步骤 1：准备上下文    let messages = context.messages;    if (config.transformContext) {        messages = await config.transformContext(messages, signal);    }    const llmMessages = await config.convertToLlm(messages);    // 步骤 2：把转换后的消息装进 LLM 能理解的 Context 对象    const llmContext = {        systemPrompt: context.systemPrompt,        messages: llmMessages,   // ← llmMessages 用在这里        tools: context.tools,    };    // 步骤 3：发起流式请求（返回一个 async iterable，可以用 for await 逐个取）    const response = await streamFunction(config.model, llmContext, { ... });    // 步骤 4：逐事件处理    let partialMessage = null;    let addedPartial = false;  // 追踪是否已经收到过 "start" 事件    for await (const event of response) {        switch (event.type) {            case "start":                // 模型开始说话——创建一条空的 assistant 消息，先推进 context                partialMessage = event.partial;                context.messages.push(partialMessage);                addedPartial = true;                await emit({ type: "message_start", message: { ...partialMessage } });                break;            case "text_start":            case "text_delta":            case "text_end":            case "thinking_start":            case "thinking_delta":            case "thinking_end":            case "toolcall_start":            case "toolcall_delta":            case "toolcall_end":                // 模型吐出新内容——更新 partial，替换 context 里的旧版本                if (partialMessage) {  // 守卫：万一 "start" 事件丢了，不炸                    partialMessage = event.partial;                    context.messages[context.messages.length - 1] = partialMessage;                    await emit({ type: "message_update", assistantMessageEvent: event, message: { ...partialMessage } });                    //                                                                         ^^^^^^^^^^^^^^^^^^^                    // 注意浅拷贝：emit 出去的是快照，后续 delta 不会改变已 emit 的对象                }                break;            case "done":            case "error":                // 流结束——拿到最终完整消息                const finalMessage = await response.result();                if (addedPartial) {                    context.messages[context.messages.length - 1] = finalMessage;  // 替换 partial                } else {                    context.messages.push(finalMessage);  // 从没收到 "start"（极端情况）→ 直接 push                }                // [省略] 如果 !addedPartial，这里还会补发一个 message_start（确保事件配对）                await emit({ type: "message_end", message: finalMessage });                return finalMessage;        }    }    // [省略] for-await 正常退出（没走 done/error case）的 fallback 路径    // 实际代码在这里也会调 response.result() 拿最终消息并 emit    // 这是防御性代码——正常情况下不会走到这里}
```

代码里的核心设计：**`context.messages` 里始终只有一条 assistant 消息**——t0 push 进去后，后续所有 delta 都是对同一位置的覆盖，不会越积越多。这保证了即使中途 abort，对话历史结构也是完好的。

下面用一个具体例子，看每个事件到达时 `context.messages` 怎么变化：

### 一个完整的流式事件 trace

假设用户问"读一下 package.json"，模型决定调用 `read_file` 工具。

**进入 `streamAssistantResponse` 时，`context.messages` 长这样：**

```
context.messages = [    { role: "user", content: [{type:"text", text:"读一下 package.json"}] },   // [0]    // ← 就这一条，还没有 assistant 回复]
```

下面是 for-await 循环收到的每一个事件，以及 `context.messages` 数组的完整快照：

```
━━━ t0: 收到 { type: "start", partial: { role: "assistant", content: [] } } ━━━  执行: context.messages.push(partialMessage)    ← 唯一一次 push，数组长度从 1 变 2  emit: message_start  context.messages = [      { role: "user",      content: [{type:"text", text:"读一下 package.json"}] },  // [0]      { role: "assistant", content: [] },                                            // [1] ← 新 push 的空壳  ]━━━ t1: 收到 { type: "text_start", partial: { role: "assistant", content: [{type:"text", text:""}] } } ━━━  执行: context.messages[1] = partialMessage     ← 覆盖 [1]，数组长度不变  emit: message_update  context.messages = [      { role: "user",      content: [{type:"text", text:"读一下 package.json"}] },  // [0] 没动      { role: "assistant", content: [{type:"text", text:""}] },                      // [1] 被覆盖  ]━━━ t2: 收到 { type: "text_delta", delta: "我来读", partial: { role: "assistant", content: [{type:"text", text:"我来读"}] } } ━━━  执行: context.messages[1] = partialMessage     ← 再次覆盖 [1]  emit: message_update  context.messages = [      { role: "user",      content: [{type:"text", text:"读一下 package.json"}] },  // [0] 没动      { role: "assistant", content: [{type:"text", text:"我来读"}] },                // [1] 文字多了  ]━━━ t3: 收到 { type: "text_delta", delta: "一下", partial: { ... text:"我来读一下" ... } } ━━━  执行: context.messages[1] = partialMessage     ← 覆盖 [1]  emit: message_update  context.messages = [      { role: "user",      content: [{type:"text", text:"读一下 package.json"}] },  // [0] 不变      { role: "assistant", content: [{type:"text", text:"我来读一下"}] },             // [1]  ]━━━ t4: 收到 { type: "toolcall_start", partial: { content: [{text:"我来读一下"}, {type:"toolCall", name:"read_file", arguments:{}}] } } ━━━  执行: context.messages[1] = partialMessage     ← 覆盖 [1]，content 数组多了一个 toolCall 块  emit: message_update  context.messages = [      { role: "user",      content: [{type:"text", text:"读一下 package.json"}] },  // [0] 不变      { role: "assistant", content: [                                                 // [1]          {type:"text", text:"我来读一下"},          {type:"toolCall", name:"read_file", id:"toolu_01X...", arguments:{}},      ]},  ]━━━ t5: 收到 { type: "toolcall_delta", partial: { role: "assistant", content: [{type:"text", text:"我来读一下"}, {type:"toolCall", name:"read_file", id:"toolu_01X...", arguments:{path:"package.json"}}] } } ━━━  执行: context.messages[1] = partialMessage     ← 覆盖 [1]，arguments 填上了  emit: message_update  context.messages = [      { role: "user",      content: [{type:"text", text:"读一下 package.json"}] },  // [0] 不变      { role: "assistant", content: [                                                 // [1]          {type:"text", text:"我来读一下"},          {type:"toolCall", name:"read_file", id:"toolu_01X...", arguments:{path:"package.json"}},      ]},  ]━━━ t6: 收到 { type: "done" } ━━━  执行: finalMessage = await response.result()   ← 拿到带 stopReason + usage 的最终版        context.messages[1] = finalMessage        ← 最后一次覆盖 [1]  emit: message_end  return finalMessage  context.messages = [      { role: "user",      content: [{type:"text", text:"读一下 package.json"}] },  // [0] 不变      { role: "assistant", content: [                                                 // [1] 完整了          {type:"text", text:"我来读一下"},          {type:"toolCall", name:"read_file", id:"toolu_01X...", arguments:{path:"package.json"}},      ], stopReason: "toolUse", usage: {inputTokens: 52, outputTokens: 31} },  ]
```

**要点：** 数组长度从始至终只在 t0 变了一次（1→2）。t1–t6 全是对 `[1]` 位置的覆盖。如果中途 abort，`[1]` 里是截断的 partial 但数组结构完好——不会出现多余的空消息或消息配对断裂。

### emit 出去的事件，UI 拿来干什么

循环本身不知道 UI 长什么样——它只管在正确的时刻 `emit` 正确的事件。UI 订阅自己关心的事件类型：

| 事件 | UI 通常拿它干什么 |
| :-- | :-- |
| `message_start` | 显示一个新的气泡框 |
| `message_update`（text\_delta） | 逐字往气泡里追加文字（打字机效果） |
| `message_update`（toolcall\_delta） | 实时显示工具参数的拼凑过程 |
| `message_end` | 标记这条消息完成 |
| `tool_execution_start` | 显示"正在执行 read\_file..." |
| `tool_execution_update` | 工具执行中的中间状态（如 bash 的 stdout） |
| `tool_execution_end` | 显示工具执行结果 |

注意 `message_update` 里的 `message` 是**累积的**——每次 emit 都包含到目前为止的完整内容（上面 trace 里能看到）。UI 如果只想要新增部分，看 `assistantMessageEvent.delta`；如果想要完整文本，看 `message.content`。

### transformContext 和 convertToLlm

注意流式请求之前有两步预处理：

```
if (config.transformContext) {    messages = await config.transformContext(messages, signal);}const llmMessages = await config.convertToLlm(messages);
```

```
两步预处理管道：AgentMessage[]（完整对话历史）  → transformContext → AgentMessage[]（裁剪/注入后）  → convertToLlm    → Message[]（LLM 能理解的格式）  → 发给 LLM
```

**`transformContext`** — 在 AgentMessage 层面变换上下文。**每一轮 LLM 调用之前都会执行**，但不修改真正的对话历史——它只影响这一次发给 LLM 的输入。

它是一个函数，不是一个配置值。每次被调用时拿到完整的消息列表，返回修改后的列表：

```
// 最简单的用法：对话太长时只保留最近 N 条transformContext: async (messages) => {    if (messages.length > 100) {        // 保留第一条（系统提示相关）+ 最后 50 条        return [messages[0], ...messages.slice(-50)];    }    return messages;  // 不到 100 条就原样返回}
```

在 pi 的生产代码里，`transformContext` 被接到了扩展系统的 `"context"` 事件上——扩展可以在每次 LLM 调用前注入或移除消息。一个真实例子是 pi 官方的 `plan-mode` 扩展：

```
// plan-mode 扩展：plan mode 关闭后，把之前注入的 plan mode 提示消息清掉pi.on("context", async (event) => {    if (planModeEnabled) return;  // plan mode 开着 → 不动，return undefined = 消息列表原样保留    // plan mode 关了 → 过滤掉所有 plan mode 相关的消息（模型不需要再看到它们）    return {        messages: event.messages.filter((m) => {            if (m.customType === "plan-mode-context") return false;  // .filter() 里 false = 丢掉            return true;  // 其他保留        }),    };});
```

这个扩展同时还用 `tool_call` 事件拦截工具调用——plan mode 开着时模型调任何工具都会被 block。两个事件配合：`context` 控制"模型看到什么"，`tool_call` 控制"模型能做什么"。

**`convertToLlm`** — 把 AgentMessage 转成 LLM 能理解的标准 `Message[]`。LLM 只认 `user` / `assistant` / `toolResult` 三种角色，但 pi 内部有更多类型。下面是 pi 真实的 `convertToLlm`（messages.ts 第 148 行，简化注释）：

```
function convertToLlm(messages: AgentMessage[]): Message[] {    return messages.map((m) => {        switch (m.role) {            case "user":            case "assistant":            case "toolResult":                return m;  // LLM 认识，直通            case "custom":                // 扩展注入的自定义消息（如 plan-mode-context）→ 转成 user 消息喂给模型                return { role: "user", content: m.content, timestamp: m.timestamp };            case "bashExecution":                // 用户在终端跑的 ! 命令的输出 → 转成 user 消息                return { role: "user", content: [{ type: "text", text: bashExecutionToText(m) }], ... };            case "compactionSummary":                // 压缩摘要 → 转成 user 消息（让模型知道"之前的对话被压缩了，这是摘要"）                return { role: "user", content: [{ type: "text", text: "..." + m.summary + "..." }], ... };            case "branchSummary":                // 分支摘要 → 同上                return { role: "user", content: [...], ... };        }    }).filter(m => m !== undefined);}
```

所有非标准类型最终都被转成了 `role: "user"` 消息——对 LLM 来说它们就是"用户给的额外信息"。

**两步的分工：**`transformContext` 管"给多少"（裁剪），`convertToLlm` 管"怎么翻译"（格式转换）。分成两步是因为裁剪逻辑需要看完整的 AgentMessage 类型信息（比如"保留所有 compactionSummary 但删旧的 assistant"），而翻译只需要逐条转换。

这就是 types.ts 第 309 行\[4\] 定义的 `AgentMessage` 和底层 `Message` 的区别：

```
// AgentMessage = 标准 LLM 消息 + 你自定义的消息类型export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

循环内部全程操作 `AgentMessage`，只在发给 LLM 的最后一刻才转成 `Message`——保留了自定义消息的能力，又不污染 LLM 的输入。

* * *

## 5\. Steering 和 Follow-up 队列（第 166 行、第 253 行、第 257 行）

用户在 agent 干活时打字进来，循环怎么接住？

### 单循环（mini-pi）的问题

你在 Part 1 写的 mini-pi 是这样的：

```
while (true) {    const message = await callLLM();    if (message.stopReason !== "toolUse") break;  // 没有工具调用 → 直接退出    await executeTools(message);}
```

**用户完全插不上话。** 循环在跑的时候，用户打什么字都没人接；循环退出后，对话就结束了。

### pi 的解法：两个队列 + 两个检查点

pi 用两个队列解决两种"用户想说话"的场景：

|  | Steering | Follow-up |
| :-- | :-- | :-- |
| 用户意图 | "现在就听我的，改方向" | "你先干完，干完了接着干这个" |
| 检查时机 | 每轮工具执行**后**（内层循环里） | agent 打算**退出时**（外层循环里） |
| 怎么触发 | 按 `Enter` 发送 | 按 `Alt+Enter` 发送 |

对应的代码只有两行：

```
// 内层循环末尾（第 253 行）——agent 还在忙，检查有没有中途插话pendingMessages = (await config.getSteeringMessages?.()) || [];// 外层循环末尾（第 257 行）——agent 打算停了，检查有没有追加任务const followUpMessages = (await config.getFollowUpMessages?.()) || [];if (followUpMessages.length > 0) {    pendingMessages = followUpMessages;    continue;  // 拉回内层循环继续}break;  // 真的没事了，退出
```

### 一个具体场景

```
你：帮我检查有没有 bugagent：开始干活 → 读文件 → 读文件 →  ← 你按 Enter 说："顺便看安全漏洞"  → 进 steering 队列 → 本轮工具执行完后注入 → 下一轮模型就看到agent：检查完了，发现 2 个 bug → 没有更多工具调用       → 内层循环退出 → 走到外层的 break 之前       → 先检查 follow-up 队列...  ← 你之前按 Alt+Enter 说过："现在帮我修第一个"  → 在 follow-up 队列里等着 → 被检查到 → 不 break，continue 回内层循环agent：继续跑 → 修 bug → 完成 → 再次走到 break 前       → follow-up 队列空了 → 这次真的 break → agent_end
```

### 和单循环的根本区别

单循环只有一个退出点（`break`），退了就退了。pi 的双层结构多了一道"散会前最后检查"：

```
单循环：    没有 tool call → break → 结束，用户没机会追加双层循环：  没有 tool call → 内层退出 → 检查 follow-up → 有 → 拉回来继续                                                       → 没有 → 才真正退出
```

**如果你的 agent 不需要"agent 干完后追加任务"的能力，单循环 + 单队列完全够用。** pi 加第二层是因为它要支持 `Alt+Enter` 排队和 SDK 的 `streamingBehavior: "followUp"` 这两个产品功能。

SDK 调用时通过参数指定：

```
session.prompt("别管 test/", { streamingBehavior: "steer" });      // 立刻插入session.prompt("搞完再帮我改 README", { streamingBehavior: "followUp" }); // 排队等着
```

* * *

## 6\. afterToolCall：执行后的改写（第 665–708 行）

还有一个值得单独说的钩子——`afterToolCall`，在工具执行完、结果回报模型之前跑：

```
async function finalizeExecutedToolCall(currentContext, assistantMessage, prepared, executed, config, signal) {    // executed —— 工具刚刚执行完的原始结果，长这样：    // { result: { content: [{ type: "text", text: "文件内容..." }] }, isError: false }    let result = executed.result;    let isError = executed.isError;    // 如果你注册了 afterToolCall 钩子——    if (config.afterToolCall) {        // 把完整上下文交给钩子：谁调的、什么参数、原始结果、当前对话状态        const afterResult = await config.afterToolCall(            { assistantMessage, toolCall: prepared.toolCall, args: prepared.args, result, isError, context: currentContext },            signal,        );        // 钩子返回值（如果有的话）可以改写结果的任何部分        // ?? 是"空值合并"：左边是 null/undefined 就用右边（保留原值）        if (afterResult) {            result = {                content: afterResult.content ?? result.content,      // 想换内容？给 content；不想换？返回 undefined，保留原来的                details: afterResult.details ?? result.details,      // 同上                terminate: afterResult.terminate ?? result.terminate, // 想让循环停？给 true            };            isError = afterResult.isError ?? isError;                // 想把成功改成失败（或反过来）？改这个        }    }    // 最终返回给循环的结果——可能被钩子改过，也可能原封不动    return { toolCall: prepared.toolCall, result, isError };}
```

**实际例子——afterToolCall 截断大文件：**

```
// 你注册的 afterToolCall 钩子：afterToolCall: async ({ toolCall, result }) => {    if (toolCall.name === "read_file") {        const text = result.content[0].text;        const lines = text.split("\n");        if (lines.length > 200) {            // 文件超过 200 行 → 截断，省 token            return {                content: [{ type: "text", text: lines.slice(0, 200).join("\n") + `\n... (截断，共 ${lines.length} 行)` }],            };            // 只返回了 content → details/terminate/isError 保持原值（?? 生效）        }    }    // 不需要改写 → 返回 undefined → 结果原封不动}
```

**更多用途：**

-   工具返回了敏感信息（密码、API key），钩子把它替换成 `[REDACTED]` 再回报模型
-   工具执行成功但你想让 agent 停下来，钩子返回 `{ terminate: true }` → 循环不再调 LLM

`terminate` 的细节：只有当一个 batch 里**所有**工具结果都设置了 `terminate: true` 时，循环才真正停下来（第 544 行\[1\]）。一个说停、另一个没说 → 继续转。

* * *

## 7\. 生命周期钩子：prepareNextTurn + shouldStopAfterTurn（第 226、241 行）

在每轮工具执行完、结果推回对话之后，循环还要做两件事情再决定"下一步怎么走"。先看它们在整个循环结构里的位置：

```
外层 while (true) {    内层 while (hasMoreToolCalls || pendingMessages.length > 0) {        调 LLM（streamAssistantResponse）        执行工具（executeToolCalls）        emit turn_end        → prepareNextTurn       ← 每轮都跑：要不要换 model / thinking level？        → shouldStopAfterTurn   ← 每轮都跑：要不要强制停？        → getSteeringMessages   ← 检查用户中途插话    }    → getFollowUpMessages       ← 检查追加任务}
```

这两个钩子分别回答两个问题：

```
轮次结束后的两个检查：本轮结束（turn_end 已 emit）  → prepareNextTurn（下一轮用什么配置?）  → shouldStopAfterTurn（要不要停?）      停   → agent_end      不停 → getSteeringMessages → 继续循环
```

### prepareNextTurn — 动态换挡（第 226 行）

```
// 第 226–239 行const nextTurnContext = {    message,        // 刚完成的 assistant 消息    toolResults,    // 本轮所有工具的执行结果    context: currentContext,  // 完整对话状态    newMessages,    // 本次 agent run 新增的所有消息};const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);if (nextTurnSnapshot) {    currentContext = nextTurnSnapshot.context ?? currentContext;    // 可以换整个上下文    config = {        ...config,        model: nextTurnSnapshot.model ?? config.model,             // 可以换模型        reasoning: nextTurnSnapshot.thinkingLevel === undefined            ? config.reasoning            : nextTurnSnapshot.thinkingLevel === "off"                ? undefined                : nextTurnSnapshot.thinkingLevel,                  // 可以换 thinking level    };}
```

**什么时候用？** 典型场景：

-   **动态降级**：前几轮用 Claude Opus 做规划，工具执行完发现剩下的是简单的文本生成 → 切到 Sonnet 省 token
-   **thinking 调节**：对话超过 50 条消息了 → 关掉 extended thinking 防止上下文溢出
-   **上下文裁剪**：对话太长 → 钩子返回一个精简过的 `context`，只保留最近 N 轮

### shouldStopAfterTurn — 强制停（第 241 行）

```
// 第 241–251 行if (    await config.shouldStopAfterTurn?.({        message,        toolResults,        context: currentContext,        newMessages,    })) {    await emit({ type: "agent_end", messages: newMessages });    return;  // 不再检查 steering 和 follow-up，直接退出}
```

**pi 自己没有提供默认实现。** 这是一个可选字段——不传就不检查，循环永远不会因为它停下来。你自己写 agent 时可以传一个：

```
const agent = new Agent({    shouldStopAfterTurn: ({ context }) => {        // 对话超过 200 条消息就强制停        return context.messages.length > 200;    },});
```

### `terminate` 和 `shouldStopAfterTurn` 的区别

这两个都能让循环停下来，但层级不同：

```
一次内层循环迭代：    调 LLM → 得到 assistant 消息（带 3 个 tool call）    执行 3 个工具 → 每个工具结果里有 terminate 字段        ↓    全部 terminate: true？        → 是：hasMoreToolCalls = false（工具说"够了"）           但！如果有 steering 消息，内层循环还会继续        → 否：hasMoreToolCalls = true，继续调 LLM        ↓    emit turn_end → prepareNextTurn        ↓    shouldStopAfterTurn 返回 true？        → 是：直接 agent_end，不管有没有 steering / follow-up，彻底结束        → 否：继续检查 steering
```

|  | `terminate` | `shouldStopAfterTurn` |
| :-- | :-- | :-- |
| 谁设置 | 工具（通过 `afterToolCall` 钩子返回 `{terminate: true}`） | 你传给 agent 的函数 |
| 作用 | `hasMoreToolCalls = false`（内层循环**可能**继续） | 直接退出整个循环（**一定**停） |
| 能被 steering 覆盖吗 | 能——如果有 steering 消息，循环还是继续 | 不能——它在 steering 检查**之前** |
| 类比 | 工人说"活干完了"（但老板可以加新活） | 老板说"下班了"（不管还有没有活） |

**简单记忆：`terminate` 是温和建议，`shouldStopAfterTurn` 是强制命令。**

* * *

## 8\. Abort 信号：随时可中断（贯穿全文件）

你可能注意到几乎每个函数的签名里都有 `signal?: AbortSignal`：

```
async function runLoop(..., signal?: AbortSignal)async function streamAssistantResponse(..., signal?: AbortSignal)async function prepareToolCall(..., signal?: AbortSignal)async function executePreparedToolCall(prepared, signal?: AbortSignal, ...)async function finalizeExecutedToolCall(..., signal?: AbortSignal)
```

用户按 Ctrl+C 时，上层调 `abortController.abort()`，`signal.aborted` 变成 `true`。循环在所有可能长期阻塞的点都检查这个信号：

```
// prepareToolCall 第 591 行和第 606 行if (signal?.aborted) {    return {        kind: "immediate",        result: createErrorToolResult("Operation aborted"),        isError: true,    };}
```

```
// executeToolCallsSequential 第 440 行if (signal?.aborted) {    break;  // 不再执行剩下的工具，立即返回已有结果}
```

**设计要点：**

-   Abort 不抛异常——它返回一个带 `isError: true` 的 `"Operation aborted"` 结果
-   这意味着 abort 后的对话历史是完整的（不会出现"有 toolCall 但没有 toolResult"的断裂）
-   上层可以通过 `message.stopReason === "aborted"` 判断循环是正常结束还是被中断的（第 196 行）

对比 mini-pi：你的版本没有 abort 机制——一旦 LLM 调用发出去，用户只能干等。pi 允许用户随时按 Ctrl+C，循环会在最近的检查点优雅退出。

* * *

## 接着干，等我

你现在能读懂 pi 的整个 agent 循环了——从双层 while 到三道关卡到并行执行到流式广播。但我们一直在 `packages/agent/` 这一层——它只是个抽象框架，不知道什么是"文件"、什么是"终端"。`packages/coding-agent/` 才是那个知道怎么读文件、跑 bash、编辑代码的具体产品。下一步可以去看它怎么定义那七个工具（`bash`、`edit`、`find`、`grep`、`ls`、`read`、`write`），以及 system prompt 怎么写——那是 agent 的"性格"来源。
