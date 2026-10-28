import type { CodingProposalReviewDto, CodingPublicationResultDto } from "@kushex/contracts";
import type { PostgresSqlDatabase } from "../../../infrastructure/database/PostgresSqlDatabase.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { ConflictError } from "../../../errors/ConflictError.js";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { ChatThreads } from "../../chat-threads/ChatThreads.js";
import type { WorkspaceService, WorkspacePathResolver } from "../../workspaces/public.js";
import { kushibotEntry } from "../infrastructure/kushibotEntry.js";

type ProposalService = Readonly<{
  create(input: unknown): Promise<unknown>;
  review(input: unknown): Promise<CodingProposalReviewDto | null>;
}>;
type PublicationService = Readonly<{
  apply(input: unknown, digest: string, principal: string): Promise<CodingPublicationResultDto>;
  reconcile(input: unknown, digest: string, principal: string): Promise<CodingPublicationResultDto>;
}>;
type Services = Readonly<{ proposals: ProposalService; publication: PublicationService }>;
type Kushibot = Readonly<{
  LocalWorkspaceProposalService: new (
    database: PostgresSqlDatabase,
    statements?: undefined,
    artifactsDirectory?: string,
  ) => ProposalService;
  LocalWorkspacePublicationService: new (
    database: PostgresSqlDatabase,
    proposals: ProposalService,
    statements?: undefined,
    receipts?: undefined,
    artifactsDirectory?: string,
  ) => PublicationService;
}>;

/** Resolves the authorized run and workspace before preparing a durable proposal. */
export class CodingProposals {
  private service: Promise<Services> | null = null;
  private readonly operations = new Map<string, Promise<unknown>>();
  constructor(
    private readonly threads: ChatThreads,
    private readonly workspaces: WorkspaceService,
    private readonly paths: WorkspacePathResolver,
    private readonly database: PostgresSqlDatabase,
    private readonly kushibotDirectory: string | null,
    private readonly artifactsDirectory?: string,
  ) {}

  async create(context: RequestContext, projectId: string, runId: string): Promise<unknown> {
    const input = await this.input(context, projectId, runId);
    return this.serial(input.workspace, async () => (await this.load()).proposals.create(input));
  }

  async review(
    context: RequestContext,
    projectId: string,
    runId: string,
  ): Promise<CodingProposalReviewDto> {
    const input = await this.input(context, projectId, runId);
    return this.serial(input.workspace, async () => {
      const review = await (await this.load()).proposals.review(input);
      if (review === null) throw new NotFoundError("Coding proposal not found.");
      return review;
    });
  }

  async apply(
    context: RequestContext,
    projectId: string,
    runId: string,
    digest: string,
  ): Promise<CodingPublicationResultDto> {
    return this.publish(context, projectId, runId, digest, false);
  }

  async reconcile(
    context: RequestContext,
    projectId: string,
    runId: string,
    digest: string,
  ): Promise<CodingPublicationResultDto> {
    return this.publish(context, projectId, runId, digest, true);
  }

  private async publish(
    context: RequestContext,
    projectId: string,
    runId: string,
    digest: string,
    reconcileOnly: boolean,
  ) {
    const input = await this.input(context, projectId, runId);
    return this.serial(input.workspace, async () => {
      const services = await this.load();
      const review = await services.proposals.review(input);
      if (!review || review.digest !== digest)
        throw new ConflictError("The proposal no longer matches the reviewed changes.");
      return reconcileOnly
        ? services.publication.reconcile(input, digest, context.actor.id)
        : services.publication.apply(input, digest, context.actor.id);
    });
  }

  /** Serializes host publication and SQLite evidence access for the same physical workspace. */
  private serial<T>(workspace: string, work: () => Promise<T>): Promise<T> {
    const next = (this.operations.get(workspace) ?? Promise.resolve()).catch(() => {}).then(work);
    this.operations.set(workspace, next);
    const release = () => {
      if (this.operations.get(workspace) === next) this.operations.delete(workspace);
    };
    void next.then(release, release);
    return next;
  }

  private async input(context: RequestContext, projectId: string, runId: string) {
    const { workspace } = await this.workspaces.forProject(context, projectId);
    const evidence = await this.threads.codingResult(context, projectId, runId);
    const checkout = await this.paths.resolve(workspace.path);
    return {
      id: runId,
      workspace: checkout.absolute,
      targetId: workspace.id,
      scope: { scopeId: context.actor.id, projectId, workspaceId: workspace.id },
      ...evidence,
    };
  }

  private load(): Promise<Services> {
    if (!this.kushibotDirectory) throw new ConflictError("Coding proposals require Kushibot.");
    this.service ??= import(kushibotEntry(this.kushibotDirectory))
      .then((module: Kushibot) => {
        const proposals = new module.LocalWorkspaceProposalService(
          this.database,
          undefined,
          this.artifactsDirectory,
        );
        return {
          proposals,
          publication: new module.LocalWorkspacePublicationService(
            this.database,
            proposals,
            undefined,
            undefined,
            this.artifactsDirectory,
          ),
        };
      })
      .catch((error: unknown) => {
        this.service = null;
        throw error;
      });
    return this.service;
  }
}
