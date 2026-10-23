import type { FastifyInstance } from "fastify";

/** Adapts one group of routes; controllers are registered by the HTTP server at construction. */
export interface HttpController {
  register(routes: FastifyInstance): void;
}
