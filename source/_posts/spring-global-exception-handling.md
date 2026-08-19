---
title: "全局异常处理的两种策略：HandlerExceptionResolver和RestControllerAdvice"
slug: spring-global-exception-handling
date: 2025-11-26 18:54:24
updated: 2025-11-26 18:54:26
categories:
  - "Java"
  - "后端工程"
tags:
  - "Java"
  - "Spring Boot"
  - "Spring MVC"
  - "后端工程"
cover: /images/csdn/spring-global-exception-handling/01.webp
description: "本文对比了Spring中两种全局异常处理策略：HandlerExceptionResolver和@RestControllerAdvice。HandlerExceptionResolver是Spring底层的异常解析机制，需要手动注册到处理器链中，优先级高且处理范围广，适合框架级异常处理；而@RestControllerAdvice基于注解实现，使用简单，主要处理Controller层异常，…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/155277397"
original_platform: CSDN
---

本文对比了Spring中两种全局异常处理策略：HandlerExceptionResolver和@RestControllerAdvice。HandlerExceptionResolver是Spring底层的异常解析机制，需要手动注册到处理器链中，优先级高且处理范围广，适合框架级异常处理；而@RestControllerAdvice基于注解实现，使用简单，主要处理Controller层异常，…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/155277397)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

全局异常处理是Java后端开发中不可或缺的一部分，我们需要根据异常的类型做出相应处理并返回给前端可读友好的Json格式或HTML页面，个人认为 `HandlerExceptionResolver`可以从SpringMVC的角度来看， `RestControllerAdvice`可以从SpringBoot学习时的角度来看。下面以技术派这个项目分析两种不同的全局异常处理策略及如何使用

## HandlerExceptionResolver

`HandlerExceptionResolver`是Spring 提供的一种异常处理机制，它允许我们在应用程序中以统一的方式处理控制器方法引发的异常。要使用 `HandlerExceptionResolver`，我们需要创建一个实现该接口的类，并在其中定义如何处理异常。例如:

```java
@Slf4j
@Order(-100) // 用于指定 Spring 中组件的加载顺序，值越小，优先级越高
public class ForumExceptionHandler implements HandlerExceptionResolver {
	@Override
	public ModelAndView resolveException(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex){
	
	}
}
```

在学习SpringMVC的时候我们知道，此时如果只写这一个类，系统并不会知道这个类是干什么的，异常来的时候也就进入不到这个类里面，而是进入到SpringMVC提供的`HandlerExceptionResolver`的默认全局异常处理的实现类里面：`DefaultHandlerExceptionResolver、ExceptionHandlerExceptionResolver`。  
为使得我们自定义的全局异常处理器生效，就需要在启动类里将自定义的异常处理器添加到配置中：

```java
public class QuickForumApplication implements WebMvcConfigurer, ApplicationRunner {
	@Override
    public void configureHandlerExceptionResolvers(List<HandlerExceptionResolver> resolvers) {
        resolvers.add(0, new ForumExceptionHandler());
    }
}
```

Spring MVC有一个异常处理器链（resolveExceptionChain），所有实现 `HandlerExceptionResolver` 的对象都会排序后按顺序执行，这里 `add(0, ...)` 表示放在第一个，优先级最高，最先处理到来的异常。如果所有的 `HandlerExceptionResolver` 都无法处理这个异常，那么 Spring MVC 会将异常重新抛出，以便其他异常处理器(如 Servlet 容器)进行处理。  
![文章配图](/images/csdn/spring-global-exception-handling/01.webp)

## RestControllerAdvice

上面属于将自定义的异常处理器手动配置到Spring中，`RestControllerAdvice`是使用注解的方式自动配置到Spring中：

```java
public class ForumAdviceException extends RuntimeException {
    @Getter
    private Status status;

    public ForumAdviceException(Status status) {
        this.status = status;
    }

    public ForumAdviceException(int code, String msg) {
        this.status = Status.newStatus(code, msg);
    }

    public ForumAdviceException(StatusEnum statusEnum, Object... args) {
        this.status = Status.newStatus(statusEnum, args);
    }
}

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(value = ForumAdviceException.class)
    public ResVo<String> handleForumAdviceException(ForumAdviceException e) {
        return ResVo.fail(e.getStatus());
    }
}
```

`@RestControllerAdvice` 是一个特殊的 `@ControllerAdvice`注解，适用于处理 RESTfulAPI 异常的情况。这意味着它将用于处理来自带有 `@RestController` 注解的控制器抛出的异常。  
此类中定义的方法 `handleForumAdviceException` 使用 `@ExceptionHandler` 注解，表示它将处理 `ForumAdviceException` 类型的异常。

![文章配图](/images/csdn/spring-global-exception-handling/02.webp)

## 对比

| 对比项 | @RestControllerAdvice（含 @ExceptionHandler） | HandlerExceptionResolver |
| --- | --- | --- |
| 处理层级 | Spring MVC 的“业务层异常处理” | Spring MVC 的“底层异常解析器链” |
| 触发方式 | Controller 抛出异常后由 Spring AOP 捕获 | DispatcherServlet 捕获异常后依序调用所有 Resolver |
| 优先级 | 默认，按 @Order 或类加载顺序 | 可手动通过 resolvers.add(0, …) 提升优先级 |
| 可处理范围 | 只能处理 Controller 层的异常 | 可以处理所有阶段异常（拦截器、参数解析、视图渲染） |
| 返回内容 | 默认 JSON（Rest 环境） | 可返回 ModelAndView 或 JSON，完全自定义 |
| 编码复杂度 | 简单，只需要写方法 | 较复杂，需要实现接口并手动构造响应 |
| 使用场景 | 大部分业务异常（业务错误、参数非法等） | 框架级异常、自定义协议异常、需要统一兜底时 |
| 可维护性 | 高，代码集中且直观 | 中，逻辑分散但更灵活 |
| Spring Boot 默认支持 | 有默认全局处理机制 | 有默认 HandlerExceptionResolver 链 |

当然这个表是直接生成的，表中说`RestControllerAdvice`只能处理Controller层的异常，但是Service和Dao层的异常也会往上抛，最终也会到达Controller。本人认为最重要的区别在于通过 `resolvers.add(0, new ForumExceptionHandler())` 手动将其放在异常处理器链的第一位，从而强制保证自己的异常处理逻辑拥有最高的控制权和执行优先级。
