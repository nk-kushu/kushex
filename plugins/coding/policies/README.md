# Coding agent policies

These policies turn the generic agent runtime into a coding agent with specific
rules. They prepare each stage's context, choose its tools, and decide whether
its result is acceptable.

## What each policy does

| Policy | Role in the process |
| --- | --- |
| [CodingInputPolicy](./CodingInputPolicy.ts) | Validates a step's input. Before editing, requires an accepted plan and adds its receipt reference. Preserves the original task's requirements and file permissions. |
| [PlanningSessionPolicy](./PlanningSessionPolicy.ts) | Sets up the planning session with task context, planning instructions, read-only tools, and a check that proposed files stay within the original task's allowlist. An empty allowlist permits workspace access. |
| [EditingSessionPolicy](./EditingSessionPolicy.ts) | Sets up implementation: verifies the plan receipt, supplies the accepted plan, enables editing and check tools, and checks the reported result against workspace evidence. |

## Where policies fit in a run

```text
Original task
    ↓ CodingInputPolicy validates input
Planning session ← PlanningSessionPolicy
    ↓ Accepted plan
CodingInputPolicy requires plan + preserves original task
    ↓
Editing session ← EditingSessionPolicy
    ↓
Workflow acceptance and final completion checks
    ↓
Returned result
```

[AgentWorkflow](../workflow/AgentWorkflow.ts) creates the workspace tools and
connects both session policies to the runtime's task factories.
[CodingWorkflow](../workflow/CodingWorkflow.ts) registers the input policies and
declares the dependency from editing to planning.

The accepted plan is guidance. It does not replace the original task's goal,
acceptance criteria, or permitted files. The editing session receives both the
original task and the accepted plan.

## Why separate policies from workflows and prompts?

- The **workflow** specifies the order: plan, then edit.
- The **prompts** tell the model what to do.
- The **policies** provide context, capabilities, and acceptance decisions that
  the runtime applies.
- The **runtime** executes sessions and model/tool calls.

For example, "inspect files before planning" is an instruction. Giving the
planner only read-only tools is a programmatic restriction. Both are configured
by the planning policy, but they provide different levels of control.

Acceptance also happens at several levels. Session policies check the model's
candidate result. The workflow's step acceptance policies validate the plan's
shape and require an editing result with no unresolved work. Finally,
`AgentWorkflow` checks the accepted editing result against the current workspace
and required check results before declaring the run complete. A correctly shaped
result alone does not prove that the implementation was done.

## What “policy” means here

All three classes implement `IPolicy` through an `apply()` method. The name covers
different responsibilities: the session policies mostly act as session
configuration factories, while `CodingInputPolicy` validates and transforms
step input. Their shared purpose is to keep coding-specific decisions separate
from the generic execution machinery.
