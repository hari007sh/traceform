export interface SamplingConfig {
    rate: number;              // 0.0-1.0, default 1.0
    alwaysKeepErrors: boolean; // default true
    alwaysKeepSlowMs: number;  // default 5000
    alwaysKeepCostly: number;  // cents, default 500
}

export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
    rate: 1.0,
    alwaysKeepErrors: true,
    alwaysKeepSlowMs: 5000,
    alwaysKeepCostly: 500,
};

export function shouldSendFull(
    config: SamplingConfig,
    status: string,
    durationMs: number,
    totalCostCents: number,
): boolean {
    if (config.rate >= 1.0) return true;
    if (config.alwaysKeepErrors && ['failed', 'healed', 'timeout'].includes(status)) return true;
    if (durationMs > config.alwaysKeepSlowMs) return true;
    if (totalCostCents > config.alwaysKeepCostly) return true;
    return Math.random() < config.rate;
}
