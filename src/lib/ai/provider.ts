import { env } from "@/lib/env";

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  structuredOutput?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
  source: "reported" | "estimated";
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: CompletionUsage;
  providerRequestId?: string;
}

export interface AiProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

let provider: AiProvider | undefined;

/**
 * AI_PROVIDER=bedrock → AWS Bedrock (Claude via the Converse API).
 * AI_PROVIDER=mock    → deterministic offline provider for dev/demo/tests.
 */
export async function aiProvider(): Promise<AiProvider> {
  if (!provider) {
    if (env().AI_PROVIDER === "bedrock") {
      const { BedrockProvider } = await import("./bedrock");
      provider = new BedrockProvider();
    } else if (env().AI_PROVIDER === "anthropic") {
      const { AnthropicProvider } = await import("./anthropic");
      provider = new AnthropicProvider();
    } else {
      const { MockProvider } = await import("./mock");
      provider = new MockProvider();
    }
  }
  return provider;
}
