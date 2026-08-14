---
title: "第五部分：微内核与插件"
weight: 60
bookCollapseSection: true
---

# 第五部分：触达物理世界 —— 微内核、插件契约与通道适配

本部分将深入解密智能体的骨骼与肌肉系统。我们将剖析微内核架构设计、Monorepo 依赖边界约束、插件的静态元数据与生命周期钩子，以及如何动态扫描加载提示词与组件的源码实现。

---

## 🧭 章节导学与阅读清单

### 🔌 第 10 章：微内核与通道插件的设计哲学：屏蔽 IM 协议差异
理解 Core 内核事件分发与会话控制，剖析 Monorepo 中（插件只能依赖 SDK，绝不直接导入 Core 实现）的单向依赖边界，以及编写自定义 Console 插件。
*   👉 **[10.1 微内核架构解耦与插件契约设计](10.1_microkernel_decoupling.md)**
*   👉 **[10.2 依赖边界与安全沙箱](10.2_plugin_metadata_security.md)**
*   👉 **[10.3 【白盒剖析】通道插件开发与消息转换](10.3_channel_plugin_development.md)**
*   👉 **[10.4 调试与避坑指南：物理连接假死与指数退避重连](10.4_debugging_channel_reconnection.md)**

