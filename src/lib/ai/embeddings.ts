import { createHash } from "node:crypto";
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { bedrockClient } from "@/lib/aws/clients";
import { env } from "@/lib/env";

export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingResult {
  vector: number[];
  model: string;
  inputTokens: number;
  usageSource: "reported" | "estimated";
  providerRequestId?: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<EmbeddingResult>;
}

/**
 * Deterministic, normalized hashed bag-of-words embedding for offline runs.
 * It is intentionally simple but preserves lexical similarity, which makes
 * local retrieval inspectable without pretending it is a production model.
 */
export function mockEmbedding(text: string): number[] {
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";

  async embed(text: string): Promise<EmbeddingResult> {
    return {
      vector: mockEmbedding(text),
      model: "mock-hash-bow-1024",
      inputTokens: Math.max(1, Math.ceil(text.length / 4)),
      usageSource: "estimated",
    };
  }
}

class BedrockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "bedrock";

  async embed(text: string): Promise<EmbeddingResult> {
    const model = env().BEDROCK_EMBEDDING_MODEL_ID;
    const response = await bedrockClient().send(
      new InvokeModelCommand({
        modelId: model,
        contentType: "application/json",
        accept: "application/json",
        body: new TextEncoder().encode(
          JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSIONS }),
        ),
      }),
    );
    const payload = JSON.parse(
      new TextDecoder().decode(response.body),
    ) as { embedding?: number[]; inputTextTokenCount?: number };
    if (!payload.embedding || payload.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error("Embedding provider returned an invalid vector dimension");
    }
    return {
      vector: payload.embedding,
      model,
      inputTokens: payload.inputTextTokenCount ?? Math.max(1, Math.ceil(text.length / 4)),
      usageSource: payload.inputTextTokenCount ? "reported" : "estimated",
      providerRequestId: response.$metadata.requestId,
    };
  }
}

let provider: EmbeddingProvider | undefined;

export async function embeddingProvider(): Promise<EmbeddingProvider> {
  if (!provider) {
    provider =
      env().EMBEDDING_PROVIDER === "bedrock"
        ? new BedrockEmbeddingProvider()
        : new MockEmbeddingProvider();
  }
  return provider;
}
