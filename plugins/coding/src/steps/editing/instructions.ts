import { instructions } from "../instructions";

export const editingInstructions = `${instructions}
The task preserves the original request. The host supplies the acceptedPlan result
directly in your initial context and retains its receipt reference in sourceRefs.
Use acceptedPlan.goal for ordered steps, acceptanceCriteria for planned checks, and
filePaths for proposed targets. Do not invent additional authority from the plan.
Implement that plan within the original permitted scope. Read cited sources, run relevant verification,
and return an EditingResult with actual snapshot and change artifact references and unresolved issues.
If the plan cannot be followed, report the blocker rather than expanding scope silently.`;
