import type { FastifyRequest } from "fastify";
import type { RequestContext } from "../../shared/application/RequestContext.js";
import type { ActorResolver } from "./ActorResolver.js";

export class RequestContextFactory {
  constructor(private readonly actors: ActorResolver) {}
  create(request: FastifyRequest): RequestContext {
    return { requestId: request.id, actor: this.actors.resolve(request) };
  }
}
