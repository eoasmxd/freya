---
title: "Getting Started Guide"
weight: 30
description: "A quick guide on configuring LLM API keys, managing plugin toggles, and using session shortcuts in the console."
---

# Freya Getting Started Guide

## 1. LLM API Configuration

After entering the console, follow these three steps to configure and connect your LLM:

### Step 1: Add a Provider
1. Click the **Settings ⚙️** icon in the top-right corner to open the configuration panel, and go to the **Providers** tab.
2. Click **Add Provider**, then fill in the **Provider ID**, **Base URL**, and **API Key** (`OPENAI` compatible protocol is selected by default).
   > **Note**: If you want to use the native Google Gemini API, please first enable the **Gemini Model Plugin** under the **Plugins** tab (disabled by default).

### Step 2: Add a Model
1. Select the newly added provider from the left list.
2. Click **+ Add Model**, enter your target **Model ID** (e.g. `gemini-3.5-flash-lite`, `deepseek-v4-flash`, `gpt-4o-mini`), and confirm.

### Step 3: Bind to the Default Fallback Chain & Save (Global Config)
1. Switch to the **Global Config** tab, expand the **Models** category, and locate **Default Model Fallback Chain (`models.default`)**.
2. Select your newly added model from the bottom dropdown list and click **Bind** (you can bind multiple models and adjust fallback priorities using the arrow buttons).
3. **Click the "Save Configuration" button** in the bottom-right corner to save and apply changes. You are now ready to chat!

#### Common Provider Reference

| Provider | Official Default Base URL | Model ID Example | Protocol / Plugin |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | Official default endpoint | `gemini-3.5-flash-lite` | Requires enabling the Gemini Model Plugin |
| **DeepSeek** | `https://api.deepseek.com` | `deepseek-v4-flash` | OPENAI compatible protocol |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` | OPENAI compatible protocol |

> 💡 **Endpoint Note**: The Base URLs above are official default endpoints. Freya strictly follows the OpenAI API specification and fully supports third-party proxy/aggregation platforms (e.g. SiliconFlow, OpenRouter) as well as open-source local deployments (e.g. Ollama, vLLM, with endpoints like `http://<IP>:11434/v1`).

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
