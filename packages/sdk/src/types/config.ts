import type { LocalizedText } from './common.js';

export type ConfigEnumOption = string | { value: string; label: LocalizedText };

export interface ConfigFieldSchema {
  key: string;
  defaultValue?: any;
  description: LocalizedText;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';
  enumValues?: ConfigEnumOption[];
  required?: boolean;
  min?: number;
  max?: number;
  sensitive?: boolean;
  manualOnly?: boolean;
  readonly?: boolean;
  category?: LocalizedText;
  uiHint?: 'text' | 'textarea' | 'password' | 'select' | 'slider';
  children?: ConfigFieldSchema[];
}
