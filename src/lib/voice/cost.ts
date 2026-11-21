/**
 * Voice cost accounting. All money is in INR.
 * Default prices are the PUBLISHED Sarvam rates quoted in the product brief. They are not a
 * guarantee of production cost: replace them with measured billing once real calls exist.
 */
export type Pricing = {
  sttPerAudioMinute: number;
  ttsPer1000Chars: number;
  llmInputPerMillionTokens: number;
  llmOutputPerMillionTokens: number;
  fxInrPerUsd: number;
  targetUsdPerMinute: number;
};

export const PUBLISHED_SARVAM_PRICING: Pricing = {
  sttPerAudioMinute: 0.49,
  ttsPer1000Chars: 1, // Bulbul v4 Flash; v3 is 3
  llmInputPerMillionTokens: 29.28, // Sarvam 105B
  llmOutputPerMillionTokens: 73.2,
  fxInrPerUsd: 85,
  targetUsdPerMinute: 0.02,
};

export const targetInrPerMinute = (p: Pricing) => p.targetUsdPerMinute * p.fxInrPerUsd; // 1.70 at defaults

export type CallUsage = {
  connected: boolean;
  /** Seconds of customer audio billed by the STT provider. */
  sttBilledSeconds: number;
  ttsCharacters: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  /** Seconds the call was connected (what the customer experienced). */
  connectedSeconds: number;
  orchestrationInr?: number;
  telephonyInr?: number;
  /** True for a retry of an earlier attempt: its cost still counts. */
  isRetry?: boolean;
};

export type CallCost = {
  stt: number;
  tts: number;
  llm: number;
  orchestration: number;
  ai: number;
  telephony: number;
  total: number;
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function costOfCall(u: CallUsage, p: Pricing = PUBLISHED_SARVAM_PRICING): CallCost {
  const stt = (u.sttBilledSeconds / 60) * p.sttPerAudioMinute;
  const tts = (u.ttsCharacters / 1000) * p.ttsPer1000Chars;
  const llm =
    (u.llmInputTokens / 1_000_000) * p.llmInputPerMillionTokens +
    (u.llmOutputTokens / 1_000_000) * p.llmOutputPerMillionTokens;
  const orchestration = u.orchestrationInr ?? 0;
  const telephony = u.telephonyInr ?? 0;
  const ai = stt + tts + llm + orchestration;
  return { stt: r4(stt), tts: r4(tts), llm: r4(llm), orchestration: r4(orchestration), ai: r4(ai), telephony: r4(telephony), total: r4(ai + telephony) };
}

/** The brief's per-minute worked examples, as a function. */
export function speechCostPerMinute(charsPerMinute: number, p: Pricing = PUBLISHED_SARVAM_PRICING) {
  return r4(p.sttPerAudioMinute + (charsPerMinute / 1000) * p.ttsPer1000Chars);
}

export const MIN_SAMPLE_FOR_TARGET_CLAIM = 100;

export type CostSummary = {
  calls: number;
  connectedCalls: number;
  failedCalls: number;
  retries: number;
  connectedMinutes: number;
  aiInr: number;
  telephonyInr: number;
  aiInrPerConnectedMinute: number | null;
  totalInrPerConnectedMinute: number | null;
  aiUsdPerConnectedMinute: number | null;
  /** The acceptance gate: the $0.02 target is never "met" on a small or empty sample. */
  targetStatus: "insufficient_sample" | "met" | "not_met";
  targetInrPerMinute: number;
};

/**
 * Aggregates a set of calls. Failed calls and retries ARE included in the cost numerator;
 * only connected time is in the denominator. That is deliberate: hiding failures flatters the average.
 */
export function summarizeCosts(
  calls: CallUsage[],
  p: Pricing = PUBLISHED_SARVAM_PRICING,
  minSample = MIN_SAMPLE_FOR_TARGET_CLAIM,
): CostSummary {
  let ai = 0;
  let tel = 0;
  let connectedSeconds = 0;
  let connectedCalls = 0;
  let retries = 0;
  for (const c of calls) {
    const cost = costOfCall(c, p);
    ai += cost.ai;
    tel += cost.telephony;
    if (c.connected) {
      connectedCalls++;
      connectedSeconds += c.connectedSeconds;
    }
    if (c.isRetry) retries++;
  }
  const minutes = connectedSeconds / 60;
  const aiPerMin = minutes > 0 ? ai / minutes : null;
  const totalPerMin = minutes > 0 ? (ai + tel) / minutes : null;
  const target = targetInrPerMinute(p);
  let targetStatus: CostSummary["targetStatus"] = "insufficient_sample";
  if (calls.length >= minSample && aiPerMin !== null) targetStatus = aiPerMin <= target ? "met" : "not_met";
  return {
    calls: calls.length,
    connectedCalls,
    failedCalls: calls.length - connectedCalls,
    retries,
    connectedMinutes: r4(minutes),
    aiInr: r4(ai),
    telephonyInr: r4(tel),
    aiInrPerConnectedMinute: aiPerMin === null ? null : r4(aiPerMin),
    totalInrPerConnectedMinute: totalPerMin === null ? null : r4(totalPerMin),
    aiUsdPerConnectedMinute: aiPerMin === null ? null : r4(aiPerMin / p.fxInrPerUsd),
    targetStatus,
    targetInrPerMinute: target,
  };
}

/** North-star: total campaign and calling cost divided by attended site visits. */
export function costPerAttendedVisit(totalCostInr: number, attendedVisits: number): number | null {
  return attendedVisits > 0 ? r4(totalCostInr / attendedVisits) : null;
}
