import type { FreyaContext } from '@eoasmxd/freya-sdk';

export type ControlLevel = 'standard' | 'high_risk' | 'system';

const LEVEL_WEIGHT: Record<ControlLevel, number> = {
  standard: 1,
  high_risk: 2,
  system: 3
};

/**
 * Home Assistant 实体访问控制与权限安全网关
 * Home Assistant entity access control and permission security gateway
 */
export class HomeAssistantSecurityGateway {
  private ctx?: FreyaContext;

  setContext(ctx: FreyaContext): void {
    this.ctx = ctx;
  }

  isControlAllowed(): boolean {
    const cfg = (this.ctx?.config as any)?.homeassistant;
    return Boolean(cfg?.allowControl);
  }

  getControlLevel(): ControlLevel {
    const cfg = (this.ctx?.config as any)?.homeassistant;
    const level = cfg?.controlLevel;
    if (level === 'high_risk' || level === 'system') {
      return level;
    }
    return 'standard';
  }

  assertEntityExposed(entityId: string, exposedSet: Set<string>): void {
    if (!exposedSet.has(entityId)) {
      throw new Error(`Entity "${entityId}" does not exist or is not accessible.`);
    }
  }

  private static readonly ALLOWED_PURE_DOMAINS = new Set([
    'notify', // 通知 (Notify)
    'persistent_notification' // 持续通知 (Persistent notification)
  ]);

  private static readonly STANDARD_ENTITY_DOMAINS = new Set([
    'light', // 灯光 (Light)
    'switch', // 开关 (Switch)
    'climate', // 气候/空调 (Climate)
    'fan', // 风扇 (Fan)
    'humidifier', // 加湿器 (Humidifier)
    'media_player', // 媒体播放器 (Media player)
    'vacuum', // 吸尘器 (Vacuum)
    'water_heater', // 热水器 (Water heater)
    'lawn_mower', // 割草机 (Lawn mower)
    'button', // 按钮 (Button)
    'number', // 数字 (Number)
    'select', // 选择 (Select)
    'text', // 文本 (Text)
    'date', // 日期 (Date)
    'datetime', // 日期时间 (Datetime)
    'time', // 时间 (Time)
    'remote', // 遥控器 (Remote)
    'scene', // 场景 (Scene)
    'automation', // 自动化 (Automation)
    'input_boolean', // 虚拟开关 (Input boolean)
    'input_button', // 虚拟按钮 (Input button)
    'input_number', // 虚拟数字 (Input number)
    'input_select', // 虚拟选择 (Input select)
    'input_datetime', // 虚拟日期时间 (Input datetime)
    'input_text', // 虚拟文本 (Input text)
    'timer', // 定时器 (Timer)
    'counter', // 计数器 (Counter)
    'script', // 脚本 (Script)
    'todo', // 待办事项 (Todo list)
    'calendar' // 日历 (Calendar)
  ]);

  private static readonly HIGH_RISK_ENTITY_DOMAINS = new Set([
    'lock', // 锁 (Lock)
    'valve', // 阀门 (Valve)
    'siren', // 警报器 (Siren)
    'alarm_control_panel', // 警报控制面板 (Alarm control panel)
    'cover', // 遮盖物/车库门 (Cover/Garage door)
    'camera' // 摄像头 (Camera)
  ]);

  isDomainAllowed(domain: string): boolean {
    if (!this.isControlAllowed()) {
      return false;
    }

    const level = this.getControlLevel();
    if (level === 'system') {
      return true;
    }

    const lowerDomain = domain.toLowerCase();
    if (HomeAssistantSecurityGateway.ALLOWED_PURE_DOMAINS.has(lowerDomain)) {
      return true;
    }

    if (HomeAssistantSecurityGateway.STANDARD_ENTITY_DOMAINS.has(lowerDomain)) {
      return true;
    }

    if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT.high_risk && HomeAssistantSecurityGateway.HIGH_RISK_ENTITY_DOMAINS.has(lowerDomain)) {
      return true;
    }

    return false;
  }

  assertCanCallService(
    domain: string,
    service: string,
    entityId: string | undefined,
    serviceData: Record<string, any>,
    exposedSet: Set<string>
  ): void {
    if (!this.isControlAllowed()) {
      throw new Error('Currently in read-only mode, control commands are forbidden.');
    }

    if (this.getControlLevel() === 'system') {
      return;
    }

    const lowerDomain = domain.toLowerCase();
    if (!this.isDomainAllowed(lowerDomain)) {
      throw new Error(`Security policy restriction: Domain "${domain}" is not in the allowed services whitelist under current control level.`);
    }

    const forbiddenKeys = ['area_id', 'device_id', 'floor_id', 'label_id'];
    for (const key of forbiddenKeys) {
      if (key in serviceData || (serviceData.target && typeof serviceData.target === 'object' && key in serviceData.target)) {
        throw new Error(`Security policy restriction: Only specific exposed entities are supported, batch control by ${key} is forbidden.`);
      }
    }

    const targetEntities = new Set<string>();
    if (entityId) {
      targetEntities.add(entityId);
    }

    const dataEntityId = serviceData.entity_id || serviceData.target?.entity_id;
    if (dataEntityId) {
      if (Array.isArray(dataEntityId)) {
        dataEntityId.forEach((id) => targetEntities.add(String(id).trim()));
      } else {
        targetEntities.add(String(dataEntityId).trim());
      }
    }

    if (targetEntities.size === 0) {
      const isDynamicScriptService = lowerDomain === 'script' && !['turn_on', 'turn_off', 'toggle', 'reload'].includes(service);

      if (isDynamicScriptService) {
        targetEntities.add(`${lowerDomain}.${service}`);
      }
      else if (HomeAssistantSecurityGateway.ALLOWED_PURE_DOMAINS.has(lowerDomain)) {
        return;
      }
      else {
        throw new Error('Security policy restriction: Calling a service must explicitly specify target entity_id.');
      }
    }

    for (const id of targetEntities) {
      this.assertEntityExposed(id, exposedSet);
    }
  }
}
