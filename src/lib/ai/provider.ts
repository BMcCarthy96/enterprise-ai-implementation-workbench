import { env } from "@/lib/env";

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
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
    } else {
      const { MockProvider } = await import("./mock");
      provider = new MockProvider();
    }
  }
  return provider;
}
