---
title: "第二部分：掌控“工具”"
weight: 30
bookCollapseSection: true
---

# 第二部分：连接物理世界 —— 智能体如何掌控“工具” (Tool Call)

本部分将深入探讨大模型是如何理解并调用外部物理世界的 API 工具的。我们将解剖 JSON Schema 参数描述符、网络 Raw 数据包、以及跨厂商协议流派（OpenAI/Gemini）的抹平架构。

---

## 🧭 章节导学与阅读清单

### 🛠️ 第 4 章：大模型感知与选择工具的底层技术本质
剖析工具描述符的 JSON Schema 规范、捕获并拆解大模型返回的 Tool Call 原始数据，并探索工具执行的安全沙箱设计。
*   👉 **[4.1 语言到动作的转换](4.1_json_schema_mapping.md)**
*   👉 **[4.2 【白盒剖析】Tool Call Raw 数据包结构](4.2_tool_call_raw_packet.md)**
*   👉 **[4.3 【白盒剖析】工具安全防线与本地执行](4.3_freya_tool_execution.md)**
*   👉 **[4.4 调试与避坑指南：错误 Observation 与自我修正](4.4_debugging_observation_fix.md)**

### 🔌 第 5 章：大厂 Function Calling 协议差异与多轮关联流派
分析 OpenAI（基于单会话多 `call_id` 关联）与 Gemini 在多轮工具调用下的协议设计哲学，并拆解底座代理层的解耦与统一抹平设计。
*   👉 **[5.1 工具执行结果的归流](5.1_observation_injection.md)**
*   👉 **[5.2 两大厂商协议流派交锋](5.2_openai_vs_gemini_protocol.md)**
*   👉 **[5.3 【白盒剖析】Freya 大模型代理层协议映射](5.3_freya_llm_proxy_mapping.md)**
*   👉 **[5.4 调试与避坑指南：并发多工具调用关联混乱排错](5.4_debugging_parallel_call_chaos.md)**

