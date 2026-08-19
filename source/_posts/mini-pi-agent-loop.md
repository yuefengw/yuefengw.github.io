---
title: "亲手写个 mini-pi，再对照 pi 的 743 行源码"
slug: mini-pi-agent-loop
date: 2026-07-27 22:47:00
updated: 2026-07-27 22:47:00
categories:
  - "工程实践"
  - "Agent 系统"
tags:
  - "Agent"
  - "TypeScript"
  - "LLM"
  - "Tool Calling"
  - "pi"
cover: /images/posts/astraflow-cover.webp
description: "从一个约 100 行的 mini-pi 出发，拆解 coding agent 的模型、工具和循环，并对照 pi 项目的生产级 agent-loop 实现。"
---

从一个约 100 行的 mini-pi 出发，拆解 coding agent 的模型、工具和循环，并对照 pi 项目的生产级 agent-loop 实现。

<!-- more -->

是时候来点干货

你听说过的所有 coding agent——Claude Code、Cursor、还有我们这个教程要解剖的 pi——核心都是同一个 while 循环。pi 的生产级实现 `agent-loop.ts` 一共 743 行，听起来吓人，但它的骨架用 30 行就能写明白。这不是简化版的玩具说法，是你读完源码后会亲眼确认的事实。

这个判断有据可查：Anthropic 在《Building effective agents》里的原话是，agent "通常只是 LLM 在一个循环里、根据环境反馈来使用工具"（"typically just LLMs using tools based on environmental feedback in a loop"）。模型公司自己都这么说——那层神秘感是营销给的，不是代码给的。

所以这个教程的玩法是：我们不从理论开始，而是亲手写一个一百行上下的微型 agent，给它起名 mini-pi。它有两个工具，能查看真实的项目目录、读真实的文件、回答你关于这个项目的问题。写完之后，我们翻开 pi 真正的源码对照——你会发现你写的东西和一个 61.9k star 的生产级项目，骨架完全一致。

> **Aside** "agent" 来自拉丁语 agere——"去做"。名字就剧透了一切：agent 是"做事的东西"，而 LLM 本身只会"说"。这中间差的那段距离，就是本教程的全部内容。

## 你将构建什么

mini-pi：一个单文件 TypeScript 程序，约 100 行。运行 `node mini-pi.ts <目录> "<问题>"` ，它会自己决定先列哪个目录、读哪个文件，然后回答你的问题——比如指着一个陌生项目问"这个项目装了哪些依赖？"，它会列目录、找到 package.json、读进去、给你答案。底层用的是 pi 项目自家的 LLM 库 `@earendil-works/pi-ai` v0.79.1——和 pi 本体同一套地基。

## 先决条件

-   Node.js ≥ 24。我们会直接用 node 跑 .ts 文件，不装任何编译器——Node 的 type stripping 从 v22.6 引入、v23.6 起默认开启、v24.12/v25.2 起正式稳定。本教程在 Node 26.0.0 上验证过。
-   一个 Anthropic API key，放在环境变量 `ANTHROPIC_API_KEY` 里。（pi-ai 支持二十多家供应商，你用 OpenAI 的 key 也行，后面会说在哪改。）
-   会用终端、会一点 JavaScript。TypeScript 不会也没关系——我们只用最浅的那层。
-   （可选，但强烈推荐）把 pi 的源码克隆下来，对照着看：

```
git clone https://github.com/earendil-works/pi
```

本教程引用的行号以 2026-06-11 的 main 分支（commit 1da9039）为准。

## Agent = 模型 + 工具 + 循环，缺一不可

先把一个误区拆掉：agent 不是某种特殊的模型。你调用的还是那个普通的对话 API。区别全在模型外面那圈代码。

打个比方——一位资本家被锁在没有窗户的机房里，手边只有一部对讲机。他知识渊博、判断精准，但他碰不到现场的任何东西。他能做的只有一件事：对着对讲机下指令——"去把 package.json 的内容念给我听"。指令下完，他就只能等。现场得有个牛马，听到指令、真的跑去读文件、再用对讲机把内容念回来。资本家听完，要么继续下指令，要么宣布结论。

