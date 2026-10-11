import type { HAEntityRegistryEntry, HAEntityState, HAServiceDomain, HomeAssistantClientConfig } from './types.js';

/**
 * Home Assistant REST 与 WebSocket 通信客户端
 * Home Assistant REST and WebSocket communication client
 */
export class HomeAssistantClient {
  private readonly config: HomeAssistantClientConfig;
  private readonly cacheTtlMs: number;
  private exposedCache = new Set<string>();
  private registryCache = new Map<string, HAEntityRegistryEntry>();
  private lastSyncTime = 0;
  private syncPromise: Promise<Set<string>> | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(options?: Partial<HomeAssistantClientConfig>) {
    const token = options?.token || process.env.SUPERVISOR_TOKEN || '';
    const baseUrl = options?.baseUrl || 'http://supervisor/core/api';
    const wsUrl = options?.wsUrl || 'ws://supervisor/core/websocket';

    this.cacheTtlMs = 60_000;
    this.config = {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      wsUrl,
      token
    };
  }

  startBackgroundSync(intervalMs = 60_000): void {
    this.triggerSync();

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    this.syncTimer = setInterval(() => {
      this.triggerSync();
    }, intervalMs);

    if (this.syncTimer.unref) {
      this.syncTimer.unref();
    }
  }

  stopBackgroundSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private triggerSync(): void {
    this.fetchExposedViaWebSocket().catch(() => { });
  }

  async getExposedEntities(): Promise<Set<string>> {
    const now = Date.now();
    if (this.exposedCache.size > 0 && now - this.lastSyncTime < this.cacheTtlMs) {
      return this.exposedCache;
    }

    if (this.syncPromise) {
      return this.syncPromise;
    }

    return this.fetchExposedViaWebSocket();
  }

  async getRegistryEntries(): Promise<Map<string, HAEntityRegistryEntry>> {
    await this.getExposedEntities();
    return this.registryCache;
  }

  async getRegistryEntry(entityId: string): Promise<HAEntityRegistryEntry | undefined> {
    await this.getExposedEntities();
    return this.registryCache.get(entityId);
  }

