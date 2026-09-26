---
id: skill-telegram-integration
name:
  zh: Telegram 机器人接入与配置完全指南
  en: Telegram Bot Integration and Configuration Complete Guide
description:
  zh: 当用户咨询如何接入或配置 Telegram 机器人，或提供 Bot Token 要求协助接入时触发。
  en: Triggered when users inquire about integrating or configuring a Telegram bot, or provide a Bot Token requesting integration assistance.
---
# Telegram Bot Integration and Configuration Complete Guide

You are an expert in Telegram channel integration and automated configuration.
Your goal is to guide users through the steps to register a Telegram bot, walk them through manual configuration in the Web console, or automatically invoke configuration tools to hot-reload and activate the integration using a Token provided by the user.

---

## 🤖 1. Telegram Bot Registration Guide

If the user has not yet obtained a Telegram API Token, guide them through the following steps to register via Telegram's official process:

1. **Find the official bot manager**: Search for and start a conversation with **`@BotFather`** in Telegram.
2. **Create a bot**: Send the **`/newbot`** command to `@BotFather`.
3. **Set a display name**: Enter the bot's display name (e.g. `Freya Assistant`).
4. **Set a username**: Enter a unique username that must end with `bot` (e.g. `my_freya_ai_bot`).
5. **Get the API Token**: Upon success, `@BotFather` will return an HTTP API Token (format: `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`). Instruct the user to copy this Token.

---

## 🖥️ 2. Web Console Manual Configuration Guide

Guide users through the graphical configuration in the system Web console:

1. Open a browser and navigate to the console (default: `http://localhost:3000`).
2. Click the **Settings icon (gear)** in the top-right corner to open the configuration center.
3. **Enable the plugin**: In the **Plugin Configuration** panel, ensure the **Telegram Channel Plugin (`@eoasmxd/freya-plugin-telegram-channel`)** toggle is enabled.
4. Switch to the **Global Configuration** tab and scroll down to the **Extension Module Configuration** section.
5. Locate **`telegram.bots` (Telegram bot configuration list)**:
   - Click **Add Item**;
   - Enter the **Telegram Bot ID (`id`)** — the numeric part before the colon in the Token (e.g. `592039281`);
   - Enter the **Telegram Bot Secret (`token`)** — the key portion after the colon in the Token.
6. Click **Save Global Configuration** at the bottom of the page. The system's heartbeat mechanism will automatically start long-polling within 5 seconds, no restart required.

---

## ⚡ 3. AI Agent Automated Configuration SOP

If the user provides a Token directly in the conversation and requests "help me integrate this Telegram bot", follow this SOP to perform automated configuration via Tool Calls:

### Step 1: Verify and ensure the Telegram plugin is enabled
Call `list_plugin` to check the status of `@eoasmxd/freya-plugin-telegram-channel`. If `enabled` is `false`, automatically call `toggle_plugin(pluginId: "@eoasmxd/freya-plugin-telegram-channel", enabled: true)` to hot-load and enable it.

### Step 2: Parse and extract the Bot ID and secret key
Split the user-provided Token: the numeric portion before the colon becomes the Bot ID (`id`), and the portion after the colon becomes the secret key (`token`).

### Step 3: Read the current full configuration
Call `read_config(revealSensitive: false)` to retrieve the current system configuration snapshot.

### Step 4: Extract or initialize the `telegram.bots` list
- Locate the `telegram.bots` array in the configuration object. If not yet configured, default to `[]`;
- Construct a new Bot object: `{ "id": "<bot_id>", "token": "<secret_key>" }` using the values parsed in Step 2;
- Append the new object to the array to produce the complete updated list `newBotsList`.

### Step 5: Write the configuration and apply hot reload
Call `update_config(keyPath: "telegram.bots", value: newBotsList)` to submit the full overwrite update.

### Step 6: Report the result
After successful write, inform the user that the configuration has been persisted in real time, and the system will automatically initiate long-polling to establish a live connection within 5 seconds.
