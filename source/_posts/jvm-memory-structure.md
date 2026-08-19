---
title: "【JVM】内存结构"
slug: jvm-memory-structure
date: 2026-01-04 15:53:45
updated: 2026-01-06 21:31:46
categories:
  - "Java"
  - "JVM"
tags:
  - "Java"
  - "JVM"
cover: /images/csdn/jvm-memory-structure/01.webp
description: "本文介绍了JVM内存结构的关键组成部分及其特性。程序计数器是线程私有的指令地址记录器；虚拟机栈存储方法调用的栈帧；本地方法栈支持Native方法调用；堆是对象分配的主区域，线程共享且支持GC；方法区存储类信息等元数据，1.8后改为元空间实现；直接内存用于NIO操作，不受JVM管理。重点分析了StringTable在不同JDK版本的实现差异及调优方法，以及直接内存的分配回收机制。…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/156537650"
original_platform: CSDN
---

本文介绍了JVM内存结构的关键组成部分及其特性。程序计数器是线程私有的指令地址记录器；虚拟机栈存储方法调用的栈帧；本地方法栈支持Native方法调用；堆是对象分配的主区域，线程共享且支持GC；方法区存储类信息等元数据，1.8后改为元空间实现；直接内存用于NIO操作，不受JVM管理。重点分析了StringTable在不同JDK版本的实现差异及调优方法，以及直接内存的分配回收机制。…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/156537650)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

![文章配图](/images/csdn/jvm-memory-structure/01.webp)

### 程序计数器(Program Counter Register)

Java源代码 -> jvm指令 -> 解释器 -> 机器码 -> cpu

程序计数器：记住下一条jvm指令的执行地址，通过寄存器来实现

特点：

-   线程私有的，线程1的时间片用完的时候，程序计数器记住下一条指令的地址，下次执行时从此继续执行
-   不会有内存溢出问题

### 虚拟机栈 Java Virtual Machine Stacks

每个线程运行的时候需要的内存空间叫做虚拟机栈，每个栈内有若干个栈帧，栈帧是每个方法运行时需要的内存，比方说存参数，局部变量，返回地址，方法调用结束将对应的栈帧释放

-   每个线程运行时所需要的内存，称为虚拟机栈。
-   每个栈由多个栈帧(Frame)组成，对应着每次方法调用时所占用的内存
-   每个线程只能有一个活动栈帧（栈顶方法），对应着当前正在执行的那个方法

> **Q: 垃圾回收涉及栈内存吗？**  
> A: 不涉及。栈帧随方法结束自动弹出（释放），不需要 GC 介入。  
> **Q: 栈内存分配越大越好吗？**  
> A: 不是。物理内存是固定的，栈内存设置得越大（-Xss），可创建的线程数就越少。大栈内存只能支撑更深的方法递归调用。  
> **Q: 方法内的局部变量是线程安全的吗？**  
> A1: 安全：变量在方法内创建且未逃逸（未作为返回值返回，未传递给外部方法）。  
> A2: 不安全：变量是外部传入的参数（其他线程可能持有引用）；或者变量作为返回值抛出去了（其他线程可能获取并修改）。

**栈内存溢出**  
栈帧过多过大都会导致栈内存溢出，可以通过-Xss 设置栈内存大小

> **Q: cpu占用过多排查步骤?**
> 
> 1.  top：定位占用 CPU 高的进程 PID。
> 2.  ps H -eo pid,tid,%cpu | grep \[PID\]：查看该进程下哪个线程 (TID) 占用高。
> 3.  jstack \[PID\]：导出堆栈信息。
> 4.  将 TID 转换为十六进制，在 jstack 输出中搜索，定位具体源码行数。  
>     (注：如果程序卡死无结果，也可用 jstack 排查是否死锁)。

### 本地方法栈

为 JVM 调用 Native 方法（由 C/C++ 编写的方法，如 Object.hashCode、Thread.start）提供内存空间。与虚拟机栈类似，也是线程私有的。

### 堆

通过new出来的对象都会使用堆内存

-   是线程共享的，需要考虑线程安全问题
-   有垃圾回收机制

OutOfMemoryError堆内存溢出， 通过-Xmx设置堆内存大小

堆内存诊断：

-   jps 查看当前系统中的java进程
-   jmap -heap 进程id 查看堆内存占用，看Eden Space used的使用变化
-   jconsole 图形化监控

> 垃圾回收后，内存占用仍然很高？  
> jvisualvm Heap Dump查看是那些对象占用高

### 方法区

在虚拟机启动时被创建，逻辑上是堆的组成部分，存储类信息、常量、静态变量、JIT 编译后的代码。  
![文章配图](/images/csdn/jvm-memory-structure/02.webp)  
版本变化：

-   1.6叫永久代，`-XX:MaxPermSize`设置内存大小
-   1.8以后方法区采用元空间实现，没设置内存上限，`-XX:MaxMetaspacesize=8m`设置最大虚拟机内存大小
-   1.6 StringTable是常量池的一部分，随常量池存储在永久代
-   1.7 1.8 StringTable转移到了堆里，因为永久代回收效率低，永久代只有 Full GC 才会回收，效率低；堆中 Minor GC 即可回收，缓解字符串过多的内存压力。

