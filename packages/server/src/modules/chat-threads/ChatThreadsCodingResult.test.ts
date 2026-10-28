import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { ProjectService } from "../projects/public.js";
import type { Logger } from "../../shared/application/Logger.js";
import { ChatThreads } from "./ChatThreads.js";

const context = { requestId: "request", actor: { id: "alice" } };
const ref = {
  artifactId: "artifact-one",
  digest: "a".repeat(64),
  byteLength: 10,
  mediaType: "application/json",
  schemaId: "workspace-change",
  schemaVersion: "1",
};
const result = {
  summary: "Update",
  baseSnapshotRef: "base",
  resultSnapshotRef: "after",
  changedPaths: ["a.ts"],
  changeArtifactRefs: ["artifact:artifact-one"],
  unresolved: [],
};
const value = {
  outcome: { status: "finished", outcome: { status: "completed" } },
  result,
  artifacts: { "artifact:artifact-one": ref },
};

function fixture(events: unknown) {
  const findFirst = vi.fn().mockResolvedValue({ events });
  const db = { chatTurn: { findFirst } } as unknown as PrismaClient;
  return { findFirst, threads: new ChatThreads(db, {} as ProjectService, {} as Logger) };
}

describe("coding result evidence", () => {
  it("reads a completed result under the actor and project scope", async () => {
    const { threads, findFirst } = fixture([
      { type: "result", value, truncated: false },
      { type: "status", status: "completed" },
    ]);
    expect(await threads.codingResult(context, "project", "run")).toEqual({
      result,
      artifacts: { "artifact:artifact-one": ref },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "run", thread: { actorId: "alice", projectId: "project" } },
      select: { events: true },
    });
  });

  it("rejects incomplete, truncated and mismatched results", async () => {
    const cases = [
      [{ type: "result", value, truncated: false }],
      [
        { type: "result", value, truncated: true },
        { type: "status", status: "completed" },
      ],
      [
        { type: "result", value: { ...value, artifacts: {} }, truncated: false },
        { type: "status", status: "completed" },
      ],
      [
        {
          type: "result",
          value: { ...value, result: { ...result, unresolved: ["failed"] } },
          truncated: false,
        },
        { type: "status", status: "completed" },
      ],
    ];
    for (const events of cases)
      await expect(
        fixture(events).threads.codingResult(context, "project", "run"),
      ).rejects.toThrow();
  });
});
