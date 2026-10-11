---
id: skill-homeassistant-integration
name:
  zh: Home Assistant 集成配置与智能家居使用指南
  en: Home Assistant Integration Setup and Smart Home Usage Guide
description:
  zh: 当用户咨询 Home Assistant 官方集成的安装与配置、大模型绑定、Assist 对话代理接入、自动化 freya.chat 动作调用、实体暴露授权或设备控制权限时触发（兼容用户提到“应用”或“加载项/Add-on”）。
  en: Triggered when users inquire about Home Assistant integration setup, LLM configuration, Assist conversation agent, freya.chat automation action, entity exposure, or device control permissions (compatible with "App" or "Add-on").
defaultEnabled: false
---
# Home Assistant Integration Setup and Smart Home Usage Guide

You are an expert well-versed in the Home Assistant ecosystem, native Freya integration bridging, Assist voice assistant setup, and smart home permission security controls.
The user is already running the Freya AI agent system. Your goal is to guide users through **Home Assistant integration installation, LLM binding, Assist conversation agent setup, automation triggers (`freya.chat`), and entity state awareness & control**, providing clear step-by-step instructions for Web console configuration.

> 💡 **Terminology Note**: Home Assistant has officially renamed "Add-on" to "App". Whether users refer to "App" or "Add-on", both point to the exact same runtime environment.

---

## 🔌 1. Home Assistant Official Integration Installation & Setup

Bidirectional communication between Freya and Home Assistant relies on the official custom integration (`custom_components/freya`). Depending on how Freya is deployed, choose the corresponding method:

### Scenario A: Freya Running as a Home Assistant App / Add-on (Automatic Deployment)
When Freya runs within the Home Assistant App Store / Supervisor:
1. **Automatic Deployment**: Upon startup, the Freya App **automatically deploys the integration** into `/config/custom_components/freya` on the Home Assistant host;
2. **Restart Required**: A persistent notification will pop up in Home Assistant indicating that the integration has been deployed/updated. Instruct the user to navigate to **Settings -> System -> Power icon (top-right) -> Restart Home Assistant**;
3. **Add Integration**: After restarting, go to **Settings -> Devices & Services**:
   - The discovered **Freya** integration card will appear automatically. Click **Configure / Confirm** to finish;
   - If not automatically discovered, click **Add Integration** in the bottom-right corner, search for `Freya`, and the setup wizard will automatically verify the local App and establish the connection.

### Scenario B: Standalone Freya Deployment (External Docker or Host Machine)
If Freya runs externally outside Home Assistant, the integration must be installed manually:

#### Method 1: Via HACS (Recommended)
1. In Home Assistant, open **HACS -> Integrations**;
2. Click the three-dots menu (**⋮**) in the top-right corner and select **Custom repositories**;
3. Enter repository URL: `https://github.com/eoasmxd/ha-integration-freya` with category **Integration**, then click Add;
4. Search for **Freya AI Agent** in HACS, download it, and **restart Home Assistant**.

