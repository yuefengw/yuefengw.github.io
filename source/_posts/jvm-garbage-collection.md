---
title: "【JVM】垃圾回收"
slug: jvm-garbage-collection
date: 2026-01-06 21:29:15
updated: 2026-01-16 10:10:41
categories:
  - "Java"
  - "JVM"
tags:
  - "JVM"
  - "Java"
cover: /images/csdn/jvm-garbage-collection/01.webp
description: "本文介绍了JVM垃圾回收的关键机制。判断对象可回收的方法包括引用计数法（存在循环引用问题）和可达性分析算法（通过GC Roots遍历）。垃圾回收算法主要有标记清除（产生碎片）、标记整理（无碎片但慢）和复制算法（无碎片但占用双倍空间）。分代回收将堆分为新生代（Minor GC）和老年代（Full GC），采用不同策略。…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/156571441"
original_platform: CSDN
---

本文介绍了JVM垃圾回收的关键机制。判断对象可回收的方法包括引用计数法（存在循环引用问题）和可达性分析算法（通过GC Roots遍历）。垃圾回收算法主要有标记清除（产生碎片）、标记整理（无碎片但慢）和复制算法（无碎片但占用双倍空间）。分代回收将堆分为新生代（Minor GC）和老年代（Full GC），采用不同策略。…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/156571441)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

### 1\. 如何判断对象可以被回收

#### 1.1 引用计数法

**原理：** 只要当前对象被引用一次，计数+1，不再引用的时候计数-1，为 0 回收。  
**弊端：** 无法解决循环引用问题![文章配图](/images/csdn/jvm-garbage-collection/01.webp)  
A 引用 B，B 引用 A，各自的引用计数始终是1，不能被回收掉。

#### 1.2 可达性分析算法

**原理：** 从 GC Roots 出发，沿着引用链寻找。找不到的对象即为垃圾。  
**GC Roots 包括：** 虚拟机栈（栈帧中的局部变量）引用的对象、方法区中类静态属性、常量引用的对象、本地方法栈（Native 方法）引用的对象、被同步锁（synchronized）持有的对象。  
jmap -dump:format=b,live,file=1.bin \[进程id\]

#### 1.3 四种引用

![文章配图](/images/csdn/jvm-garbage-collection/02.webp)  
强引用：GC Root引用叫做强引用，不会被回收  
软引用(SoftReference)：当没有被强引用时发生GC且内存不够时会被回收  
弱引用(WeakReference)：当没有被强引用时发生GC时会被回收  
虚引用(PhantomReference)：当被虚引用的对象被回收掉时，虚引用对象Cleaner会进入引用队列，ReferenceHandeder线程调用Cleaner.clean()方法，调用unsafe.freeMemory()释放直接内存  
终结器引用(FinalReference)：对象被重写finalize()方法且没被强引用会被引用，发生垃圾回收时， 终结器引用加入引用队列，finalizeHandeder线程调用对象的finalize()方法，下次一GC会被回收掉  
引用队列：软、弱、虚引用在对象被回收（或即将回收）时，引用对象本身会被放入队列，用于后续的清理与通知机制。

### 2 垃圾回收算法

#### 2.1 标记清除算法

![文章配图](/images/csdn/jvm-garbage-collection/03.webp)  
先标记不被GCRoot引用的对象，再“清除”，但是会产生很对内存碎片

#### 2.2 标记整理

![文章配图](/images/csdn/jvm-garbage-collection/04.webp)  
标记完了之后，将使用的内存移动在一起，没内存碎片，但是速度慢

#### 2.3 复制

![文章配图](/images/csdn/jvm-garbage-collection/05.webp)  
先标记，将使用的内存复制到TO区域， 再交换From和To，不会有内存碎片，需要占用双倍内存空间

### 3 分代垃圾回收

![文章配图](/images/csdn/jvm-garbage-collection/06.webp)  
长时间使用的对象放在老年代，新生代存放生命周期短的对象

新对象放在伊甸园中，新生代空间不够的时候，触发Minor GC：先标记，将伊甸园和From存活的对象复制到To，将幸存对象寿命+1，伊甸园的其他对象就被回收掉了，然后交换From和To的指针；Minor GC会引发stop the world，需要暂停其他用户线程，因为回收的时候会发生复制地址发生变化，回收结束了用户线程才恢复运行。  
当寿命达超过阈值（最大15，4bit）的时候晋升到老年代，大对象会直接晋升到老年代，当老年代空间不足先尝试触发Minor GC，之后仍然不足触发Full GC，stop the world时间更长，Full GC之后老年代还是不能存新对象则OOM

子线程触发OOM以后主线程不会意外结束  
参数：  
![文章配图](/images/csdn/jvm-garbage-collection/07.webp)

### 4 垃圾回收器

#### 4.1 串行

