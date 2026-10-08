# AGENTS.md — Freya AI Agent 行为规范

面向在 Freya 仓库中工作的 AI 编程助手（Codex、Claude、Copilot 等）的行为准则。

## 语言与交互

- **开发语言与内部文本**：代码编写统一为 **英文**，系统内部及用户不可见的文本（如日志 Logger 输出、内部异常、底层链路信息等）默认采用英文。
- **代码注释**：核心接口、类、方法及关键算法的注释要求采用 **中英双语** 书写。
- **用户可见文本与国际化（I18n）**：
  - 凡是用户可见的文本（UI 界面交互、CLI 交互提示、客户端报错、配置项 Schema 名称与描述等）**强制要求接入 I18n** 体系管理，禁止硬编码。
  - 国际化以 **英文（en）** 作为代码层基线与默认回退（Fallback），并同步维护中文（zh）等各语言包字典（`locales/`）。
- **提示词与技能卡（Skills）**：
  - AI 提示词物理模板以 **英文** 作为无后缀基线文件（如 `*.prompt.<name>.md`），多语言版本采用带语言后缀命名（如 `*.prompt.<name>.zh.md`）。


## 项目架构

Freya 采用轻量级的 Monorepo 结构进行管理。需要特别注意：**系统运行时默认以用户主目录下的 `~/.freya/` 作为配置与持久化存储主目录**（若定义了 `FREYA_HOME` 环境变量，则以该绝对路径为基准），以使运行时脏数据与代码仓库目录安全物理隔离。

### 仓库源码与物理分发结构
```
freya/
├── packages/
│   ├── core/       # 后端单服务核心
│   ├── sdk/        # 插件开发标准 SDK
│   └── ui/         # 独立前端 Web 交互页面
├── plugins/        # 插件根目录
└── skills/         # 动态扫描加载的技能卡 Markdown 目录
```

### 运行时沙箱与持久化数据结构
```
~/.freya/           # 运行时主目录 (默认创建于用户主目录下)
├── config/         # 运行时用户配置与覆盖提示词目录 (freya.json, IDENTITY.md 等)
├── data/           # 运行时持久化数据目录 (sessions/, memories.json, memories/ 长期记忆)
└── workspace/      # 宿主与大模型交互隔离的文件读写沙箱 (download/ 网页大响应保存区)
```

### 依赖边界（硬约束）

- **插件只能依赖 `@eoasmxd/freya-sdk`**，绝对禁止直接导入 `@eoasmxd/freya-core` 的内部实现。
- **内核不依赖任何插件**，内核负责生命周期管理、插件加载与路由、事件总线，并内建 CLI/WebSocket 双通道及配置与会话管理基础工具集。
- **单向依赖链**：`plugins` → `@eoasmxd/freya-sdk` ← `@eoasmxd/freya-core`

### 事件驱动通信

- 内核与插件之间不采用直接方法调用，统一通过进程内 EventEmitter 发布/订阅异步事件。
- 核心事件模式：
  - `connection:reply` / `connection:message` → 统一连接管理器与各通道插件间收发消息
  - `token:consumed` → 计费组件 / WSS 推送账单

## 编码规范

### 零硬编码提示词（Zero Hardcoded Prompt）

- `packages/core` 及任何插件的 TypeScript 源码中，**绝对不允许**硬编码任何自然语言提示词或兜底文本。
- 所有提示词模板必须放在物理 Markdown 文件中（如 `packages/core/config/prompts/`）。无后缀模板文件（如 `core.prompt.identity.md`）作为英文基线，各语言版本使用语言后缀命名（如 `core.prompt.identity.zh.md`）。
- 提示词模板在启动与运行时通过结合当前环境语言的三层级联探针机制（Cascading Read: FREYA_HOME -> FREYA_LAUNCH -> FREYA_APP）优先探测带语言后缀的本地化模板，未命中时平滑回退至英文基线模板；若都不存在则回退加载包内默认配置入内存，仅在用户显式编辑保存时落盘写入 `FREYA_HOME/config/` 目录。
- 其它配置文件（`freya.json`、`plugins.json`、`providers.json`）不走拷贝机制，而是分别通过 Schema 声明合并、目录扫描合并、空初始化生成。
- 如果提示词注册表返回空，代码只能保持空字符串 `''` 或使用纯变量占位符（如 `'{text}'`），不得使用硬编码兜底文案。


### 路径体系与配置分离（三层模型）

- **FREYA_APP（程序根目录）**：程序代码物理安装根目录，只读，包含引擎核心、UI 静态资源、全量聚合源码（发布态 `src/`）及官方内置 plugins/skills。
- **FREYA_LAUNCH（宿主启动目录）**：宿主命令发起启动执行目录，默认为 `process.cwd()`。系统在启动时会扫描此目录下的 `plugins/` 与 `skills/` 进行就近业务层扩展。
- **FREYA_HOME（运行时数据目录）**：用户持久化配置与运行态数据主目录，默认位于 `~/.freya/`（Docker 中为 `/data/`），包含用户个性化 `config/`、`data/`（会话与长期记忆）、智能体专属读写工作区 `workspace/` 以及用户自建的 `skills/` 与 `plugins/`。
- **动态扫描与合并**：系统启动时，Plugins 与 Skills 均按 `FREYA_APP`（内置） -> `FREYA_LAUNCH`（宿主扩展） -> `FREYA_HOME`（用户自建）三层级联自动发现并载入。

