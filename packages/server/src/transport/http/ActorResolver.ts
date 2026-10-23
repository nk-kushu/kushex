import type { FastifyRequest } from "fastify";
import type { Actor } from "../../shared/application/Actor.js";

export interface ActorResolver {
  resolve(request: FastifyRequest): Actor;
}