`javap -v Hello.class` 反编译字节码显示详细信息 包含类基本信息、常量池、类方法定义，包含虚拟机指令

**常量池**，就是一张表，虚拟机指令根据这张常量表找到要执行的类名、方法名、参数类型、字面量等信息  
**运行时常量池**，常量池是 \*.class 文件中的，当该类被加载，它的常量池信息就会放入运行时常量池，并把里面的符号地址变为真实地址  
**StringTable**，本质是一个 HashTable，且不可扩容。

```java
String s1 = "a"; 
String s2 = "b";
String s3 = "ab";             // 放入串池(StringTable)
String s4 = s1 + s2;          // 变量拼接 -> new StringBuilder().append("a").append("b").toString() -> 堆中新对象
String s5 = "a" + "b";        // 常量拼接 -> 编译期优化(Javac)为 "ab"，直接引用串池中的 s3

System.out.println(s3 == s5); // true (都指向串池中的 "ab")
System.out.println(s3 == s4); // false (s3在串池，s4在堆)
```

**StringTable特性：**

-   常量池中的字符串仅是符号，第一次用到时才变为对象
-   利用串池的机制，来避免重复创建字符串对象
-   字符串变量拼接的原理是 stringBuilder (1.8)
-   字符串常量拼接的原理是编译期优化
-   可以使用 intern 方法，主动将串池中还没有的字符串对象放入串池

```java
// JDK 1.8 逻辑
String s = new String("a") + new String("b"); // 堆中对象 "ab"，此时串池中没有 "ab"
String s2 = s.intern(); // 尝试放入串池。
                        // 因为串池没有，则将 s 的【引用地址】放入串池，并返回该地址。
                        // 此时 s 和 s2 指向同一个对象。
System.out.println(s == "ab"); // true

// JDK 1.6 逻辑 (区别点)
// 1.6 会把堆中的 "ab" 【复制】一份拷贝到永久代的串池中，s 还是堆中的，s2 是串池副本。
// 所以 1.6 中 s != s2
```

`String s = new String("a") + new String("b");` a,b都是常量，在StringTable 中; 而s是动态拼接出来的，底层是用StringBulider，所以s放在堆中  
**版本区别：**

-   在1.8中，`String s2 = s.intern()` 可以将这个字符串对象尝试放入StringTable ，如果有则并不会放入，如果没有则放入串池，会把串池中的对象返回
-   但是1.6中，当尝试把s放入串池的时候会将s复制一份放进去， 而不是直接将s放进去

**StringTable性能调优：**

-   调整桶大小：-XX:StringTableSize=xxxx。桶越多，Hash 冲突越少，存取越快。
-   去重：如果应用中有大量重复字符串（如地址、标签），使用 intern() 让它们共享串池对象，可大幅降低堆内存占用。

### 直接内存

直接内存是操作系统内存

-   常见于NIO操作，用于数据缓冲器
-   分配回收成本高，但读写性能高
-   不受JVM内存回收管理

**异常：** 如果直接内存分配过多，会抛出 OutOfMemoryError: Direct buffer memory  
![文章配图](/images/csdn/jvm-memory-structure/03.webp)

> **当 Java 传统 IO读取文件时，流程如下：**  
> 1\. 磁盘 -> 系统缓冲区：操作系统将数据从磁盘读取到内核空间的缓冲区（系统缓冲区）。  
> 2\. 系统缓冲区 -> Java 缓冲区：因为 Java 代码无法直接访问内核空间，JVM 必须将数据从系统缓冲区复制到 Java 堆内存（`byte[]`）。  
> 3\. 结果：发生了两次拷贝，且需要进行上下文切换，效率较低。

![文章配图](/images/csdn/jvm-memory-structure/04.webp)

> **使用 `ByteBuffer.allocateDirect(int capacity)` 分配直接内存时：**
> 
> 1.  映射：操作系统划出一块物理内存，这块内存既可以被系统内核直接访问，也可以被 Java 进程直接访问（通过 ByteBuffer 对象引用）。
> 2.  结果：少了一次数据复制，数据直接在物理内存中操作，提升 IO 效率。

> **直接内存分配和回收原理：**  
> 直接内存的管理和释放通过unsafe实现，直接内存的释放借助了虚引用机制`cleaner = Cleaner.create(this, new Deallocator(base, size, cap))`，当前对象this（也就是ByteBufer ）被回收掉以后，cleaner（虚引用）会被放入 ReferenceQueue, JVM 内部的 ReferenceHandler 线程发现队列中有对象，会调用 `Cleaner.clean()`，clean() 方法执行 `Deallocator.run()`，最终调用 `Unsafe.freeMemory()` 释放堆外内存。

`System.gc()`是显式的垃圾回收，FullGC，如果禁用，且堆内存（Young/Old）一直未满，JVM 就不会触发 GC  
当`-XX:+DisablExplictGC`显式垃圾回收被禁用后，ByteBufer就不会被立即回收，会对直接内存的垃圾回收有影响。
