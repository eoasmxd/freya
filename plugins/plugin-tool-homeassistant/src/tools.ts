import type { FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import type { HomeAssistantClient } from './client.js';
import type { HomeAssistantSecurityGateway } from './security.js';

/**
 * Home Assistant 实体列表查询工具
 * Home Assistant entity list query tool
 */
export class HomeAssistantListEntityTool implements FreyaTool {
  constructor(
    private readonly client: HomeAssistantClient,
    private readonly security: HomeAssistantSecurityGateway
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'homeassistant_list_entity',
      description: 'List devices and entities in Home Assistant (supports filtering by domain or keyword).',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Optional entity domain filter, e.g. "sensor", "binary_sensor", "light", "switch", "climate", etc.'
          },
          keyword: {
            type: 'string',
            description: 'Optional keyword to match entity ID or friendly name.'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const exposedSet = await this.client.getExposedEntities();
    if (exposedSet.size === 0) {
      return 'No accessible entities currently found.';
    }

    const registryEntries = await this.client.getRegistryEntries();
    const allStates = await this.client.getStates();
    const domain = typeof args.domain === 'string' ? args.domain.trim().toLowerCase() : '';
    const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';

    const matched = allStates.filter((item) => {
      if (!exposedSet.has(item.entity_id)) {
        return false;
      }

      if (domain && !item.entity_id.startsWith(`${domain}.`)) {
        return false;
      }

      if (keyword) {
        const friendlyName = String(item.attributes?.friendly_name || '').toLowerCase();
        const reg = registryEntries.get(item.entity_id);
        const aliases = (reg?.aliases || []).map((a) => String(a).toLowerCase());
        const areaId = String(reg?.area_id || '').toLowerCase();
        const hasAliasMatch = aliases.some((a) => a.includes(keyword));
        const hasAreaMatch = areaId.includes(keyword);

        if (!item.entity_id.toLowerCase().includes(keyword) && !friendlyName.includes(keyword) && !hasAliasMatch && !hasAreaMatch) {
          return false;
        }
      }

      return true;
    });

    if (matched.length === 0) {
      return 'No matching entities found.';
    }

    const lines = matched.map((item) => {
      const reg = registryEntries.get(item.entity_id);
      const name = item.attributes?.friendly_name || reg?.name || reg?.original_name || item.entity_id;
      const unit = item.attributes?.unit_of_measurement ? ` ${item.attributes.unit_of_measurement}` : '';
      const extras: string[] = [];
      if (reg?.aliases && reg.aliases.length > 0) {
        extras.push(`aliases: ${reg.aliases.join(', ')}`);
      }
      if (reg?.area_id) {
        extras.push(`area: ${reg.area_id}`);
      }
      const extraInfo = extras.length > 0 ? ` [${extras.join(' | ')}]` : '';
      return `- ${item.entity_id} (${name}${extraInfo}): ${item.state}${unit}`;
    });

    return `Found ${matched.length} entities:\n${lines.join('\n')}`;
  }
}

/**
 * Home Assistant 单实体状态查询工具
 * Home Assistant single entity state query tool
 */
export class HomeAssistantReadStateTool implements FreyaTool {
  constructor(
    private readonly client: HomeAssistantClient,
    private readonly security: HomeAssistantSecurityGateway
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'homeassistant_read_state',
      description: 'Get real-time state and detailed attributes for a specified entity in Home Assistant.',
      parameters: {
        type: 'object',
        properties: {
          entityId: {
            type: 'string',
            description: 'Unique entity ID, e.g. "sensor.living_room_temperature" or "light.kitchen_light".'
          }
        },
        required: ['entityId']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const entityId = String(args.entityId ?? args.entity_id ?? '').trim();
    if (!entityId) {
      return 'Error: entityId is required.';
    }

    const exposedSet = await this.client.getExposedEntities();
    this.security.assertEntityExposed(entityId, exposedSet);

    const reg = await this.client.getRegistryEntry(entityId);
    const state = await this.client.getState(entityId);
    return JSON.stringify(
      {
        entity_id: state.entity_id,
        state: state.state,
        area_id: reg?.area_id || undefined,
        aliases: reg?.aliases && reg.aliases.length > 0 ? reg.aliases : undefined,
        attributes: state.attributes,
        last_changed: state.last_changed,
        last_updated: state.last_updated
      },
      null,
      2
    );
  }
}

/**
 * Home Assistant 设备控制服务调用工具
 * Home Assistant device control service call tool
 */
export class HomeAssistantCallServiceTool implements FreyaTool {
  constructor(
    private readonly client: HomeAssistantClient,
    private readonly security: HomeAssistantSecurityGateway
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'homeassistant_call_service',
      description: 'Call Home Assistant device control services (e.g. turn on/off lights, toggle switches, set temperature, etc.). Batch control by area_id, device_id, floor_id, or label_id is strictly forbidden. You must explicitly target a specific exposed entityId.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Service domain, e.g. "light", "switch", "cover", "climate", etc.'
          },
          service: {
            type: 'string',
            description: 'Service name, e.g. "turn_on", "turn_off", "toggle", etc.'
          },
          entityId: {
            type: 'string',
            description: 'Target entity unique identifier ID, e.g. "light.living_room". Required for device control.'
          },
          serviceData: {
            type: 'object',
            description: 'Optional additional service parameters, such as brightness, color, target temperature, etc. Forbidden keys: area_id, device_id, floor_id, label_id.'
          }
        },
        required: ['domain', 'service', 'entityId']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const domain = String(args.domain || '').trim();
    const service = String(args.service || '').trim();
    const rawEntityId = args.entityId ?? args.entity_id;
    const entityId = rawEntityId ? String(rawEntityId).trim() : undefined;
    const rawData = args.serviceData ?? args.service_data;
    const extraData = (rawData && typeof rawData === 'object') ? rawData : {};

    const exposedSet = await this.client.getExposedEntities();
    this.security.assertCanCallService(domain, service, entityId, extraData, exposedSet);

    const payload: Record<string, any> = { ...extraData };
    if (entityId) {
      payload.entity_id = entityId;
    }

    const result = await this.client.callService(domain, service, payload);
    const detail = result && Object.keys(result).length > 0 ? ` Response details: ${JSON.stringify(result)}` : '';
    return `Service "${domain}.${service}" executed successfully.${detail}`.trim();
  }
}

