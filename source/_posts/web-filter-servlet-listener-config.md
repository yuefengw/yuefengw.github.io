---
title: "WEB三大组件：Filter、Servlet、Listener不同配置方式的差异与优先级对比"
slug: web-filter-servlet-listener-config
date: 2025-11-27 11:40:21
updated: 2026-01-10 10:09:06
categories:
  - "Java"
  - "后端工程"
tags:
  - "Java"
  - "Servlet"
  - "后端工程"
cover: /images/csdn/web-filter-servlet-listener-config/01.webp
description: "本文对比了Web三大组件(Filter、Servlet、Listener)的不同配置方式及其优先级。文章详细说明了各组件的配置差异和执行顺序，为开发者选择合适配置方式提供了参考。_servlet filter listener"
original_url: "https://blog.csdn.net/qq_41725967/article/details/155300477"
original_platform: CSDN
---

本文对比了Web三大组件(Filter、Servlet、Listener)的不同配置方式及其优先级。文章详细说明了各组件的配置差异和执行顺序，为开发者选择合适配置方式提供了参考。_servlet filter listener

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/155300477)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## Filter

Filter（过滤器）作为 Web 请求处理链路中的关键组件，核心作用是拦截 HTTP 请求，常用于实现鉴权校验、日志记录、流量限流等功能。  
当一个 HTTP 请求抵达服务端时，会首先经过 Filter 的拦截处理：Filter 执行预设的业务逻辑后，若判定请求可通行，则将请求转发至 Servlet 层处理；待 Servlet 完成业务逻辑并生成响应后，响应会再次流经 Filter，最终返回给请求方。  
反之，若 Filter 判定请求不符合规则（如鉴权失败、触发限流），则直接中断请求链路并返回响应，无需将请求传递至 Servlet 层。  
![文章配图](/images/csdn/web-filter-servlet-listener-config/01.webp)

### @WebFilter注解

```java
@slf4j
@WebFilter(urlPatterns ="/*",filterName = "reqRecordFilter",asyncSupported = true)
public class RegRecordFilter implements Filter{
	@Override
    public void init(FilterConfig filterConfig) {
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain) throws IOException, ServletException {
	    try {
	     // 省略~
	     filterChain.doFilter(request, servletResponse);
	    }finally{
		// ···
		}
	}
}
```

执行`filterChain.doFilter(servletRequest,servletResponse)`若不执行这一句，表示这一次的 http 请求到此为止了，后面的走不下去了，表示会继续将请求执行下去;

使用这个注解时，需要在启动类/配置类上添加 `@ServletComponentScan` 注解来启用。

注意：`@WebFilter` 注解结合`@Order` 来定义 filter 注解设置优先级，可能并不会生效

### FilterRegistrationBean

```java
@Bean
public FilterRegistrationBean<Filter> orderFilter(){
	FilterRegistrationBean<Filter> filter = new FilterRegistrationBean<>();
	filter.setName("regRecordFilter");
	filter.setUrlPatterns(Arrays.asList("/**"));
	filter.setFilter(new ReqRecordFilter());
	filter.setOrder(-1);// 指定优先级
	return filter;
}
```

配置Filter的优先级用此种方式更简单，`@WebFilter`声明的过滤器优先级最低。此时直接@Order不能指定优先级，直接在代码里set就好，比上面方便。

## Servlet

### @WebServlet注解 和 ServletRegistrationBean

-   @WebServlet注解和Filter部分的一样
-   需要定义一个ServletRegistrationBean，并让其持有Servlet的实例，和前面Filter
-   的部分有区别

### 普通Bean和ServletContextInitializer

-   直接将Serlvet当做普通的bean注册给Spring（有坑，不推荐）  
    当项目中只有一个普通bean的servlet时，它响应url:/,但是需要注意不指定优先级时，默认场景下Spring的Servlet优先级更高，所以它接收不到请求；当项目有多个此种case的servlet时，响应的url为`beanName+/`。
-   实现接囗 `ServletContextInitializer`，通过 `ServletContext.addServlet`来注册自定义Servlet

## Listener

### @WebListener注解 和 ServletListenerRegistrationBean

-   @WebListener注解和Filter部分的一样
-   ServletListenerRegistrationBean：需要先实现ServletContextListener，再定义一个ServletListenerRegistrationBean，让其持有Listener的实例

### 普通Bean

将Listener当成一个普通的spring bean，spring boot会自动将其包装为`ServletListenerRegistrationBean` 对象。

```java
@Component
public class BeanContextListener implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        System.out.println("bean context 初始化");
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        System.out.println("bean context 销毁");
    }
}
```

### ServletContextListener

这里主要是借助在ServletContext上下文创建的时机，主动的向其中添加Filter，Servlet，Listener，从而实现种主动注册的效果：

```java
public class SelfContextListener implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        System.out.println("ServletContextInitializer context 初始化");
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        System.out.println("ServletContextInitializer context 销毁");
    }
}

@Component
public class ExtendServletConfigInitializer implements ServletContextInitializer {
    @Override
    public void onStartup(ServletContext servletContext) throws ServletException {
        servletContext.addListener(SelfContextListener.class);
    }
}
```

### ⭐注册时机和优先级分析

`ExtendServletConfiglnitializer`的主动注册时机：

-   Spring 上下文初始化完成后，会收集所有实现 `ServletContextInitializer`接口的 Bean（因该类标注了 `@Component`，会被 Spring 扫描并实例化）。
-   在 Tomcat启动阶段，容器会回调所有 `ServletContextInitializer` 的 `onStartup` 方法（时机：`ServletContext` 初始化后、Servlet 容器完全启动前）。
-   此时 `ExtendServletConfigInitializer` 的 `onStartup` 方法被执行，通过 `servletContext.addListener(SelfContextListener.class)` 主动注册监听器。

通过`ServletContextInitializer`主动注册（如`ExtendServletConfigInitializer`）的时机最早、优先级最高（可通过@Order进一步细化），其次是显式配置的`ListenerRegistrationBean`，再是被 Spring 自动包装为`ServletListenerRegistrationBean`的普通`@Component`标注的`ServletContextListener`，最后是`@WebListener`注解（需配合`@ServletComponentScan`）的方式。

从注册时机看：`ServletContextInitializer`在嵌入式 Servlet 容器启动早期（ServletContext 初始化后、容器完全启动前）通过`onStartup`主动注册；`ListenerRegistrationBean`作为 Spring Boot 封装的注册器，与`ServletContextInitializer`同属 Spring 主导的注册阶段（略晚于显式`ServletContextInitializer`但早于自动包装）；普通`@Component`的监听器(普通Bean)需等 Spring 扫描实例化后被自动包装，注册时机稍滞后；`@WebListener`则依赖 Servlet 容器自身的组件扫描机制，在容器启动后期完成注册。