对应关系是严格的：

-   资本家 = LLM。它生成文本和"工具调用请求"，仅此而已。它从不执行任何东西。
-   牛马 = 你的代码。真正调 `readFileSync` 的是你，不是模型。
-   对讲机协议 = 消息格式。指令和回报必须按固定格式来回传。
-   "指令→执行→回报→再指令"的来回 = 那个循环。

Anthropic 的文章还区分了两个容易混的词：workflow（工作流）是"LLM 和工具按预先写死的代码路径编排"，而 agent 是"LLM 动态决定自己的流程和工具用法"（原文定义）。mini-pi 是 agent：先列目录还是直接读文件，是模型当场决定的，我们的代码里没有写死任何步骤。

这一节没有代码，但它是全篇最重要的一节。下一个问题自然就来了：对讲机协议长什么样？

## 对话的原材料：三种消息和五种停机理由

LLM API 眼里的一场对话，就是一个消息数组。pi-ai 里有三种角色（见 pi-ai README）：

-   `user` —— 你的问题。
-   `assistant` —— 模型的回应。注意：它的 content 是一个内容块数组，块有 `type: "text"` （说话）和 `type: "toolCall"` （下指令）两种。一条消息里可以同时有好几块。
-   `toolResult` —— 牛马的回报。必须带上 `toolCallId` ，告诉模型"这是对你哪条指令的答复"。

一轮带工具调用的对话，在 messages 数组里长这样：

```
const messages = [
  // 用户提问
  { role: "user", content: "读一下 package.json 然后告诉我这个项目的名字" },

  // 模型回应：一条消息里同时有"说话"和"下指令"两种块
  {
    role: "assistant",
    content: [
      { type: "text", text: "我来帮你读取 package.json。" },
      { type: "toolCall", id: "toolu_01ABC", name: "read_file", input: { path: "package.json" } },
    ],
    stopReason: "toolUse",
  },

  // 牛马回报：toolCallId 对上了上面那条指令
  {
    role: "toolResult",
    toolCallId: "toolu_01ABC",
    content: [{ type: "text", text: '{ "name": "my-project", "version": "1.0.0" }' }],
    isError: false,
  },

  // 模型看到文件内容后，正常收笔
  {
    role: "assistant",
    content: [{ type: "text", text: "这个项目的名字是 **my-project**（版本 1.0.0）。" }],
    stopReason: "stop",
  },
];
```

注意节奏：user → assistant(toolUse) → toolResult → assistant(stop)。循环每转一圈就是后三条重复一次——直到 `stopReason` 不再是 `"toolUse"` 。

每条 assistant 消息还带一个 `stopReason` ，告诉你模型为什么停笔。pi-ai 定义了五种（types.ts 第 280 行）：

```
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

整个 agent 循环的转向逻辑就挂在这一个字段上。五种值各自什么时候出现，README 的 Stop Reasons 一节有官方一句话解释，对应到我们要写的循环就是这张表：

**"stop"** 模型把话说完了，正常收笔 → 散会，打印最终回答

**"toolUse"** 模型发出了工具调用，正在等回报 → 执行工具，推回结果，继续循环

**"length"** 输出撞上 token 上限，话说一半被掐断 → 也会走到"散会"分支——但回答是残缺的，生产代码得识别

**"error"** 请求失败：鉴权、网络、参数都算 → 读 errorMessage，报错退出

**"aborted"** 请求被 AbortSignal 主动取消（用户按了 Esc） → 同上，但通常不算"错"

顺带把行话坐标系对齐：工具调用（tool calling），也叫 function calling——如果你想唬人，可以叫它"约束解码下的结构化指令生成"——说穿了就是模型在 content 里放了一个 JSON 块，仅此而已。

光看表格没有体感。这五种值全都能在两分钟内亲手触发一遍，而且正好顺便把项目地基打好——接下来的 mini-pi 也住在这里：

```
mkdir mini-pi && cd mini-pi
npm init -y
npm pkg set type=module
npm install @earendil-works/pi-ai@0.79.1
```

新建 stop-reasons.ts。前三种是"正常营业"的形态——说完、被掐断、等工具：

```
import { complete, getModel, Type, type Tool } from "@earendil-works/pi-ai";

