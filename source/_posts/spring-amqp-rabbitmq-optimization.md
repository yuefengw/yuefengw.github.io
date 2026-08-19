---
title: "使用Spring AMQP优化技术派RabbitMQ部分"
slug: spring-amqp-rabbitmq-optimization
date: 2026-01-23 11:09:54
updated: 2026-01-23 11:09:57
categories:
  - "Java"
  - "后端工程"
tags:
  - "Java"
  - "Spring"
  - "RabbitMQ"
  - "后端工程"
cover: /images/posts/backend-cover.webp
description: "本文介绍了使用Spring AMQP优化技术派RabbitMQ的实现方案。原方案采用连接池方式存在长连接问题和单线程处理瓶颈，优化后通过Spring AMQP内置的CachingConnectionFactory管理连接池和Channel缓存。主要改进包括：使用@RabbitListener实现消费监听、配置生产者确认和失败回调机制、引入Redis分布式锁防止重复消费。…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/157059736"
original_platform: CSDN
---

本文介绍了使用Spring AMQP优化技术派RabbitMQ的实现方案。原方案采用连接池方式存在长连接问题和单线程处理瓶颈，优化后通过Spring AMQP内置的CachingConnectionFactory管理连接池和Channel缓存。主要改进包括：使用@RabbitListener实现消费监听、配置生产者确认和失败回调机制、引入Redis分布式锁防止重复消费。…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/157059736)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

#### 1\. 原方案

原先技术派使用的是**连接池**的方式发送和消费消息，发送和消费结束后将连接返还给连接池

##### 1.1. 原方案存在的问题

启用mq以后，在不点赞的时候只是10s输出一次processConsumerMsg cycle. 这是因为原先设计的就是十秒钟执行一次consumerMsg方法，AI说消费者应保持长连接状态，具体遇到的问题如下：

-   第一次执行这个方法的时候，consumer对象传入的是channel-1，在handleDelivery方法内部也应当由channel-1进行basicAck，但是第一次执行时候没有点赞，只是`channel.basicConsume(queueName, false, consumer)` 告诉服务器：“有消息推给我”,然后channel-1在方法结束前close掉了
-   这之后点赞，会触发consumer的`handleDelivery`方法，但是在里面进行`channel.basicAck`的时候需要的是已被关闭的channel-1，所以会报错： AlreadyClosedException

而且，while(true)事实上只有单线程处理消息，**无法并行**

##### 1.2. 普通解决方案

`RabbitmaAutoConfig`初始化的时候会调用 `processConsumerMsg()`方法，去掉while使得初始化的时候有一个消费者在线：

```java
@Override
    public void processConsumerMsg() {
        log.info("Begin to processConsumerMsg.");
        // 【重要修改】去掉 while(true) 和 sleep
        // 只需要初始化一次监听即可,消费者监听应保持长连接
        consumerMsg(CommonConstants.EXCHANGE_NAME_DIRECT, CommonConstants.QUERE_NAME_PRAISE,
                CommonConstants.QUERE_KEY_PRAISE);
    }
```

`consumerMsg()`方法里面注释掉close的部分，这样能保证不再报AlreadyClosedException

#### 2\. 使用Spring AMQP优化

Spring AMQP内置了`CachingConnectionFactory`， 它帮我们维护了一个连接池和Channel 缓存，所以我们放弃旧方案，拥抱新技术🤗

主要优化有：

-   Spring AMQP实现点赞通知，通过`RabbitListener`注解实现消费监听
-   `setConfirmCallback`和`setReturnsCallback`实现 `消息 -> 通过交换机 然后路由到 -> 相应的队列`过程中生产者确认和失败回调的简单告警
-   利用Redis 分布式锁防止重复消费

一句话写到简历：**基于 Spring AMQP 重构 RabbitMQ 集成方案，集成生产者确认+退回模式保证消息可靠送达，采用基于Redis TTL 的非阻塞式分布式锁实现消费端幂等与防抖设计, 配置死信队列实现异常消息隔离。**

