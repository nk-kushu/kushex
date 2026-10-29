import {
  Agent,
  AgentRuntimeFactory,
  JsonValueContract,
  TaskInputContract,
  type EditingResult,
  type TaskInput,
} from "kushibot";
import { AgentWorkflow } from "../workflow/AgentWorkflow";
import type { CodingAgentOptions } from "../CodingAgentOptions";

/** Coding is a configuration of the generic Kushibot Agent, without a subclass. */
export function createCodingAgent(options: CodingAgentOptions): Agent<TaskInput, EditingResult> {
  const { workspace, checks, artifacts, ...runtime } = options;
  
  return new Agent({
    id: "coding",
    requestContract: new TaskInputContract(new JsonValueContract()),
    workflow: new AgentWorkflow(workspace, artifacts, checks),
    runtime: new AgentRuntimeFactory(runtime),
  });
}
