import * as client from 'prom-client';
import { redisService } from './redis.service';
import { logger } from '../utils/logger';
import { databricksService } from './databricks.service';

export interface BudgetUsage {
  minutes: number;
}

export interface BudgetAlert {
  id: string;
  percentage: number;
  triggeredAt: string;
  acknowledged: boolean;
  dayKey: string;
}

interface RecordUsageParams {
  schoolId?: string;
  durationSeconds?: number;
  provider?: string;
}

function getCounter(name: string, help: string, labelNames: string[]) {
  const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({ name, help, labelNames });
}

function getGauge(name: string, help: string, labelNames: string[]) {
  const existing = client.register.getSingleMetric(name) as client.Gauge<string> | undefined;
  if (existing) return existing;
  return new client.Gauge({ name, help, labelNames });
}

function parseAlertList(raw: string | null): BudgetAlert[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data as BudgetAlert[];
    return [];
  } catch {
    return [];
  }
}

function serializeAlerts(alerts: BudgetAlert[]): string {
  return JSON.stringify(alerts.slice(-50));
}

export class SttBudgetService {
  private readonly budgetGauge = getGauge('stt_budget_minutes', 'Accumulated STT minutes for the day', ['school', 'date']);
  private readonly alertsCounter = getCounter('stt_budget_alerts_total', 'Total budget alerts emitted', ['school', 'pct']);
  private readonly memoryUsage = new Map<string, { minutes: number; lastPct: number }>();
  private readonly memoryAlerts = new Map<string, BudgetAlert[]>();

  async recordUsage(params: RecordUsageParams): Promise<void> {
    const { schoolId, durationSeconds } = params;
    if (!schoolId) return;
    const seconds = durationSeconds ?? 0;
    if (!Number.isFinite(seconds) || seconds <= 0) return;

    const minutes = seconds / 60;
    const now = new Date();
    const dayKey = this.buildDayKey(now);
    const usageKey = this.usageKey(schoolId, dayKey);
    const lastAlertKey = this.lastAlertKey(schoolId, dayKey);

    let totalMinutes = 0;
    let lastAlerted = 0;

    if (redisService.isConnected()) {
      const clientR = redisService.getClient();
      try {
        // @ts-ignore ioredis supports incrbyfloat
        await (clientR as any).incrbyfloat?.(usageKey, minutes);
      } catch {
        const curRaw = await clientR.get(usageKey);
        const cur = parseFloat(curRaw || '0') || 0;
        await clientR.set(usageKey, String(cur + minutes));
      }
      const [totalMinutesStr, lastAlertedStr] = await Promise.all([
        clientR.get(usageKey),
        clientR.get(lastAlertKey),
      ]);
      totalMinutes = parseFloat(totalMinutesStr || '0') || 0;
      lastAlerted = parseInt(lastAlertedStr || '0', 10) || 0;
    } else {
      const usage = this.memoryUsage.get(`${schoolId}:${dayKey}`) || { minutes: 0, lastPct: 0 };
      usage.minutes += minutes;
      totalMinutes = usage.minutes;
      lastAlerted = usage.lastPct;
      this.memoryUsage.set(`${schoolId}:${dayKey}`, usage);
    }

    this.budgetGauge.set({ school: schoolId, date: dayKey }, totalMinutes);

    const dailyBudgetMinutes = this.dailyBudgetMinutes();
    if (dailyBudgetMinutes <= 0) return;

    const threshold = this.thresholds().find((pct) => {
      const usagePct = Math.floor((totalMinutes / dailyBudgetMinutes) * 100);
      return usagePct >= pct && lastAlerted < pct;
    });

    if (typeof threshold === 'number') {
      await this.handleAlert(schoolId, dayKey, threshold, lastAlertKey, totalMinutes);
    }
  }

  async getUsage(schoolId: string, date: string): Promise<BudgetUsage> {
    const dayKey = date.replace(/-/g, '');
    const usageKey = this.usageKey(schoolId, dayKey);

    if (redisService.isConnected()) {
      const clientR = redisService.getClient();
      const minutesStr = await clientR.get(usageKey);
      return { minutes: parseFloat(minutesStr || '0') || 0 };
    }

    const usage = this.memoryUsage.get(`${schoolId}:${dayKey}`);
    return { minutes: usage?.minutes || 0 };
  }