##### 2.1. 修改依赖

paicoding-core/pom.xml

```xml
        <!--  RabbitMQ
        <dependency>
            <groupId>com.rabbitmq</groupId>
            <artifactId>amqp-client</artifactId>
            <version>5.5.1</version>
        </dependency> 
                        -->

        <!-- ========== Spring AMQP 替代原先的RabbitMQ的写法========== -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-amqp</artifactId>
            <version>2.7.1</version>
        </dependency>
        <!-- 这里不加版本号一直加载不进去，我也不知道为啥 -->
```

##### 2.2. 新增配置类

`RabbitmqConfig`配置了message的转换器、消费者并发数、点赞交换机和队列的配置及路由绑定、死信队列等，连接池应该是在connectionFactory里面。

之前`UserFootServiceImpl`里调用publishMsg的时候，最后一个参数传进来的是Json串，这里已经设置了jsonMessageConverter，以后直接传readUserFootDO就ok，缺点是接口类需要改一下参数类型

```java
@Slf4j
@Configuration
public class RabbitmqConfig {
    /**
     * 消息转换器 - 自动将 Java 对象转换为 JSON
     * 职责：将消息序列化为 JSON，接收时反序列化为对象
     */
    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    /**
     * RabbitTemplate - 消息发送模板
     * 职责：封装消息发送的常用操作
     */
    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate rabbitTemplate = new RabbitTemplate(connectionFactory);
        rabbitTemplate.setMessageConverter(jsonMessageConverter());

        // 消息 -> 通过交换机 然后路由到 -> 相应的队列
        // 这两个 -> 处都有可能出问题
        // 1. 确认消息是否发送到交换机
        rabbitTemplate.setConfirmCallback((correlationData, ack, cause) -> {
            if (ack) {
                log.info("消息成功达到交换机：id={}",
                        correlationData != null ? correlationData.getId() : null);
            } else {
                // 这里发送失败了error一下
                log.error("消息没成功到达交换机，id={}, cause={}",
                        correlationData != null ? correlationData.getId() : null, cause);
            }
        });

        // 2. 确认消息是否路由到队列
        rabbitTemplate.setReturnsCallback(returned -> {
            // TODO: 这里失败以后可以存入数据库或消息队列，由定时任务重试
            // 但是我点到为止了~
            log.error("消息路由失败: exchange={}, routingKey={}, replyCode={}, replyText={}",
                    returned.getExchange(), returned.getRoutingKey(),
                    returned.getReplyCode(), returned.getReplyText());
        });
        return rabbitTemplate;
    }

    /**
     * 监听器容器工厂 - 配置消费者的行为
     * 职责：管理消费者线程、消息确认方式等
     */
    @Bean
    public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
            ConnectionFactory connectionFactory) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setMessageConverter(jsonMessageConverter());
        // 手动确认消息
        factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        // 并发消费者数量
        factory.setConcurrentConsumers(3);
        // 最大并发消费者数量
        factory.setMaxConcurrentConsumers(10);
        // 预取消息数量
        factory.setPrefetchCount(10);
        return factory;
    }

    // ==================== 点赞相关 ====================

    /**
     * 点赞交换机 - Direct 类型
     * 职责：根据 routingKey 精确路由消息
     */
    @Bean
    public DirectExchange praiseExchange() {
        return new DirectExchange(CommonConstants.EXCHANGE_NAME_DIRECT, true, false);
    }

    /**
     * 点赞队列 - 存储点赞消息
     * 职责：保存待消费的点赞通知消息
     */
    @Bean
    public Queue praiseQueue() {
        return QueueBuilder
                .durable(CommonConstants.QUERE_NAME_PRAISE)
                // 配置死信队列 - 消息处理失败后进入死信队列
                .withArgument("x-dead-letter-exchange", CommonConstants.EXCHANGE_NAME_DIRECT + ".dlx")
                .withArgument("x-dead-letter-routing-key", "dlx")
                .build();
    }

    /**
     * 点赞绑定 - 连接交换机和队列
     * 职责：定义 routingKey 路由规则
     */
    @Bean
    public Binding praiseBinding(Queue praiseQueue, DirectExchange praiseExchange) {
        return BindingBuilder
                .bind(praiseQueue)
                .to(praiseExchange)
                .with(CommonConstants.QUERE_KEY_PRAISE);
    }

    // ==================== 死信队列相关 ====================

    /**
     * 死信交换机 - 处理失败消息
     * 职责：接收无法正常消费的消息
     */
    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange(CommonConstants.EXCHANGE_NAME_DIRECT + ".dlx", true, false);
    }

    /**
     * 死信队列 - 存储失败消息
     * 职责：保存处理失败的消息，便于后续排查
     */
    @Bean
    public Queue deadLetterQueue() {
        return QueueBuilder
                .durable(CommonConstants.QUERE_NAME_PRAISE + ".dlq")
                .build();
    }

    /**
     * 死信绑定
     */
    @Bean
    public Binding deadLetterBinding(Queue deadLetterQueue, DirectExchange deadLetterExchange) {
        return BindingBuilder
                .bind(deadLetterQueue)
                .to(deadLetterExchange)
                .with("dlx");
    }
}
```

