# Coding agent

Open **Agents → coding** in Kushex. `agent.ts` exports the same name,
instructions, model, configuration and override resolver as the panel template.
It also exposes `Workflow`, a constructor for the runnable Kushibot workflow.

The workflow runs `plan → edit`. Planning returns a validated Kushibot `TaskInput`:
`goal` holds ordered steps, `acceptanceCriteria` holds outcomes/checks,
`filePaths` holds proposed files and `sourceRefs` holds supporting evidence.
Editing depends on an accepted plan. Its input preserves the original request's
scope and adds the accepted plan receipt to `sourceRefs`. Invalid/missing plans
stop input preparation. Editing results with unresolved work are rejected.

A host integrates it as follows:

```ts
const { definition, executors, policies } = new agent.Workflow(
  planningTaskFactory,
  editingTaskFactory,
  clock,
).create();
// Register definition in WorkflowDefinitionRegistry and supply executors and
// policies to Kushibot's WorkflowStepRunnerFactory / WorkflowEngine.
```

Supply `IAgentTaskFactory<TaskInput>` for planning and
`IAgentTaskFactory<EditingResult>` for editing, plus an `IClock`.
The host owns model gateways, credentials, sessions, budgets and workspace tools.
Give the planner read-only tools; give the editor workspace-scoped write/check
tools and a reader that resolves accepted receipt references and result evidence.
The editor must stop when that evidence is unavailable. Model instructions alone
are not a filesystem permission boundary.

Kushex currently stores and edits definitions; it does not start these workflows.
No provider client or credentials are bundled. The model profile follows the
existing template and can be edited for your configured provider. Check commands
are requested through editor tools; there is no independent verification executor
or publication step in this workflow.
