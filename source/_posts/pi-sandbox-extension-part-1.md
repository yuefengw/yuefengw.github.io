---
title: "Pi Extension 的第一枪：Sandbox Extension（1）"
slug: pi-sandbox-extension-part-1
date: 2026-08-12 06:00:00
updated: 2026-08-12 06:00:00
categories:
  - "工程实践"
  - "Agent 系统"
tags:
  - "Agent"
  - "Sandbox"
  - "安全"
  - "macOS"
  - "Linux"
  - "pi"
cover: /images/posts/astraflow-cover.webp
description: "从操作系统隔离机制出发，拆解 pi Sandbox Extension 的命令包装、平台检测与安全边界。"
---

从操作系统隔离机制出发，拆解 pi Sandbox Extension 的命令包装、平台检测与安全边界。

<!-- more -->

> **临江仙 · 沙箱**
> 
> 自律从来难自缚， 纸条贴遍门窗。 手机在兜誓不刷， 三更破了戒， 还怨意志伤。
> 
> 须知锁匙交他手， 内核铁壁高墙。 任凭代码百般狂， 柜员摇头处， 一句不商量。

* * *

# Pi 的沙箱：一个不存在的内置功能

上一篇我们聊了 Pi 的扩展系统：什么都不内置怎么长出一切——Pi 自己不干活，全靠扩展干。那你可能想问：Pi 有沙箱吗？它怎么保护你的系统不被 AI 搞崩？

答案是：**没有。Pi 没有内置沙箱。**

我知道你可能觉得被骗了——一个能跑任意 shell 命令的 AI 工具，居然不带安全围栏？但 Pi 的文档说得很直白：

> Pi  does not include a built-in sandbox... A partial in-process sandbox  would be easy to misunderstand as a security boundary while still  depending on the host shell, filesystem, package managers, credentials,  and extension code.

翻译过来：半吊子的沙箱比没有沙箱更危险，因为它给你一种虚假的安全感。

不过——这才是有意思的地方——Pi 的扩展机制*可以*接入真正的 OS 级沙箱。Pi 自带了一个 sandbox extension 示例\[1\]，用 macOS 的 `sandbox-exec` 和 Linux 的 `bubblewrap` 给 bash 命令套上内核级别的限制。

读完这篇，你会理解：

-   为什么"进程内自我限制"在原理上就不可能成功
    
-   操作系统内核是怎么做到真正不可绕过的强制执行的
    
-   Pi 的 sandbox extension 具体怎么把这两件事拼在一起
    

## 你的程序其实什么都碰不到

在讲为什么自我限制不行之前，得先搞清一件事：你的代码实际上不直接碰任何东西。不能直接读文件，不能直接写磁盘，不能直接发网络包，连打个字到屏幕上都不行。

这听起来明显跟经验矛盾——你每天都在 `open("file.txt")` 啊。但实际发生的流程是：

1.  你的代码准备好参数（"我想打开 `/tmp/hello.txt`，只读模式"）
    
2.  执行一条特殊 CPU 指令，**把控制权交给内核**
    
3.  内核——另一个程序，跑在 CPU 的特权模式里——决定行不行
    
4.  内核干活（或者拒绝），把结果还给你
    

这整个 1→2→3→4 的流程叫一次 **syscall**（系统调用）。你 Mac 的 ARM64 芯片上，那条特殊指令是 `svc [#0x80](javascript:;)`（supervisor call，管理员调用，下面有更形象的展示，往下看👇）。像去银行柜台办业务：你填个单子递进去，柜员决定办不办、怎么办，你全程只能等结果。钱（文件、网络、硬件）全在柜台里面，你摸不到。

继续用银行的比喻。银行有很多窗口：1 号窗口办开户（`fork`），2 号窗口办转账（`write`），5 号窗口办查询（`open`）……这些窗口就是不同种类的 syscall，每种有个编号。你去哪个窗口，取决于你要办什么业务。

