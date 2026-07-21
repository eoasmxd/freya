---
title: "Freya 提示词管理系统说明"
date: 2026-07-21T20:55:00+08:00
draft: false
weight: 16
description: "介绍 6 大维度提示词管理方案、动态 Prompt Composer 拼装结构与 Dual-Read 探针机制。"
---

# Freya 提示词管理系统说明

为了便于运维及非技术人员对智能体进行性格、行为与约束微调，Freya 彻底去除了 TypeScript 源码中的硬编码提示词，统一将提示词拆分为六个核心维度进行解耦管理。

---

## 1. 六大核心维度提示词

*   **IDENTITY (身份设定)**：定义“我是谁”、“我的名字叫 Freya”等基础身份认知（对应物理文件：`config/IDENTITY.md`，程序注册 Key: `core.prompt.identity`）。
*   **SOUL (灵魂性格)**：定义智能体的语气、性格特征、社交风格、核心行为原则（对应物理文件：`config/SOUL.md`，程序注册 Key: `core.prompt.soul`）。
*   **USER (用户设定)**：定义对当前用户的画像认知，让智能体具备对用户偏好、习惯的记忆（对应物理文件：`config/USER.md`，程序注册 Key: `core.prompt.user`）。
*   **MEMORY (长期记忆)**：定义独立长期记忆，不隶属于任何记忆工具插件（对应物理文件：`config/MEMORY.md`，程序注册 Key: `core.prompt.memory`）。
*   **TOOLS (工具使用规范)**：指导智能体何时应该使用工具、如何处理工具的返回结果（对应物理文件：`config/TOOLS.md`，程序注册 Key: `core.prompt.tools`）。
*   **AGENTS (角色与设定)**：定义智能体当前的业务分工或具体的背景工作角色设定（对应物理文件：`config/AGENTS.md`，程序注册 Key: `core.prompt.agents`）。

---

## 2. 运行时提示词拼装结构 (Prompt Composer)

在内核主线程准备调用大模型时，提示词拼装器（Prompt Composer）将按照标准结构，动态将上述各个维度的提示词合并为一条最终的 System Prompt 送入大模型：

```markdown
# IDENTITY (本体)
[读取 config/IDENTITY.md 的生效内容 (对应程序注册 Key: core.prompt.identity)]

# SOUL (灵魂)
[读取 config/SOUL.md 的生效内容 (对应程序注册 Key: core.prompt.soul)]

# USER INFO (用户画像)
[读取 config/USER.md 的生效内容 (对应程序注册 Key: core.prompt.user)]

# MEMORY (长期记忆)
[读取 config/MEMORY.md 的生效内容 (对应程序注册 Key: core.prompt.memory)]

# TOOLS SPEC (工具指南)
[读取 config/TOOLS.md 的生效内容 (对应程序注册 Key: core.prompt.tools)]

# AGENT TOPOLOGY (拓扑模式)
[读取 config/AGENTS.md 的生效内容 (对应程序注册 Key: core.prompt.agents)]

# PLUGIN PROMPT [当前激活的技能 ID] (若当前会话绑定了具体 Skill)
[读取对应 Skill 物理 Markdown 文件中的 systemPrompt 内容]
```

---

## 3. Dual-Read 内存双通道探针机制

*   **读取优先级**：提示词注册表在系统启动时，优先尝试解算运行时 `~/.freya/config/` 目录下用户的自定义 Markdown 覆盖文件；若文件不存在，则自动降级读取包内默认配置（`packages/core/config/prompts/`）充入内存，**启动时不会盲目拷贝磁盘物理文件**。
*   **按需写入**：仅当用户通过 Web 控制台或 `write_prompt` / `edit_prompt` 工具显式编辑提示词时，系统才会将其落盘写入 `~/.freya/config/` 目录中。
*   **空值保护**：如果提示词注册表返回空，代码逻辑只能选择保持空字符 `''` 并跳过该部分拼装，或者使用无自然语言说明的纯变量占位符（如 `'{text}'`），绝对禁止硬编码兜底文案。
