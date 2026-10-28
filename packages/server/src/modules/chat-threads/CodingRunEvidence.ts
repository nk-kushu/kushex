import { z } from "zod";
import { ConflictError } from "../../errors/ConflictError.js";

/** Validates a completed coding transcript before publication can use its references. */
export class CodingRunEvidence {
  read(input: unknown) {
    const events = z.array(z.record(z.string(), z.unknown())).safeParse(input);
    if (
      !events.success ||
      !events.data.some((event) => event.type === "status" && event.status === "completed")
    )
      throw new ConflictError("The coding run has not completed.");
    const event = events.data.findLast((item) => item.type === "result");
    const artifactRef = z
      .object({
        artifactId: z.string().min(1).max(128),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        byteLength: z.number().int().min(0).max(1048576),
        mediaType: z.literal("application/json"),
        schemaId: z.literal("workspace-change"),
        schemaVersion: z.literal("1"),
      })
      .strict();
    const result = z
      .object({
        summary: z.string().trim().min(1).max(2048),
        baseSnapshotRef: z.string().min(1).max(256),
        resultSnapshotRef: z.string().min(1).max(256),
        changedPaths: z.array(z.string().min(1).max(240)).min(1).max(16),
        changeArtifactRefs: z.array(z.string().min(1).max(256)).min(1).max(16),
        unresolved: z.array(z.string()).length(0),
      })
      .strict();
    const value = z
      .object({
        outcome: z
          .object({
            status: z.literal("finished"),
            outcome: z.object({ status: z.literal("completed") }).passthrough(),
          })
          .passthrough(),
        result,
        artifacts: z.record(z.string(), z.unknown()),
      })
      .passthrough();
    const parsed = z
      .object({ truncated: z.literal(false), value })
      .passthrough()
      .safeParse(event);
    if (!parsed.success)
      throw new ConflictError("No completed coding changes are available for review.");
    const coding = parsed.data.value;
    if (
      coding.result.changedPaths.length !== coding.result.changeArtifactRefs.length ||
      new Set(coding.result.changedPaths).size !== coding.result.changedPaths.length ||
      new Set(coding.result.changeArtifactRefs).size !== coding.result.changeArtifactRefs.length
    )
      throw new ConflictError("The coding result has inconsistent change evidence.");
    const artifacts: Record<string, z.infer<typeof artifactRef>> = {};
    for (const key of coding.result.changeArtifactRefs) {
      const ref = artifactRef.safeParse(coding.artifacts[key]);
      if (!ref.success || key !== `artifact:${ref.data.artifactId}`)
        throw new ConflictError("The coding result has invalid change evidence.");
      artifacts[key] = ref.data;
    }
    return { result: coding.result, artifacts };
  }
}
