/**
 * Home Assistant 实体实时状态数据模型
 * Home Assistant entity real-time state data model
 */
export interface HAEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}

/**
 * Home Assistant 服务域及其包含的服务定义集合
 * Home Assistant service domain and service definition collection
 */
export interface HAServiceDomain {
  domain: string;
  services: Record<string, {
    description?: string;
    fields?: Record<string, {
      description?: string;
      example?: any;
      required?: boolean;
    }>;
  }>;
}

/**
 * Home Assistant 实体注册表元数据模型
 * Home Assistant entity registry metadata model
 */
export interface HAEntityRegistryEntry {
  entity_id: string;
  name?: string | null;
  original_name?: string | null;
  aliases?: string[];
  area_id?: string | null;
  device_id?: string | null;
  icon?: string | null;
  labels?: string[];
  categories?: Record<string, string>;
  entity_category?: string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
  has_entity_name?: boolean;
  options?: Record<string, any>;
  device_class?: string | null;
  original_device_class?: string | null;
  original_icon?: string | null;
  capabilities?: Record<string, any>;
  platform?: string;
  translation_key?: string | null;
  unique_id?: string;
  [key: string]: any;
}

/**
 * Home Assistant 客户端通信配置
 * Home Assistant client communication configuration
 */
export interface HomeAssistantClientConfig {
  baseUrl: string;
  wsUrl: string;
  token: string;
}