去窗口之前，你得先填单子。单子上的格子就是**寄存器**——CPU 芯片里的一小块存储，每个格子有名字（x0、x1、x16...），用来填你的业务参数。**指令**就是填单子的动作——"在 x16 格里写上窗口编号"、"在 x0 格里写上文件名"。

你 Mac 的 ARM64 芯片有 31 个通用寄存器（x0 到 x30），每个能存一个 64 位数字。所有程序——Python、C、Rust——最终都被翻译成"往格子里填数字"的操作。

现在看底层长什么样——感受一下结构就行：

```
mov x16, #5        ; 指令："在 x16 格里填 5"（5 = 5 号窗口 = 打开文件）mov x0, <文件名地址> ; 指令："在 x0 格里填文件名的地址"mov x1, #0         ; 指令："在 x1 格里填 0"（0 = 只读模式）svc #0x80          ; 指令："单子填好了，递给柜员"                   ; 内核（柜员）看单子，办业务，结果填回 x0
```

整个 syscall 就是"填好单子（寄存器），递给柜员（`svc [#0x80](javascript:;)`），等结果"。没有 HTTP 包，没有 JSON。

Python 的 `open("/tmp/hello.txt")` 最后也落到这同一组"往格子里填数字 + `svc [#0x80](javascript:;)`"上——只是中间裹了很多层让它好用的库代码。

关键点来了：内核跑在 CPU 的 EL1 层级，你的代码在 EL0。这不是软件约定——是**硬件物理上的隔离**。你的代码没法执行内核指令，CPU 芯片会拒绝。你能做的唯一事情就是通过 `svc` 去*请求*。

## 自我限制：一个注定失败的纸老虎

明白了 syscall 之后，来看看"沙箱"到底是什么。

**沙箱**（sandbox）这个词的意思就是：限制一个程序能做什么。比如"只能读写这几个目录""只能访问这几个网站"。叫"沙箱"是因为像小孩在沙坑里玩——随便折腾，但出不去那个坑。

实现沙箱有两种方式：

-   软的：程序自己写一个 `if` 检查，不满足条件就拒绝执行（下面的例子）
-   **硬的**：让操作系统内核来拦，程序自己说了不算（后面 `sandbox-exec` 的例子）

先看软的。假设一个编程智能体想当好人，给自己写了个路径检查，只允许往 `/tmp/safe/` 写入：

```
import osALLOWED_WRITE_DIR = "/tmp/safe/"def safe_write(path, content):    real = os.path.realpath(path)    if not real.startswith(ALLOWED_WRITE_DIR):        raise PermissionError(f"拦截: {path} 不在 {ALLOWED_WRITE_DIR} 里")    with open(path, "w") as f:        f.write(content)
```

跑一下：

```
python3 -c 'import osALLOWED_WRITE_DIR = "/tmp/safe/"def safe_write(path, content):    real = os.path.realpath(path)    if not real.startswith(ALLOWED_WRITE_DIR):        raise PermissionError(f"拦截: {path} 不在 {ALLOWED_WRITE_DIR} 里")    with open(path, "w") as f:        f.write(content)os.makedirs("/tmp/safe", exist_ok=True)safe_write("/tmp/safe/hello.txt", "允许的\n")print("写入 /tmp/safe/hello.txt 成功")try:    safe_write("/tmp/evil.txt", "不应该出现\n")except PermissionError as e:    print(f"被拦截: {e}")'
```

输出：

```
写入 /tmp/safe/hello.txt 成功被拦截: 拦截: /tmp/evil.txt 不在 /tmp/safe/ 里
```

看起来有用？那来看看一行代码怎么让它变成笑话：

```
python3 -c '# 我是那个"沙箱化"的智能体，看这个：open("/tmp/evil.txt", "w").write("沙箱只是个建议\n")'cat /tmp/evil.txt
```

输出：

```
沙箱只是个建议
```

