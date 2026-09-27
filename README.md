# Freya - Microkernel AI Agent System

[English](README.md) | [简体中文](README.zh.md)

> `Freya` 是一个轻量级、架构清晰、生产可用的微内核智能体系统，专为学习与构建 Agent 而设计。

`Freya` is a lightweight, architecturally clear, and production-ready microkernel AI Agent system designed specifically for **learning Agent programming**. The codebase is intentionally simple and self-documenting, helping developers understand the decision-making mechanics and underlying principles of AI agents without overhead.

While inspired by the open-source **OpenClaw** project in its design philosophy, Freya is built from the ground up with completely independent code. It eliminates complex distributed cluster RPCs and heavy container sandbox dependencies in favor of a clean, monolithic microkernel architecture—while fully preserving and implementing modular plugin extensions, event-driven decoupling, zero-hardcoded prompts, and multi-channel interaction capabilities.

## ✨ Key Features

- 🔌 **Microkernel Architecture**: LLM providers (OpenAI, Gemini, etc.), system tools (filesystem, web, etc.), and communication channels are decoupled via standard SDK contracts and support hot-reloading, keeping the core runtime lightweight.
- ⚡ **Event-Driven Decoupling**: Core and plugins communicate asynchronously via an in-process EventEmitter, providing high-concurrency, low-coupling streaming communication and token billing telemetry.
- 📝 **Zero Hardcoded Prompts**: System identities, constraints, and plugin prompts are strictly separated from source code into physical Markdown files, supporting real-time hot updates and persistent disk overrides through a three-tier cascading probe (`FREYA_HOME` -> `FREYA_LAUNCH` -> `FREYA_APP`) with language fallback.
- 🖥️ **Multi-Channel Interaction**: Built-in modern Web UI and interactive local CLI out of the box, with extensible support for WeChat, WeCom, Telegram, and more, supporting both foreground and daemon modes.

---

## ⚡ Quick Start

### Method 1: Global Install via NPM (Recommended)

Freya is published as a globally executable CLI tool. After global installation, you can launch it directly:

```bash
# 1. Install globally
npm install -g @eoasmxd/freya

# 2. Start the service (listens on http://localhost:3000 by default)
freya

# 3. Run silently in background (disables local console, suitable for servers)
freya --no-cli

# 4. Stop the running background service
freya stop
```

### Method 2: Run via Docker (Recommended, zero-environment setup)

Run instantly without configuring Node.js or package managers (supports persistent configuration and session data):

```bash
# Start and mount persistent data volume (maps host ./freya-data to container /data)
docker run -d \
  --name freya \
  -p 3000:3000 \
  -v $(pwd)/freya-data:/data \
  --restart unless-stopped \
  ghcr.io/eoasmxd/freya:latest
```

Or build and run locally from source:
```bash
# Build and run locally
docker build -t freya .
docker run -d --name freya -p 3000:3000 -v $(pwd)/freya-data:/data freya
```

---

### Method 3: Install via Home Assistant (Recommended for Smart Home users)

If you use Home Assistant, you can run Freya directly as an Add-on. **This installation natively integrates with Home Assistant**, providing a dedicated toolset for smart home status awareness and device control:

1. **One-Click Add Repository**: Click the button below to navigate to your Home Assistant instance and add the repository:

   [![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Feoasmxd%2Fha-addons)

   *Or manually add the repository URL in HA under **"Settings -> Add-ons -> Add-on Store -> Top-right three dots (Repositories)"**: `https://github.com/eoasmxd/ha-addons`.*

2. **Install & Start**: Locate **Freya** in the Add-on Store, click Install and Start. We recommend enabling "Show in sidebar" and "Start on boot".
3. **Native HA Interaction Support**:
   - **Entity State Awareness**: Fully adheres to entities exposed to Assist in the native HA UI (Settings -> Voice assistants -> Expose). The agent reads device states and sensor data on demand.
   - **Device Security Control**: The application is in safe read-only mode by default. To allow the LLM to control devices (turn on/off lights, control switches, etc.), set `homeassistant.allowControl` to `true` in the Freya Web UI ("Global Config -> Permissions & Security").

---

### Method 4: Build & Run from Source

Requirements: **Node.js** (>= 22.0.0) and **pnpm** (9.x).

```bash
# 1. Clone source code and install dependencies
pnpm install

# 2. Build all packages
pnpm build

# 3. Start the microkernel service
pnpm start
```

*After starting the service via any method, navigate to `http://localhost:3000` in your browser (or click on the Home Assistant sidebar) to access the Web UI.*

---

## 📚 System Architecture & Documentation (`doc/`)

Comprehensive technical specifications and documentation are available in the [doc/](doc/_index.en.md) directory:

### 🛠️ Technical Specifications & Guides

* 🚀 **[Getting Started Guide](doc/getting-started.en.md)**: Visual LLM provider configuration, plugin management, and chat shortcuts.
* 🛠️ **[Installation & Deployment Guide](doc/installation-guide.en.md)**: NPM global install, Docker containerization, Home Assistant Add-on, and source code development.
* 🏗️ **[Architecture Design Specification](doc/specifications/architecture-design.md)**: Monorepo physical layout, core ReAct loop sequence diagram, component responsibilities, and EventBus asynchronous communication.
* ⚙️ **[Configuration & Data Isolation Specification](doc/specifications/config-spec.md)**: `~/.freya/` runtime directory layout, data isolation, and dynamic schema merging strategy.
* 📝 **[Prompt Management System](doc/specifications/prompt-system.md)**: 6-dimensional prompt system, dynamic Prompt Composer, and three-tier cascading probe (Cascading Read) mechanism.

### 🎓 White-Box Agent Tutorials

* 👉 **[Hands-On AI Agent Development Tutorials](doc/tutorials/_index.md)**: White-box deep dive into agent fundamentals, containing 13 structured chapters from Next-Token Prediction to the core ReAct loop, multi-turn conversations, and multi-agent collaboration.

---

## 📄 License & Security

* License terms can be found in [LICENSE](LICENSE).
* Security boundaries and threat models are documented in [SECURITY.md](SECURITY.md).
* AI coding assistant behavioral guidelines are documented in [AGENTS.md](AGENTS.md).
