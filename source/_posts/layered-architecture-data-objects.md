---
title: "理解分层架构：彻底理清 VO、DTO、BO、PO、DO 的边界与流转"
slug: layered-architecture-data-objects
date: 2025-11-26 21:46:07
updated: 2025-11-26 21:50:00
categories:
  - "Java"
  - "后端工程"
tags:
  - "Java"
  - "后端工程"
cover: /images/csdn/layered-architecture-data-objects/01.webp
description: "本文介绍了分层架构中常见的VO、DTO、BO、PO、DO等数据对象的概念及流转过程。这些对象分别承担表示层、业务层和数据层的特定职责，确保系统各层之间的隔离和安全性。DO对应数据库记录，BO封装业务逻辑，DTO用于跨层传输，VO是前端视图对象。文章通过传统三层架构和DDD架构的对比，展示了这些对象在不同架构中的流转路径。POJO作为基础Java类，是这些数据对象的共同特征。…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/155283249"
original_platform: CSDN
---

本文介绍了分层架构中常见的VO、DTO、BO、PO、DO等数据对象的概念及流转过程。这些对象分别承担表示层、业务层和数据层的特定职责，确保系统各层之间的隔离和安全性。DO对应数据库记录，BO封装业务逻辑，DTO用于跨层传输，VO是前端视图对象。文章通过传统三层架构和DDD架构的对比，展示了这些对象在不同架构中的流转路径。POJO作为基础Java类，是这些数据对象的共同特征。…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/155283249)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

简单来说，VO、DTO、BO、PO、DO、POJO 都可以看作是“对象”的不同形态，它们分别承担在各自层中的特定职责，用来确保系统在表示层、业务层、数据层之间实现数据结构的隔离、职责的单一化与安全性。在这套体系中，DO 是数据库记录在系统中的映射，而 DAO（Data Access Object）则是专门用于操作 DO 的组件，通过封装 CRUD 行为完成数据层的读写，与这些对象彼此协作，共同构成清晰可维护的分层架构。

## 数据对象简介

1.  DO（Data Object）  
    它就是一条数据库的记录映射成的 Java 对象，一般和数据库表一一对应：
    
    ```java
    @Data
    @TableName("tb_shop")
    public class Shop {
        private Long id;
        private String name;
        private Integer avgPrice;
    }
    ```
    
2.  PO (Persistent Object）  
    PO 和 DO 在大部分项目里等价
3.  BO（Business Object）  
    Service 内部使用的业务对象，比如点评里面从Redis查询店铺信息封装到BO里面
4.  DTO（Data Transfer Object）  
    接收前端参数的对象或者跨层/跨服务数据传输，屏蔽敏感字段，比方说BO/PO里面有password字段，DTO里面就没有
5.  VO（View Object）  
    返回给前端的对象，即视图对象
6.  POJO （Plain Old Java Object）  
    没有继承复杂父类、没有实现复杂接口、没有特殊框架标签的普通 Java 类。就是一个“干干净净的类”，通常只包含：字段、getter/setter、toString 等基本方法；DO / DTO / VO 都是 POJO 的一种具体使用分类

## 业务流程中数据对象的流转

下面以业务流程的角度带大家深入了解这几个不同的数据对象：

### 传统三层架构

DAO层操作DO返回DO/PO给Service层，Service层在执行业务逻辑的时候可能会有BO业务对象的加入，但是最终都是以DTO的形式返回Controller层，Controller层会将对象转换为VO返回给前端  
![文章配图](/images/csdn/layered-architecture-data-objects/01.webp)

### DDD架构

DDD中的DO（Domain Object）可以认为不再是传统架构中的Data Object，替代了三层架构中BO的位置\[1\]。  
![文章配图](/images/csdn/layered-architecture-data-objects/02.webp)

* * *

参考资料：  
\[1\] [PO、VO、BO、DTO、DAO、POJO傻傻分不清楚](https://cloud.tencent.com/developer/article/2555083)
