import { LocalWorkspaceProposalService, LocalWorkspacePublicationService } from "kushibot";
import { PluginCatalog } from "../modules/plugins/PluginCatalog.js";
import { PluginsController } from "../modules/plugins/PluginsController.js";
import {
  SettingsService,
  PrismaSettingsRepository,
  SettingsController,
} from "../modules/settings/public.js";
import {
  ProjectService,
  PrismaProjectRepository,
  ProjectsController,
} from "../modules/projects/public.js";
import {
  WorkspaceService,
  WorkspacePathResolver,
  LocalWorkspaceFileSystem,
  PrismaWorkspaceRepository,
  LocationsController,
} from "../modules/workspaces/public.js";
import { FileService, FilesController } from "../modules/files/public.js";
import {
  AgentService,
  AgentsController,
  CodeNotesController,
  CodeNotesService,
  KushibotTypesReader,
  NodeTypesReader,
  PrismaCodeNotesRepository,
} from "../modules/agents/public.js";
import {
  AgentRunDebugEvents,
  CodingProposals,
  AgentRunService,
  AgentRunsController,
  ChildProcessAgentLauncher,
  KushibotDebugEventLog,
  PrismaDebugStreamRepository,
} from "../modules/agent-runs/public.js";
import { RequestContextFactory } from "../transport/http/RequestContextFactory.js";
import { LocalOperatorActorResolver } from "../transport/http/LocalOperatorActorResolver.js";
import { LocalRequestGuard } from "../transport/http/LocalRequestGuard.js";
import { fileURLToPath } from "node:url";
import { type Logger as PinoLogger, pino } from "pino";
import type { ServerConfig } from "../config/ServerConfig.js";
import { DatabaseReadinessCheck } from "../infrastructure/database/DatabaseReadinessCheck.js";
import { PrismaDatabase } from "../infrastructure/database/PrismaDatabase.js";
import { PostgresSqlDatabase } from "../infrastructure/database/PostgresSqlDatabase.js";
import { PrismaMigrationReadinessCheck } from "../infrastructure/database/PrismaMigrationReadinessCheck.js";
import { ErrorResponder } from "../transport/http/ErrorResponder.js";
import { HealthController } from "../transport/http/HealthController.js";
import { HttpServer } from "../transport/http/HttpServer.js";
import { Application } from "./Application.js";
import { ReadinessProbe } from "./health/ReadinessProbe.js";
import { ChatThreads } from "../modules/chat-threads/ChatThreads.js";
import { ChatThreadsController } from "../modules/chat-threads/ChatThreadsController.js";
import { NoteService, NotesController, PrismaNoteRepository } from "../modules/notes/public.js";

/** Readiness must answer within the Compose probe timeout (3 s). */
const READINESS_TIMEOUT_MS = 2000;

/** Composition root: selects concrete implementations and wires them together. */
export class ApplicationFactory {
  readonly logger: PinoLogger;

  constructor(
    private readonly config: ServerConfig,
    /** Resolved relative to the package root in both `src/app` and `dist/app`. */
    private readonly migrationsDirectory = fileURLToPath(
      new URL("../../prisma/migrations/", import.meta.url),
    ),
  ) {
    this.logger = pino({ level: config.logLevel, base: { service: "kushex-server" } });
  }

  createServer(): Application {
    const database = new PrismaDatabase(this.config.database, this.logger);
    const readiness = new ReadinessProbe(
      [
        new DatabaseReadinessCheck(database.client),
        new PrismaMigrationReadinessCheck(database.client, this.migrationsDirectory),
      ],
      READINESS_TIMEOUT_MS,
      this.logger,
    );
    const contexts = new RequestContextFactory(new LocalOperatorActorResolver());
    const workspacePaths = new WorkspacePathResolver(this.config.workspacesRoots);
    const filesystem = new LocalWorkspaceFileSystem(workspacePaths);
    const workspaces = new WorkspaceService(
      new PrismaWorkspaceRepository(database.client),
      filesystem,
    );
    const projects = new ProjectService(new PrismaProjectRepository(database.client), workspaces);
    const threads = new ChatThreads(database.client, projects, this.logger);
    const files = new FileService(workspaces, filesystem);
    const catalog = new PluginCatalog(this.config.pluginsDirectory);
    const agents = new AgentService(
      catalog,
      new KushibotTypesReader(this.config.kushibotDirectory),
      new NodeTypesReader(),
    );
    // kushibot's debug-event tables, in their own schema next to Prisma's `kushex`.
    const kushibotDatabase = new PostgresSqlDatabase({
      url: this.config.database.url,
      schema: "kushibot",
      maxConnections: 4,
      connectionTimeoutMs: this.config.database.connectionTimeoutMs,
    });
    const debugEvents = new AgentRunDebugEvents(
      new KushibotDebugEventLog(this.config.kushibotDirectory, kushibotDatabase),
      new PrismaDebugStreamRepository(database.client),
      this.logger,
    );
    const proposals = new LocalWorkspaceProposalService(
      kushibotDatabase,
      undefined,
      this.config.artifactsDirectory,
    );
    const publication = new LocalWorkspacePublicationService(
      kushibotDatabase,
      proposals,
      undefined,
      undefined,
      this.config.artifactsDirectory,
    );
    const codingProposals = new CodingProposals(
      threads,
      workspaces,
      workspacePaths,
      proposals,
      publication,
    );
    const runs = new AgentRunService(
      workspaces,
      workspacePaths,
      agents,
      new ChildProcessAgentLauncher(this.config.kushibotDirectory, this.logger),
      debugEvents,
      {},
      threads,
      codingProposals,
    );
    const http = new HttpServer(
      this.config.http,
      this.logger,
      new ErrorResponder(this.logger),
      [
        new HealthController(readiness),
        new SettingsController(
          new SettingsService(new PrismaSettingsRepository(database.client)),
          contexts,
        ),
        new LocationsController(workspaces, contexts),
        new ProjectsController(projects, contexts),
        new ChatThreadsController(threads, contexts),
        new NotesController(new NoteService(new PrismaNoteRepository(database.client)), contexts),
        new FilesController(files, contexts),
        new AgentsController(agents),
        new PluginsController(catalog),
        new CodeNotesController(
          new CodeNotesService(new PrismaCodeNotesRepository(database.client), agents),
        ),
        new AgentRunsController(runs, contexts, debugEvents, codingProposals),
      ],
      new LocalRequestGuard(this.config.allowedOrigins),
    );
    // Stopped in reverse: agent processes end first, which also closes their event streams.
    return new Application(
      [database, kushibotDatabase, catalog, http, threads, runs],
      this.config.shutdownTimeoutMs,
      this.logger,
    );
  }
}