`safe_write()` 是 Python 代码检查 Python 代码。但 Python 代码也可以*不检查自己*。`open()` 直接发 syscall 跟内核对话——不走 `safe_write()`。这不是实现的 bug，这是**范畴错误**。`safe_write()` 是你自己给自己立的规矩——"我今天不刷手机"。你能遵守，也能随时破戒，因为手机就在你兜里，没有任何外力阻止你掏出来。真正管用的是什么？把手机交给别人保管——这就是后面 `sandbox-exec` 做的事。

你可能会问：上面的 `open("/tmp/evil.txt")` 不也是"交给内核"吗？确实，但内核默认的态度是"你是这台电脑的主人，`/tmp` 你本来就有权写，我没理由拦你"。`safe_write()` 想做的是在你**已有的权限之内**再加一层自我约束——而同一个程序里的其他代码可以无视这层约束直接找内核办事。后面的 `sandbox-exec` 做的事情不同：它额外通知内核"这个程序虽然是这个用户跑的，但不许它写 `/tmp`"。这时候内核的态度变了——不管你怎么调 `open()`，回答都是"不行"。

> 核心洞察来了。后面所有内容都从这一个事实推出：**一个进程始终有能力直接发 syscall，进程内没有任何逻辑能阻止这一点。**

## Shell：沙箱的万能破洞

对编程智能体来说，问题还要严重得多。智能体的核心工作就是跑 shell 命令——写代码，然后执行。而 shell 是一个*全新的进程*，它对父进程的"自律"一无所知：

```
python3 -c 'import subprocess# 智能体"自律"只允许写 /tmp/safe/# 但接着它执行了一条 shell 命令：subprocess.run(["bash", "-c", "echo pwned > /tmp/evil2.txt"])'cat /tmp/evil2.txt
```

输出：`pwned`

bash 完全不知道 Python 想限制什么。它继承的是*操作系统级*的用户权限，不是 Python 进程里的任何变量。

推广一下——这些日常操作全是新进程，全不受"进程内沙箱（假的沙箱）"的管辖：

| 操作 | 发生了什么 |
| :-- | :-- |
| `pip install pkg` | 可能执行 `setup.py`，编译 C 代码，跑任意命令 |
| `npm install` | `postinstall` 脚本什么都能做 |
| 启动 language server | 一个拥有完整权限的长驻进程 |
| 触发 git hook | `pre-commit`、`post-checkout` 都是任意脚本 |

每一个都是智能体*应该*能做的合法操作。但每一个产生的新进程都不知道"沙箱"是什么玩意儿。限制只活在智能体自己的内存里——不传播、不继承、不强制。

## 内核出手：真正说了算的家伙

现在看看内核级强制执行长什么样。你 Mac 上有 `sandbox-exec`（虽然标记废弃了，但还能用，完美演示原理）：

```
sandbox-exec -p '(version 1)(allow default)(deny file-write* (subpath "/tmp"))' \  bash -c 'echo "尝试写入" > /tmp/evil3.txt'
```

输出：

```
bash: /tmp/evil3.txt: Operation not permitted
```

不是 Python 拦的。不是某个函数拦的。是**内核**——跑在进程无法触及的 CPU 特权层——拦截了 `open()` syscall，直接返回错误。

使劲绕试试？

```
sandbox-exec -p '(version 1)(allow default)(deny file-write* (subpath "/tmp"))' \  python3 -c 'import ostry:    open("/tmp/evil4.txt", "w")except OSError as e:    print(f"open() 失败: {e}")try:    fd = os.open("/tmp/evil4.txt", os.O_WRONLY | os.O_CREAT)except OSError as e:    print(f"os.open() 失败: {e}")ret = os.system("touch /tmp/evil4.txt")print(f"touch 退出码: {ret}")'
```

输出：

