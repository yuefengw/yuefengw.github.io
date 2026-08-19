---
title: "Redis实现点赞、收藏、关注等原子计数 + 异步解耦设计"
slug: redis-atomic-counters-async-decoupling
date: 2025-12-30 16:48:06
updated: 2026-01-10 10:19:45
categories:
  - "Java"
  - "后端工程"
tags:
  - "Redis"
  - "Bootstrap"
  - "数据库"
  - "Java"
  - "后端工程"
cover: /images/posts/backend-cover.webp
description: "本文介绍了基于Redis实现高并发计数与异步解耦的设计方案。针对点赞、阅读量等高频操作，使用Redis的HINCRBY命令实现原子计数，避免并发问题。通过Spring的@EventListener和@Async实现业务解耦与异步处理，提升响应速度。同时采用Redis Pipeline减少网络开销，定时任务进行全量数据同步。方案还解决了事务一致性问题，使用游标分页处理大数据量，…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/156419312"
original_platform: CSDN
---

本文介绍了基于Redis实现高并发计数与异步解耦的设计方案。针对点赞、阅读量等高频操作，使用Redis的HINCRBY命令实现原子计数，避免并发问题。通过Spring的@EventListener和@Async实现业务解耦与异步处理，提升响应速度。同时采用Redis Pipeline减少网络开销，定时任务进行全量数据同步。方案还解决了事务一致性问题，使用游标分页处理大数据量，…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/156419312)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## Redis 做计数器

在业务中，我们经常遇到“阅读量”、“点赞数”这种高频写、高频读的数据。如果直接操作 MySQL

```sql
UPDATE article SET view_count = view_count + 1 WHERE id = 1001;
```

在高并发下行锁竞争严重，性能慢。此时可以上Redis缓存在这种高频访问的数据上：

```java
public static Long hIncr(String key, String filed, Integer cnt) {
    // 核心逻辑：通过 template 执行底层的 Redis 命令
    return template.execute((RedisCallback<Long>) con -> 
        con.hIncrBy(keyBytes(key), valBytes(filed), cnt)
    );
}
```

这个方法对应的 Redis CLI 命令是： `HINCRBY key field increment`

-   **原子性 (Atomicity)**: 这是该方法最大的价值。
    -   在高并发场景下（例如 1000 个人同时点击一篇文章），如果我们在 Java 代码中写 `get` -> `value + 1` -> `set`，会出现**并发安全问题**（数据丢失）。
    -   Redis 的 `HINCRBY` 是单线程原子执行的，它保证了无论多少人同时调用，由于 Redis 是单线程处理命令，计数值绝对准确，**不需要在 Java 层加锁（如 `synchronized`）**。
-   **容错性**:
    -   如果 `key` 不存在，Redis 会自动创建。
    -   如果 `field` 不存在，Redis 会将其视为 0，然后执行加法。

> *为什么不用 `redisTemplate.opsForHash().increment(...)`？*

虽然 `opsForHash()` 更简单，但该代码使用了 `execute(RedisCallback)` 模式，这是一种更底层的写法：

1.  **控制粒度**: 直接操作 `byte[]`，避免了 `RedisTemplate` 默认序列化器可能带来的一些额外开销或格式不兼容问题。
2.  **性能**: 在极高性能要求的场景下，直接操作 Connection 稍微快一点点（但也增加了代码复杂度，需要手动处理字节转换）。

## 解耦与消息机制

> 比如在实际设计场景中，点赞之后，除了计数器更新之外，还有用户活跃度更新，如果所有的逻辑都放在业务中，会导致业务的耦合较重

```java
@EventListener(classes = NotifyMsgEvent.class)
@Async
public void notifyMsgListener(NotifyMsgEvent msgEvent) {
    switch (msgEvent.getNotifyType()) {
        case COMMENT:
        case REPLY:
            CommentDO comment = (CommentDO) msgEvent.getContent();
            // 在这里调用hIncr
            RedisClient.hIncr(CountConstants.ARTICLE_STATISTIC_INFO + comment.getArticleId(), CountConstants.COMMENT_COUNT, 1);
            break;
        case DELETE_COMMENT:
        case DELETE_REPLY:
            comment = (CommentDO) msgEvent.getContent();
            RedisClient.hIncr(CountConstants.ARTICLE_STATISTIC_INFO + comment.getArticleId(), CountConstants.COMMENT_COUNT, -1);
            break;
        // ...
        default:
    }
}
```