![文章配图](/images/csdn/jvm-garbage-collection/08.webp)  
单线程，适合堆内存较小，适合个人电脑  
`XX:+UseSerialGC=serial+ serialOld`, serial 工作在新生代采用复制算法，serialOld工作在老年代采用标记整理算法，只有一个垃圾回收线程在执行，期间阻塞其他线程

#### 4.2 吞吐量优先

![文章配图](/images/csdn/jvm-garbage-collection/09.webp)  
多线程，适合堆内存较大，多核CPU，让单位时间内STW的时间最短  
`-XX:+UseParallelGc~ -XX:+UseParallelOldGC`,ParallelGc工作在新生代采用复制算法，ParallelOldGC工作在老年代采用标记整理算法。多线程垃圾回收。

#### 4.3 响应时间优先 CMS

![文章配图](/images/csdn/jvm-garbage-collection/10.webp)  
多线程，适合堆内存较大，多核CPU，尽可能让单词STW的时间最短  
`-XX:+UseConcMarkSweepGC ~ -XX:+UseParNewGC-SerialOld` UseConcMarkSweepGC 并发标记清除算法，允许GC和用户并发运行，工作在老年代，并发失败时退化到SerialOld；UseParNewGC基于复制算法工作在新生代。初始标记和重新标记触发STW。  
并行运行的用户线程会产生新的垃圾，叫做浮动垃圾，需要预留空间保存浮动垃圾，`-XX:CMSInitiatingOccupancyFraction=percent`当老年代的内存占用达到percent的时候开始GC，剩下的空间留给浮动垃圾  
`-XX:+CMSScavengeBeforeRemark`，重新标记时，有可能新生代的对象引用老年代的对象，这个时候就会多余扫描新生代的潜在的垃圾对象，可以在重新标记之前做一次新生代的垃圾回收，减轻重新标记时的压力，但是CMS会产生碎片，内存碎片多了会引发并发失败，此时退化为SerialOld。

#### 4.4 G1

超大堆内存，会将堆划分为多个大小相等的 Region，优先回收垃圾最多的 Region  
整体上是标记+整理算法，两个区域之间是复制算法

jdk1.9及以后是默认的  
![文章配图](/images/csdn/jvm-garbage-collection/11.webp)  
**Young Collection (新生代回收)**  
当 Eden 区被占满时，将 Eden 和 Survivor Region 的存活对象，复制到新的 Survivor 或 Old Region 中。  
![文章配图](/images/csdn/jvm-garbage-collection/12.webp)  
**Young Collection跨代引用：** 利用 RSet (Remembered Set) 和 Card Table。老年代引用了新生代，对应的 Card 会被标记为 Dirty。GC 时只需扫描 Dirty Card，无需扫描整个老年代。在引用变更时通过 post-write barrier+dirty card queue，将来由一个线程异步更新。  
**Young Collection + Concurrent Marking (并发标记)**：  
当老年代占用堆空间达到阈值（默认 45%）时，\[STW\] 标记 GC Roots 直接关联的对象，\[并发\] 从 GC Roots 遍历对象图，Remark (最终标记)：\[STW\] 处理并发阶段引用发生变化的对象  
![文章配图](/images/csdn/jvm-garbage-collection/13.webp)  
**Remark：** `pre-write barrier + satb_mark_queue`对象c引用发生了改变，写屏障指令，将c加入到队列satb\_mark\_queue，状态改为未处理完。remark时会从队列中取出对象c进行检测  
**JDK8字符串去重：**  
优点:节省大量内存  
缺点:略微多占用了 cpu 时间，新生代回收时间略微增加  
`-XX:+UsestringDeduplication`默认打开  
将所有新分配的字符串放入一个队列  
当新生代回收时，G1并发检查是否有字符串重复  
如果它们值一样，让它们引用同一个 char  
注意，与 string.intern()不一样

-   string.intern()关注的是字符串对象
-   而字符串去重关注的是 char\[\]
-   在 JVM 内部，使用了不同的字符串表

**JDK 8u40 并发标记类卸载：**  
所有对象都经过并发标记后，就能知道哪些类不再被使用，当一个类加载器的所有类都不再使用，则卸载它所加载的所有类  
`XX:+ClassUnloadingWithConcurrentMark`默认启用  
**JDK 8u60 回收巨型对象：**  
一个对象大于 region 的一半时，称之为巨型对象  
G1不会对巨型对象进行拷贝  
回收时被优先考虑  
G1 会跟踪老年代所有 incoming 引用，这样老年代 incoming 引用为0 的巨型对象就可以在新生代垃圾回收时处理掉  
**JDK9并发标记起始时间的调整：**  
并发标记必须在堆空间占满前完成，否则退化为FullGC  
JDK9之前需要使用 `-XX: InitiatingHeap0ccupancyPercent`  
JDK9 可以动态调整：`-XX:InitiatingHeap0ccupancyPercent`用来设置初始值、进行数据采样并动态调整、总会添加一个安全的空档空间