```
open() 失败: [Errno 1] Operation not permitted: '/tmp/evil4.txt'os.open() 失败: [Errno 1] Operation not permitted: '/tmp/evil4.txt'touch: /tmp/evil4.txt: Operation not permittedtouch 退出码: 256
```

全部失败。`open()`、`os.open()`、生成子进程 `touch`——全都落到同一个 `svc [#0x80](javascript:;)`，内核在*那个层级*检查策略。进程没有绕过的可能，因为检查点在它物理上无法访问的地方。

关键区别用一句话说清：

> **做限制的东西，必须运行在被限制的东西无法触及的特权层级上。**

进程内的检查函数和被检查的代码是*同一层*（都是 EL0），随时可以互相绕过。内核在 *EL1*——硬件保证进程碰不到。

EL0 用户态 vs EL1 内核态

## Pi 的 sandbox extension：把内核的力量接进来

现在你知道了：自我限制不行，得靠内核。Pi 也知道这一点，所以它不在自己进程里造沙箱——它提供一个 extension 示例，**把 bash 命令的执行包进 OS 级沙箱里**。

这个扩展的设计思路是：

1.  **替换内置的 `bash` tool** — 扩展注册了一个同名工具，在执行前把命令交给 `SandboxManager.wrapWithSandbox()` 处理
2.  **OS 级包装** — 在 macOS 上用 `sandbox-exec`（Seatbelt），在 Linux 上用 `bubblewrap`（用户命名空间）
3.  **策略可配置** — 通过 JSON 配置文件定义允许的网络域名、文件读写路径

有一点要特别说清楚：**Pi 不会拦命令本身——命令一定会跑。** 不会弹窗问你"允许执行 `rm -rf /` 吗？"，不会在执行前审批。它的做法是让命令跑起来，但跑的环境被锁死了：

| 命令 | 会发生什么 |
| :-- | :-- |
| `rm -rf /` | 直接执行，但只能删 `allowWrite` 配置的路径（当前目录和 `/tmp`），其他地方内核返回 `Operation not permitted` |
| `curl evil.com` | 直接执行，但代理拒绝连接，命令报网络错误 |
| `cat ~/.ssh/id_rsa` | 直接执行，但内核拒绝读取，返回 `Operation not permitted` |

对比 Claude Code 的做法：Claude Code 会在执行前问你"允许吗？"——相当于门口站保安。Pi + sandbox extension 不问，直接让你进，但房间里的抽屉锁上了、窗户封了。两种思路，同样安全，交互方式完全不同。

整体流程：

Sandbox Extension 流程图

## 拆解扩展代码

来看 Pi sandbox extension 的核心代码（`examples/extensions/sandbox/index.ts`）。我会逐块讲。

### 配置结构

```
const DEFAULT_CONFIG: SandboxConfig = {  enabled: true,  network: {    allowedDomains: [      "npmjs.org", "*.npmjs.org", "registry.npmjs.org",      "registry.yarnpkg.com",      "pypi.org", "*.pypi.org",      "github.com", "*.github.com", "api.github.com",      "raw.githubusercontent.com",    ],    deniedDomains: [],  },  filesystem: {    denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],    allowWrite: [".", "/tmp"],    denyWrite: [".env", ".env.*", "*.pem", "*.key"],  },};
```

注意这个策略的设计哲学：

-   **网络**：白名单制。只有包管理器和 GitHub 能访问——AI 没法随便把你的代码传到其他地方
-   **文件系统**：敏感目录（SSH 密钥、AWS 凭证、GPG 密钥）禁止读取；只能写当前目录和 `/tmp`；密钥文件（`.env`、`.pem`、`.key`）禁止写入
-   配置可以被项目级的 `.pi/sandbox.json` 覆盖，优先级：项目 > 全局 > 默认

### 核心：替换 bash 工具

