---
title: "第一部分：Agent 心智模型"
weight: 20
bookCollapseSection: true
---

# 第一部分：Agent 的心智模型 —— 探秘 ReAct 决策环与沙箱物理隔离

本部分将正式引入智能体的“心智”核心，深入解剖 ReAct 决策环，并在代码物理层面理解 Agent 是如何实现自主决策、工具调用与运行时环境隔离的。

---

## 🧭 章节导学与阅读清单

### 🧠 第 2 章：智能体架构演进 —— 从聊天助手到能动的主体
剖析 ReAct 主决策环 `while(loop)` 运行逻辑，解密智能体如何通过 Reasoning 和 Acting 形成决策闭环，并分析 ReAct 自循环失控的成因。
*   👉 **[2.1 能动性（Agency）的诞生](2.1_agency_vs_chatbot.md)**
*   👉 **[2.2 ReAct 心智模型与推演](2.2_react_mind_model.md)**
*   👉 **[2.3 【白盒剖析】决策循环与 agent-executor 源码](2.3_freya_agent_executor.md)**
*   👉 **[2.4 调试与避坑指南：ReAct 自循环失控熔断](2.4_debugging_loop_deadlock.md)**

### 📝 第 3 章：系统提示词的动态织造与零硬编码规范
探讨如何通过物理分离和热加载避免在 TypeScript 源码中硬编码提示词，并解密运行时双通道动态合并机制。
*   👉 **[3.1 提示词工程的痛点](3.1_hardcoded_prompt_pain.md)**
*   👉 **[3.2 零硬编码解耦架构](3.2_decoupled_architecture.md)**
*   👉 **[3.3 【白盒剖析】双通道动态提示词合并](3.3_freya_dual_read_probe.md)**
*   👉 **[3.4 调试与避坑指南：动态 Prompt 拼装与模板报错排查](3.4_debugging_composition_placeholder.md)**

