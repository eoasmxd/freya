import type { LocalizedText } from './common.js';

export interface ConfigFieldSchema {
  key: string;
  defaultValue?: any;
  description: LocalizedText;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';
  enumValues?: string[];
  required?: boolean;
  min?: number;
  max?: number;
  sensitive?: boolean;
  manualOnly?: boolean;
  category?: LocalizedText;
  uiHint?: 'text' | 'textarea' | 'password' | 'select' | 'slider';
  children?: ConfigFieldSchema[];
}