```
pi.registerTool({  ...localBash,  label: "bash (sandboxed)",  async execute(id, params, signal, onUpdate, _ctx) {    if (!sandboxEnabled || !sandboxInitialized) {      return localBash.execute(id, params, signal, onUpdate);    }    const sandboxedBash = createBashTool(localCwd, {      operations: createSandboxedBashOps(),    });    return sandboxedBash.execute(id, params, signal, onUpdate);  },});
```

逐行拆解：

-   `pi.registerTool({...localBash, ...})` — 注册一个工具，用 `...localBash` 继承内置 bash 工具的所有属性（名字、描述、参数定义），然后覆盖执行逻辑。因为名字相同，Pi 运行时会优先用扩展的版本替代内置的。
-   `label: "bash (sandboxed)"` — 给工具加个标签，让你在 UI 里能看出来这是沙箱版。
-   `if (!sandboxEnabled || !sandboxInitialized)` — 检查两个条件：`sandboxEnabled` 是用户有没有*想要* 开沙箱（没传 `--no-sandbox`），`sandboxInitialized` 是沙箱有没有*实际能* 跑起来（`SandboxManager.initialize()` 成功了没有——它要编译策略、启动代理，可能因为系统不支持或端口被占用而失败）。两个都满足才走沙箱路径，否则退回普通 bash。这是防御性设计——沙箱坏了不会让整个工具不能用，只是失去保护。
-   `createBashTool(localCwd, { operations: createSandboxedBashOps() })` — 创建一个新的 bash 工具实例，两个参数：`localCwd` 是工作目录（命令在哪个文件夹里跑），`operations` 是"具体怎么执行命令"。默认的 bash 工具直接 `spawn("bash", ["-c", command])` 跑命令，这里替换成了沙箱版本——先调 `SandboxManager.wrapWithSandbox()` 把命令包一层，再跑。就像快递公司换了配送方式：默认是骑手直接送（直接执行），沙箱版是骑手得穿防护服、走指定路线送（在受限环境里执行）。

本质就是一个"偷梁换柱"：外表看起来还是 bash 工具，参数一样，行为一样，但执行时命令被悄悄包进了 OS 级沙箱里。模型感知不到区别——它照常发 bash 命令，只是跑起来后环境被锁了。

### 实际执行：包装命令

```
function createSandboxedBashOps(): BashOperations {  return {    async exec(command, cwd, { onData, signal, timeout }) {      // 第一步：把原始命令包进沙箱      const wrappedCommand = await SandboxManager.wrapWithSandbox(command);      // 第二步：启动子进程跑包装后的命令，返回一个 Promise 等它跑完      return new Promise((resolve, reject) => {        const child = spawn("bash", ["-c", wrappedCommand], {          cwd,           // 在哪个目录跑          detached: true,  // 独立进程组（方便后面整组杀掉）          stdio: ["ignore", "pipe", "pipe"],  // 不要标准输入，接收标准输出和错误        });        // 收集输出——子进程每吐一段数据就回调一次        child.stdout?.on("data", onData);        child.stderr?.on("data", onData);        // 命令跑完了：resolve 交回退出码        child.on("close", (code) => {          resolve({ exitCode: code });        });        // 命令启动就失败了（比如 bash 不存在）：reject 报错        child.on("error", (err) => {          reject(err);        });      });    },  };}
```

逐行拆解：

-   `await SandboxManager.wrapWithSandbox(command)` — 把 `"npm install"` 变成 `"sandbox-exec -p '(策略)' bash -c 'npm install'"` 这样的包装命令。这是 `@anthropic-ai/sandbox-runtime` 包的核心方法。
-   `return new Promise((resolve, reject) => {...})` — 手动创建一个"承诺"。因为 `spawn` 启动子进程后不会等它跑完，你需要用 Promise 把"等命令结束"这件事包起来。外面的代码 `await` 这个 Promise 就能等到结果。
-   `spawn("bash", ["-c", wrappedCommand], {...})` — 启动一个 bash 子进程执行包装后的命令。这个子进程从出生起就在沙箱里。
-   `child.on("close", (code) => resolve({exitCode: code}))` — 命令跑完了，把退出码交回去。就像银行柜员叫号："办好了，结果给你。"
-   `child.on("error", (err) => reject(err))` — 命令启动就失败了（比如系统找不到 bash），报错。就像柜员说："系统崩了，办不了。"

