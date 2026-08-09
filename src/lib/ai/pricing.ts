export interface ModelPricing {
  version: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

/**
 * Pricing is deliberately versioned and overridable. Provider prices change;
 * historical telemetry keeps the version used at write time.
 */
const PRICING: Array<{ matches: RegExp; pricing: ModelPricing }> = [
  {
    matches: /^anthropic\.claude-sonnet-4-5|^claude-sonnet-4-5/,
    pricing: {
      version: "config-v1",
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    },
  },
];

export function pricingForModel(model: string): ModelPricing | null {
  return PRICING.find((entry) => entry.matches.test(model))?.pricing ?? null;
}

export function calculateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const pricing = pricingForModel(model);
  if (!pricing) return null;
  return (
    (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * pricing.outputUsdPerMillion
  );
}

export function pricingVersionForModel(model: string): string | null {
  return pricingForModel(model)?.version ?? null;
}
