---
title: "Getting Started Guide"
weight: 30
description: "A quick guide on configuring LLM API keys, managing plugin toggles, and using session shortcuts in the console."
---

# Freya Getting Started Guide

## 1. LLM API Configuration

After launching the service and accessing `http://localhost:3000` for the first time, you need to configure your LLM settings:

1. Click the **Settings** ⚙️ button in the top right corner of the interface to open the settings modal.
2. Switch to the **Providers** tab and click **Add Provider**:
   - Fill in the provider name, API endpoint (Base URL), and API Key (such as OpenAI, DeepSeek, or other compatible services).
3. Select the newly added provider and click **Add Model**:
   - Fill in the model ID (e.g., `deepseek-chat` or `gpt-4o`).
4. Switch to the **Global Config** tab:
   - Configure the newly added model in the default model fallback list, and the system will be ready to respond to conversations.

---

## 2. Plugin Management

Select the **Plugins** tab in the settings modal:

- The interface lists all physical plugins discovered by the system (e.g., filesystem tool `plugin-tool-fs`, web fetcher `plugin-tool-web`, etc.).
- Click the toggle switch to hot-load or unload the corresponding plugin capability in real time.

---

## 3. Session Control Commands

The following system commands are supported in the Web chat input box:

- **`/reset`**: Archive and clear the current conversation context, resetting the session.
- **`/session info`**: View the current session status and currently active model information.
- **`/session new [name]`**: Launch a new independent branch session.
- **`/session switch <ID>`**: Switch to a specified historical session.
