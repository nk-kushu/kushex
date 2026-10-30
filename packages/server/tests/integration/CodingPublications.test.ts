import { LocalWorkspaceProposalService, LocalWorkspacePublicationService } from "kushibot";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  AgentRunDto,
  CodingProposalReviewDto,
  CodingPublicationResultDto,
} from "@kushex/contracts";
import { PrismaDatabase } from "../../src/infrastructure/database/PrismaDatabase.js";
import { PostgresSqlDatabase } from "../../src/infrastructure/database/PostgresSqlDatabase.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import {
  WorkspacePathResolver,
  WorkspaceService,
  LocalWorkspaceFileSystem,
  PrismaWorkspaceRepository,
} from "../../src/modules/workspaces/public.js";
import { ProjectService, PrismaProjectRepository } from "../../src/modules/projects/public.js";
import {
  AgentService,
  LocalAgentStore,
  KushibotTypesReader,
  NodeTypesReader,
} from "../../src/modules/agents/public.js";
import { ChatThreads } from "../../src/modules/chat-threads/ChatThreads.js";
import {
  AgentRunService,
  AgentRunsController,
  CodingProposals,
} from "../../src/modules/agent-runs/public.js";
import type {
  AgentLauncher,
  AgentLaunch,
} from "../../src/modules/agent-runs/application/AgentLauncher.js";
import { HttpServer } from "../../src/transport/http/HttpServer.js";
import { ErrorResponder } from "../../src/transport/http/ErrorResponder.js";
import { RequestContextFactory } from "../../src/transport/http/RequestContextFactory.js";
import { LocalOperatorActorResolver } from "../../src/transport/http/LocalOperatorActorResolver.js";
import { LocalRequestGuard } from "../../src/transport/http/LocalRequestGuard.js";
import { kushibotEntry } from "../../src/modules/agent-runs/infrastructure/kushibotEntry.js";

const logger = pino({ level: "silent" });
const owner = { requestId: "test", actor: { id: "local-operator" } };
const kushibotDirectory =
  process.env.KUSHEX_TEST_KUSHIBOT_DIR ??
  path.resolve(import.meta.dirname, "../../../../../kushibot");
type Library = {
  LocalWorkspaceArtifacts: {
    open(
      workspace: string,
      directory: string,
    ): Promise<{ services: { store: unknown }; close(): Promise<void> }>;
  };
  FilesystemWorkingCopy: new () => { create(source: string): Promise<string> };
  WorkspaceEvidence: new (
    read: (file: string) => Promise<string | null>,
    checks: readonly [],
    artifacts: unknown,
    runId: string,
    signal: AbortSignal,
  ) => {
    initialize(files: readonly string[]): Promise<void>;
    status(): Promise<unknown>;
    evidence(): Readonly<Record<string, unknown>>;
  };
};

