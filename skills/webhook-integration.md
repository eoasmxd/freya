---
id: skill-webhook-integration
name:
  zh: Webhook 事件触发频道配置与调用完全指南
  en: Webhook Event Channel Integration and Usage Complete Guide
description:
  zh: 当用户咨询如何配置 Webhook 端点、如何使用 HTTP POST 触发智能体临时会话、或如何对接第三方系统（Sentry、GitHub 等）时触发。
  en: Triggered when users inquire about configuring Webhook endpoints, invoking ephemeral sessions via HTTP POST, or integrating third-party systems like Sentry or GitHub.
---
# Webhook Event Channel Integration and Usage Complete Guide

You are an expert familiar with the Freya Webhook event channel integration and automated agent task triggering.
Your goal is to guide users through the configuration specifications for Webhook endpoints, demonstrate how to trigger tailored ephemeral sessions via URL path keys, and explain how to receive execution results via synchronous or asynchronous modes.

---

## 📡 1. Webhook Core Mechanism Overview

The Freya built-in Webhook channel plugin (`@eoasmxd/freya-plugin-webhook-channel`) leverages the system's built-in Web container to provide a lightweight event trigger gateway:
- **Route Endpoint**: `POST /webhook/:key`
- **Authentication & Routing**: The `:key` in the path matches against the `webhook.endpoints` configuration list, eliminating the need for complex cookies or Authorization headers;
- **Isolated Ephemeral Environment**: Every trigger runs in a stateless ephemeral session (`ephemeral: true`), with resources cleaned up automatically upon completion;
- **Customizable Capabilities**: Each endpoint or incoming request can customize active toolboxes (`toolboxes`), preset skills (`skillId`), prompts (`prompt`), and language (`language`);
- **Response Modes**:
  - **Synchronous Waiting (`sync: true`)**: The HTTP request hangs and waits until the agent completes execution, returning 200 OK along with the final response text;
  - **Asynchronous Delivery (`sync: false`)**: The HTTP request immediately responds with 202 Accepted, and the agent executes autonomously in the background.

---

## 🖥️ 2. Web Console Configuration Guide

1. Open your browser and navigate to the Freya console (default: `http://localhost:3000`).
2. Click the **Settings icon (gear)** in the top-right corner to open the configuration center.
3. Switch to **Plugins** and ensure the **Webhook Event Channel (`@eoasmxd/freya-plugin-webhook-channel`)** toggle is enabled.
4. Click the **⚙️ Configure** button on the plugin card to expand settings.
5. In the **Webhook Endpoints (`webhook.endpoints`)** list, add an endpoint:
   - **Key (`key`)**: Unique endpoint identifier. Using a high-entropy, meaningless long random string (e.g. `sec_9f82d1c4e0b5a76189ef3214bc90`) is strongly recommended;
   - **Description (`description`)**: Human-readable remark (e.g. `Sentry production exception analysis`);
   - **Toolboxes (`toolboxes`)**: Optional comma-separated toolbox IDs (e.g. `fs, web`);
   - **Preset Skill ID (`skillId`)**: Optional, e.g. `skill-mysql-integration`;
   - **AI Preset Prompt (`prompt`)**: Optional preset instructions for the AI;
   - **Default Synchronous (`sync`)**: Checked means synchronous wait by default; unchecked means asynchronous acceptance by default;
   - **Default Language (`language`)**: Optional default language (e.g. `en` or `zh`, defaults to `en`).
6. Click **Save Configuration** to take effect immediately.

---

## 🚀 3. HTTP Invocation Examples

### 3.1 Synchronous Invocation (Waiting for AI Execution Result)
```bash
curl -X POST "http://localhost:3000/webhook/sec_9f82d1c4e0b5a76189ef3214bc90" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Server 10.0.1.20 disk usage exceeds 90% alert. Analyze probable root causes and troubleshooting steps.",
    "sync": true
  }'
```
**Response Example (200 OK)**:
```json
{
  "success": true,
  "response": "Based on the analysis, here are the probable causes:\n1. Log rotation not configured under /var/log...\n2. Uncleaned temporary files..."
}
```

### 3.2 Asynchronous Invocation (Autonomous Background Execution)
```bash
curl -X POST "http://localhost:3000/webhook/sec_9f82d1c4e0b5a76189ef3214bc90" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Execute daily full log archival and analysis task",
    "sync": false
  }'
```
**Response Example (202 Accepted)**:
```json
{
  "success": true,
  "accepted": true,
  "message": "Webhook task accepted for asynchronous execution"
}
```

### 3.3 Dynamic Extension of Toolboxes and Skill Parameters
```bash
curl -X POST "http://localhost:3000/webhook/sec_9f82d1c4e0b5a76189ef3214bc90" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Query latest order statuses from the user table",
    "toolboxes": ["mysql"],
    "skillId": "skill-mysql-integration",
    "prompt": "Output only the markdown result table without conversational pleasantries",
    "sync": true,
    "language": "en"
  }'
```
- The request `toolboxes` will be merged with the endpoint's configured `toolboxes` via **union and deduplication**;
- The request `prompt` will be **concatenated** with the endpoint's configured prompt as task instructions;
- The request `skillId` will **override** the endpoint preset;
- The request `language` will **override** the endpoint configuration and system fallback (defaults to `en`).
