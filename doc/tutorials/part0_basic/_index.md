---
title: "第零部分：AI 基础概念"
weight: 10
bookCollapseSection: true
---

# 第零部分：AI 基础概念与“文字接龙”的秘密

本部分将带您深入大语言模型（LLM）的最底层运作机理，从 Tokenizer 到无状态 API 会话的织造，一步步揭开“文字接龙”的物理真相。

---

## 🧭 章节导学与阅读清单

### 🏷️ 第 0 章：揭开 AI 的神秘面纱 —— 大语言模型运作本质
深入自回归大模型的物理极限，彻底理解 Token 切分和生成参数对智能体输出严谨性的本质影响。
*   👉 **[0.1 概率预测与 Next-Token Prediction](0.1_probability_prediction.md)**
*   👉 **[0.2 算力与窗口的物理极限](0.2_attention_and_context.md)**
*   👉 **[0.3 随机与严谨的博弈](0.3_generation_parameters.md)**
*   👉 **[0.4 调试与避坑指南：本地 Token 消耗排查](0.4_debugging_token.md)**

### 🎭 第 1 章：对话的舞台 —— 大模型聊天接口与三种角色
了解大模型 API 无状态的物理事实，掌握 Chat Completion 中三种角色分工以及 Freya 模型代理层的代码实现。
*   👉 **[1.1 鱼的记忆与无状态网络](1.1_stateless_and_history.md)**
*   👉 **[1.2 聊天数据结构解析](1.2_chat_data_structure.md)**
*   👉 **[1.3 三大核心角色分工](1.3_system_user_assistant.md)**
*   👉 **[1.4 【沙箱对照】阅读与调试模型代理配置](1.4_freya_model_proxy.md)**