/**
 * Home Assistant 可用服务定义与参数查询工具
 * Home Assistant available service definition and parameter query tool
 */
export class HomeAssistantListServiceTool implements FreyaTool {
  constructor(
    private readonly client: HomeAssistantClient,
    private readonly security: HomeAssistantSecurityGateway
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'homeassistant_list_service',
      description: 'Query supported services in Home Assistant and parameter definitions for each service (can filter by domain, e.g. "light", "switch", "climate", etc.).',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Optional domain name filter, e.g. "light", "switch", "climate", "cover", etc. If specified, only services under that domain with parameter definitions are returned.'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const allServices = await this.client.getServices();
    const domainFilter = typeof args.domain === 'string' ? args.domain.trim().toLowerCase() : '';

    if (domainFilter) {
      if (!this.security.isDomainAllowed(domainFilter)) {
        return `Domain "${domainFilter}" is not in the allowed services whitelist under the current security policy.`;
      }

      const matched = allServices.find((item) => item.domain.toLowerCase() === domainFilter);
      if (!matched || !matched.services) {
        return `No services found for domain "${domainFilter}".`;
      }

      const lines: string[] = [`Available services supported by domain "${domainFilter}":`];
      for (const [serviceName, serviceDef] of Object.entries(matched.services)) {
        const desc = serviceDef?.description ? ` - ${serviceDef.description}` : '';
        lines.push(`\n### ${domainFilter}.${serviceName}${desc}`);

        if (serviceDef?.fields && Object.keys(serviceDef.fields).length > 0) {
          lines.push('  Parameters:');
          for (const [fieldName, fieldDef] of Object.entries<any>(serviceDef.fields)) {
            const fieldDesc = fieldDef?.description ? `: ${fieldDef.description}` : '';
            const example = fieldDef?.example !== undefined ? ` (example: ${JSON.stringify(fieldDef.example)})` : '';
            lines.push(`    - ${fieldName}${fieldDesc}${example}`);
          }
        }
      }
      return lines.join('\n');
    }

    const domainNames = allServices
      .filter((item) => this.security.isDomainAllowed(item.domain))
      .map((item) => item.domain)
      .sort();
    return `Currently supported ${domainNames.length} service domains (to inspect detailed services and parameters for a domain, provide the domain argument):\n${domainNames.join(', ')}`;
  }
}

/**
 * Home Assistant 实体历史状态查询工具
 * Home Assistant entity state history query tool
 */
export class HomeAssistantReadHistoryTool implements FreyaTool {
  constructor(
    private readonly client: HomeAssistantClient,
    private readonly security: HomeAssistantSecurityGateway
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'homeassistant_read_history',
      description: 'Query historical state change records for a single entity in Home Assistant.',
      parameters: {
        type: 'object',
        properties: {
          entityId: {
            type: 'string',
            description: 'Single entity ID (e.g. "sensor.living_room_temperature"). Only one entity is allowed per query.'
          },
          startTime: {
            type: 'string',
            description: 'Optional start timestamp in ISO 8601 format (e.g. "2023-01-01T00:00:00Z"). Defaults to 24 hours ago.'
          },
          endTime: {
            type: 'string',
            description: 'Optional end timestamp in ISO 8601 format (e.g. "2023-01-01T23:59:59Z").'
          }
        },
        required: ['entityId']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const entityId = String(args.entityId ?? args.entity_id ?? '').trim();
    if (!entityId) {
      return 'Error: entityId is required.';
    }

    if (entityId.includes(',') || entityId.includes(' ') || entityId.includes(';')) {
      return 'Error: Only a single entity_id is allowed per query.';
    }

    const exposedSet = await this.client.getExposedEntities();
    this.security.assertEntityExposed(entityId, exposedSet);

    const rawStartTime = args.startTime ?? args.start_time;
    const rawEndTime = args.endTime ?? args.end_time;
    const history = await this.client.getHistory(entityId, {
      startTime: typeof rawStartTime === 'string' ? rawStartTime.trim() : undefined,
      endTime: typeof rawEndTime === 'string' ? rawEndTime.trim() : undefined
    });

    if (history.length === 0) {
      return `No history records found for entity "${entityId}".`;
    }

    const maxDataRows = 98;
    let sampled = history;
    if (history.length > maxDataRows) {
      sampled = [];
      const step = (history.length - 1) / (maxDataRows - 1);
      for (let i = 0; i < maxDataRows; i++) {
        const idx = Math.min(Math.round(i * step), history.length - 1);
        sampled.push(history[idx]);
      }
    }

    const lines = [
      `Entity: ${entityId} (Total: ${history.length}, Sampled: ${sampled.length})`,
      'Timestamp | State'
    ];

    for (const item of sampled) {
      const time = item.last_changed || item.last_updated || 'unknown';
      lines.push(`${time} | ${item.state}`);
    }

    return lines.join('\n');
  }
}
