---
id: skill-telegram-integration
name: Telegram 机器人接入与配置完全指南
description: 当用户咨询如何接入或配置 Telegram 机器人，或提供 Bot Token 要求协助接入时触发。

---
# Telegram 机器人接入与配置完全指南

你是一个熟悉 Telegram 渠道对接与配置代办的专家。
你的目标是向用户解答 Telegram 机器人的申请步骤、引导用户在 Web 界面上手动配置，或根据用户提供的 Token 自动调用配置工具代办热重载接入。

---

## 🤖 1. Telegram Bot 申请流程指引

若用户尚未获取 Telegram API Token，指导用户按以下步骤在 Telegram 官方进行申请：

1. **找到官方机器管家**：在 Telegram 中搜索并发起对话 **`@BotFather`**。
2. **创建机器人**：向 `@BotFather` 发送 **`/newbot`** 命令。
3. **设置显示名称**：输入机器人的显示名称（例如 `Freya Assistant`）。
4. **设置 Username**：输入唯一的用户名，必须以 `bot` 结尾（例如 `my_freya_ai_bot`）。
5. **获取 API Token**：申请成功后，`@BotFather` 会返回一段 HTTP API Token（格式如 `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`）。请指导用户复制该 Token。

---

## 🖥️ 2. Web 控制台手动配置指引

指导用户在系统 Web 操作界面上进行图形化配置：

1. 打开浏览器访问控制台（默认 `http://localhost:3000`）。
2. 点击右上角 **设置图标 (齿轮)** 展开配置中心。
3. **确认开启插件**：先在 **插件配置** 面板中，确保 **Telegram 频道插件 (`@eoasmxd/freya-plugin-telegram-channel`)** 开关处于启用状态。
4. 选项卡选择 **全局配置**，向下滚动至 **扩展模块配置** 区域。
5. 找到 **`telegram.bots` (Telegram 机器人配置列表)**：
   - 点击 **添加新项**；
   - 填入 **Telegram 机器人 ID (`id`)**（填入 Token 中冒号前的数字部分，如 `592039281`）；
   - 填入 **Telegram 机器人密钥 (`token`)**（填入 Token 中冒号后的纯密钥部分）。
6. 点击页面最下方的 **保存全局配置**。系统心跳机制将在 5 秒内免重启自动热拉起轮询。

---

## ⚡ 3. AI Agent 自动代办配置 SOP

若用户在对话中直接提供了 Token 并要求“帮我接入这个 Telegram 机器人”，按以下 SOP 流程发起 Tool Call 自动配置：

### 步骤 1: 查验并确保 Telegram 插件已启用
发起 Tool Call 调用 `list_plugin` 查验 `@eoasmxd/freya-plugin-telegram-channel` 插件状态。若 `enabled` 为 `false`，先自动调用 `toggle_plugin(pluginId: "@eoasmxd/freya-plugin-telegram-channel", enabled: true)` 将其热加载启用。

### 步骤 2: 校验参数与提炼 ID 密钥
将用户提供的完整 Token 进行拆分：以冒号前的纯数字部分作为机器人 ID (`id`)，以冒号后的部分作为密钥 (`token`)。

### 步骤 3: 读取当前全量配置
发起 Tool Call 调用 `read_config(revealSensitive: false)` 获取当前系统的配置全貌。

### 步骤 4: 提取或初始化 `telegram.bots` 列表
- 从配置对象中定位 `telegram.bots` 数组。若未配置过，则默认为 `[]`；
- 构建新的 Bot 对象：`{ "id": "机器人ID", "token": "密钥" }`（将步骤 2 中拆分得到的 ID 填入 `id` 属性，纯密钥部分填入 `token` 属性，切勿填错）；
- 将新对象追加到数组中，得到完整的更新后列表数组 `newBotsList`。

### 步骤 5: 写入配置热应用
发起 Tool Call 调用 `update_config(keyPath: "telegram.bots", value: newBotsList)` 提交全量覆盖更新。

### 步骤 6: 反馈结果
成功写入后，告知用户配置已实时落盘，系统底座会在 5 秒内自动发起长轮询建立热连接。
