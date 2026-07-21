export interface ConfigFieldSchema {
  key: string;
  defaultValue?: any;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';
  enumValues?: string[];
  required?: boolean;
  min?: number;
  max?: number;
  sensitive?: boolean;
  category?: string;
  uiHint?: 'text' | 'textarea' | 'password' | 'select' | 'slider';
  children?: ConfigFieldSchema[];
}
