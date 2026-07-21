# AGENTS.md — Freya AI Agent 行为规范

面向在 Freya 仓库中工作的 AI 编程助手（Codex、Claude、Copilot 等）的行为准则。

## 语言与交互

- 所有代码注释、文档、提交信息均使用 **中文**。
- 代码中的用户可见文本（日志、提示、UI）使用中文。

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
~/.freya/           # 运行时主目录 (默认创建于用户主目录下，已被 .gitignore 过滤)
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

- `packages/core` 及任何插件的 TypeScript 源码中，**绝对不允许**硬编码中文自然语言提示词或兜底文本。
- 所有提示词模板必须放在物理 Markdown 文件中（如 `packages/core/config/prompts/`）。
- 提示词模板在启动时通过内存双通道探针机制（Dual-Read）优先读取运行时 `config/` 目录，若不存在则回退加载包内默认配置入内存，仅在用户显式编辑保存时落盘写入 `config/` 目录。
- 其它配置文件（`freya.json`、`plugins.json`、`providers.json`）不走拷贝机制，而是分别通过 Schema 声明合并、目录扫描合并、空初始化生成。
- 如果提示词注册表返回空，代码只能保持空字符串 `''` 或使用纯变量占位符（如 `'{text}'`），不得使用硬编码兜底文案。


### 配置与数据分离

- **Workspace（工作区）**：与宿主隔离的沙箱，默认位于 `~/.freya/workspace/`（已 gitignore）。
- **Runtime Config（配置目录）**：用户个性化配置，默认位于 `~/.freya/config/`（已 gitignore）。
- **Runtime Data（数据目录）**：运行时持久化数据与记忆，默认位于 `~/.freya/data/`（已 gitignore）。
- **Runtime Skills（运行时技能卡）**：用户自定义技能卡目录，位于 `~/.freya/skills/` 下。AI 助手需注意系统在启动时，会同时扫描程序包默认目录（`APP_ROOT/skills/`）与此目录下的 Markdown 技能卡文件进行双通道动态合并加载。

### 命名规范

- 项目中所有的类名、文件名、变量、日志输出和配置前缀，统一使用 `freya` 命名。
- 示例：`FreyaPlugin`、`FreyaContext`、`freya.json`。

## 开发流程

### 环境要求

- **Node.js**：>= 22.0.0（推荐 Node 22 或 24）
- **包管理器**：pnpm@9.x

### 常用命令

```bash
pnpm install       # 安装依赖
pnpm build         # 编译所有包
pnpm dev:core      # 启动后端服务
pnpm dev:ui        # 启动前端 Web UI
pnpm start         # 启动本地 CLI 交互
```

### 提交规范

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 格式：

```
type: 中文简要描述
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
   - `displayName`：插件显示名称。
   - `defaultEnabled`：默认启停策略。严格遵循安全优先原则（Security by Default），仅程序内置物理目录（`APP_ROOT/plugins`）且显式置为 `true` 的插件初始启用；其余环境及外置插件统一默认禁用 (`false`)。
   - `schema`：静态配置 Schema 物理定义路径（如 `"./schema.json"`）。
   - `prompts`：提示词 Markdown 模板文件名数组（如 `["plugin.prompt.<name>.md"]`）。
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