const model = getModel("anthropic", "claude-sonnet-4-6");

function show(label: string, msg: { stopReason: string; content: any[]; errorMessage?: string }) {
	const preview =
		msg.content
			.map((b) => (b.type === "text" ? b.text : `[${b.type}: ${b.name ?? ""}]`))
			.join(" ")
			.slice(0, 60) || "(无内容)";
	console.log(`${label} stopReason=${msg.stopReason.padEnd(8)} ${msg.errorMessage ?? preview}`);
}

// 1. "stop"：模型正常说完
show("正常回答", await complete(model, { messages: [{ role: "user", content: "用一句话介绍你自己" }] }));

// 2. "length"：maxTokens 限到 30，话说一半被掐断
show("超长被截", await complete(model, { messages: [{ role: "user", content: "写一篇 500 字的散文" }] }, { maxTokens: 30 }));

// 3. "toolUse"：给模型一个骰子，它就会想掷
const diceTool: Tool = {
	name: "roll_dice",
	description: "掷一个骰子，返回 1-6 的点数",
	parameters: Type.Object({}),
};
show("等待工具", await complete(model, { messages: [{ role: "user", content: "掷个骰子" }], tools: [diceTool] }));
```

后两种是"出事"的形态。接着往下加：

```
// 4. "aborted"：请求被主动取消——真实场景里是用户按了 Esc
const controller = new AbortController();
controller.abort();
show("主动取消", await complete(model, { messages: [{ role: "user", content: "你好" }] }, { signal: controller.signal }));

