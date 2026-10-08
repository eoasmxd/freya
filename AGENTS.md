# AGENTS.md — Freya AI Agent Guidelines

Behavioral guidelines for AI programming assistants (Codex, Claude, Copilot, etc.) working in the Freya repository.

## Language and Interaction

- **Development Language & Internal Text**: Code must be written in **English**. Internal and non-user-facing text (e.g., logger outputs, internal exceptions, low-level trace information) defaults to English.
- **Code Comments**: Comments for core interfaces, classes, methods, and critical algorithms must be written in **bilingual (Chinese and English)** format.
- **User-Facing Text and Internationalization (I18n)**:
  - All user-facing text (UI interactions, CLI prompts, client error messages, configuration schema names and descriptions, etc.) **must be integrated into the I18n** system; hardcoding is strictly prohibited.
  - Internationalization uses **English (`en`)** as the code baseline and default fallback, while synchronously maintaining language dictionaries (such as Chinese `zh`) in `locales/`.
- **Prompts & Skills**:
  - Physical AI prompt templates use **English** for baseline files without language suffixes (e.g., `*.prompt.<name>.md`), and localized versions use language-suffixed filenames (e.g., `*.prompt.<name>.zh.md`).

## Project Architecture

Freya is organized as a lightweight Monorepo. Note: **The system runtime defaults to `~/.freya/` under the user's home directory as the primary directory for configuration and persistent storage** (or the absolute path defined by the `FREYA_HOME` environment variable), isolating runtime data from the code repository.

### Repository Source & Distribution Structure
```
freya/
├── packages/
│   ├── core/       # Backend single-service core
│   ├── sdk/        # Standard SDK for plugin development
│   └── ui/         # Standalone frontend Web UI
├── plugins/        # Plugins root directory
└── skills/         # Dynamically scanned and loaded skill Markdown directory
```

### Runtime Sandbox & Persistent Data Structure
```
~/.freya/           # Runtime home directory (created in user home by default)
├── config/         # User configuration and prompt override directory (freya.json, IDENTITY.md, etc.)
├── data/           # Persistent runtime data directory (sessions/, memories.json, memories/ long-term memory)
└── workspace/      # Isolated file read/write sandbox for model interactions (download/ for large web responses)
```

### Dependency Boundaries (Hard Constraints)

- **Plugins may only depend on `@eoasmxd/freya-sdk`**; directly importing internal implementations of `@eoasmxd/freya-core` is strictly forbidden.
- **Core does not depend on any plugins**. Core handles lifecycle management, plugin loading and routing, the event bus, and provides built-in CLI/WebSocket dual channels along with configuration and session management utilities.
- **Unidirectional Dependency Chain**: `plugins` → `@eoasmxd/freya-sdk` ← `@eoasmxd/freya-core`

### Event-Driven Communication

- Core and plugins do not use direct method calls; they communicate asynchronously via an in-process EventEmitter publish/subscribe model.
- Core event patterns:
  - `connection:reply` / `connection:message` → Unified connection manager exchanges messages with channel plugins
  - `token:consumed` → Billing component / WSS push bill

## Coding Standards

### Zero Hardcoded Prompts

- In TypeScript source code across `packages/core` and any plugin, hardcoding any natural language prompts or fallback text is **strictly prohibited**.
- All prompt templates must reside in physical Markdown files (e.g., `packages/core/config/prompts/`). Suffix-less template files (e.g., `core.prompt.identity.md`) serve as the English baseline, while localized versions use language suffixes (e.g., `core.prompt.identity.zh.md`).
- Prompt templates are loaded during startup and runtime via a three-tier cascading probe (Cascading Read: FREYA_HOME -> FREYA_LAUNCH -> FREYA_APP) that prioritizes templates matching the current environment language suffix, smoothly falling back to the English baseline template when not found. If neither exists, packaged default configurations are loaded into memory and written to disk under `FREYA_HOME/config/` only when explicitly saved by the user.
- Other configuration files (`freya.json`, `plugins.json`, `providers.json`) do not use file copying; they are generated via Schema declaration merge, directory scan merge, or empty initialization respectively.
- If the prompt registry returns empty, code must keep an empty string `''` or use pure variable placeholders (such as `'{text}'`), never hardcoded fallback copy.

### Path Hierarchy & Configuration Separation (Three-Tier Model)

- **FREYA_APP (Application Root Directory)**: Read-only physical installation root directory, containing the core engine, UI static assets, fully aggregated source (`src/` in release state), and official built-in plugins/skills.
- **FREYA_LAUNCH (Host Launch Directory)**: The execution directory where the host command is triggered, defaulting to `process.cwd()`. The system scans `plugins/` and `skills/` under this directory during startup for host-level business extensions.
- **FREYA_HOME (Runtime Data Directory)**: Root directory for user persistent configurations and runtime data, located at `~/.freya/` by default (`/data/` in Docker). It contains user-specific `config/`, `data/` (sessions and long-term memory), agent-dedicated read/write `workspace/`, and user-defined `skills/` and `plugins/`.
- **Dynamic Scanning & Merging**: Upon system startup, Plugins and Skills are automatically discovered and loaded via three-tier cascading: `FREYA_APP` (built-in) -> `FREYA_LAUNCH` (host extension) -> `FREYA_HOME` (user custom).

