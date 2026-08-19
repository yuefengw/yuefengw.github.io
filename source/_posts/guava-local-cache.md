---
title: "Guava整合本地缓存"
slug: guava-local-cache
date: 2026-01-04 15:53:57
updated: 2026-01-04 15:53:59
categories:
  - "Java"
  - "后端工程"
tags:
  - "Guava"
  - "缓存"
  - "后端工程"
cover: /images/posts/backend-cover.webp
description: "本文介绍了Guava缓存在项目中的几种应用场景：1) CategoryServiceImpl使用Guava Cache缓存分类信息，避免频繁查询数据库；2) UserSessionHelper使用Redis存储会话信息；3) WxLoginHelper使用Guava缓存验证码和长连接关系；4) ImageServiceImpl利用缓存避免重复上传相同图片。…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/156544787"
original_platform: CSDN
---

本文介绍了Guava缓存在项目中的几种应用场景：1) CategoryServiceImpl使用Guava Cache缓存分类信息，避免频繁查询数据库；2) UserSessionHelper使用Redis存储会话信息；3) WxLoginHelper使用Guava缓存验证码和长连接关系；4) ImageServiceImpl利用缓存避免重复上传相同图片。…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/156544787)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

### 1 CategoryServiceImpl

避免每次从DB查询。代码逻辑非常简单，给分类加一个缓存，key为 categoryid，如果缓存中不存在，则去 DB中查找，最后返回一个由分类 ID、分类名、分类排序的对象。

```java
    @PostConstruct
    public void init() {
        categoryCaches = CacheBuilder.newBuilder().maximumSize(300).build(new CacheLoader<Long, CategoryDTO>() {
            @Override
            public CategoryDTO load(@NotNull Long categoryId) throws Exception {
                CategoryDO category = categoryDao.getById(categoryId);
                if (category == null || category.getDeleted() == YesOrNoEnum.YES.getCode()) {
                    return CategoryDTO.EMPTY;
                }
                return new CategoryDTO(categoryId, category.getCategoryName(), category.getRank());
            }
        });
    }
```

> 为什么要@PostConstruct？
> 
> 因为init代码中用到了categoryDao，为了确保categoryDao不为空，所以给init方法@PostConstruct，这样categoryDao注入完成以后再init就不会有空指针异常

### 2 UserSessionHelper

这里其实已经不是Guava做缓存了

```java
// 生成会话的时候直接将token和UserId存入Redis
RedisClient.setStrWithExpire(token, String.valueOf(userId), jwtProperties.getExpire() / 1000);
// 登录校验的时候根据用户带来的session查id
String user = RedisClient.getStr(session);
// 删除
RedisClient.del(session);
```

### 3 QrLoginHelper

对应现在的`WxLoginHelper`；verifyCodeCache缓存验证码和长连接的对应关系，deviceCodeCache缓存设备Id和验证码之间的对应关系；

用户第一次打开登陆页面的时候给一个设备id，然后根据设备id给一个验证码（这里由deviceCodeCache缓存），建立一个长连接 ，非同一个设备多次打开此页面的情况下缓存`verifyCodeCache.put(realCode, sseEmitter)`对应关系并发送验证码和二维码

> `onTimeout` 和 `onError` 是干啥的？
> 
> `onTimeout`: 当连接建立的时间超过了设置的 `SSE_EXPIRE_TIME`（代码里是 15 分钟）时，Spring 会自动触发这个回调关闭连接，释放服务器资源。
> 
> `onError`: SSE 是服务器推给客户端。如果客户端把浏览器关了，服务器这时候如果强行推消息，底层 TCP 管道会报错（Broken Pipe / Connection Reset）然后执行OnError关闭连接。

做好缓存当用户发来verifyCode以后从verifyCodeCache里找对应的长连接，生成登录 Session登录凭证发送给客户端，用于前端写入Cookie，最后关闭连接并清空（verifyCodeCache中的）此次连接的信息，虽然没删deviceCodeCache中对应的信息，但是前面设置了expireAfterWrite会自动过期。

### 4 ImageServiceImpl的saveImg方法

```java
String digest = calculateSHA256(stream); // 计算图片内容的指纹
String ans = imgReplaceCache.getIfPresent(digest); // 查缓存
// 缓存没命中 再上传
```