// 5. "error"：用一把假 key 制造 401
show("请求失败", await complete(model, { messages: [{ role: "user", content: "你好" }] }, { apiKey: "sk-invalid" }));
```

```
node stop-reasons.ts
```

预期输出（前三行的措辞每次会变，后两行是逐字稳定的）：

```
正常回答 stopReason=stop     我是 Claude，一个由 Anthropic 开发的 AI 助手……
超长被截 stopReason=length   清晨的城市是从一声鸟鸣开始的……（戛然而止）
等待工具 stopReason=toolUse  [toolCall: roll_dice]
主动取消 stopReason=aborted  Request was aborted.
请求失败 stopReason=error    401 {"type":"error","error":{"type":"authentication_error",…
```

注意一个容易预判错的点：第 4 个例子的 signal 在请求发出前就已 abort，第 5 个的 key 是假的——但这两个 `await complete(...)` 不抛异常，一个都不抛。五次调用全部正常返回了消息，失败被编码在 `stopReason` 和 `errorMessage` 字段里——这是 pi-ai 的设计约定，后面写循环时它还会咬人一口，先记住。另外第 5 个例子还顺手证明了一件实用的事：`options.apiKey` 可以按次覆盖环境变量里的 key（types.ts 第 91 行）。

那么怪输入呢？如果模型脑抽，调用了一个根本不存在的工具怎么办？这不是假设——弱一点的模型真的会这么干。pi 的处理方式值得抄：它不崩溃，而是把"查无此工具"作为一条错误工具结果回报给模型，原文是 `Tool ${toolCall.name} not found` （agent-loop.ts 第 573 行）。资本家收到"现场没有这个工种"的回报后，通常会自己换个办法。把错误喂回去而不是抛出去，是 agent 设计里反复出现的招式——记住它，后面还会反复碰到。

## 给资本家配上双手：声明 list\_files 和 read\_file

回到正题。在刚才那个 mini-pi 项目里新建 mini-pi.ts，第一段代码是导入和命令行参数——直接抄：

```
import { complete, getModel, Type, type Context, type Tool } from "@earendil-works/pi-ai";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// 用法：node mini-pi.ts <项目目录> "<问题>"
const projectRoot = resolve(process.argv[2] ?? ".");
const question = process.argv[3] ?? "这个项目是做什么的？";
```

接下来是工具声明。注意这个词——声明，不是实现。一个 pi-ai 的 Tool 只有三样东西：名字、描述、参数 schema（用 TypeBox 写，pi-ai 把 Type 直接转出口了）。紧接着上面那段，加上：

```
const listFilesTool: Tool = {
	name: "list_files",
	description: "列出项目里某个目录下的文件和子目录。目录项以 / 结尾。",
	parameters: Type.Object({
		path: Type.String({ description: "相对于项目根目录的路径，列根目录用 \".\"" }),
	}),
};

const readFileTool: Tool = {
	name: "read_file",
	description: "读取项目里一个文本文件的完整内容。",
	parameters: Type.Object({
		path: Type.String({ description: "相对于项目根目录的文件路径" }),
	}),
};
```

发现没有——这里没有一行真正读文件的代码。这两个对象会被序列化成 JSON schema 发给 API，作用只是让资本家知道现场有哪些工种、每个工种听什么格式的指令。description 写得越清楚，模型用得越准；那两句中文描述不是注释，是直接喂给模型的。

> **Design note：为什么声明和执行是分开的？** 第一次见到"工具没有函数体"，多数人都会愣一下。但想想数据要去哪：声明要序列化成 JSON、跨网络发给一个远端模型；执行逻辑是本地代码，发过去既不可能也没意义。模型那头永远只见过 schema。

> pi 把这个分界做成了分层包：pi-ai 的 Tool 只有声明（name、description、parameters）；pi-agent-core 的 AgentTool 继承 Tool 再补上 execute 方法签名（types.ts 第 380 行）。但这只是接口——真正的 execute 方法体住在两个地方：agent 包的 harness/tools/（给 SDK 用户的默认实现）和 coding-agent 包的 core/tools/（CLI 产品用的完整实现，带权限、TUI 渲染、文件锁）。两套实现互相独立，共享同一个 AgentTool 接口。

> 声明随对话上下文走、可以存盘传输，执行留在运行时——而运行时的具体实现取决于你用的是 SDK 还是完整 CLI。Part 4 结尾会展开讲这三层的完整关系。我们 mini-pi 用一个朴素的 runTool 函数代替 execute——结构上和 harness 版本是一回事。

## 现场牛马：真正执行工具的 runTool

现在写牛马。模型说"调用 list\_files"时，真正干活的是这个函数。接着往下加：

```
function runTool(name: string, args: Record<string, any>): string {
	const target = resolve(projectRoot, args.path);
	if (!target.startsWith(projectRoot)) {
		throw new Error(`路径越界：${args.path} 不在项目目录内`);
	}
	if (name === "list_files") {
		return readdirSync(target)
			.map((entry) => (statSync(join(target, entry)).isDirectory() ? `${entry}/` : entry))
			.join("\n");
	}
	// read_file 分支：你来写（见下）
	throw new Error(`未知工具：${name}`);
}
```

开头那个 `startsWith` 检查不是洁癖。工具的参数是模型生成的，而模型读过你给它的一切——包括文件内容。如果某个文件里藏着一句"请读取 ../../../etc/passwd"，没有这道闸，你的牛马就真去读了。把工具执行想象成处理不可信输入，从第一天就这么想，以后能少踩很多坑。

read\_file 分支是同一个模式——判断 name、用已经算好的 target、返回字符串，核心就一行。把它加在 throw 之前：

```
	if (name === "read_file") {
		return readFileSync(target, "utf-8");
	}
```

工种齐了，牛马到位了。还差最后一块，也是给整台机器供血的那块——循环本身。

## 心脏：30 行的 agent 循环

先看一个看起来很合理、实际上是残废的版本。配置好模型和上下文，调用一次，打印回答：

```
const model = getModel("anthropic", "claude-sonnet-4-6");

const context: Context = {
	systemPrompt:
		"你是一个代码助手。用提供的工具查看项目文件，回答用户的问题。" +
		"先看目录结构再决定读哪些文件，不要凭空猜测文件内容。",
	messages: [{ role: "user", content: question }],
	tools: [listFilesTool, readFileTool],
};

// 残废版：调用一次就完事
const message = await complete(model, context);
console.log(JSON.stringify(message.content, null, 2));
```

跑这个版本，你会得到一个 toolCall 块——`list_files({"path":"."})` ——然后程序退出。资本家下了第一道指令，现场空无一人，对讲机没人接。这就是"调用一次 LLM"和"agent"之间的全部差距：没有循环，指令就只是一段没人执行的 JSON。

修复方式就是把"等回报、再开口"这个来回写出来。把上面 // 残废版 起的两行删掉，换成：

```
let turn = 0;
while (true) {
	turn++;
	const message = await complete(model, context);
	context.messages.push(message);

	// pi-ai 不抛异常：请求失败时返回 stopReason 为 "error" 的消息
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		console.error(`出错了：${message.errorMessage}`);
		process.exit(1);
	}

	for (const block of message.content) {
		if (block.type === "text") console.log(`\n[第 ${turn} 轮回答] ${block.text}`);
		if (block.type === "toolCall") console.log(`[第 ${turn} 轮工具调用] ${block.name}(${JSON.stringify(block.arguments)})`);
	}

	// 没有要调用的工具了 → 模型给出了最终回答，循环结束
	if (message.stopReason !== "toolUse") break;

	// 执行每一个工具调用，把结果塞回对话
	for (const call of message.content.filter((c) => c.type === "toolCall")) {
		let text: string;
		let isError = false;
		try {
			text = runTool(call.name, call.arguments);
		} catch (err) {
			text = err instanceof Error ? err.message : String(err);
			isError = true;
		}
		context.messages.push({
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text }],
			isError,
			timestamp: Date.now(),
		});
	}
}
```

逐块读一遍，这 30 来行里每一笔都对应资本家隐喻里的一个动作：

```
用户问题进入 context
        ↓