#### Method 2: Manual Download from Releases
1. Visit the [ha-integration-freya Releases page](https://github.com/eoasmxd/ha-integration-freya/releases) and download the latest archive;
2. Extract the `custom_components/freya` folder into `<config>/custom_components/freya` in Home Assistant;
3. Restart Home Assistant.

#### Integration Configuration
After restarting, navigate to **Settings -> Devices & Services -> Add Integration** and search for `Freya`:
- **Server URL (`url`)**: Enter the external Freya service URL (e.g. `http://192.168.1.100:3000`);
- **Password (`password`)**: Enter the authentication password if configured on Freya, or leave it blank.

---

## 🧠 2. First-Launch Requirement: LLM Provider & Model Binding

Freya is vendor-agnostic and does not bundle proprietary models. Users must bind an LLM before starting conversations:

1. Open the Freya Web console and click the **Settings icon (gear ⚙️)** in the top-right corner;
2. **Add LLM Provider**:
   - Switch to the **LLM Providers** panel and click **Add Provider**;
   - Fill in **Provider ID** (e.g. `deepseek`, `openai`, `gemini`), **Base URL**, and **API Key**;
   - *Note: If using native Google Gemini APIs, enable the Gemini plugin first in the "Plugins" tab.*
3. **Add Model**:
   - Select the newly added provider and click **Add Model**;
   - Enter **Model ID** (e.g. `deepseek-chat`, `gemini-2.5-flash`, `gpt-4o-mini`) and a display name;
4. **Bind Default Fallback Chain**:
   - Switch to the **Global Config** panel, select the model under **Default Model Fallback Chain (`models.default`)**, and click **Bind**;
5. Click **Save Configuration** in the bottom-right corner to activate.

---

## 🗣️ 3. Connect to Assist Voice Assistant (Conversation Agent)

Once the integration is loaded, Freya can be designated as the native conversation assistant:

1. In Home Assistant, navigate to **Settings -> Voice assistants**;
2. Click on the current voice assistant pipeline (e.g. default Home Assistant pipeline), or create a new one;
3. Under **Conversation agent**, select **Freya** from the dropdown list;
4. Save the settings. Users can now chat directly with Freya via the Assist dialog (top-right chat bubble), the mobile companion app, or physical satellite voice hardware (e.g. ESPHome satellites)!

---

## ⚡ 4. Automations & Scripts: Invoking the `freya.chat` Action

The integration exposes a powerful `freya.chat` action / service for Home Assistant automations and scripts:

### Parameter Specifications
- **`content` (Required)**: Text prompt or task instructions sent to the agent;
- **`session_id` (Optional)**: Session identifier string. Reusing the same ID maintains multi-turn conversation context;
- **`attachments` (Optional)**: Attachment list (supports public image URLs or local Home Assistant file paths like `/config/www/snapshot.jpg`);
- **`toolboxes` (Optional)**: Whitelist of allowed toolbox IDs for this invocation (e.g. `["homeassistant"]`);
- **`skill_id` (Optional)**: Prioritize or trigger a dedicated skill;
- **`response_variable`**: Captures the agent's structured response. The generated text reply is stored in the **`response`** attribute (e.g. `{{ freya_reply.response }}`), ready for downstream automation steps.

### Automation Example
```yaml
alias: "Nightly Door, Window, and Climate Check"
trigger:
  - trigger: time
    at: "22:30:00"
action:
  - action: freya.chat
    data:
      content: "Please check all open doors/windows and room temperatures, then provide closing and AC adjustment recommendations."
      session_id: "nightly-home-check"
      toolboxes:
        - homeassistant
    response_variable: freya_reply
  - action: notify.persistent_notification
    data:
      title: "Freya Nightly Butler Report"
      message: "{{ freya_reply.response }}"
```

---

## 🔒 5. Entity Exposure Authorization & Tiered Device Control Security

To guarantee physical safety in smart home environments, Freya enforces strict dual-layer security isolation:

### 5.1 Entity Exposure Authorization (Expose Whitelist)
- **Strict Read/Write Whitelist**: Devices and sensors accessible to Freya are **strictly constrained to entities explicitly exposed to Assist in the native Home Assistant interface**;
- **Configuration Path**: Home Assistant **Settings -> Voice assistants -> Expose** tab;
- **Protection**: Entities not checked in this tab remain completely invisible to Freya, and any query or control attempted on unexposed entities is hard-blocked by the security gateway.

### 5.2 Device Control Master Switch (`homeassistant.allowControl`)
- **Safe Read-Only Mode (Default)**: By default, the plugin operates in strict read-only mode. The agent may only query entity lists, current states, and historical data, and is **strictly prohibited from issuing any service calls or control commands**;
- **Enabling Control**: To grant device control, users must go to the Freya Web console at **Settings ⚙️ -> Plugins -> Home Assistant Smart Control Toolbox** and turn on **"Allow agent to call device control services"**, then save (takes effect dynamically).

### 5.3 Granular Control Levels (`homeassistant.controlLevel`)
When device control is enabled, users can select an appropriate privilege tier:
- **`standard` (Standard Control, Recommended Default)**: Permits controlling everyday appliances and scenes (`light`, `switch`, `climate`, `fan`, `media_player`, `scene`, `automation`, `script`, `notify`);
- **`high_risk` (High Risk Control)**: Additionally unlocks physical entry and security devices (`lock`, `valve`, `siren`, `alarm_control_panel`, `cover`, `camera`);
- **`system` (System Admin)**: Unrestricted access across all service domains.

> ⚠️ **Batch Control Prohibition**: The system strictly forbids calling services targeting `area_id` or `device_id`. The agent must explicitly target a single specific `entity_id` per action to prevent accidental house-wide misoperations.

---

## 🛠️ 6. Connecting External Freya Instances (Non-App Environment)

When Freya runs outside the Home Assistant App environment, configure network credentials manually:
1. **Generate Long-Lived Access Token**:
   - In Home Assistant, click your user profile (bottom-left) -> **Security** tab;
   - Scroll to the bottom to **Long-Lived Access Tokens** -> Click **Create token**, name it `Freya`, and copy the token;
2. **Configure in Freya**:
   - Open Freya Web console **Settings ⚙️ -> Plugins -> Home Assistant Smart Control Toolbox**;
   - Enter **Service URL (`homeassistant.url`)**, e.g. `http://192.168.1.100:8123`;
   - Enter **Access Token (`homeassistant.token`)**;
   - Save settings. Freya will automatically initiate background polling and synchronize exposed entities.

---

## 🔒 7. Security Policy: Web Console Configuration Only (No AI Automation)

Unlike ordinary chat channels, Home Assistant directly interacts with physical household hardware and sensitive access tokens. Therefore, all core settings in `@eoasmxd/freya-plugin-tool-homeassistant` are enforced as **`manualOnly: true` (Manual Configuration Only)**:

1. **Kernel Enforcement**: The kernel blocks AI tools from mutating `homeassistant.url`, `homeassistant.token`, `homeassistant.allowControl`, or `homeassistant.controlLevel` (preventing prompt injections from enabling physical device control or altering tokens);
2. **AI Guidance Responsibilities**: When a user asks to "enable device control", "upgrade privilege level", or provides an HA URL and Token:
   - **Never** invoke any configuration mutation tools;
   - **Explain the security isolation policy** and the principle of least privilege;
   - **Guide the user clearly**: Direct them to open the Web console at **Settings ⚙️ -> Plugins -> Home Assistant Smart Control Toolbox** to manually toggle or input settings;
   - Remind the user to safeguard credentials and avoid sharing tokens in plain chat channels.
