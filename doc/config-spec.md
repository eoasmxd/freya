---
title: "Freya 配置与数据隔离规范"
date: 2026-07-21T20:55:00+08:00
draft: false
weight: 15
description: "介绍 ~/.freya/ 运行时目录结构、配置/数据物理隔离及 Schema 动态合并策略。"
---

# Freya 配置与数据隔离规范

Freya 严格遵循“代码与运行态隔离”、“包内默认 -> 本地覆盖 -> 数据持久化”的设计原则。

---

## 1. 运行时沙箱与持久化数据结构 (`~/.freya/`)

为了使运行时脏数据与代码仓库目录安全物理隔离，系统运行时默认以用户主目录下的 **`~/.freya/`** 作为配置与持久化存储主目录（若定义了 `FREYA_HOME` 环境变量，则以该绝对路径为基准）。

```text
~/.freya/                        # 运行时主目录 (默认创建于用户主目录下)
├── config/                      # 运行时配置目录
│   ├── freya.json               # 运行时核心主配置文件 (各插件配置声明合并生成)
│   ├── IDENTITY.md              # 运行时核心主提示词覆盖文件：身份设定
│   ├── SOUL.md                  # 运行时核心主提示词覆盖文件：灵魂性格
│   ├── USER.md                  # 运行时核心主提示词覆盖文件：用户设定
│   ├── MEMORY.md                # 运行时核心主提示词覆盖文件：长期记忆
│   ├── TOOLS.md                 # 运行时核心主提示词覆盖文件：工具使用规范
│   ├── AGENTS.md                # 运行时核心主提示词覆盖文件：角色与设定
│   ├── prompts/                 # 运行时非核心策略提示词 Markdown 覆盖目录 (如 plugin.prompt.telegram.md)
│   ├── providers.json           # 运行时大模型提供商与费率配置
│   └── plugins.json             # 运行时已扫描并合并元数据的插件启用列表配置
├── data/                        # 运行时持久化数据目录
│   ├── sessions/                # 本地持久化缓存的各个会话历史详细文件 (.json)
│   ├── sessions.json            # 本地持久化缓存的全局会话元数据索引文件
│   ├── memories.json            # 主动长期记忆索引物理文件 (plugin-tool-memory 持有)
│   └── memories/                # 主动长期记忆物理日期文件存仓 (plugin-tool-memory 持有)
├── skills/                      # 运行时用户自定义技能卡目录 (系统启动时与内置技能双通道合并加载)
└── workspace/                   # 宿主与大模型交互隔离的文件读写沙箱
    └── download/                # 网页大响应及二进制文件自动/强制落盘下载目录 (plugin-tool-web 持有)
```

---

## 2. 配置与数据双层范式 (Dual-Layer Config & Data)

Freya 规范在项目运行根目录下划分了四个功能性区域：

1.  **Workspace（工作区）**：与宿主隔离的沙箱目录，默认 FS 工具只能读写此目录（`~/.freya/workspace/`）下的文件。
2.  **Runtime Config（配置目录）**：存放用户的个性化配置，统一保存在运行时目录的 `~/.freya/config/` 下。
3.  **Runtime Data（数据目录）**：存放运行时持久化的业务状态、历史记录及数据库文件，统一保存在运行时目录的 `~/.freya/data/` 下。
4.  **Runtime Skills（运行时技能卡）**：存放用户自定义技能卡的目录，位于 `~/.freya/skills/` 下。系统在启动时，会同时扫描程序包内置技能目录（`APP_ROOT/skills/`）与此目录下的 Markdown 文件进行双通道动态合并加载。

---

## 3. 配置文件初始化与响应机制

`config/` 目录下的各配置文件在启动时采用不同的初始化与合并策略：

| 配置文件 | 初始化机制 | 说明 |
|---------|-----------|------|
| `freya.json` | **Schema 静态合并** | 内核与各插件通过物理 `schema.json` 声明配置项及默认值，启动时合并默认值与已有用户配置，合并回写至 `freya.json` |
| `plugins.json` | **三通道动态扫描与极简落盘** | 动态扫描 Builtin / Runtime / NPM 三通道可用插件，合并 `package.json` 中的 `defaultEnabled` 契约，去重存极简启停结构 `[{ id, enabled }]` |
| `providers.json` | **空初始化** | 以空数组兜底，由用户通过配置工具或 Web 面板手动管理 |
| `config/*.md` (提示词) | **Dual-Read 内存双通道探针** | 优先尝试读取运行时配置 `~/.freya/config/` 目录下的覆盖文件，若不存在降级载入包内默认配置入内存，仅在编辑修改时落盘写入 |

各插件只作为全局配置的只读消费端，不感知也无需执行配置落盘动作。