##### 2.3. 启动类添加 @EnableRabbit 注解

##### 2.4. 修改RabbitmqServiceImpl

类似RedisTemplate一样，这里使用的就是RabbitTemplate，分布式锁保证幂等性。

> **为什么上Redis TTL分布式锁？**  
> AI老师： 在点赞通知场景中，我采用 Redis TTL 分布式锁主要是为了兼顾**消费端幂等性**与**高频操作防抖**。由于 RabbitMQ 存在网络波动导致的重复投递，且用户侧容易出现短时间内多次点击的情况，若直接穿透到数据库依靠唯一索引去重，不仅数据库压力大，还可能导致‘数据回滚了但通知却误发了’的业务不一致。通过 Redis 的 `SETNX` 原子命令配合 5 秒自动过期时间，我在缓存层构建了一个轻量级的**快速失败（Fail-Fast）窗口**，既能毫秒级拦截重复消息，保护了下游数据库，又实现了‘同一时间窗口内只触达一次通知’的友好交互体验。

```java
@Slf4j
@Service
public class RabbitmqServiceImpl implements RabbitmqService {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private RedisTemplate redisTemplate;

    @Autowired
    private NotifyService notifyService;

    /**
     * 判断是否启用 RabbitMQ
     */
    public boolean enabled() {
        return true; // Spring AMQP 会自动根据配置判断是否启用
    }

    /**
     * 发送消息
     *
     * @param exchange    交换机名称
     * @param exchangeType 交换机类型 (本项目只用 Direct)
     * @param routingKey   路由键
     * @param message      消息内容
     */
    public void publishMsg(String exchange,
                           com.rabbitmq.client.BuiltinExchangeType exchangeType,
                           String routingKey,
                           UserFootDO message) {
        // 生成消息唯一ID
        String messageId = message.getUserId() + "_" + message.getDocumentId();
        try {
            rabbitTemplate.convertAndSend(exchange, routingKey, message, msg -> {
                msg.getMessageProperties().setMessageId(messageId);
                return msg;
            });
            log.info("RabbitMQ publish success: exchange={}, routingKey={}, messageId={}",
                    exchange, routingKey, messageId);

        } catch (Exception e) {
            log.error("RabbitMQ publish failed: exchange={}, routingKey={}, messageId={}",
                    exchange, routingKey, messageId, e);
            throw e; // 向上抛出，触发 ConfirmCallback 的失败回调
        }
    }

    /**
     * 消费点赞消息
     *
     * @param message 消息体 (自动反序列化为 UserFootDO)
     * @param channel RabbitMQ 通道
     * @param deliveryTag 消息投递标签 (用于确认)
     */
    @RabbitListener(queues = CommonConstants.QUERE_NAME_PRAISE)
    public void consumerMsg(UserFootDO message, Channel channel,
                            @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag,
                            Message amqpMessage) {
        log.info("RabbitMQ receive message: {}", message);
        // 生成消息唯一标识
        String messageId = message.getUserId() + "_" + message.getDocumentId();
        String lockKey = "rabbitmq:consume:lock:" + messageId;

        try {
            // 为保证幂等性 使用Redis分布式锁，防止重复消费
            Boolean lockAcquired = redisTemplate.opsForValue()
                    .setIfAbsent(lockKey, "1", 5, TimeUnit.SECONDS);

            if(Boolean.FALSE.equals(lockAcquired)){
                // 获取锁失败 说明正在处理或者已经处理过
                log.warn("RabbitMQ message already processed, skip: messageId={}", messageId);
                channel.basicAck(deliveryTag, false);
                return;
            }
            // 业务处理
            notifyService.saveArticleNotify(message, NotifyTypeEnum.PRAISE);

            // 手动确认消息
            channel.basicAck(deliveryTag, false);
            log.info("RabbitMQ consume success: userId={}, articleId={}",
                    message.getUserId(), message.getDocumentId());
            // 用户可能在短时间内多次点赞，如果在第一次点赞通知以后取消锁
            // 那么还是会触发逻辑再通知一次，这里不取消锁则可以在5秒钟内的点赞不重复通知

        } catch (Exception e) {
            log.error("RabbitMQ consume failed: {}", message, e);
            try {
                // 释放锁，让消息可以重新消费
                redisTemplate.delete(lockKey);
                // 拒绝消息，requeue=false 表示进入死信队列
                channel.basicNack(deliveryTag, false, false);
            } catch (IOException ioException) {
                log.error("RabbitMQ nack failed", ioException);
            }
        }
    }

    /**
     * 初始化消费者 (Spring AMQP 会自动启动 @RabbitListener)
     * 保留此方法为了兼容旧代码调用（注释了也可以）
     */
    // public void processConsumerMsg() {
    //     log.info("RabbitMQ consumer initialized, listening on queue: {}",
    //             QUERE_NAME_PRAISE);
    //     // Spring AMQP 会自动管理消费者生命周期
    //     // 无需手动调用 consumerMsg
    // }
}
```

