import type { FreyaCommand, FreyaContext } from '@eoasmxd/freya-sdk';

const BUILTIN_COMMAND_CATEGORY_MAP: Record<string, string> = {
  approve: 'auth',
  reject: 'auth',
  session: 'session',
  model: 'model',
  models: 'model'
};

/** 系统指令注册表：维护主指令与别名的映射字典 */
export class FreyaCommandRegistry {
  private commands = new Map<string, FreyaCommand>();
  private aliasMap = new Map<string, string>();
  private pluginCommandsMap = new Map<string, string[]>();

  constructor(private context?: FreyaContext) {}

  setContext(context: FreyaContext): void {
    this.context = context;
  }

  /** 判断指定指令当前是否已注册且处于可用启用状态 */
  isCommandEnabled(name: string): boolean {
    const lowerName = name.toLowerCase();
    const primaryName = this.aliasMap.get(lowerName) || lowerName;

    if (!this.commands.has(primaryName)) {
      return false;
    }

    const category = BUILTIN_COMMAND_CATEGORY_MAP[primaryName];
    if (category) {
      const commandsConfig = (this.context?.config as any)?.commands?.builtin;
      if (commandsConfig && typeof commandsConfig[category]?.enabled === 'boolean') {
        return commandsConfig[category].enabled;
      }
    }

    return true;
  }

  /** 注册新的系统指令并建立别名路由 */
  register(command: FreyaCommand, pluginId?: string): void {
    const name = command.name.toLowerCase();
    if (this.commands.has(name)) {
      throw new Error(`[CommandRegistry] 指令注册冲突：主指令名 "${name}" 已经被注册。`);
    }
    if (this.aliasMap.has(name)) {
      throw new Error(`[CommandRegistry] 指令注册冲突：指令名 "${name}" 已被占用为别名。`);
    }

    this.commands.set(name, command);

    if (pluginId) {
      const list = this.pluginCommandsMap.get(pluginId) || [];
      list.push(name);
      this.pluginCommandsMap.set(pluginId, list);
    }

    if (command.alias && Array.isArray(command.alias)) {
      for (const alias of command.alias) {
        const lowerAlias = alias.toLowerCase();
        if (this.commands.has(lowerAlias) || this.aliasMap.has(lowerAlias)) {
          throw new Error(`[CommandRegistry] 指令注册冲突：别名 "${alias}" 已经被占用。`);
        }
        this.aliasMap.set(lowerAlias, name);
        if (pluginId) {
          this.pluginCommandsMap.get(pluginId)!.push(lowerAlias);
        }
      }
    }
  }

  /** 注销指定插件注册的所有指令与别名 */
  unregisterByPlugin(pluginId: string): void {
    const names = this.pluginCommandsMap.get(pluginId);
    if (!names) return;
    for (const name of names) {
      this.commands.delete(name);
      this.aliasMap.delete(name);
    }
    this.pluginCommandsMap.delete(pluginId);
  }

  get(name: string): FreyaCommand | undefined {
    const lowerName = name.toLowerCase();
    const cmd = this.commands.get(lowerName);
    if (cmd) return cmd;

    const primaryName = this.aliasMap.get(lowerName);
    if (primaryName) {
      return this.commands.get(primaryName);
    }

    return undefined;
  }

  list(): FreyaCommand[] {
    return Array.from(this.commands.values()).filter((cmd) => this.isCommandEnabled(cmd.name));
  }
}
