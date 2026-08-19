---
title: ClaimAssist：从文档处理到混合检索的 RAG 问答链路
slug: claimassist-rag-retrieval-pipeline
date: 2026-08-17 18:00:00
updated: 2026-08-19 11:20:00
categories:
  - 工程实践
  - RAG
tags:
  - Elasticsearch
  - RAGAS
  - Kafka
  - MinIO
  - Cross-Encoder
cover: /images/posts/claimassist-cover.webp
description: 介绍 ClaimAssist 如何处理保险条款文档，并通过混合检索、重排、记忆融合和自动评估提升回答质量。
---

ClaimAssist 是一个面向保险条款的 RAG 智能问答平台。相比“把 PDF 切成固定长度再做向量检索”，它更关注文档结构、召回质量和结果可评估性。

<p><a class="post-demo-button" href="https://rag.wyf219.top" target="_blank" rel="noopener noreferrer">打开在线演示</a></p>

## 异步文档处理

上传链路基于 MinIO 与 Kafka，支持分片上传、续传和合并。文件进入处理队列后，解析、切块、向量化和索引化可以异步执行，避免大文档阻塞请求线程。

## 结构化切块

系统以 MinerU 解析得到的 JSON 为基础，再结合递归细切、列表前导句、表头绑定和 VLM 图片描述回填，尽量避免把一个完整条款拆成缺少上下文的碎片。

在项目测试中，这套策略将知识库检索召回率从 73% 提升到 87%。

## 混合检索与重排

检索阶段并行使用两条路径：

1. Elasticsearch + IK 分词器完成 BM25 关键词召回；
2. KNN 完成向量语义召回。

随后使用 RRF 融合两路结果，再通过 Cross-Encoder 进行第二阶段重排。项目评估中，MRR 和 NDCG 均提升 20% 以上。

## 记忆与评估

多轮对话使用 Redis 窗口上下文保留短期信息，通过 LLM 摘要抽取长期记忆，并由 Elasticsearch 完成相关记忆召回。

质量评估使用 RAGAS 和 450 条测试集持续执行。项目记录中，忠实度由 71% 提升到 85%，上下文精确度与召回率接近 90%。
