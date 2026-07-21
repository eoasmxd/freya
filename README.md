# Freya - 微内核智能体系统

`Freya` 是一个专为**学习智能体（Agent）编程**而设计的轻量级、架构清晰、生产可用的微内核智能体系统。项目代码结构保持了极致的简单与高度自我解释性，旨在帮助开发者无障碍、零负担地透彻理解智能体底座的决策机制与运行原理。

本项目在设计理念上借鉴自开源项目 **OpenClaw**，但全量底层代码均由独立重写打造。Freya 摒弃了复杂的分布式集群 RPC 与繁重的容器沙箱依赖，采用干净纯粹的单体微内核架构，完整保留并实现了插件化扩展、事件驱动解耦、去硬编码提示词及 Web/CLI 双通道交互能力。


---

## ⚡ 快速开始

### 方式一：通过 NPM 全局安装（推荐）

系统已发布为全局可执行命令行工具，全局安装后可直接启动：

```bash
# 1. 全局安装包
npm install -g @eoasmxd/freya

# 2. 启动服务 (默认监听 http://localhost:3000)
freya
```

---

### 方式二：从源码构建运行

运行环境要求：**Node.js** (>= 22.0.0) 和 **pnpm** (9.x)。

```bash
# 1. 克隆源码并安装依赖
pnpm install

# 2. 编译打包全量模块
pnpm build

# 3. 启动微内核服务
pnpm start
```

*任何一种方式启动服务后，使用浏览器访问 `http://localhost:3000` 即可进入 Web 操作界面。*


---

## 📚 系统架构与设计文档库 (`doc/`)

为了便于开发者深入了解 Freya 的底座原理与扩展机制，系统在 [doc/](doc/_index.md) 物理目录下提供了完整的技术文档库：

* 🏗️ **[架构设计说明](doc/architecture-design.md)**：包含 Monorepo 物理结构、核心 ReAct 调用链路图、核心组件职责及 EventBus 异步通信机制。
* ⚙️ **[配置与数据隔离规范](doc/config-spec.md)**：介绍 `~/.freya/` 运行时目录结构、配置/数据物理隔离及 Schema 动态合并策略。
* 📝 **[提示词管理系统](doc/prompt-system.md)**：介绍 6 大维度提示词管理方案、动态 Prompt Composer 拼装结构与 Dual-Read 探针机制。
* 🚀 **[快速使用指引](doc/getting-started.md)**：图形化 LLM 提供商配置、插件开启控制与会话快捷指令。
* 🛠️ **[安装与构建运行](doc/installation-guide.md)**：分步说明环境准备、安装、编译与控制台开发模式。

---

## 📄 开源协议与安全

* 协议规范参阅 [LICENSE](LICENSE)。
* 系统安全边界与威胁模型说明参阅 [SECURITY.md](SECURITY.md)。
* AI 编程助手行为规范参阅 [AGENTS.md](AGENTS.md)。
