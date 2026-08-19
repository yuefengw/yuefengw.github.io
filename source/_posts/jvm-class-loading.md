---
title: "【JVM】类加载阶段&类加载器"
slug: jvm-class-loading
date: 2026-01-06 21:31:14
updated: 2026-01-06 21:31:17
categories:
  - "Java"
  - "JVM"
tags:
  - "JVM"
  - "Java"
cover: /images/csdn/jvm-class-loading/01.webp
description: "本文介绍了JVM类加载机制与运行优化。类加载分为加载、链接和初始化三个阶段：加载阶段将字节码载入方法区；链接阶段包括验证、准备和解析；初始化阶段执行类构造方法，采用懒加载策略。类加载器采用双亲委派模型，分为启动类、扩展类和应用类加载器，JDBC等场景通过线程上下文类加载器打破该机制。JVM采用分层编译优化，包括解释执行、C1编译和C2编译等5个层次，通过即时编译器将热点代码编译为机器码提升性能。…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/156642276"
original_platform: CSDN
---

本文介绍了JVM类加载机制与运行优化。类加载分为加载、链接和初始化三个阶段：加载阶段将字节码载入方法区；链接阶段包括验证、准备和解析；初始化阶段执行类构造方法，采用懒加载策略。类加载器采用双亲委派模型，分为启动类、扩展类和应用类加载器，JDBC等场景通过线程上下文类加载器打破该机制。JVM采用分层编译优化，包括解释执行、C1编译和C2编译等5个层次，通过即时编译器将热点代码编译为机器码提升性能。…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/156642276)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

### 1\. 类加载阶段

#### 1.1 加载

将类的字节码载入方法区。JVM 内部采用 C++ 的 `InstanceKlass` 描述 Java 类。

-   元数据存储：`InstanceKlass` 存储在方法区（JDK 1.8+ 为元空间 Metaspace）。
-   Java 镜像：\_java\_mirror（即 String.class 这样的对象）存储在堆中。底层的 Klass 暴露给 Java 层代码使用。
-   如果父类未加载，优先加载父类。加载和链接阶段在逻辑上是交叉进行的。  
    ![文章配图](/images/csdn/jvm-class-loading/01.webp)

#### 1.2 链接

**验证：** class字节码的格式是否符合JVM规范  
**准备：** 为static变量分配空间，并设置默认初始值（如 int 为 0，boolean 为 false）。

-   1.8静态变量存储在堆中，存储于\_java\_mirror 末尾，1.6及以前存储在`instanceClass`末尾
-   static 变量分配空间和赋值是两个步骤，分配空间在准备阶段完成，赋值在初始化阶段完成
-   如果 static 变量是 final 的基本类型，以及字符串常量，那么编译阶段值就确定了，赋值在准备阶段完成
-   如果 static 变量是 final的，但属于引用类型，那么赋值也会在初始化阶段完成

**解析：** 将常量池中的符号引用解析为直接引用，解析之后才知道地址位置

#### 1.3 初始化

初始化即调用`<cinit>()v`，虚拟机会保证这个类的**构造方法**的线程安全，概括得说，类初始化是**懒惰的**

**触发初始化的时机：**

-   main 方法所在的类，总会被首先初始化
-   首次访问这个类的静态变量或静态方法时
-   子类初始化，如果父类还没初始化，会引发
-   子类访问父类的静态变量，只会触发父类的初始化
-   Class,forName
-   new 会导致初始化

**不会引发初始化的情况：**

-   访问类的 static final静态常量(基本类型和字符串)不会触发初始化
-   类对象.class 不会触发初始化
-   创建该类的数组不会触发初始化
-   类加载器的 loadClass 方法
-   Class,forName 的参数2为false 时

**例子1：双重检查锁 (Double-Checked Locking, DCL)**

```java
public class LazySingleton {
    // 1. volatile 关键字至关重要
    // 它防止指令重排序，确保 instance 初始化完全后才能被其他线程看到
    private static volatile LazySingleton instance;

    // 2. 私有构造方法，防止外部 new
    private LazySingleton() {
        System.out.println("单例对象被创建了 (占用了大量资源)");
    }

    // 3. 全局访问点
    public static LazySingleton getInstance() {
        // 第一次检查：如果已经不为 null，直接返回，避免不必要的同步锁性能损耗
        if (instance == null) {
            synchronized (LazySingleton.class) {
                // 第二次检查：防止两个线程同时通过了第一次检查，排队进来重复创建
                if (instance == null) {
                    instance = new LazySingleton();
                }
            }
        }
        return instance;
    }
}
```

**例子2：静态内部类 (Bill Pugh Singleton)**

```java
public class HolderSingleton {
    private HolderSingleton() {}

    // 静态内部类：只有在 HolderSingleton.getInstance() 被调用时
    // JVM 才会去加载这个内部类，从而初始化 INSTANCE
    private static class SingletonHolder {
        private static final HolderSingleton INSTANCE = new HolderSingleton();
    }

    public static HolderSingleton getInstance() {
        return SingletonHolder.INSTANCE;
    }
}
```

### 2\. 类加载器

#### 2.1 类加载器层级

**启动类加载器 (Bootstrap ClassLoader)：** 由C++编写，`getClassLoader`后显示null  
**扩展类加载器 (Extension ClassLoader)：** 加载扩展库（JAVA\_HOME/lib/ext 目录下的 jar 包）  
**应用程序类加载器 (Application/System ClassLoader)：** 加载用户类路径（ClassPath）下的类，也就是我们自己写的代码和引入的第三方 Jar 包。  
**自定义类加载器 (Custom ClassLoader)：** 户自定义的加载器，父级通常是 AppClassLoader。

