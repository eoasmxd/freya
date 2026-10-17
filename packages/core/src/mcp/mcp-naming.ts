/**
 * MCP 工具名称清洗与命名空间映射
 * MCP tool name sanitization and namespace mapping
 */
export class McpNaming {
  /**
   * 将服务 ID 与原工具名转换为暴露给模型的标准工具名
   * Format: mcp_<serverId>_<sanitizedName>
   */
  static formatToolName(serverId: string, originalName: string): string {
    const cleanServer = serverId.toLowerCase().replace(/[^a-z0-9]/g, '');
    let cleanTool = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const prefix = `mcp_${cleanServer}_`;
    if (prefix.length + cleanTool.length > 64) {
      const hash = this.simpleHash(cleanTool);
      const allowedToolLen = 64 - prefix.length - 5;
      cleanTool = `${cleanTool.slice(0, Math.max(1, allowedToolLen))}_${hash}`;
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
