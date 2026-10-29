import Joi from "joi";
import type { JsonValue } from "kushibot";
import type { WorkspaceEvidence } from "kushibot";
import { JsonValueContract, type ITool, type ToolDescriptor } from "kushibot";
import { JoiArgumentsContract } from "kushibot";

export class StatusTool implements ITool {
  readonly argumentsContract = new JoiArgumentsContract("status-arguments", Joi.object({}));
  readonly resultContract = new JsonValueContract();
  private readonly description =
    "status {}: returns actual EditingResult references and check failures; copy these references into your final result.";
  get descriptor(): ToolDescriptor {
    return {
      id: "status",
      version: "1",
      description: this.description,
      inputSchema: this.argumentsContract.schema,
      maxArgumentBytes: 65536,
      maxOutputBytes: 65536,
    };
  }

  constructor(private readonly evidence: WorkspaceEvidence) {}

  async execute(_input: JsonValue): Promise<JsonValue> {
    try {
      return { ...(await this.evidence.status()) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Workspace operation failed." };
    }
  }
}
