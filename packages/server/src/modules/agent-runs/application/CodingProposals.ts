import type { CodingProposalReviewDto, CodingPublicationResultDto } from "@kushex/contracts";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { ConflictError } from "../../../errors/ConflictError.js";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { ChatThreads } from "../../chat-threads/ChatThreads.js";
import type { WorkspaceService, WorkspacePathResolver } from "../../workspaces/public.js";
import type { LocalWorkspaceProposalService, LocalWorkspacePublicationService } from "kushibot";

/** Resolves the authorized run and workspace before preparing a durable proposal. */
export class CodingProposals {
  private readonly operations = new Map<string, Promise<unknown>>();
  constructor(
    private readonly threads: ChatThreads,
    private readonly workspaces: WorkspaceService,
    private readonly paths: WorkspacePathResolver,
    private readonly proposals: Pick<LocalWorkspaceProposalService, "create" | "review">,
    private readonly publication: Pick<LocalWorkspacePublicationService, "apply" | "reconcile">,
  ) {}

  async create(context: RequestContext, projectId: string, runId: string): Promise<unknown> {
    const input = await this.input(context, projectId, runId);
    return this.serial(input.workspace, async () => this.proposals.create(input));
  }

  async review(
    context: RequestContext,
    projectId: string,
    runId: string,
  ): Promise<CodingProposalReviewDto> {
    const input = await this.input(context, projectId, runId);
    return this.serial(input.workspace, async () => {
      const review = await this.proposals.review(input);
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
      const review = await this.proposals.review(input);
      if (!review || review.digest !== digest)
        throw new ConflictError("The proposal no longer matches the reviewed changes.");
      return reconcileOnly
        ? this.publication.reconcile(input, digest, context.actor.id)
        : this.publication.apply(input, digest, context.actor.id);
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
}
