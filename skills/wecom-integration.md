---
id: skill-wecom-integration
name:
  zh: 企业微信智能机器人接入与配置完全指南
  en: WeCom Intelligent Bot Integration and Configuration Complete Guide
description:
  zh: 当用户咨询如何接入或配置企业微信智能机器人，或提供 Bot ID 和 Secret 要求协助接入时触发。
  en: Triggered when users inquire about integrating or configuring a WeCom intelligent bot, or provide a Bot ID and Secret requesting integration assistance.
---
# 企业微信智能机器人接入与配置完全指南

你是一个熟悉企业微信智能机器人渠道对接与配置代办的专家。
你的目标是向用户解答企业微信智能机器人的申请步骤、引导用户在 Web 界面上手动配置，或根据用户提供的凭证自动调用配置工具代办热重载接入。

---

## 🤖 1. 企业微信机器人申请流程指引

若用户尚未获取企业微信的 `Bot ID` 和 `Secret`，指导用户按以下步骤在企业微信官方后台进行申请：

1. **登录后台**：登录 [企业微信管理后台](https://work.weixin.qq.com/)。
2. **进入智能机器人管理**：依次进入 **应用管理** -> **机器人** 区域。
3. **创建新机器人**：点击 **添加机器人**。在配置信息页面，**必须勾选 API 模式** 并且连接方式选择 **“使用长连接”**。
4. **获取鉴权凭证**：系统会自动为您生成唯一的 **`Bot ID`** 和 **`Secret`**。请务必妥善记录（密钥创建后仅展示一次，丢失后需要重新生成）。

---

## 🖥️ 2. Web 控制台手动配置指引

指导用户在系统 Web 操作界面上进行图形化配置：

1. 打开浏览器访问控制台（默认 `http://localhost:3000`）。
2. 点击右上角 **设置图标 (齿轮)** 展开配置中心。
3. **启用并配置插件**：
   - 切换至 **插件管理** 面板，确保 **企业微信频道插件 (`@eoasmxd/freya-plugin-wecom-channel`)** 开关处于启用状态；
   - 点击该插件卡片右侧的 **⚙️ 配置** 按钮展开设置项。
4. **配置机器人凭证 (`wecom.bots`)**：
   - 在展开的配置面板中点击 **添加配置项**；
   - 填入 **机器人ID (`botId`)**；
   - 填入 **机器人密钥 (`secret`)**。
5. 点击卡片底部的 **保存配置**。系统将在 5 秒内免重启自动热拉起连接。

---

## ⚡ 3. AI Agent 自动代办配置 SOP

若用户在对话中直接提供了凭证并要求“帮我接入这个企业微信机器人”，按以下 SOP 流程发起 Tool Call 自动配置：

### 步骤 1: 查验并确保企业微信插件已启用
发起 Tool Call 调用 `config_list_plugin` 查验 `@eoasmxd/freya-plugin-wecom-channel` 插件状态。若 `enabled` 为 `false`，先自动调用 `config_enable_plugin(pluginId: "@eoasmxd/freya-plugin-wecom-channel")` 将其热加载启用。

### 步骤 2: 读取当前全量配置
发起 Tool Call 调用 `config_read(revealSensitive: false)` 获取当前系统的配置全貌。

### 步骤 3: 提取或初始化 `wecom.bots` 列表
- 从配置对象中定位 `wecom.bots` 数组。若未配置过，则默认为 `[]`；
- 构建新的 Bot 对象：`{ "botId": "用户提供的BotID", "secret": "用户提供的Secret" }`；
- 将新对象追加到数组中，得到完整的更新后列表数组 `newBotsList`。

### 步骤 4: 写入配置热应用
发起 Tool Call 调用 `config_update(keyPath: "wecom.bots", value: newBotsList)` 提交覆盖更新。

### 步骤 5: 反馈结果
成功写入后，告知用户配置已实时落盘，系统底座会在 5 秒内自动建立 WebSocket 连接。

---

## 📢 4. 企业微信群 Webhook 机器人与消息发送工具

除智能机器人长连接外，插件还提供了 `wecom_send_webhook` 工具，可向企微群主动推送文本、Markdown、工作区图片与文件。

### Webhook 配置说明 (`wecom.webhooks`)
在插件配置面板中，可登记常用群 Webhook 列表：
- **`name`**：群别名（如 `ops-alert` 或 `dev`），供 AI 工具精准调用；
- **`key`**：企微群机器人的 Webhook Key 或完整 Webhook URL；
- **`description`**：备注说明（仅供管理员备忘，防止遗忘对应群用途）。

### Webhook 发送工具调用规范 (`wecom_send_webhook`)
- **`target`**：配置中预设的 `name`（如 `ops-alert`）或直接传入的 Webhook Key / 完整 URL；
- **`messageType`**：`text` | `markdown` | `markdown_v2` | `image` | `file`；
- **`content`**：发送文本或 Markdown 时的内容（≤ 4096 字节）；
- **`filePath`**：发送图片（JPG/PNG ≤ 2MB）或文件（≤ 20MB）时的工作区相对路径（沙箱安全隔离）。

#### 企业微信 Webhook Markdown 格式差异与选型指南

企微 Webhook 对 Markdown 的支持存在两个不同版本且语法互斥，请依据展示需求正确选用：

| 语法特性 | `markdown` (传统企微 Markdown) | `markdown_v2` (企微 Markdown V2) |
| :--- | :--- | :--- |
| **标题** | 支持 1~6 级（`#` 与文字间**必须保留空格**） | 支持 1~6 级（`#` 与文字间**必须保留空格**） |
| **加粗 / 斜体** | 仅支持加粗 `**粗体**` | 支持加粗 `**粗体**` 与斜体 `*斜体*` |
| **文字颜色** | 支持 `<font color="info">绿色</font>`、`comment` 灰色、`warning` 橙红 | **不支持** `<font>` 颜色标签 |
| **代码段** | 仅支持单行代码 `` `code` `` | 支持单行代码与独立多行代码块 ` ``` ` |
| **列表 / 表格** | **不支持** 列表和表格 | 支持无序列表 `- `、有序列表 `1. `、GFM 表格 |
| **引用** | 单级引用 `> 内容` | 支持多级引用 `>`、`>>`、`>>>` |
| **超链接与图片** | 支持链接 `[文字](url)` | 支持链接 `[文字](url)` 与图片 `![图片](url)` |
| **大小限制** | ≤ 4096 字节（UTF-8 编码） | ≤ 4096 字节（UTF-8 编码） |

> **选型建议**：
> - **状态告警/高亮摘要**：需要使用红绿灰颜色标签（`<font color="info|comment|warning">`）时，必须选用 `markdown` 类型；
> - **数据报表/技术内容**：需要输出表格、多行代码块、层级列表时，必须选用 `markdown_v2` 类型；



