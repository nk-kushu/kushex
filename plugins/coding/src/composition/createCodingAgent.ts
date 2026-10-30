import {
  Agent,
  AgentRuntimeFactory,
  CodexCliTextGatewayFactory,
  JsonValueContract,
  TaskInputContract,
  type EditingResult,
  type TaskInput,
} from "kushibot";
import { CodingRunWorkflow } from "../workflow/CodingRunWorkflow";
import type { CodingAgentOptions } from "../CodingAgentOptions";

/**
 * Create a coding agent without starting a task or making a model call.
 *
 * Choose one model connection in options:
 * - gateway: use an existing Kushibot gateway (also useful for tests).
 * - provider: "codex-cli": use the installed CLI and its saved login.
 *
 * The host supplies the workspace, artifact writer, model profile, and checks.
 * CodingRunWorkflow prepares each run's workspace tools and plan → edit workflow;
 * Kushibot owns execution, sessions, budgets, and cancellation.
 */
export function createCodingAgent(options: CodingAgentOptions): Agent<TaskInput, EditingResult> {
  const {
    workspace,
    checks,
    artifacts,
    gateway: suppliedGateway,
    provider,
    compression,
    ...settings
  } = options;
  // CLI settings configure the gateway; shared options configure the runtime.
  const { codex, ...runtime } = settings;
  let gateway = suppliedGateway;

  if (provider === "codex-cli") {
    if (options.profile.providerId !== "codex-cli")
      throw new Error("Codex CLI composition requires a Codex CLI model profile.");
    gateway = new CodexCliTextGatewayFactory(codex).create(options.profile);
  }
  if (!gateway) throw new Error("A gateway or supported provider is required.");

  // Compressing sessions build their own BudgetedModelCall, and AgentRunRuntime keeps its
  // gateway and profile private, so pass them down here. Same gateway, same profile, same
  // budget — compression is charged to the run like any other model work.
  const model = {
    gateway,
    profile: options.profile,
    modelTimeoutMs: options.modelTimeoutMs ?? 60_000,
  };

  // Only compose the agent here; per-run resources are allocated by agent.run().
  return new Agent({
    id: "coding",
    requestContract: new TaskInputContract(new JsonValueContract()),
    workflow: new CodingRunWorkflow(workspace, artifacts, checks, model, compression),
    runtime: new AgentRuntimeFactory({ ...runtime, gateway }),
  });
}
