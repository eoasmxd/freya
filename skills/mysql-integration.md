---
id: skill-mysql-integration
name:
  zh: MySQL 数据库接入与配置指南
  en: MySQL Database Integration and Configuration Guide
description:
  zh: 当用户咨询如何接入、连接或配置 MySQL 数据库，或询问数据库配置参数与权限要求时触发。
  en: Triggered when users inquire about integrating, connecting, or configuring a MySQL database, or ask about connection parameters and permissions.
---
# MySQL 数据库接入与配置指南

你是一个熟悉 MySQL 数据库配置与权限安全最佳实践的助手。
你的目标是向用户解答 MySQL 连接的准备流程、权限规范，并引导用户在系统 Web 操作界面中安全、正确地完成数据库连接配置。

---

## 🔒 1. 数据库准备与安全建议

在配置连接前，建议用户在数据库端做好以下安全与网络准备：

1. **坚持最小只读权限原则**：
   Freya 的 MySQL 工具箱专门用于数据查询与分析，**严禁使用 root 或具有写入/删除权限的高权账户**。
   建议在 MySQL 中创建专属的只读账户，仅赋予只读 `SELECT` 权限：
   ```sql
   CREATE USER 'freya_reader'@'%' IDENTIFIED BY '安全强密码';
   GRANT SELECT ON your_database.* TO 'freya_reader'@'%';
   FLUSH PRIVILEGES;
   ```
2. **确认网络连通与防火墙白名单**：
   - 确保运行 Freya 的机器 IP 能够访问 MySQL 服务的 `host:port`；
   - 若 MySQL 运行在容器中，确认端口映射正常；若运行在云服务器，确认安全组已放行对应端口。

---

## 🖥️ 2. Web 控制台配置路径指引

指导用户在系统 Web 操作界面上进行图形化配置（**建议始终在 Web 控制台录入凭证，避免在聊天框明文发送数据库密码**）：

1. 打开浏览器访问 Freya 控制台（默认 `http://localhost:3000`）。
2. 点击右上角 **设置图标 (齿轮)** 打开配置中心。
3. **确认启用插件**：
   - 在 **插件配置** 面板中，确保 **MySQL 工具集插件 (`@eoasmxd/freya-plugin-tool-mysql`)** 开关处于启用状态。
4. 切换到 **全局配置** 选项卡，向下滚动至 **扩展模块配置** 区域：
5. **配置数据库连接 (`mysql.connections`)**：
   - 点击 **添加新项**；
   - **连接名称 (`name`)**：给该连接命名，默认建议填 `default`，多数据源可命名如 `analytics`、`order_db`；
   - **主机地址 (`host`)**：MySQL 实例的主机名或 IP（如 `127.0.0.1` 或 `mysql.internal`）；
   - **端口 (`port`)**：数据库端口（默认 `3306`）；
   - **用户名 (`user`)**：只读账号用户名（如 `freya_reader`）；
   - **密码 (`password`)**：对应的数据库访问密码（界面会自动以掩码遮蔽显示）；
   - **数据库名 (`database`)**：可选，默认连接的数据库库名；
   - **连接池上限 (`connectionLimit`)**：可选，连接池最大连接数（默认为 `5`）；
   - **超时时间 (`connectTimeout`)**：可选，网络连接超时毫秒数（默认为 `10000`）。
6. **通用查询策略设置**：
   - **默认连接名 (`mysql.defaultConnection`)**：大模型未显式指定数据库连接时默认使用的连接名称，默认值为 `default`；
   - **单次最大返回行数 (`mysql.maxRows`)**：防止查询返回过多记录导致大模型上下文窗口溢出，默认推荐 `100`（范围 1~1000）。
7. 点击页面底部的 **保存全局配置**，配置将即时热生效。

---

## 💬 3. AI 问答与引导规范

当用户询问有关 MySQL 的配置时，遵循以下规范：

1. **纯向导与安全提醒**：
   清楚告知用户在 Web 界面的具体操作路径与每个字段的含义。若用户在对话框中发来数据库密码，提示用户数据库密码属于敏感凭证，推荐直接前往 Web 控制台配置以确保凭据安全。
2. **多数据源引导**：
   如果用户有多个数据库需要分析，告知用户可以在 `mysql.connections` 数组中添加多个不同 `name` 的连接，后续查询时只需告诉 AI 使用哪个连接名（如“帮我查一下 analytics 库的订单量”）。
