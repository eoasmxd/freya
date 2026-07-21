import type { FreyaContext, LLMTokenUsage } from '@eoasmxd/freya-sdk';
import fs from 'node:fs';
import path from 'node:path';
import type { FreyaLLMRegistry } from '../llm/llm-registry.js';

interface StatsBilling {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  totalTokens: number;
  cost: number;
  lastUpdatedAt: string;
}

interface DayMonthBilling {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  totalTokens: number;
  cost: number;
  byProvider: Record<string, { promptTokens: number; completionTokens: number; cost: number }>;
  bySession: Record<string, { promptTokens: number; completionTokens: number; cost: number }>;
}

export class FreyaBillingService {
  private writeLock = Promise.resolve();
  
  private stats: StatsBilling = {
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    totalTokens: 0,
    cost: 0,
    lastUpdatedAt: new Date().toISOString(),
  };

  private providers: Record<string, any> = {};

  private billingDir = '';
  private datesDir = '';
  private monthsDir = '';

  constructor(
    private context: FreyaContext,
    private llmRegistry: FreyaLLMRegistry
  ) {
    const dataDir = path.join(process.cwd(), 'data');
    this.billingDir = path.join(dataDir, 'billing');
    this.datesDir = path.join(this.billingDir, 'dates');
    this.monthsDir = path.join(this.billingDir, 'months');

    this.initFileSystem().then(() => {
      this.setupListeners();
    }).catch((err) => {
      this.context.logger.error('[BillingService] 物理计费系统初始化失败:', err);
    });
  }

  private async initFileSystem(): Promise<void> {
    await fs.promises.mkdir(this.datesDir, { recursive: true });
    await fs.promises.mkdir(this.monthsDir, { recursive: true });

    const statsPath = path.join(this.billingDir, 'stats.json');
    if (fs.existsSync(statsPath)) {
      try {
        const statsContent = await fs.promises.readFile(statsPath, 'utf-8');
        this.stats = JSON.parse(statsContent);
      } catch (err) {
        this.context.logger.warn('[BillingService] 解析 stats.json 失败，将使用默认配置覆写。');
      }
    } else {
      await fs.promises.writeFile(statsPath, JSON.stringify(this.stats, null, 2), 'utf-8');
    }

    const providersPath = path.join(this.billingDir, 'providers.json');
    if (fs.existsSync(providersPath)) {
      try {
        const providersContent = await fs.promises.readFile(providersPath, 'utf-8');
        this.providers = JSON.parse(providersContent);
      } catch (err) {
        this.context.logger.warn('[BillingService] 解析 providers.json 失败，将使用默认配置覆写。');
      }
    } else {
      await fs.promises.writeFile(providersPath, JSON.stringify(this.providers, null, 2), 'utf-8');
    }
  }

  private setupListeners(): void {
    this.context.eventBus.on('token:consumed', (payload: { ownerType?: string; ownerId?: string; providerId?: string; modelId: string; usage: LLMTokenUsage }) => {
      this.handleTokenConsumption(payload).catch((err) => {
        this.context.logger.error('[BillingService] 处理 Token 消费统计失败:', err);
      });
    });
  }

  private accumulateBilling(
    data: DayMonthBilling,
    usage: LLMTokenUsage,
    cachedTokens: number,
    singleCost: number,
    provId: string,
    sessionId: string
  ): void {
    data.promptTokens += usage.promptTokens;
    data.completionTokens += usage.completionTokens;
    data.cachedPromptTokens += cachedTokens;
    data.totalTokens += usage.totalTokens;
    data.cost = parseFloat((data.cost + singleCost).toFixed(7));

    if (!data.byProvider[provId]) {
      data.byProvider[provId] = { promptTokens: 0, completionTokens: 0, cost: 0 };
    }
    data.byProvider[provId].promptTokens += usage.promptTokens;
    data.byProvider[provId].completionTokens += usage.completionTokens;
    data.byProvider[provId].cost = parseFloat((data.byProvider[provId].cost + singleCost).toFixed(7));

    if (!data.bySession[sessionId]) {
      data.bySession[sessionId] = { promptTokens: 0, completionTokens: 0, cost: 0 };
    }
    data.bySession[sessionId].promptTokens += usage.promptTokens;
    data.bySession[sessionId].completionTokens += usage.completionTokens;
    data.bySession[sessionId].cost = parseFloat((data.bySession[sessionId].cost + singleCost).toFixed(7));
  }

