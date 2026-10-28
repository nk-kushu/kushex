import type { FastifyInstance } from "fastify";
import type { HttpController } from "../../transport/http/HttpController.js";
import { NotFoundError } from "../../errors/NotFoundError.js";
import type { PluginCatalog } from "./PluginCatalog.js";

export class PluginsController implements HttpController {
  constructor(private readonly catalog: PluginCatalog) {}
  register(routes: FastifyInstance): void {
    routes.get("/plugins", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return { entries: this.catalog.plugins(), nextOffset: null };
    });
    routes.get<{ Params: { id: string } }>("/plugins/:id", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const plugin = this.catalog.plugins().find((entry) => entry.id === request.params.id);
      if (!plugin) throw new NotFoundError("Plugin not found.");
      return plugin;
    });
  }
}
