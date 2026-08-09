import { env } from "@/lib/env";
import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
} from "./provider";

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const settings = env();
    if (!settings.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is required for AI_PROVIDER=anthropic");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: settings.ANTHROPIC_MODEL_ID,
        max_tokens: req.maxTokens ?? 4096,
        temperature: 0.2,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
    });

    const payload = (await response.json()) as {
      id?: string;
      model?: string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(
        `Anthropic request failed (${response.status}): ${payload.error?.message ?? "unknown error"}`,
      );
    }

    const text =
      payload.content
        ?.filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("") ?? "";
    if (!text) throw new Error("Anthropic returned an empty response");

    return {
      text,
      model: payload.model ?? settings.ANTHROPIC_MODEL_ID,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
        source: "reported",
      },
      providerRequestId: payload.id,
    };
  }
}