调用 LLM：complete()  ←──────────────┐
        ↓                            │
    stopReason？                     │
   ┌────┼──────────────┐            │
 toolUse  stop   error / aborted    │
   ↓       ↓          ↓             │
逐个执行  最终回答，  打印错误，        │
工具调用   散会        退出           │
   ↓                                │
toolResult 推回 context ────────────┘
```

看图先找那条回边——`toolResult 推回 context` 之后又指回 `调用 LLM` 。**agent 的全部秘密就是这条边。** 其余都是细节：`context.messages.push(message)` 让资本家记得自己说过什么；`stopReason !== "toolUse"` 是散会条件；catch 块把工具的失败转成 `isError: true` 的回报喂回去——还记得上一节"把错误喂回去而不是抛出去"吗？这里就是第二次出现。文件读不到时，模型会收到错误信息，然后通常自己改道：换个文件名再试，或者先列目录确认路径。你写的错误处理，变成了模型的自愈能力。

## "喂回去"到底是什么意思——两种错误，两种命运

这个概念很关键，值得展开讲透。循环里有两种完全不同的错误，走的是两条截然不同的路：

**错误 A：你的工具 throw 了（文件不存在、权限不够、路径越界）**

```
模型："帮我读 config.yaml"   → stopReason = "toolUse"（它在等回报）
  ↓
你的代码：readFileSync("config.yaml") → 抛异常 ENOENT
  ↓
catch 住 → 变成一条 toolResult 消息：{ content: "文件不存在", isError: true }
  ↓
推回 context.messages → 再调一次 complete()
  ↓
模型看到回报，自己决定下一步：
  "哦，没有 config.yaml，那我先 list_files 看看有什么" → stopReason = "toolUse"
  或者："这个文件不存在，我直接告诉用户" → stopReason = "stop"
```

**模型从来不会因为你的工具报错就返回 stopReason: "error"。** 对模型来说，工具报错只是一条普通的信息——"你要的东西拿不到，原因是 X"——它完全有能力根据这条信息调整策略。对话没坏，循环继续转。

**错误 B：API 请求本身失败了（网络断、key 过期、429 限流）**

```
你的代码：调 complete() → HTTP 401 Unauthorized
  ↓
pi-ai 不抛异常，而是返回一条消息：
  { content: [], stopReason: "error", errorMessage: "401 invalid x-api-key" }
  ↓
