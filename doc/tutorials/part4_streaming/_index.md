---
title: "第四部分：流式与事件驱动"
weight: 50
bookCollapseSection: true
---

# 第四部分：智能体的血脉与交互体验 —— 流式通信与事件驱动

本部分将深入解密智能体的网络血液系统。我们将剖析 SSE（Server-Sent Events）流式协议本质、字符分片传输中的乱序解码，以及双通道事件总线的解耦架构设计。

---

## 🧭 章节导学与阅读清单

### ⚡ 第 8 章：用户交互期望：流式响应 (Streaming Delta) 的传输秘密
探索流式 SSE 推送与长连接原理，解密如何在向用户吐出流的同时，拦截和隐藏 Thought 或 Tool 的内部推理流。
*   👉 **[8.1 SSE 协议本质与首字延迟革命](8.1_sse_protocol_basics.md)**
*   👉 **[8.2 隐藏中间推理的工程艺术](8.2_hiding_thoughts_in_stream.md)**
*   👉 **[8.3 【白盒剖析】EventBus 事件广播与响应推送](8.3_freya_event_bus.md)**
*   👉 **[8.4 调试与避坑指南：反代缓存与流式 UTF-8 字符截断排错](8.4_debugging_stream_decoder.md)**

### 🛑 第 9 章：计费解耦、状态监测与异步中断 (Abort)
掌握 AbortController 信号在多级异步调用中的打断链传导，分析 Token 消费审计与结算的解耦设计，以及解决打断后资源未释放导致的泄漏。
*   👉 **[9.1 链路级刹车机制](9.1_abort_signal_braking.md)**
*   👉 **[9.2 异步事件通信机制](9.2_async_event_channels.md)**
*   👉 **[9.3 【白盒剖析】中断流转与抢救性结算](9.3_freya_abort_billing.md)**
*   👉 **[9.4 调试与避坑指南：中断抢占死锁与句柄释放排查](9.4_debugging_abort_lock_deadlock.md)**

