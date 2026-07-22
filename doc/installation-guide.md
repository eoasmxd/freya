---
title: "Freya 安装与构建运行"
date: 2026-07-21T16:28:00+08:00
draft: false
weight: 20
description: "提供环境准备、依赖安装、本地编译与服务启动的操作步骤。"
---

# Freya 安装与构建运行

## 1. 环境准备

运行项目需要以下工具环境：
- **Node.js**：>= 22.0.0
- **pnpm**：9.x

---

## 2. 安装与运行步骤

### 第一步：安装依赖

在根目录下运行：

```bash
pnpm install
```

### 第二步：编译项目

执行代码编译与文件汇总：

```bash
pnpm build
```

该命令会依次执行：
1. 编译 `core`、`sdk`、`ui` 及各插件源码；
2. 运行 `node scripts/distribute.js` 脚本，在根目录下生成 `dist/` 分发库。

### 第三步：启动服务

在根目录下运行：

```bash
pnpm freya
```

启动成功后，打开浏览器访问 `http://localhost:3000` 即可进入 Web 操作控制台。

### 第四步：后台运行与停止

如果你不需要本地控制台交互，希望将 Freya 作为纯后台网关服务运行：

* **后台静默运行**（此时父进程会自动安全退出并将控制台退还用户）：
  ```bash
  pnpm freya --no-cli
  ```
* **停止后台服务**：
  ```bash
  pnpm stop
  ```

---

## 3. 版本更新

根据你最初的安装方式，选择以下对应的方法进行手动版本更新：

### 方式一：全局 NPM 安装的更新
若你是通过 `npm install -g @eoasmxd/freya` 安装的全局命令行工具：

1. **停止当前后台服务**：
   ```bash
   freya stop
   ```
2. **下载并更新全局包**：
   ```bash
   npm install -g @eoasmxd/freya@latest
   ```
3. **重新拉起服务**（根据需要选择前台或后台模式）：
   ```bash
   freya
   # 或后台静默运行：
   freya --no-cli
   ```

### 方式二：源码构建运行的更新
若你是通过克隆源码在本地编译运行的：

1. **停止当前后台服务**：
   ```bash
   pnpm stop
   ```
2. **拉取最新代码**：
   ```bash
   git pull origin main
   ```
3. **重新安装依赖与编译**：
   ```bash
   pnpm install
   pnpm build
   ```
4. **重新拉起服务**（根据需要选择前台或后台模式）：
   ```bash
   pnpm freya
   # 或后台静默运行：
   pnpm freya --no-cli
   ```