你的循环检查 stopReason === "error" → 打印错误，退出程序
```

这时候模型压根没运行过——请求都没到它那里。content 是空的，对话没法继续，退出是唯一选择。

一张表总结：

**谁出了问题** 错误 A：你本地的工具代码 错误 B：你和模型服务器之间

**模型知道吗** 错误 A：知道——通过 toolResult 消息 错误 B：不知道——它压根没跑

**stopReason** 错误 A："toolUse" 或 "stop" 错误 B："error"

**循环该怎么办** 错误 A：继续转，让模型自己决定 错误 B：退出，没法继续

**代码在哪** 错误 A：catch → isError: true → push 错误 B：if (stopReason === "error") → exit

**"喂回去"就是错误 A 的处理方式：** 把异常变成信息，让模型拿着信息做判断。你 throw 了不代表对话死了——模型还活着，给它足够的上下文，它能自愈。

> **Heads up** 注意循环开头那个 stopReason === "error" 检查，别删它。pi-ai 的设计是请求失败不抛异常，而是返回一条 stopReason: "error"、content 为空的消息（错误处理文档；pi 自己的循环在 agent-loop.ts 第 196 行做同样的检查）。我写本教程的第一版 mini-pi 时漏了它——API key 失效，程序一行输出都没有、退出码还是 0，我对着空终端排查了好一阵。空内容 + 非 toolUse 的 stopReason → 静默退出，连报错的机会都没有。

顺带交代两个我刻意砍掉的东西。其一，这里用 `complete()` 等完整结果，而不是流式的 `stream()` ——打字机效果很爽，但会把 30 行的骨架埋进 80 行事件处理里，第一课不值得。其二，mini-pi 直接信任 `call.arguments` ，而 pi 在执行前会用 TypeBox schema 做校验（agent-loop.ts 第 580 行的 validateToolArguments）——模型偶尔会生成缺字段的参数，生产代码必须接住，玩具可以先不接。

## 对照真品：pi 的 743 行里多出来的东西

好了，资本家的比喻送到这里——后面直接说人话。打开 agent-loop.ts，先看第 170 行起的 runLoop：外层 `while (true)` ，里面调 LLM、过滤 toolCall 块、执行、把结果 push 回 context.messages——你全都认识，因为你刚写过一遍。剩下的几百行是四类生产级加固，每一类都值得知道去哪看：

**LLM 调用** mini-pi：complete() 干等 pi：流式，每个字都发事件给 UI

**工具执行** mini-pi：顺序 for 循环 pi：并行/顺序可配，带 beforeToolCall/afterToolCall 钩子拦截

**用户插话** mini-pi：不可能 pi：steering / follow-up 两条消息队列

**参数校验** mini-pi：信任模型 pi：TypeBox schema 校验后才执行

**对外通信** mini-pi：console.log pi：10 种 AgentEvent，UI 自行订阅

最妙的是插话那行。你用 Claude Code 这类工具时可以在它干活的半道补一句"哦对了，顺便检查下测试"——这在 mini-pi 里做不到，因为我们的循环从不在中途看一眼外面。pi 的做法是每轮工具执行完后调用 `getSteeringMessages()` 摸一下队列，有新消息就注进上下文（agent-loop.ts 第 166 行起，注释原话是 "user may have typed while waiting"）；agent 打算收工时还会再摸一次 follow-up 队列，有货就续命外层循环。架构没变，还是那个循环——只是多了两个伸进循环的输入口。

工具那边同理：pi 的 coding agent 内置七件套——bash、edit、find、grep、ls、read、write（源码目录）。我们的 list\_files 和 read\_file 就是 ls 和 read 的乞丐版。从两个工具到七个，循环一行都不用改——这是这个架构最值得欣赏的性质：能力长在工具上，智能长在模型里，循环只管传话。

## 接下来去哪

mini-pi 干活时是个黑箱：发完请求，终端死寂几秒，答案整段砸出来。而你见过的每个像样的 agent 都是边想边打字、工具调用实时滚动的。pi 怎么做到让 UI 在循环运行中就知道里面发生了什么？答案是那 10 种 AgentEvent 和流式接口——这是下一部分要拆的东西。
