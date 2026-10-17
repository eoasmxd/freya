/**
 * MCP 工具名称清洗与命名空间映射
 * MCP tool name sanitization and namespace mapping
 */
export class McpNaming {
  /**
   * 将服务 ID 清洗为小写、仅含字母数字与下划线的标准键（用于工具箱 ID 与本地存储文件名）
   * Sanitize server ID into lowercase alphanumeric/underscore key for toolbox ID and storage filenames
   */
  static sanitizeServerId(serverId: string): string {
    return serverId.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  }

  /**
   * 获取 MCP 服务对应的工具箱 ID（mcp_<cleanServer>）
   * Get toolbox ID for MCP service (mcp_<cleanServer>)
   */
  static getToolboxId(serverId: string): string {
    return `mcp_${this.sanitizeServerId(serverId)}`;
  }

  /**
   * 获取 MCP 服务的标准工具调用前缀
   * Get standard tool prefix for MCP service (e.g. mcp_<cleanServer>_)
   */
  static getToolPrefix(serverId: string): string {
    return `${this.getToolboxId(serverId)}_`;
  }

  /**
   * 将服务 ID 与原工具名转换为暴露给模型的标准工具名
   * Format: mcp_<cleanServer>_<cleanTool>
   */
  static formatToolName(serverId: string, originalName: string): string {
    const prefix = this.getToolPrefix(serverId);
    let cleanTool = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (prefix.length + cleanTool.length > 64) {
      const hash = this.simpleHash(cleanTool);
      const allowedToolLen = Math.max(1, 64 - prefix.length - 5);
      cleanTool = `${cleanTool.slice(0, allowedToolLen)}_${hash}`;
    }

    return `${prefix}${cleanTool}`;
  }

  /**
   * 计算简易短哈希
   * Compute short hash digest
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).slice(0, 4);
  }
}