### Naming Conventions

- All class names, file names, variables, log outputs, and configuration prefixes in the project consistently use the `freya` naming scheme.
- Examples: `FreyaPlugin`, `FreyaContext`, `freya.json`.

### Tool Architecture and Naming Standards

Tools exposed to LLM function calling follow strict structural tiers and naming conventions:

1. **Classification Tiers**:
   - **Core Intrinsic Tools**: Tools built directly into the kernel without a toolbox ID. They are unconditionally or conditionally persistent (e.g., `activate_toolbox`, `deactivate_toolbox`, `activate_skill`, `deactivate_skill`, and conditionally `read_snapshot` when snapshots exist).
   - **On-Demand Toolbox Tools**: Tools organized within a named toolbox (`FreyaToolbox.getId()`, lowercase single word without underscores, e.g., `agent`, `config`, `fs`, `web`, `memory`, `mysql`). They must be dynamically activated/deactivated.

2. **Naming Syntax**:
   - **Intrinsic Tools**: `<verb>_<object>` in snake_case (e.g., `activate_toolbox`, `read_snapshot`).
   - **Toolbox Tools**: snake_case format, typically `<toolboxId>_<verb>_<object>` (e.g., `agent_delegate_task`, `fs_read_file`, `config_create_model`), or `<toolboxId>_<verb>` when the toolbox itself serves as the object (e.g., `config_read`, `config_update`).
   - **Singular Nouns**: All nouns must strictly use singular form (e.g., `toolbox` instead of `toolboxes`, `directory` instead of `directories`, `model` instead of `models`, `provider` instead of `providers`). Plural nouns are prohibited.
   - **No Abbreviations**: Full descriptive words must be used (e.g., `directory` instead of `dir`).
   - **Standard Verbs**: Use consistent verbs for identical semantics (`list`, `read`, `write`, `edit`, `create`, `update`, `delete`, `search`, `save`, `enable`, `disable`, `activate`, `deactivate`, `delegate`).
   - **Parameter Naming**: Tool input parameters must consistently follow camelCase naming style (e.g., `toolboxIds`, `skillId`, `providerId`, `modelId`).

## Development Workflow

### Environment Requirements

- **Node.js**: >= 22.0.0 (Node 22 or 24 recommended)
- **Package Manager**: pnpm@9.x

### Common Commands

```bash
pnpm install       # Install dependencies
pnpm build         # Build all packages
pnpm freya         # Start local service and CLI interaction (or use pnpm start)
```

### Commit Conventions

Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
type: short description
```

Types (`type`): `feat`, `fix`, `improve`, `refactor`, `docs`, `chore`.

Examples:
```
feat: CLI channel plugin supports command history navigation
fix: resolve missing error logs when plugin loading fails
docs: add getting started guide for plugin development
```

## Adding New Plugins & Plugin Standards

1. Create a new directory under `plugins/`, such as `plugins/plugin-<name>/`.
2. **Package Naming Convention**: The `name` in `package.json` uses the official NPM package name format (e.g., `@eoasmxd/freya-plugin-<name>`), serving as the plugin's unique global ID.
3. **Static Metadata Specifications**: Plugin configuration and metadata must be defined in the `"freya"` declaration block of `package.json`:
   - `displayName`: Plugin display name, supporting either a string or a `LocalizedText` multilingual object (e.g., `{"en": "...", "zh": "..."}`).
   - `defaultEnabled`: Default enable/disable strategy. Strictly follow Security by Default: only built-in physical directories (`FREYA_APP/plugins`) with `true` explicitly set are enabled initially; all other environments and external plugins are disabled (`false`) by default.
   - `schema`: Physical definition path to the static configuration Schema (e.g., `"./schema.json"`), where field `label` and `description` support `LocalizedText` multilingual objects.
   - `prompts`: Array of prompt Markdown template filenames (e.g., `["plugin.prompt.<name>.md"]`, where baseline templates are written in English, and localized `*.zh.md` templates are automatically linked and loaded via cascading probe).
4. **Code Cleanliness & Strict Contracts**:
   - Plugins may only depend on `@eoasmxd/freya-sdk` and implement SDK abstract contract interfaces (`FreyaPlugin`, `LLMPlugin`, `ToolPlugin`, etc.).
   - Plugin classes only contain `type` polymorphic tags and lifecycle/business methods.
   - `FreyaToolbox.getId(): string` inside `ToolPlugin` is a mandatory contract for logical decoupling and toolbox routing.
5. Plugins act only as read-only consumers of global configuration and do not perceive or execute configuration disk-write operations.

## Adding/Modifying SDK Interfaces

1. Define interfaces in `packages/sdk/src/types/`.
2. Ensure interfaces are abstract contracts without introducing concrete implementation details.
3. If any existing plugins are affected, adapt them together in the current change.
4. Update corresponding documentation.