/** A deterministic editor replaces model calls while exercising real workspace evidence and artifacts. */
class FixtureCodingLauncher implements AgentLauncher {
  readonly copies: string[] = [];
  constructor(
    private readonly library: Library,
    private readonly artifacts: string,
  ) {}
  launch(launch: AgentLaunch) {
    void this.complete(launch).catch((error: unknown) => {
      launch.run.emit({ type: "error", message: String(error), stack: null });
      launch.run.emit({ type: "status", status: "failed" });
    });
    return { cancel() {}, kill() {} };
  }
  private async complete({ run, workspace }: AgentLaunch) {
    run.emit({ type: "status", status: "running" });
    const copy = await new this.library.FilesystemWorkingCopy().create(workspace);
    this.copies.push(copy);
    const local = await this.library.LocalWorkspaceArtifacts.open(workspace, this.artifacts);
    let value: unknown;
    try {
      const evidence = new this.library.WorkspaceEvidence(
        async (file) => {
          try {
            return await readFile(path.join(copy, file), "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        },
        [],
        local.services.store,
        run.id,
        new AbortController().signal,
      );
      await evidence.initialize(["a.ts", "new.ts"]);
      await writeFile(path.join(copy, "a.ts"), "export const answer = 43;\n");
      await writeFile(path.join(copy, "new.ts"), "export const added = true;\n");
      value = {
        outcome: { status: "finished", outcome: { status: "completed" } },
        result: await evidence.status(),
        artifacts: evidence.evidence(),
      };
    } finally {
      await local.close();
    }
    run.emit({ type: "result", value, truncated: false });
    run.emit({ type: "status", status: "completed" });
  }
}

let temporary: TemporaryDatabase;
let migrator: PrismaMigrator;
let database: PrismaDatabase;
let publicationDatabase: PostgresSqlDatabase;
let directory: string;
let workspace: string;
let projectId: string;
let threadId: string;
let base: string;
let server: HttpServer;
let launcher: FixtureCodingLauncher;
let threads: ChatThreads;
let workspaces: WorkspaceService;
let paths: WorkspacePathResolver;
let agents: AgentService;
let proposals: CodingProposals;
let runs: AgentRunService;

async function startServer() {
  const libraryProposals = new LocalWorkspaceProposalService(
    publicationDatabase,
    undefined,
    path.join(directory, "artifacts"),
  );
  proposals = new CodingProposals(
    threads,
    workspaces,
    paths,
    libraryProposals,
    new LocalWorkspacePublicationService(
      publicationDatabase,
      libraryProposals,
      undefined,
      undefined,
      path.join(directory, "artifacts"),
    ),
  );
  runs = new AgentRunService(workspaces, paths, agents, launcher, null, {}, threads, proposals);
  server = new HttpServer(
    { host: "127.0.0.1", port: 0 },
    logger,
    new ErrorResponder(logger),
    [
      new AgentRunsController(
        runs,
        new RequestContextFactory(new LocalOperatorActorResolver()),
        null,
        proposals,
      ),
    ],
    new LocalRequestGuard([]),
  );
  await server.start();
  base = `http://127.0.0.1:${server.port}`;
}

beforeEach(async () => {
  temporary = await TemporaryDatabase.create();
  migrator = await PrismaMigrator.create();
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  for (const entry of (await readdir(migrations)).sort())
    if (entry !== "migration_lock.toml")
      await migrator.add(
        entry,
        await readFile(new URL(`${entry}/migration.sql`, migrations), "utf8"),
      );
  await migrator.deploy(temporary.url);
  database = new PrismaDatabase(
    { url: temporary.url, maxConnections: 4, connectionTimeoutMs: 2000 },
    logger,
  );
  await database.start();
  publicationDatabase = new PostgresSqlDatabase({
    url: temporary.url,
    schema: "kushibot",
    maxConnections: 4,
    connectionTimeoutMs: 2000,
  });
  directory = await mkdtemp(path.join(tmpdir(), "coding-publication-http-"));
  const root = path.join(directory, "projects");
  workspace = path.join(root, "fixture");
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "a.ts"), "export const answer = 42;\n");
  paths = new WorkspacePathResolver([root]);
  workspaces = new WorkspaceService(
    new PrismaWorkspaceRepository(database.client),
    new LocalWorkspaceFileSystem(paths),
  );
  const projects = new ProjectService(new PrismaProjectRepository(database.client), workspaces);
  projectId = (await projects.create(owner, { name: "Fixture", path: "projects/fixture" })).id;
  threads = new ChatThreads(database.client, projects, logger);
  threadId = (await threads.create(owner, projectId)).id;
  const agentDirectory = path.join(directory, "agents");
  await mkdir(path.join(agentDirectory, "coding"), { recursive: true });
  await writeFile(
    path.join(agentDirectory, "coding/agent.ts"),
    "export async function chat() {}\n",
  );
  agents = new AgentService(
    new LocalAgentStore(agentDirectory),
    new KushibotTypesReader(null),
    new NodeTypesReader(),
  );
  launcher = new FixtureCodingLauncher(
    (await import(kushibotEntry(kushibotDirectory))) as Library,
    path.join(directory, "artifacts"),
  );
  await startServer();
});
afterEach(async () => {
  await server?.stop(new AbortController().signal);
  await runs?.stop();
  await threads?.stop();
  await publicationDatabase?.stop();
  await database?.stop();
  await temporary?.drop();
  await migrator?.remove();
  for (const copy of launcher?.copies ?? [])
    await rm(path.dirname(copy), { recursive: true, force: true });
  if (directory) await rm(directory, { recursive: true, force: true });
});
const post = (url: string, body: unknown) =>
  fetch(`${base}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
async function completedProposal() {
  const launched = await post(`/projects/${projectId}/agent-runs`, {
    threadId,
    agentName: "coding",
    message: "Update the answer",
    files: [],
    debug: false,
  });
  expect(launched.status).toBe(201);
  const run = (await launched.json()) as AgentRunDto;
  let review!: CodingProposalReviewDto;
  await vi.waitFor(
    async () => {
      const response = await fetch(`${base}/projects/${projectId}/agent-runs/${run.id}/proposal`);
      expect(response.status).toBe(200);
      review = (await response.json()) as CodingProposalReviewDto;
    },
    { timeout: 10000 },
  );
  return { review, url: `/projects/${projectId}/agent-runs/${run.id}/proposal`, run };
}

it("automatically prepares a proposal, reviews it, applies only the approved digest and survives a host restart", async () => {
  const { review, url } = await completedProposal();
  expect(review.status).toBe("ready");
  expect(review.changes).toHaveLength(2);
  expect(review.changes[1]).toEqual({
    path: "new.ts",
    before: null,
    after: "export const added = true;\n",
  });
  expect(await readFile(path.join(workspace, "a.ts"), "utf8")).toContain("42");
  await expect(readFile(path.join(workspace, "new.ts"))).rejects.toThrow();
  expect((await post(`${url}/apply`, { digest: "0".repeat(64) })).status).toBe(409);
  const checked = await post(`${url}/reconcile`, { digest: review.digest });
  expect(((await checked.json()) as CodingPublicationResultDto).status).toBe(
    "waiting-for-approval",
  );
  expect(await readFile(path.join(workspace, "a.ts"), "utf8")).toContain("42");
  const applied = await post(`${url}/apply`, { digest: review.digest });
  expect(applied.status).toBe(200);
  const outcome = (await applied.json()) as CodingPublicationResultDto;
  expect(outcome.effect?.status).toBe("published");
  expect(await readFile(path.join(workspace, "a.ts"), "utf8")).toContain("43");
  expect(await readFile(path.join(workspace, "new.ts"), "utf8")).toContain("added");
  await server.stop(new AbortController().signal);
  await runs.stop();
  await threads.stop();
  await startServer();
  expect(((await (await fetch(`${base}${url}`)).json()) as CodingProposalReviewDto).status).toBe(
    "applied",
  );
  expect(await (await post(`${url}/apply`, { digest: review.digest })).json()).toEqual(outcome);
  const records = await publicationDatabase.query(
    "SELECT payload FROM kushibot_publications_v1",
    [],
  );
  const record = JSON.parse(String(records.rows[0]!["payload"]));
  expect(record.command.approval.principalRef).toBe(owner.actor.id);
  expect(record.command.approval.proposalDigest).toBe(review.digest);
  expect(
    (
      await publicationDatabase.query(
        "SELECT COUNT(*) AS count FROM kushibot_filesystem_receipts_v1",
        [],
      )
    ).rows[0]!["count"],
  ).toBe(1);
  await expect(
    proposals.review({ ...owner, actor: { id: "someone-else" } }, projectId, review.id),
  ).rejects.toThrow();
});

it("rejects stale originals without writing either changed or new files", async () => {
  const { review, url } = await completedProposal();
  await writeFile(path.join(workspace, "a.ts"), "user edits");
  const response = await post(`${url}/apply`, { digest: review.digest });
  expect(response.status).toBe(200);
  expect(((await response.json()) as CodingPublicationResultDto).effect).toEqual({
    status: "not-applied",
    code: "TARGET_CHANGED",
  });
  expect(await readFile(path.join(workspace, "a.ts"), "utf8")).toBe("user edits");
  await expect(readFile(path.join(workspace, "new.ts"))).rejects.toThrow();
  expect(((await (await fetch(`${base}${url}`)).json()) as CodingProposalReviewDto).code).toBe(
    "TARGET_CHANGED",
  );
});

it("keeps an uncertain effect pending and never repeats writes when receipt persistence failed", async () => {
  const { review, url } = await completedProposal();
  const library = (await import(kushibotEntry(kushibotDirectory))) as {
    postgresqlFilesystemReceiptStatements: { schema: string };
  };
  await publicationDatabase.migrationTransaction(async (tx) => {
    await tx.query(library.postgresqlFilesystemReceiptStatements.schema, []);
  });
  await publicationDatabase.query(
    "CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture receipt failure'; END $$",
    [],
  );
  await publicationDatabase.query(
    "CREATE TRIGGER receipt_failure BEFORE INSERT ON kushibot_filesystem_receipts_v1 FOR EACH ROW EXECUTE FUNCTION fail_receipt()",
    [],
  );
  const response = await post(`${url}/apply`, { digest: review.digest });
  expect(response.status).toBe(200);
  expect(((await response.json()) as CodingPublicationResultDto).status).toBe("pending");
  expect(await readFile(path.join(workspace, "a.ts"), "utf8")).toContain("43");
  await publicationDatabase.query(
    "DROP TRIGGER receipt_failure ON kushibot_filesystem_receipts_v1",
    [],
  );
  await writeFile(path.join(workspace, "a.ts"), "later manual change");
  await server.stop(new AbortController().signal);
  await runs.stop();
  await threads.stop();
  await startServer();
  expect(
    (
      (await (
        await post(`${url}/reconcile`, { digest: review.digest })
      ).json()) as CodingPublicationResultDto
    ).status,
  ).toBe("pending");
  expect(
    (
      (await (
        await post(`${url}/apply`, { digest: review.digest })
      ).json()) as CodingPublicationResultDto
    ).status,
  ).toBe("pending");
  expect(await readFile(path.join(workspace, "a.ts"), "utf8")).toBe("later manual change");
});