**A. `@EventListener(classes = NotifyMsgEvent.class)`**

-   **作用**：这是 Spring 提供的观察者模式实现。它声明该方法是一个“监听器”，专门监听 `NotifyMsgEvent` 类型的事件。
-   **原理**：当业务代码调用 `applicationContext.publishEvent(new NotifyMsgEvent(...))` 时，Spring 会自动找到这个方法并执行它，进而触发计数。

**B. `@Async`**

-   **作用**：**异步解耦执行**。  
    如果没有 `@Async`，虽然代码逻辑上解耦了，但实际上还是在**同一个线程**里顺序执行的。用户点赞后，必须等 Redis 更新完才能看到响应。  
    加上 `@Async` 后，Spring 会将这个方法的执行扔给一个**独立的线程池**。
-   **效果**：主线程（处理用户请求的线程）发布完事件立刻返回成功给用户，用户体验快；而 Redis 的更新操作在后台线程慢慢跑，这里积分更新等操作也可以扔给Event或MQ慢慢跑。

**C. `事务一致性问题 (Transaction)`**

-   **隐患**：如果在 `praiseRepository.save()` 事务提交之前发布了事件，而在这个 `@Async` 方法里读取数据库，可能会读不到数据（因为主事务还没提交）。或者， 主事务回滚了，但事件已经发出去并把 Redis 里的数字加了 1，导致数据不一致。
-   **解法**：使用 `@TransactionalEventListener`。  
    它可以配置为 `phase = TransactionPhase.AFTER_COMMIT`。只有当数据库事务**成功提交**后，才触发这个监听器。这保证了业务数据的强一致性。

## Redis Pipeline、定时任务全量更新

```java
RedisClient.pipelineAction()
        .add(..., (connection, key, value) -> connection.hIncrBy(key, value, 1))
        .add(..., (connection, key, value) -> connection.hIncrBy(key, value, 1))
        .execute();
```

-   **场景**：用户阅读一篇文章，需要同时更新两个计数器：
    1.  文章本身的阅读数 +1
    2.  文章作者的总被阅读数 +1
-   **知识点**：
    -   如果不使用 Pipeline，客户端需要发两次请求给 Redis，经历两次 RTT（往返网络延迟）。
    -   **Pipeline** 允许客户端把一组命令一次性打包发给 Redis，Redis 执行完后把结果一次性返回。这极大地减少了网络开销，提升了吞吐量。

```java
 @Scheduled(cron = "0 15 4 * * ?")
    public void autoRefreshAllUserStatisticInfo() {
        Long now = System.currentTimeMillis();
        log.info("开始自动刷新用户统计信息");
        Long userId = 0L;
        int batchSize = 20;
        while (true) {
            List<Long> userIds = userDao.scanUserId(userId, batchSize);
            userIds.forEach(this::refreshUserStatisticInfo);
            if (userIds.size() < batchSize) {
                // 如果这次拿到的不足 20 个（比如只拿到 5 个），说明后面没人了，是最后一批。
                userId = userIds.get(userIds.size() - 1);
                break;
            } else {
                // 移动游标：如果这次拿满了 20 个，说明后面可能还有人。
                // 把游标更新为这批里最后一个人的 ID。
                // 下次循环就会从这个 ID 往后继续查。
                userId = userIds.get(batchSize - 1);
            }
        }
        log.info("结束自动刷新用户统计信息，共耗时: {}ms, maxUserId: {}", System.currentTimeMillis() - now, userId);
    }
```

**知识点 - 游标分页 (Cursor-based Pagination)**：

-   这里使用了 `where id > lastId limit 20` 的方式进行滚动扫描。
-   这是处理全量数据的标准范式：**少量多次**，既不一次读出撑爆内存，也不长期占用数据库连接。
