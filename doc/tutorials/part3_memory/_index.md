---
title: "第三部分：记忆与上下文"
weight: 40
bookCollapseSection: true
---

# 第三部分：大脑的心流与记忆机制 —— 会话与上下文管理

本部分将深入解密智能体的大脑记忆系统。我们将探究会话（Session）在 Agent 系统中的生命周期、数据与源码物理隔离架构设计，以及滑动窗口与基于 LLM 的主动摘要压缩算法。

---

## 🧭 章节导学与阅读清单

### 💾 第 6 章：智能体的短期记忆、多轮会话与持久化安全隔离
探索会话在 Agent 架构中的生命周期与心流跟踪，理解配置、持久化数据与项目源码在物理上的隔离防线。
*   👉 **[6.1 会话管理生命周期与数据结构](6.1_session_state_lifecycle.md)**
*   👉 **[6.2 【沙箱设计】数据与源码物理隔离](6.2_physical_sandbox_separation.md)**
*   👉 **[6.3 【白盒剖析】物理持久化存储机制](6.3_freya_session_storage.md)**
*   👉 **[6.4 调试与避坑指南：高并发会话串线与写入锁排查](6.4_debugging_session_concurrency.md)**

### ⏳ 第 7 章：上下文窗口溢出危机：压缩、滚动与摘要算法
分析大模型发生严重遗忘与 Token 耗费崩塌的本质原因，并拆解滑动窗口截断、LLM 主动摘要生成以及闲置工具淘汰等压缩算法。
*   👉 **[7.1 上下文溢出的毁灭性后果与窗口危机](7.1_context_overflow_loss.md)**
*   👉 **[7.2 上下文压缩机制：滑动窗口与递归摘要算法](7.2_sliding_window_vs_summary.md)**
*   👉 **[7.3 【白盒剖析】Compactor 与淘汰算法](7.3_freya_compactor_impl.md)**
*   👉 **[7.4 调试与避坑指南：递归摘要“套娃死锁”防御](7.4_debugging_summarize_deadlock.md)**