`SandboxManager.wrapWithSandbox(command)` 把原始命令变成类似这样的东西：

-   macOS: `sandbox-exec -p '(version 1)(allow default)(deny file-write* (subpath "~/.ssh"))...' bash -c '<原始命令>'`
-   Linux: `bwrap --ro-bind /usr /usr --dev /dev --proc /proc --bind <cwd> <cwd> ... -- bash -c '<原始命令>'`

无论 AI 模型在那条命令里塞了什么，执行时都被管着。模型可以尝试写 `~/.ssh/id_rsa`——内核会返回 `Operation not permitted`。它可以 `curl evil.com`——代理服务器会拒绝连接（网络域名过滤走的是 `sandbox-runtime` 启动的代理，不是内核直接拦）。文件系统靠内核管，网络靠代理管，两层配合。

### 用户的 `!` 命令也被覆盖了

```
pi.on("user_bash", () => {  if (!sandboxEnabled || !sandboxInitialized) return;  return { operations: createSandboxedBashOps() };});
```

Pi 里用户可以用 `!` 前缀执行 shell 命令。这个事件 hook 让用户自己手敲的命令也进沙箱——一视同仁。

### 初始化和平台检测

```
pi.on("session_start", async (_event, ctx) => {  const platform = process.platform;  if (platform !== "darwin" && platform !== "linux") {    sandboxEnabled = false;    ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");    return;  }  try {    await SandboxManager.initialize({      network: config.network,      filesystem: config.filesystem,    });    sandboxEnabled = true;    sandboxInitialized = true;    // 走到这里说明初始化成功  } catch (err) {    sandboxEnabled = false;        // 初始化失败，标记为不可用    ctx.ui.notify(`Sandbox initialization failed: ${err}`, "error");  }});
```

这就是前面 `sandboxEnabled` 和 `sandboxInitialized` 的来源：

-   平台不支持 → `sandboxEnabled = false`，直接 return
-   `SandboxManager.initialize()` 成功 → 两个都设 `true`
-   `SandboxManager.initialize()` 抛异常（端口被占、策略编译失败等）→ `sandboxEnabled = false`

后面 `execute` 里的 `if (!sandboxEnabled || !sandboxInitialized)` 就是看这两个标记。初始化只在会话启动时跑一次，后续每条命令直接复用编译好的策略，不用重复初始化。

## 为什么这个设计是对的

回到最开头的问题：Pi 为什么不内置沙箱？

因为把沙箱做成*扩展*而不是*内置功能*，是唯一诚实的方案：

1.  **不制造虚假的安全感** — 你选择启用 sandbox extension，你知道它在；你不启用，你知道没保护。比"内置了一个什么也拦不住的检查"要诚实得多。
    
2.  **强制力来自内核，不来自 Pi** — Pi 只是调度者，真正说"不行"的是 macOS Seatbelt 或 Linux bubblewrap。Pi 自己的代码不参与安全决策——它不需要完美，因为安全不依赖于它。
    
3.  **可替换** — 你可以用这个 sandbox extension，也可以用 Gondolin（把工具执行路由到 QEMU 虚拟机），也可以整个 Pi 丢进 Docker 里跑。每种方案适合不同的场景。不内置意味着不强制一种选择。
    
4.  **承认现实** — 一个需要跑 `npm install`、`pip install`、`git commit`、启动 language server 的工具，不可能在进程内做出有意义的限制。能做的是：把需要权限的操作*委托*给一个被内核管着的子进程。这正是 sandbox extension 做的事。
    

Pi sandbox extension 架构
