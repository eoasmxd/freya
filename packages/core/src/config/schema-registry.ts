import type { ConfigFieldSchema } from '@eoasmxd/freya-sdk';

export class FreyaConfigSchemaRegistry {
  private schemas = new Map<string, ConfigFieldSchema[]>();
  private fields = new Map<string, {
    namespace: string;
    source: 'builtin' | 'launch' | 'runtime' | 'npm';
    field: ConfigFieldSchema;
  }>();

  register(
    namespace: string,
    fields: ConfigFieldSchema[],
    source: 'builtin' | 'launch' | 'runtime' | 'npm'
  ): void {
    this.schemas.set(namespace, fields);
    for (const field of fields) {
      this.fields.set(field.key, { namespace, source, field });
    }
  }

  getFieldSource(keyPath: string): 'builtin' | 'launch' | 'runtime' | 'npm' | undefined {
    return this.fields.get(keyPath)?.source;
  }

  getFieldNamespace(keyPath: string): string | undefined {
    return this.fields.get(keyPath)?.namespace;
  }

  getSchemas(): Map<string, ConfigFieldSchema[]> {
    return this.schemas;
  }

  getFields(): Map<string, { namespace: string; source: 'builtin' | 'launch' | 'runtime' | 'npm'; field: ConfigFieldSchema }> {
    return this.fields;
  }

  findField(keyPath: string): ConfigFieldSchema | undefined {
    return this.fields.get(keyPath)?.field;
  }

  getDefaults(): Record<string, any> {
    const defaults: Record<string, any> = {};
    for (const { field } of this.fields.values()) {
      const keys = field.key.split('.');
      let current = defaults;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }
      const lastKey = keys[keys.length - 1];
      if (!(lastKey in current)) {
        current[lastKey] = field.defaultValue;
      }
    }
    return defaults;
  }

  getSensitiveKeys(): string[] {
    const keys: string[] = [];
    const traverse = (field: ConfigFieldSchema, currentPrefix: string) => {
      const path = currentPrefix ? `${currentPrefix}.${field.key}` : field.key;
      if (field.sensitive || field.uiHint === 'password' || field.type === 'sha256') {
        keys.push(path);
      }
      if (field.children) {
        for (const child of field.children) {
          const separator = field.type === 'array' ? '.*' : '';
          traverse(child, path + separator);
        }
      }
    };
    for (const { field } of this.fields.values()) {
      traverse(field, '');
    }
    return keys;
  }

  getManualOnlyKeys(): string[] {
    const keys: string[] = [];
    const traverse = (field: ConfigFieldSchema, currentPrefix: string) => {
      const path = currentPrefix ? `${currentPrefix}.${field.key}` : field.key;
      if (field.manualOnly) {
        keys.push(path);
      }
      if (field.children) {
        for (const child of field.children) {
          const separator = field.type === 'array' ? '.*' : '';
          traverse(child, path + separator);
        }
      }
    };
    for (const { field } of this.fields.values()) {
      traverse(field, '');
    }
    return keys;
  }

  /**
   * 获取所有标记为密码（uiHint: 'password' 或 sha256）的字段路径列表
   * Get keyPath list of fields marked as password (uiHint: 'password' or sha256)
   */
  getPasswordKeys(): string[] {
    const keys: string[] = [];
    const traverse = (field: ConfigFieldSchema, currentPrefix: string) => {
      const path = currentPrefix ? `${currentPrefix}.${field.key}` : field.key;
      if (field.uiHint === 'password' || field.type === 'sha256') {
        keys.push(path);
      }
      if (field.children) {
        for (const child of field.children) {
          const separator = field.type === 'array' ? '.*' : '';
          traverse(child, path + separator);
        }
      }
    };
    for (const { field } of this.fields.values()) {
      traverse(field, '');
    }
    return keys;
  }
}
