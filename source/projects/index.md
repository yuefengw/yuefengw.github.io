---
title: 项目
date: 2026-08-19 10:00:00
top_img: false
comments: false
---

<div class="project-showcase">
  <article class="project-showcase-item featured">
    <img src="/images/posts/astraflow-cover.webp" alt="AstraFlow 多智能体编排工作台">
    <div class="project-showcase-content">
      <p class="project-eyebrow">MULTI-AGENT ORCHESTRATION</p>
      <h2>AstraFlow</h2>
      <p>面向复杂任务的多智能体编排平台，覆盖任务理解、动态路由、多 Agent 协作、工具注册、沙箱执行、可观测性与记忆检索。</p>
      <div class="project-actions">
        <a href="https://astraflow.wyf219.top" target="_blank" rel="noopener noreferrer">在线演示</a>
        <a href="/posts/astraflow-multi-agent-orchestration/">阅读设计记录</a>
      </div>
    </div>
  </article>

  <article class="project-showcase-item">
    <img src="/images/posts/claimassist-cover.webp" alt="ClaimAssist RAG 检索问答架构图">
    <div class="project-showcase-content">
      <p class="project-eyebrow">RAG KNOWLEDGE SYSTEM</p>
      <h2>ClaimAssist</h2>
      <p>面向保险条款的 RAG 智能问答平台，包含异步文档处理、结构化切块、混合检索、Cross-Encoder 重排、记忆融合与 RAGAS 评估。</p>
      <div class="project-actions">
        <a href="https://rag.wyf219.top" target="_blank" rel="noopener noreferrer">在线演示</a>
        <a href="/posts/claimassist-rag-retrieval-pipeline/">阅读设计记录</a>
      </div>
    </div>
  </article>
</div>

## 中能元器件交易与技术交流平台

**中能电子科技有限公司 · Java 实习生 · 2025.06 - 2025.09**

- 优化微信回调链路，通过 Redis 去重、异步任务与客服消息接口实现快速 ACK、AI 回复补发和重复消息过滤。
- 将 RabbitMQ 手写连接池与轮询消费改为 Spring AMQP 监听模型，结合 ACK/NACK、死信队列和 Redis TTL 锁保障可靠投递与幂等。
- 参与微信扫码登录与内容付费阅读模块，使用 SSE 同步登录状态，并通过分布式锁、幂等校验与异步消息保障订单一致性。
