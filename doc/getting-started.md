---
title: "快速使用指引"
weight: 30
description: "介绍如何配置大模型 API Key、开启插件功能以及在控制台使用快捷指令。"
---

# Freya 快速使用指引

## 1. 大模型 (LLM) API 配置

首次进入控制台后，需按以下三步完成大模型接入：

### 步骤 1：添加提供商 (Provider)
1. 点击右上角齿轮图标 **设置 ⚙️**，进入 **LLM 提供商** 页签。
2. 点击 **添加提供商**，填入 **提供商 ID**、**Base URL** 与 **API Key**（类型默认 `OPENAI` 兼容）。
   > **注意**：如需使用 Google Gemini 原生接口，需先在 **插件配置** 页签开启 **Gemini 模型插件**（系统默认处于关闭状态）。

### 步骤 2：添加模型 (Model)
1. 在左侧列表中选中刚刚添加的提供商。
2. 点击 **+ 添加模型**，填入目标 **模型 ID**（例如 `gemini-3.5-flash-lite`、`deepseek-v4-flash`、`gpt-4o-mini`）并确认。

### 步骤 3：绑定默认降级链并保存 (Global Config)
1. 切换到 **全局配置** 页签，展开分类 **“模型” (Models)**，找到 **默认模型降级链列表 (`models.default`)**。
2. 在下方下拉框中选中刚添加的模型，点击 **绑定**（可添加多个模型并通过箭头调整故障降级优先级）。
3. **点击弹窗右下角的【保存配置】按钮**落盘，即可开始对话。

#### 常用提供商配置参考

| 提供商 | 官方默认 Base URL | 典型模型 ID 示例 | 协议 / 插件要求 |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | 官方默认端点 | `gemini-3.5-flash-lite` | 需先启用 Gemini 模型插件 |
| **DeepSeek** | `https://api.deepseek.com` | `deepseek-v4-flash` | OPENAI 兼容协议 |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` | OPENAI 兼容协议 |

> 💡 **端点说明**：表中 Base URL 仅为官方默认端点。Freya 遵循标准 OpenAI 协议规范，亦完全支持各类第三方中转/聚合平台（如 SiliconFlow、OpenRouter 等）以及开源本地部署大模型（如 Ollama、vLLM 等，端点形如 `http://<IP>:11434/v1`）。

---

## 2. 插件开关控制

在设置弹窗中选择 **插件配置** 页签：

- 界面会列出当前系统扫描到的全部物理插件（如文件读写工具 `plugin-tool-fs`、网络探针 `plugin-tool-web` 等）。
- 点击开关可实时装载或卸载对应的插件能力。

---

## 3. 会话控制指令

在 Web 聊天的文本输入框中，支持以下系统指令：

- **`/reset`**：存档并清除当前的聊天上下文，重置会话。
- **`/session info`**：查看当前会话的基本状态与当前激活的模型信息。
- **`/session new [名称]`**：拉起一个新的独立会话。
- **`/session switch <ID>`**：切换到特定的历史会话。
