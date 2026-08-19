---
title: "【Spring事务失效的常见原因】同类内部调用导致 @Transactional 不生效"
slug: spring-transaction-self-invocation
date: 2025-10-11 20:52:58
updated: 2025-10-11 20:52:59
categories:
  - "Java"
  - "后端工程"
tags:
  - "Spring"
  - "数据库"
  - "Java"
  - "后端工程"
cover: /images/posts/backend-cover.webp
description: "Spring中@Transactional事务失效的常见原因是同类内部方法调用导致AOP代理失效。事务基于动态代理实现，若通过this.方法()直接调用，会绕过代理对象，使事务注解失效。解决方案是通过AopContext.currentProxy()获取代理实例调用方法，并配置@EnableAspectJAutoProxy(exposeProxy=true)启用代理暴露功能，确保事务拦截生效。…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/153072416"
original_platform: CSDN
---

Spring中@Transactional事务失效的常见原因是同类内部方法调用导致AOP代理失效。事务基于动态代理实现，若通过this.方法()直接调用，会绕过代理对象，使事务注解失效。解决方案是通过AopContext.currentProxy()获取代理实例调用方法，并配置@EnableAspectJAutoProxy(exposeProxy=true)启用代理暴露功能，确保事务拦截生效。…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/153072416)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

#### 一、问题背景

这个问题是在做黑马点评 - 优惠券秒杀功能（一人一单）（视频P54） 时发现的。

在Spring中，`@Transactional`用于开启事务，但很多人会遇到这样的情况：  
**明明加了@Transactional，事务却没有生效，数据没有回滚。**

最常见的原因之一，就是**同一个类内部的方法调用导致AOP失效**。

* * *

#### 二、失效原因

Spring的事务是基于**AOP动态代理**实现的。  
当我们调用一个带有`@Transactional`的方法时，实际上是通过代理对象调用的，Spring会在方法前后自动开启和提交/回滚事务。

但是，当你在**同一个类中**调用该方法时，例如：

```java
public Result setkillVoucher(Long voucherId) {
    // ...省略业务逻辑
    return createVoucherOrder(voucherId); // 内部调用
}

@Transactional
public Result createVoucherOrder(Long voucherId) {
    // 数据操作逻辑
}
```

这里的调用相当于 `this.createVoucherOrder()`，  
而 `this` 是当前 类 本身，不是Spring生成的代理对象。  
因此，**不会经过事务切面**，`@Transactional` 就不会生效。

* * *

#### 三、正确做法

要让事务生效，必须**通过代理对象调用**该方法。

可以使用 `AopContext.currentProxy()` 获取当前代理对象：

```java
@Override
public Result setkillVoucher(Long voucherId) {
    IVoucherOrderService proxy = (IVoucherOrderService) AopContext.currentProxy();
    return proxy.createVoucherOrder(voucherId);
}
```

并在配置类中启用代理暴露功能：

```java
@EnableAspectJAutoProxy(exposeProxy = true)
```

这样，调用链就会经过Spring的代理对象，事务拦截器才能生效。