  async sendDiscovery(service = 'freya', configData?: Record<string, any>): Promise<boolean> {
    if (!this.config.token) {
      return false;
    }

    try {
      const supervisorUrl = this.config.baseUrl.replace(/\/core\/api$/, '');
      let host = 'freya';
      let port = 3000;

      try {
        const selfInfoRes = await fetch(`${supervisorUrl}/addons/self/info`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(3_000)
        });
        if (selfInfoRes.ok) {
          const selfInfo = await selfInfoRes.json();
          if (selfInfo?.data?.hostname) {
            host = selfInfo.data.hostname;
          }
          if (selfInfo?.data?.ingress_port) {
            port = selfInfo.data.ingress_port;
          }
        }
      } catch { }

      const response = await fetch(`${supervisorUrl}/discovery`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          service,
          config: configData || {
            host,
            port
          }
        }),
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) {
        console.warn(`[HomeAssistantClient] Supervisor discovery rejected with HTTP ${response.status}: ${response.statusText}`);
      }
      return response.ok;
    } catch {
      return false;
    }
  }

  private async fetchExposedViaWebSocket(): Promise<Set<string>> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = new Promise<Set<string>>((resolve, reject) => {
      if (!this.config.token) {
        return reject(new Error('SUPERVISOR_TOKEN or HA_TOKEN credential not found.'));
      }

      const socket = new WebSocket(this.config.wsUrl);
      let messageId = 1;
      let exposeRequestId = -1;
      let entriesRequestId = -1;
      let currentExposed = new Set<string>();
      let completed = false;

      const finish = (err?: Error, result?: Set<string>) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        try { socket.close(); } catch { }
        if (err) {
          if (this.exposedCache.size > 0) {
            resolve(this.exposedCache);
          } else {
            reject(err);
          }
        } else {
          resolve(result || this.exposedCache);
        }
      };

      const timer = setTimeout(() => {
        finish(new Error('Home Assistant WebSocket connection timeout.'));
      }, 10_000);

      socket.onopen = () => { };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data.toString());
          if (data.type === 'auth_required') {
            socket.send(JSON.stringify({
              type: 'auth',
              access_token: this.config.token
            }));
            return;
          }

          if (data.type === 'auth_ok') {
            exposeRequestId = messageId++;
            socket.send(JSON.stringify({
              id: exposeRequestId,
              type: 'homeassistant/expose_entity/list'
            }));
            return;
          }

          if (data.type === 'auth_invalid') {
            finish(new Error(`WebSocket authentication failed: ${data.message || 'Invalid token'}`));
            return;
          }

          if (data.type === 'result') {
            if (data.id === exposeRequestId) {
              if (!data.success) {
                finish(new Error(`Failed to get exposed entities: ${data.error?.message || 'Unknown error'}`));
                return;
              }

              const exposed = new Set<string>();
              const rawResult = data.result?.exposed_entities || data.result || {};

              for (const [entityId, assistantMap] of Object.entries(rawResult)) {
                if (assistantMap && typeof assistantMap === 'object') {
                  const conv = (assistantMap as any)?.conversation;
                  if (conv === true || conv?.should_expose === true) {
                    exposed.add(entityId);
                  }
                }
              }

              currentExposed = exposed;

              if (exposed.size === 0) {
                this.exposedCache = exposed;
                this.registryCache.clear();
                this.lastSyncTime = Date.now();
                finish(undefined, exposed);
                return;
              }

              entriesRequestId = messageId++;
              socket.send(JSON.stringify({
                id: entriesRequestId,
                type: 'config/entity_registry/get_entries',
                entity_ids: Array.from(exposed)
              }));
              return;
            }

            if (data.id === entriesRequestId) {
              if (data.success && data.result) {
                const newRegistryCache = new Map<string, HAEntityRegistryEntry>();
                const resultData = data.result;

                if (Array.isArray(resultData)) {
                  for (const item of resultData) {
                    if (item?.entity_id) {
                      newRegistryCache.set(item.entity_id, item);
                    }
                  }
                } else if (typeof resultData === 'object') {
                  for (const [key, item] of Object.entries(resultData)) {
                    const entry = item as HAEntityRegistryEntry;
                    const entityId = entry?.entity_id || key;
                    if (entityId) {
                      newRegistryCache.set(entityId, { ...entry, entity_id: entityId });
                    }
                  }
                }

                this.registryCache = newRegistryCache;
              }

              this.exposedCache = currentExposed;
              this.lastSyncTime = Date.now();
              finish(undefined, currentExposed);
              return;
            }
          }
        } catch (err: any) {
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      };

      socket.onerror = (err: any) => {
        finish(err instanceof Error ? err : new Error('WebSocket communication error.'));
      };

      socket.onclose = () => {
        finish(new Error('WebSocket connection closed.'));
      };
    }).finally(() => {
      this.syncPromise = null;
    });

    return this.syncPromise;
  }

  async getStates(): Promise<HAEntityState[]> {
    const url = `${this.config.baseUrl}/states`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to query states [${response.status}]: ${errText || response.statusText}`);
    }

    return (await response.json()) as HAEntityState[];
  }

  async getState(entityId: string): Promise<HAEntityState> {
    const url = `${this.config.baseUrl}/states/${encodeURIComponent(entityId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to query state for entity "${entityId}" [${response.status}]: ${errText || response.statusText}`);
    }

    return (await response.json()) as HAEntityState;
  }

  async callService(domain: string, service: string, serviceData: Record<string, any> = {}): Promise<any> {
    const url = `${this.config.baseUrl}/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(serviceData),
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to call service "${domain}.${service}" [${response.status}]: ${errText || response.statusText}`);
    }

    return await response.json().catch(() => ({}));
  }

  async getServices(): Promise<HAServiceDomain[]> {
    const url = `${this.config.baseUrl}/services`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to query services [${response.status}]: ${errText || response.statusText}`);
    }

    return (await response.json()) as HAServiceDomain[];
  }

  async getHistory(
    entityId: string,
    options?: {
      startTime?: string;
      endTime?: string;
    }
  ): Promise<HAEntityState[]> {
    const timestamp = options?.startTime ? encodeURIComponent(options.startTime) : '';
    const endpoint = timestamp ? `/history/period/${timestamp}` : '/history/period';
    const params = new URLSearchParams();
    params.set('filter_entity_id', entityId);
    if (options?.endTime) {
      params.set('end_time', options.endTime);
    }
    params.set('significant_changes_only', '1');
    params.set('minimal_response', '1');

    const url = `${this.config.baseUrl}${endpoint}?${params.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to query history for entity "${entityId}" [${response.status}]: ${errText || response.statusText}`);
    }

    const data = (await response.json()) as HAEntityState[][];
    return Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) ? data[0] : [];
  }
}
