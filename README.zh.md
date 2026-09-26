# Freya - 微内核智能体系统

[English](README.md) | [简体中文](README.zh.md)

`Freya` 是一个专为**学习智能体（Agent）编程**而设计的轻量级、架构清晰、生产可用的微内核智能体系统。项目代码结构保持了极致的简单与高度自我解释性，旨在帮助开发者无障碍、零负担地透彻理解智能体底座的决策机制与运行原理。

本项目在设计理念上借鉴自开源项目 **OpenClaw**，但全量底层代码均由独立重写打造。Freya 摒弃了复杂的分布式集群 RPC 与繁重的容器沙箱依赖，采用干净纯粹的单体微内核架构，完整保留并实现了插件化扩展、事件驱动解耦、去硬编码提示词及多通道交互能力。

## ✨ 核心特性

- 🔌 **极致插件化 (Microkernel)**：大模型（OpenAI、Gemini 等）、系统工具（文件、网页等）以及通信频道，均基于标准 SDK 实现外置解耦与热加载，保持系统底座极致轻量。
- ⚡ **事件驱动解耦 (Event-Driven)**：底座与插件、插件与插件之间统一采用 EventEmitter 异步事件进行高并发、低耦合的流式通信与计费追踪。
- 📝 **零硬编码提示词 (Zero-Hardcoded)**：系统人设、交互约束、插件提示词物理脱离源码，通过三层级联探针（FREYA_HOME -> FREYA_LAUNCH -> FREYA_APP）与语言回退机制实现即时热加载与用户落盘覆盖。
- 🖥️ **灵活多通道交互 (Multi-Channel)**：原生内建现代 Web 交互界面与 CLI 本地命令行，并支持通过插件自由扩展接入微信、电报等多平台，支持前后台多种运行模式。

---

## ⚡ 快速开始

### 方式一：通过 NPM 全局安装（推荐）

系统已发布为全局可执行命令行工具，全局安装后可直接启动：

```bash
# 1. 全局安装包
npm install -g @eoasmxd/freya

# 2. 启动服务 (默认监听 http://localhost:3000)
freya

# 3. 后台静默运行 (关闭本地控制台，适合服务器部署)
freya --no-cli

# 4. 停止正在后台运行的 Freya 服务
freya stop
```

### 方式二：通过 Docker 运行（推荐，免环境配置）

无需安装 Node.js 与包管理环境，直接通过容器一键启动（支持配置与会话数据持久化）：

```bash
# 启动并挂载持久化数据目录（宿主机 ./freya-data 映射至容器 /data）
docker run -d \
  --name freya \
  -p 3000:3000 \
  -v $(pwd)/freya-data:/data \
  --restart unless-stopped \
  ghcr.io/eoasmxd/freya:latest
```

或使用本地源码构建镜像运行：
```bash
# 本地构建并启动
docker build -t freya .
docker run -d --name freya -p 3000:3000 -v $(pwd)/freya-data:/data freya
```

---

### 方式三：通过 Home Assistant 应用安装（推荐智能家居用户）

如果您使用 Home Assistant，可以直接将其作为 Add-on 应用运行。**该安装方式天然支持与 Home Assistant 原生交互**，内置专属工具箱，实现智能家居状态感知与设备控制：

1. **一键添加仓库**：点击下方按钮跳转至您的 Home Assistant 实例并完成仓库添加：

   [![在 Home Assistant 中添加此仓库](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Feoasmxd%2Fha-addons)

   *或在 HA **“设置 -> 应用 -> 安装应用 -> 右上角三个点 (仓库)”** 中手动添加仓库地址：`https://github.com/eoasmxd/ha-addons`。*

2. **安装并启动**：在应用列表中找到 **Freya**，点击安装并启动。建议勾选“在侧边栏中显示”与“开机自启”。
3. **原生 HA 交互支持**：
   - **实体状态感知**：完全遵循 HA 原生界面（设置 -> 语音助手 -> 暴露）中暴露给 Assist 的实体列表，智能体可按需读取设备状态与传感器数据。
   - **设备安全控制**：应用默认处于安全只读模式。如需允许大模型执行开关灯、控制电器等动作，可在 Freya Web 界面（“全局配置 -> 权限与安全”）将 `homeassistant.allowControl` 开启为 `true`。

---

### 方式四：从源码构建运行

运行环境要求：**Node.js** (>= 22.0.0) 和 **pnpm** (9.x)。

```bash
# 1. 克隆源码并安装依赖
pnpm install

# 2. 编译打包全量模块
pnpm build

# 3. 启动微内核服务
pnpm start
```

*任何一种方式启动服务后，使用浏览器访问 `http://localhost:3000`（或在 Home Assistant 侧边栏点击）即可进入 Web 操作界面。*


---

## 📚 系统架构与设计文档库 (`doc/`)

为了便于开发者深入了解 Freya 的底座原理与扩展机制，系统在 [doc/](doc/_index.md) 物理目录下提供了完整的技术文档库：

### 🛠️ 技术规范与指南

* 🚀 **[快速使用指引](doc/getting-started.md)**：图形化 LLM 提供商配置、插件开启控制与会话快捷指令。
* 🛠️ **[安装与构建运行](doc/installation-guide.md)**：包含 NPM 全局安装、Docker 容器化、Home Assistant 应用以及源码构建与控制台开发模式。
* 🏗️ **[架构设计说明](doc/specifications/architecture-design.md)**：包含 Monorepo 物理结构、核心 ReAct 调用链路图、核心组件职责及 EventBus 异步通信机制。
* ⚙️ **[配置与数据隔离规范](doc/specifications/config-spec.md)**：介绍 `~/.freya/` 运行时目录结构、配置/数据物理隔离及 Schema 动态合并策略。
* 📝 **[提示词管理系统](doc/specifications/prompt-system.md)**：介绍 6 大维度提示词管理方案、动态 Prompt Composer 拼装结构与三层级联探针（Cascading Read）机制。

### 🎓 白盒开发教程

* 👉 **[智能体开发实战教程](doc/tutorials/_index.md)**：白盒解剖智能体底座，包含 13 个章节硬核教程，从 Next-Token Prediction 到底层 ReAct 循环、多轮会话以及多智能体协同协作等原理解密。

---

## 📄 开源协议与安全

* 协议规范参阅 [LICENSE](LICENSE)。
* 系统安全边界与威胁模型说明参阅 [SECURITY.zh.md](SECURITY.zh.md)。
* AI 编程助手行为规范参阅 [AGENTS.zh.md](AGENTS.zh.md)。
