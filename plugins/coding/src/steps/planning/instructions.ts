import { instructions } from "../instructions";

export const planningInstructions = `${instructions}
Return a TaskInput object: goal contains the ordered implementation plan (at most 2048 characters),
acceptanceCriteria contains observable outcomes and checks, filePaths contains relative target paths,
and sourceRefs contains supplied evidence references. Preserve the original requirements and permitted
scope. Use only read-only tools. Do not write code in this phase.`;

