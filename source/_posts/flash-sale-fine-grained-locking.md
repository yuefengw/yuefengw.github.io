---
title: "【秒杀中的并发】如何避免全局单线程和实现细粒度锁"
slug: flash-sale-fine-grained-locking
date: 2025-10-11 22:01:09
updated: 2025-10-11 22:01:11
categories:
  - "Java"
  - "后端工程"
tags:
  - "Java"
  - "Spring"
  - "JVM"
  - "后端工程"
cover: /images/csdn/flash-sale-fine-grained-locking/01.webp
description: "黑马点评项目实现\"秒杀优惠券一人一单\"功能时，通过优化锁机制提升并发性能。关键点在于使用synchronized(userId.toString().intern())替代方法级锁，确保相同用户请求串行执行（防止重复下单）而不同用户请求并发执行。采用字符串常量池机制保证相同用户ID对应同一锁对象，解决了直接使用Long类型时因对象引用不同导致的锁失效问题，在保证功能的同时提升了系统吞吐量。"
original_url: "https://blog.csdn.net/qq_41725967/article/details/153075507"
original_platform: CSDN
---

黑马点评项目实现"秒杀优惠券一人一单"功能时，通过优化锁机制提升并发性能。关键点在于使用synchronized(userId.toString().intern())替代方法级锁，确保相同用户请求串行执行（防止重复下单）而不同用户请求并发执行。采用字符串常量池机制保证相同用户ID对应同一锁对象，解决了直接使用Long类型时因对象引用不同导致的锁失效问题，在保证功能的同时提升了系统吞吐量。

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/153075507)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

#### 一、问题背景

在实现 **黑马点评项目** 的「秒杀优惠券一人一单」功能时，我们需要保证：

-   同一个用户只能成功抢购一次；
-   不同用户之间的抢购可以并发执行。

视频中并没有直接在方法上使用 `synchronized`：

```java
public synchronized Result setkillVoucher(Long voucherId) {
    ...
}
```

因为这样做的问题是：

> 所有线程都会被同一个锁（this）阻塞，整个方法就变成**单线程执行**，并发性能差

* * *

#### 二、优化后的加锁方式

为了保证同一个用户的请求串行执行，不同用户的请求并发执行，我们可以将锁加在目标方法执行的外层：

```java
@Override
public Result setkillVoucher(Long voucherId) {
    Long userId = UserHolder.getUser().getId();
    synchronized (userId.toString().intern()) {
        IVoucherOrderService proxy = (IVoucherOrderService) AopContext.currentProxy();
        return proxy.createVoucherOrder(voucherId);
    }
}
```

这里的关键是：

```java
synchronized (userId.toString().intern())
```

**`String.intern()` 会将字符串放入字符串常量池**，相同内容的字符串会共享同一个对象引用。

因此：

-   同一个用户的 `userId` → 锁对象相同 → 串行执行，防止重复下单。
-   不同用户的 `userId` → 锁对象不同 → 各自独立，不会互相阻塞。

* * *

#### 三、为什么是`userId.toString()`而不直接用`userId`

**Q: 既然 `userId` 已经是唯一的数字，为什么还要转成字符串？**  
因为 Long 是包装类，它只会缓存 -128 ~ 127 范围内的对象引用。  
超出这个范围，虽然值相同，但对象引用不同，无法实现锁唯一。  
因此需要转成字符串，并通过 intern() 让相同内容的字符串共享同一引用。

简单说：

-   `Long` 对象在 JVM 中不是全局唯一的。
-   而 `String.intern()` 会把字符串放进**字符串常量池**，相同内容的字符串会共享同一个对象引用。
-   这样可以确保：同一个用户ID绑定同一个锁对象。

* * *

#### 四、集群下上述方法失效

![文章配图](/images/csdn/flash-sale-fine-grained-locking/01.webp)

> 在集群环境下这种锁会失效，如上图所示：**不同 JVM 的锁对象不共享。**  
> 每个 JVM 都有自己的字符串常量池；即使内容一样，它们在不同 JVM 中是不同对象引用；所以 synchronized(“userId.toString().intern()”) 在 JVM A 和 JVM B 上并不是同一把锁。

所以，集群场景必须使用分布式锁。
