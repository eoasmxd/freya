---
title: "安装与构建运行"
weight: 20
description: "提供环境准备、NPM 全局安装与源码构建运行的完整安装、日常启动、服务停止及手动版本更新指南。"
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

## 4. 方式三：从源码克隆编译与维护（开发模式）

适合需要进行二次开发、编写自定义插件或深入学习 Freya 微内核架构的开发者。

### 4.1 安装依赖
克隆项目后，在根目录下安装全量 workspace 依赖：
```bash
pnpm install
```

### 4.2 编译打包
执行代码级编译与物理打包汇总：
```bash
pnpm build
```
*该命令会编译 core/sdk/ui 与所有插件，并在根目录下生成最终分发包 `dist/`。*

### 4.3 启动服务
根据开发测试需求选择启动模式：
* **前台开发运行**（带 CLI 终端交互）：
  ```bash
  pnpm freya
  ```
* **后台守护运行**（静默运行 Web 核心，释放控制台）：
  ```bash
  pnpm freya --no-cli
  ```

### 4.4 停止服务
若需要结束后台常驻的子进程，在根目录下执行：
```bash
pnpm stop
```

### 4.5 手动版本更新与代码同步
当拉取代码仓库最新修改时，在根目录下执行：
1. **停止后台进程**：`pnpm stop`
2. **拉取最新源码**：`git pull origin main`
3. **重新编译打包**：`pnpm install && pnpm build`
4. **重新启动服务**（根据需要选择前台或后台模式）：`pnpm freya` 或 `pnpm freya --no-cli`