  async getAlerts(schoolId: string): Promise<BudgetAlert[]> {
    if (redisService.isConnected()) {
      const clientR = redisService.getClient();
      const raw = await clientR.get(this.alertsKey(schoolId));
      return parseAlertList(raw);
    }
    return this.memoryAlerts.get(schoolId) || [];
  }

  async acknowledgeAlert(schoolId: string, alertId: string): Promise<void> {
    if (!alertId) return;
    if (redisService.isConnected()) {
      const clientR = redisService.getClient();
      const key = this.alertsKey(schoolId);
      const alerts = parseAlertList(await clientR.get(key));
      const updated = alerts.map((alert) => (alert.id === alertId ? { ...alert, acknowledged: true } : alert));
      await clientR.set(key, serializeAlerts(updated));
    } else {
      const alerts = this.memoryAlerts.get(schoolId) || [];
      const updated = alerts.map((alert) => (alert.id === alertId ? { ...alert, acknowledged: true } : alert));
      this.memoryAlerts.set(schoolId, updated);
    }
  }

  private async handleAlert(
    schoolId: string,
    dayKey: string,
    threshold: number,
    lastAlertKey: string,
    totalMinutes: number
  ): Promise<void> {
    this.alertsCounter.inc({ school: schoolId, pct: String(threshold) });

    const alert: BudgetAlert = {
      id: `${schoolId}-${dayKey}-${threshold}-${Date.now()}`,
      percentage: threshold,
      triggeredAt: new Date().toISOString(),
      acknowledged: false,
      dayKey,
    };

    if (redisService.isConnected()) {
      const clientR = redisService.getClient();
      await Promise.all([
        clientR.set(lastAlertKey, String(threshold)),
        (async () => {
          const key = this.alertsKey(schoolId);
          const alerts = parseAlertList(await clientR.get(key));
          alerts.push(alert);
          await clientR.set(key, serializeAlerts(alerts));
        })(),
      ]);
    } else {
      const usage = this.memoryUsage.get(`${schoolId}:${dayKey}`) || { minutes: totalMinutes, lastPct: 0 };
      usage.lastPct = threshold;
      usage.minutes = totalMinutes;
      this.memoryUsage.set(`${schoolId}:${dayKey}`, usage);

      const alerts = this.memoryAlerts.get(schoolId) || [];
      alerts.push(alert);
      this.memoryAlerts.set(schoolId, alerts.slice(-50));
    }

    if (process.env.ENABLE_DB_METRICS_PERSIST === '1') {
      try {
        await databricksService.insert('operational.budget_alerts', {
          id: alert.id,
          school_id: schoolId,
          day: dayKey,
          budget_minutes: this.dailyBudgetMinutes(),
          used_minutes: totalMinutes,
          percent: threshold,
          created_at: new Date(),
        } as any);
      } catch {
        // ignore persistence errors
      }
    }

    if (process.env.API_DEBUG === '1') {
      logger.debug('Budget alert triggered', { schoolId, threshold, dayKey, totalMinutes });
    }
  }

  private buildDayKey(d: Date): string {
    const year = d.getUTCFullYear();
    const month = `${d.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${d.getUTCDate()}`.padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private usageKey(schoolId: string, dayKey: string): string {
    return `stt:usage:minutes:${schoolId}:${dayKey}`;
  }

  private lastAlertKey(schoolId: string, dayKey: string): string {
    return `stt:usage:last_alert_pct:${schoolId}:${dayKey}`;
  }

  private alertsKey(schoolId: string): string {
    return `stt:usage:alerts:${schoolId}`;
  }

  private dailyBudgetMinutes(): number {
    const raw = process.env.STT_BUDGET_MINUTES_PER_DAY;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
  }

  private thresholds(): number[] {
    return String(process.env.STT_BUDGET_ALERT_PCTS || '50,75,90,100')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 200)
      .sort((a, b) => a - b);
  }
}

export const sttBudgetService = new SttBudgetService();
