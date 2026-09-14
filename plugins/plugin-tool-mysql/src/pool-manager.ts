import mysql from 'mysql2/promise';
import type { FreyaContext } from '@eoasmxd/freya-sdk';

/** MySQL 连接配置契约 */
export interface MysqlConnectionConfig {
  name: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  connectTimeout?: number;
}

/** 安全解算嵌套或扁平配置值 */
function getNestedConfig(config: Record<string, any>, keyPath: string): any {
  if (!config) return undefined;
  if (keyPath in config) return config[keyPath];
  const parts = keyPath.split('.');
  let current: any = config;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/** MySQL 多命名连接池管理器 */
export class MysqlPoolManager {
  private pools = new Map<string, mysql.Pool>();
  private connectionConfigs = new Map<string, MysqlConnectionConfig>();
  private defaultConnectionName: string = 'default';

  constructor(private ctx: FreyaContext) {
    this.reloadConfigs();
  }

  /** 加载与同步配置 */
  public reloadConfigs(): void {
    this.connectionConfigs.clear();
    const config = this.ctx.config || {};
    this.defaultConnectionName = getNestedConfig(config, 'mysql.defaultConnection') || 'default';

    const connections = getNestedConfig(config, 'mysql.connections');
    if (Array.isArray(connections)) {
      for (const item of connections) {
        if (item && typeof item === 'object' && item.name) {
          this.connectionConfigs.set(item.name, {
            name: String(item.name),
            host: item.host ? String(item.host) : '127.0.0.1',
            port: item.port ? Number(item.port) : 3306,
            user: item.user ? String(item.user) : 'root',
            password: item.password ? String(item.password) : '',
            database: item.database ? String(item.database) : undefined,
            connectionLimit: item.connectionLimit ? Number(item.connectionLimit) : 5,
            connectTimeout: item.connectTimeout ? Number(item.connectTimeout) : 10000
          });
        }
      }
    }

    if (this.connectionConfigs.size === 0) {
      const singleHost = getNestedConfig(config, 'mysql.host');
      if (singleHost) {
        this.connectionConfigs.set(this.defaultConnectionName, {
          name: this.defaultConnectionName,
          host: String(singleHost),
          port: getNestedConfig(config, 'mysql.port') ? Number(getNestedConfig(config, 'mysql.port')) : 3306,
          user: getNestedConfig(config, 'mysql.user') ? String(getNestedConfig(config, 'mysql.user')) : 'root',
          password: getNestedConfig(config, 'mysql.password') ? String(getNestedConfig(config, 'mysql.password')) : '',
          database: getNestedConfig(config, 'mysql.database') ? String(getNestedConfig(config, 'mysql.database')) : undefined,
          connectionLimit: getNestedConfig(config, 'mysql.connectionLimit') ? Number(getNestedConfig(config, 'mysql.connectionLimit')) : 5,
          connectTimeout: getNestedConfig(config, 'mysql.connectTimeout') ? Number(getNestedConfig(config, 'mysql.connectTimeout')) : 10000
        });
      }
    }
  }

  /** 获取指定名称的数据库连接池 */
  public getPool(targetName?: string): { pool: mysql.Pool; config: MysqlConnectionConfig } {
    this.reloadConfigs();
    const connectionName = targetName || this.defaultConnectionName;
    const conf = this.connectionConfigs.get(connectionName);

    if (!conf) {
      const available = Array.from(this.connectionConfigs.keys()).join(', ') || '无配置';
      throw new Error(`未找到名为 "${connectionName}" 的 MySQL 连接配置。当前可用连接: [${available}]`);
    }

    let pool = this.pools.get(connectionName);
    if (!pool) {
      pool = mysql.createPool({
        host: conf.host,
        port: conf.port,
        user: conf.user,
        password: conf.password,
        database: conf.database,
        connectionLimit: conf.connectionLimit,
        connectTimeout: conf.connectTimeout,
        waitForConnections: true,
        queueLimit: 0,
        dateStrings: true
      });
      this.pools.set(connectionName, pool);
      this.ctx.logger.info(`MySQL 连接池已创建: [${connectionName}] -> ${conf.user}@${conf.host}:${conf.port}/${conf.database || ''}`);
    }

    return { pool, config: conf };
  }

  /** 获取所有可用连接名称 */
  public getAvailableConnectionNames(): string[] {
    return Array.from(this.connectionConfigs.keys());
  }

  /** 释放所有已建立的连接池资源 */
  public async closeAll(): Promise<void> {
    for (const [name, pool] of this.pools.entries()) {
      try {
        await pool.end();
        this.ctx.logger.info(`MySQL 连接池已释放: [${name}]`);
      } catch (err: any) {
        this.ctx.logger.warn(`关闭 MySQL 连接池 [${name}] 时发生异常: ${err?.message || err}`);
      }
    }
    this.pools.clear();
  }
}
