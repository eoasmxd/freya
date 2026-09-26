---
title: "安装与构建运行"
weight: 20
description: "提供环境准备、NPM 全局安装、Docker 容器化、Home Assistant 应用与源码构建运行的完整安装与服务维护指南。"
---

# Freya 安装与构建运行

## 1. 环境准备

运行项目需要以下工具环境：
- **Node.js**：>= 22.0.0
- **pnpm**（仅源码构建需要）：9.x

---

## 2. 方式一：通过 NPM 全局安装与维护（推荐）

适合希望快速部署和开箱即用 Freya 服务的用户。系统已发布为全局可执行命令行工具，无需下载源码即可一键启动。

### 2.1 安装全局包
在终端执行：
```bash
npm install -g @eoasmxd/freya
```

### 2.2 启动服务
根据需求选择运行模式：
* **前台常规运行**（同时拉起 Web 与本地控制台交互）：
  ```bash
  freya
  ```
* **后台静默运行**（禁用本地控制台，适合服务器部署，父进程会自动安全退回终端）：
  ```bash
  freya --no-cli
  ```

### 2.3 停止服务
当需要中止后台运行的 Freya 服务时，执行：
```bash
freya stop
```

### 2.4 手动版本更新
当发布了新的包版本时，在终端执行以下三步完成更新：
1. **停止后台进程**：`freya stop`
2. **下载并更新全局包**：`npm install -g @eoasmxd/freya@latest`
3. **重新拉起服务**（根据需要选择前台或后台模式）：`freya` 或 `freya --no-cli`

---

## 3. 方式二：通过 Docker 容器化部署与维护（推荐）

适合希望免去 Node.js 环境配置、开箱即用、或在云服务器/NAS 上实现轻量化私有部署的用户。

### 3.1 启动服务并持久化存储
在终端执行以下命令拉取官方最新镜像并常驻启动（Web 服务映射至 3000 端口，并将宿主机当前目录下的 `freya-data` 挂载到容器内持久化数据目录）：

```bash
docker run -d \
  --name freya \
  -p 3000:3000 \
  -v $(pwd)/freya-data:/data \
  --restart unless-stopped \
  ghcr.io/eoasmxd/freya:latest
```

*也可以使用本地源码直接构建镜像并运行：*
```bash
docker build -t freya .
docker run -d --name freya -p 3000:3000 -v $(pwd)/freya-data:/data freya
```

### 3.2 停止与重启服务
* **临时停止**：`docker stop freya`
* **重新唤醒**：`docker start freya`
* **重启服务**：`docker restart freya`

### 3.3 容器版本平滑更新
当发布了新的镜像版本时，执行以下三步即可无损升级：
1. **拉取最新镜像**：`docker pull ghcr.io/eoasmxd/freya:latest`
2. **销毁旧容器**：`docker rm -f freya`（用户配置与会话记忆均保留在 `./freya-data` 挂载目录中，数据安全无损）
3. **重新拉起服务**：重新执行 3.1 中的 `docker run` 命令即可。

---

## 4. 方式三：通过 Home Assistant 应用部署与维护（支持智能家居交互）

适合拥有 Home Assistant (HAOS / Supervised) 环境、希望将 Freya 与全屋智能无缝联动的用户。

> [!TIP]
> **原生 Home Assistant 深度交互**
> 该方式通过 Home Assistant Add-on 规范运行，应用内置专用智能交互工具箱，能够直接调用 Supervisor API 实现对 Home Assistant 的状态感知与自动化设备控制。

### 4.1 安装应用仓库

#### 方法 A：一键自动添加（推荐）
点击下方按钮直接跳转至您的 Home Assistant 实例并完成仓库添加：

[![在 Home Assistant 中添加此仓库](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Feoasmxd%2Fha-addons)

#### 方法 B：手动添加仓库
1. 进入 Home Assistant 控制台。
2. 依次进入：**设置 (Settings)** -> **应用 (Add-ons)** -> **安装应用 (Add-on Store)**。
3. 点击页面右上角的 **三个点 (⋮)**，选择 **仓库 (Repositories)**。
4. 在仓库地址输入框中填入：
   ```text
   https://github.com/eoasmxd/ha-addons
   ```
5. 点击 **添加**，关闭弹窗并刷新商店页面，即可在应用列表中看到 **eoasMXD** 及其下的 **Freya**。

### 4.2 安装与启动
1. 在应用商店中点击 **Freya**，进入详情页点击 **安装**。
2. 安装完成后，推荐勾选：
   - **在侧边栏中显示**：便于随时从 HA 左侧菜单栏呼出 Freya Web 对话界面。
   - **开机自启**：保证 Home Assistant 系统重启后 Freya 自动拉起。
   - **看门狗**：在服务异常时自动重启守护。
3. 点击 **启动** 即可开始使用。

### 4.3 HA 交互与安全控制配置
Freya 应用对 Home Assistant 的交互采用安全优先（Security by Default）策略：

* **实体状态感知授权**：
  Freya 能够感知的设备与传感器实体，完全受限于您在 Home Assistant 原生界面（**设置 -> 语音助手 -> 暴露**）中勾选暴露给对话助手（Assist）的实体列表，杜绝非授权实体信息泄露。
* **设备控制权限开关**：
  应用初始默认处于**安全只读模式**（仅允许查询实体状态）。如需允许智能体根据对话指令执行开灯、关电器等控制动作，可在 Freya Web 界面（**系统设置 -> 全局配置 -> 权限与安全**）将 `homeassistant.allowControl` 开启为 `true`（动态即时生效，无需重启）。

### 4.4 数据持久化与备份
应用的所有配置与会话记忆均持久化保存在 Home Assistant 宿主机的 `/config/freya/` 目录下：
- **数据与会话记忆**：`/config/freya/data/`
- **用户个性化配置**：`/config/freya/config/`

重启或升级应用均不会丢失数据。您可以通过 HA 官方的 Backup 功能或 File Editor / VS Code 应用直接查看或导出备份。

### 4.5 版本升级
当上游发布新版本时，Home Assistant 应用商店会自动出现更新提示，点击 **更新** 即可一键平滑升级，无需手动执行脚本或重构容器。

---

## 5. 方式四：从源码克隆编译与维护（开发模式）

适合需要进行二次开发、编写自定义插件或深入学习 Freya 微内核架构的开发者。

### 5.1 安装依赖
克隆项目后，在根目录下安装全量 workspace 依赖：
```bash
pnpm install
```

### 5.2 编译打包
执行代码级编译与物理打包汇总：
```bash
pnpm build
```
*该命令会编译 core/sdk/ui 与所有插件，并在根目录下生成最终分发包 `dist/`。*

### 5.3 启动服务
根据开发测试需求选择启动模式：
* **前台开发运行**（带 CLI 终端交互）：
  ```bash
  pnpm freya
  ```
* **后台守护运行**（静默运行 Web 核心，释放控制台）：
  ```bash
  pnpm freya --no-cli
  ```

### 5.4 停止服务
若需要结束后台常驻的子进程，在根目录下执行：
```bash
pnpm stop
```

### 5.5 手动版本更新与代码同步
当拉取代码仓库最新修改时，在根目录下执行：
1. **停止后台进程**：`pnpm stop`
2. **拉取最新源码**：`git pull origin main`
3. **重新编译打包**：`pnpm install && pnpm build`
4. **重新启动服务**（根据需要选择前台或后台模式）：`pnpm freya` 或 `pnpm freya --no-cli`