#### 2.2 双亲委派模型

所谓的双亲委派，就是指调用类加载器的 `loadClass` 方法时，查找类的规则，当一个加载器要加载类时，它不会自己先去加载，而是把任务扔给它的“父级”去尝试，直到最顶层。只有当父级无法加载时，子级才会尝试自己加载。向上委托查找，向下委托加载。

```java
protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
    synchronized (getClassLoadingLock(name)) {
        // 1. 检查是否已经加载过 (查缓存)
        Class<?> c = findLoadedClass(name);
        
        if (c == null) {
            try {
                // 2. 只要有父级，就委托给父级 (向上委托)
                if (parent != null) {
                    c = parent.loadClass(name, false);
                } else {
                    // 3. 这里的 parent == null，说明父级是 Bootstrap (因为无法在Java中获取)
                    c = findBootstrapClassOrNull(name);
                }
            } catch (ClassNotFoundException e) {
                // 父级无法加载，吞掉异常，继续往下走
            }

            if (c == null) {
                // 4. 父级都没找到，才轮到自己加载 (findClass 是留给我们重写的)
                c = findClass(name);
            }
        }
        return c;
    }
}
```

#### 2.3 打破双亲委派 (SPI 与 JDBC)

**背景：** 在 JDBC 的场景中，`java.sql.DriverManager`是 JDK 自带的核心类，位于 rt.jar 中，由启动类加载器 (Bootstrap ClassLoader) 加载。`com.mysql.cj.jdbc.Driver`是第三方厂商（MySQL）提供的 Jar 包，位于ClassPath下。由应用类加载器 (AppClassLoader) 加载。  
**但是：** 当我们在代码里调用 `DriverManager.getConnection()` 时，DriverManager需要去加载并实例化 MySQL 的驱动类。  
**根据双亲委派模型：** 父加载器（Bootstrap）绝对无法看到或加载子加载器（App）范围内的类。  
为了解决这个问题，采用线程上下文类加载器 (Thread Context ClassLoader, TCCL)。  
Java 使用 SPI 机制来自动发现驱动。在 `mysql-connector-java.jar` 的 `META-INF/services/java.sql.Driver` 文件里，写了驱动的全类名。  
DriverManager 实际上是委托 `ServiceLoader` 去读这个文件并加载类的；  
在`ServiceLoader.load`方法中，Java 并没有使用当前的类加载器（Bootstrap），而是去拿了线程的上下文加载器。

```java
// java.util.ServiceLoader
public static <S> ServiceLoader<S> load(Class<S> service) {
    // 1. 获取当前线程的上下文类加载器
    // 在普通 Java 应用中，这个默认就是 AppClassLoader
    // 线程启动的时候，默认将应用程序类加载器赋值给当前线程
    ClassLoader cl = Thread.currentThread().getContextClassLoader();
    // 2. 带着这个 AppClassLoader 去加载实现类
    return ServiceLoader.load(service, cl);
}
```

拿到 AppClassLoader 后，`ServiceLoader`就会用它来加载 META-INF 里配置的 MySQL 驱动类。

```java
// ServiceLoader 内部迭代加载逻辑
String cn = nextName; // 读到的 "com.mysql.cj.jdbc.Driver"
Class<?> c = Class.forName(cn, false, loader); // loader 就是刚才拿到的 AppClassLoader
```

**自定义类加载器：**  
什么时候用？

-   想加载非 classpath 随意路径中的类文件
-   都是通过接口来使用实现，希望解耦时，常用在框架设计
-   这些类希望予以隔离，不同应用的同名类都可以加载，不冲突，常见于tomcat 容器  
    第一次类加载之后就会放在类加载器的缓存里面，下次加载直接读，不同类加载器加载同一个对象，会认为是不同的类

### 3\. 运行期优化

#### 3.1 分层编译

JVM 将执行状态分成了5个层次:

-   0层，解释执行(Interpreter)
-   1 层，使用 C1即时编译器编译执行(不带 profiling)
-   2 层，使用 C1即时编译器编译执行(带基本的 profiling)
-   3 层，使用 C1 即时编译器编译执行(带完全的 profiling)
-   4 层，使用 C2 即时编译器编译执行

profiling 是指在运行过程中收集一些程序执行状态的数据，例如【方法的调用次数】，【循环的回边次数】等

即时编译器(IT)与解释器的区别

-   解释器是将字节码解释为机器码，下次即使遇到相同的字节码，仍会执行重复的解释
-   JIT 是将一些字节码编译为机器码，并存入 Code Cache，下次遇到相同的代码，直接执行，无需再编译
-   解释器是将字节码解释为针对所有平台都通用的机器码
-   JIT 会根据平台类型，生成平台特定的机器码

#### 3.2 其他优化

**方法内联：** 当方法较短的时候，将目标方法的代码“复制”到调用者中，减少方法调用的栈帧开销（压栈/出栈）。  
**逃逸分析：** 分析对象的作用域是否会逃出当前方法。 如果不逃逸，

-   1.  不创建对象，直接把对象的成员变量（标量）拆开放在栈上；
-   1.  如果对象只被当前线程访问，自动去掉 synchronized 锁

**常量折叠：** 9 \* 9 在编译期直接算成 81  
**反射优化：** 使用反射执行方法时，超过阈值（15），JVM 会生成一个动态的字节码类（`GeneratedMethodAccessor`），将反射调用转变为直接调用，从而提升性能。