### 命名规范

- 项目中所有的类名、文件名、变量、日志输出和配置前缀，统一使用 `freya` 命名。
- 示例：`FreyaPlugin`、`FreyaContext`、`freya.json`。

### 工具架构与命名规范

暴露给大模型 Function Calling 的工具遵循严格的分层结构与命名规范：

1. **工具分类层级**：
   - **内核固有工具 (Core Intrinsic Tools)**：直接内置于内核、无工具箱 ID 的核心工具。它们无条件或条件常驻（例如 `activate_toolbox`、`deactivate_toolbox`、`activate_skill`、`deactivate_skill`，以及仅在存在快照指纹时条件常驻的 `read_snapshot`）。
   - **按需工具箱工具 (On-Demand Toolbox Tools)**：归属于特定命名工具箱（`FreyaToolbox.getId()`，全小写无下划线单单词，例如 `agent`、`config`、`fs`、`web`、`memory`、`mysql`）的工具。必须按需动态激活与停用。

2. **命名语法规则**：
   - **固有工具**：snake_case 格式的 `<verb>_<object>`（例如 `activate_toolbox`、`read_snapshot`）。
   - **工具箱工具**：snake_case 格式的三段式 `<toolboxId>_<verb>_<object>`（例如 `agent_delegate_task`、`fs_read_file`、`config_update`）。
   - **名词严格单数**：所有名词必须严格采用单数形式（例如用 `toolbox` 而非 `toolboxes`，用 `directory` 而非 `directories`，用 `model` 而非 `models`，用 `provider` 而非 `providers`），严禁使用复数名词。
   - **杜绝随意缩写**：必须使用完整语义单词（例如用 `directory` 而非 `dir`）。
   - **统一标准动词**：相同语义必须保持动词一致（`list`、`read`、`write`、`edit`、`create`、`update`、`delete`、`search`、`enable`、`disable`、`activate`、`deactivate`、`delegate`）。

## 开发流程

### 环境要求

- **Node.js**：>= 22.0.0（推荐 Node 22 或 24）
- **包管理器**：pnpm@9.x

### 常用命令

```bash
pnpm install       # 安装依赖
pnpm build         # 编译所有包
pnpm freya         # 启动本地服务与 CLI 交互 (或使用 pnpm start)
```

### 提交规范

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 格式：

```
type: 简要描述
```

类型（type）：`feat`、`fix`、`improve`、`refactor`、`docs`、`chore`。

示例：
```
feat: CLI 通道插件支持历史命令回翻
fix: 修复插件加载失败时无错误日志的问题
docs: 补充插件开发入门文档
```

## 添加新插件与插件规范

1. 在 `plugins/` 下创建新目录，如 `plugins/plugin-<name>/`。
2. **包名规范**：`package.json` 中的 `name` 使用官方 NPM 包名格式（如 `@eoasmxd/freya-plugin-<name>`），作为插件的唯一全局 ID。
3. **静态元数据规范**：插件配置与元数据统一下沉至 `package.json` 的 `"freya"` 声明块：
   - `displayName`：插件显示名称，支持字符串或 `LocalizedText` 多语言对象（如 `{"en": "...", "zh": "..."}`）。
   - `defaultEnabled`：默认启停策略。严格遵循安全优先原则（Security by Default），仅程序内置物理目录（`FREYA_APP/plugins`）且显式置为 `true` 的插件初始启用；其余环境及外置插件统一默认禁用 (`false`)。
   - `schema`：静态配置 Schema 物理定义路径（如 `"./schema.json"`），字段 `label` 与 `description` 统一下沉支持 `LocalizedText` 多语言对象。
   - `prompts`：提示词 Markdown 模板文件名数组（如 `["plugin.prompt.<name>.md"]`，基准模板统一使用英文书写，多语言本地化模板 `*.zh.md` 由系统自动关联与级联探针加载）。
4. **代码纯净与严格契约**：
   - 插件只能依赖 `@eoasmxd/freya-sdk`，实现 SDK 抽象契约接口（`FreyaPlugin`、`LLMPlugin`、`ToolPlugin` 等）。
   - 插件 Class 仅包含 `type` 多态标签与生命周期/业务方法。
   - `ToolPlugin` 内部的 `FreyaToolbox.getId(): string` 为必选硬性契约，用于逻辑解耦与工具箱路由。
5. 插件仅作为全局配置的只读消费端，不感知也不执行配置落盘动作。

## 新增/修改 SDK 接口

1. 在 `packages/sdk/src/types/` 中定义接口。
2. 确保接口是抽象契约，不引入具体实现细节。
3. 所有现有插件如果受影响，本次变更中一同适配。
4. 更新相关文档。