  private async handleTokenConsumption(payload: { ownerType?: string; ownerId?: string; providerId?: string; modelId: string; usage: LLMTokenUsage }): Promise<void> {
    const { ownerType, ownerId, providerId, modelId, usage } = payload;
    const sessionId = (ownerType === 'session' && ownerId) ? ownerId : 'system';

    const matchedModel = this.llmRegistry.findModelConfig(modelId, providerId);
    const inputPrice = matchedModel ? matchedModel.inputPrice : 0;
    const outputPrice = matchedModel ? matchedModel.outputPrice : 0;
    const cachedInputPrice = matchedModel ? matchedModel.cachedInputPrice : 0;

    const cachedTokens = usage.cachedPromptTokens || 0;
    const regularPromptTokens = Math.max(0, usage.promptTokens - cachedTokens);

    const regularInputCost = (regularPromptTokens / 1000000) * inputPrice;
    const cachedInputCost = (cachedTokens / 1000000) * cachedInputPrice;
    const completionCost = (usage.completionTokens / 1000000) * outputPrice;

    const singleCost = parseFloat((regularInputCost + cachedInputCost + completionCost).toFixed(7));

    if (ownerType === 'session' && ownerId) {
      this.context.eventBus.emit('billing:session:add', {
        sessionId: ownerId,
        modelId,
        usage,
        singleCost
      });
    }

    const nextWrite = this.writeLock.then(async () => {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const monthStr = now.toISOString().slice(0, 7);

      this.stats.promptTokens += usage.promptTokens;
      this.stats.completionTokens += usage.completionTokens;
      this.stats.cachedPromptTokens += cachedTokens;
      this.stats.totalTokens += usage.totalTokens;
      this.stats.cost = parseFloat((this.stats.cost + singleCost).toFixed(7));
      this.stats.lastUpdatedAt = now.toISOString();
      await fs.promises.writeFile(path.join(this.billingDir, 'stats.json'), JSON.stringify(this.stats, null, 2), 'utf-8');

      const provId = providerId || 'unknown';
      if (!this.providers[provId]) {
        this.providers[provId] = { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0, cost: 0, models: {} };
      }
      const prov = this.providers[provId];
      prov.promptTokens += usage.promptTokens;
      prov.completionTokens += usage.completionTokens;
      prov.cachedPromptTokens += cachedTokens;
      prov.totalTokens += usage.totalTokens;
      prov.cost = parseFloat((prov.cost + singleCost).toFixed(7));

      if (!prov.models[modelId]) {
        prov.models[modelId] = { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0, cost: 0 };
      }
      const mod = prov.models[modelId];
      mod.promptTokens += usage.promptTokens;
      mod.completionTokens += usage.completionTokens;
      mod.cachedPromptTokens += cachedTokens;
      mod.totalTokens += usage.totalTokens;
      mod.cost = parseFloat((mod.cost + singleCost).toFixed(7));
      await fs.promises.writeFile(path.join(this.billingDir, 'providers.json'), JSON.stringify(this.providers, null, 2), 'utf-8');

      const datePath = path.join(this.datesDir, `${dateStr}.json`);
      let dayData: DayMonthBilling = { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0, cost: 0, byProvider: {}, bySession: {} };
      if (fs.existsSync(datePath)) {
        try {
          dayData = JSON.parse(await fs.promises.readFile(datePath, 'utf-8'));
        } catch {}
      }
      this.accumulateBilling(dayData, usage, cachedTokens, singleCost, provId, sessionId);
      await fs.promises.writeFile(datePath, JSON.stringify(dayData, null, 2), 'utf-8');

      const monthPath = path.join(this.monthsDir, `${monthStr}.json`);
      let monthData: DayMonthBilling = { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0, cost: 0, byProvider: {}, bySession: {} };
      if (fs.existsSync(monthPath)) {
        try {
          monthData = JSON.parse(await fs.promises.readFile(monthPath, 'utf-8'));
        } catch {}
      }
      this.accumulateBilling(monthData, usage, cachedTokens, singleCost, provId, sessionId);
      await fs.promises.writeFile(monthPath, JSON.stringify(monthData, null, 2), 'utf-8');
    }).catch((err) => {
      this.context.logger.error('[BillingService] 物理落盘写盘遇到异常:', err);
    });

    this.writeLock = nextWrite;
    await nextWrite;
  }
}

export default FreyaBillingService;
