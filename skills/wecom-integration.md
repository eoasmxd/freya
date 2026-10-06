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
发起 Tool Call 调用 `list_plugin` 查验 `@eoasmxd/freya-plugin-wecom-channel` 插件状态。若 `enabled` 为 `false`，先自动调用 `toggle_plugin(pluginId: "@eoasmxd/freya-plugin-wecom-channel", enabled: true)` 将其热加载启用。

### 步骤 2: 读取当前全量配置
发起 Tool Call 调用 `read_config(revealSensitive: false)` 获取当前系统的配置全貌。

### 步骤 3: 提取或初始化 `wecom.bots` 列表
- 从配置对象中定位 `wecom.bots` 数组。若未配置过，则默认为 `[]`；
- 构建新的 Bot 对象：`{ "botId": "用户提供的BotID", "secret": "用户提供的Secret" }`；
- 将新对象追加到数组中，得到完整的更新后列表数组 `newBotsList`。

### 步骤 4: 写入配置热应用
发起 Tool Call 调用 `update_config(keyPath: "wecom.bots", value: newBotsList)` 提交覆盖更新。

### 步骤 5: 反馈结果
成功写入后，告知用户配置已实时落盘，系统底座会在 5 秒内自动建立 WebSocket 连接。


