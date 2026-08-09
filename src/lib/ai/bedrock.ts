import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { bedrockClient } from "@/lib/aws/clients";
import { env } from "@/lib/env";
import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
} from "./provider";

/**
 * Claude on AWS Bedrock via the model-agnostic Converse API. Requires model
 * access to be enabled for the account/region (see docs/aws-deployment.md).
 */
export class BedrockProvider implements AiProvider {
  readonly name = "bedrock";

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const modelId = env().BEDROCK_MODEL_ID;
    const res = await bedrockClient().send(
      new ConverseCommand({
        modelId,
        system: [{ text: req.system }],
        messages: [{ role: "user", content: [{ text: req.user }] }],
        inferenceConfig: {
          maxTokens: req.maxTokens ?? 4096,
          temperature: 0.2,
        },
        ...(req.structuredOutput
          ? {
              outputConfig: {
                textFormat: {
                  type: "json_schema" as const,
                  structure: {
                    jsonSchema: {
                      name: req.structuredOutput.name,
                      schema: JSON.stringify(req.structuredOutput.schema),
                    },
                  },
                },
              },
            }
          : {}),
      }),
    );

    const text =
      res.output?.message?.content
        ?.map((block) => ("text" in block ? block.text : ""))
        .join("") ?? "";

    if (!text) {
      throw new Error(
        `Bedrock returned an empty response (stopReason=${res.stopReason})`,
      );
    }
    return {
      text,
      model: modelId,
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        source: "reported",
      },
      providerRequestId: res.$metadata.requestId,
    };
  }
}