##### 2.5. 修改 application-rabbitmq.yml

```yaml
rabbitmq:
    host: 127.0.0.1
    port: 5672
    username: guest
    password: guest
    virtual-host: /
    listener:
      simple:
        acknowledge-mode: manual  # 手动确认
        prefetch: 10              # 预取消息数量
        concurrency: 3            # 最小并发数
        max-concurrency: 10       # 最大并发数
        retry:
          enabled: true           # 启用重试
          initial-interval: 1000  # 初始重试间隔
          max-attempts: 3         # 最大重试次数
          max-interval: 10000     # 最大重试间隔
    template:
      mandatory: true             # 消息不可达时触发回调
```

##### 2.6. 删除或者注释掉之前的旧文件

原来的RabbitmqProperties、RabbitMqAutoConfig都加了注解，启动的时候都会运行，这里该注释的都注释掉

RabbitmqConnection、RabbitmqConnectionPool只能被主动调用，可以留着

另外，RabbitMQTest类也得注释一下，不然中间报错，AI说是因为 CommonConstants.QUERE\_KEY\_PRAISE重复了，确实是这样

```java
rabbitmqService.consumerMsg(CommonConstants.EXCHANGE_NAME_DIRECT, 
                            // 这里应该是CommonConstants.QUERE_NAME_PRAISE
                            CommonConstants.QUERE_KEY_PRAISE, 
                            CommonConstants.QUERE_KEY_PRAISE);
```
