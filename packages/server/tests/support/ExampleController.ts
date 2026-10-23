import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../src/transport/http/HttpController.js";

export class ExampleController implements HttpController {
  register(routes: FastifyInstance): void {
    routes.post(
      "/examples",
      { schema: { body: z.object({ name: z.string().min(1), count: z.coerce.number().int() }) } },
      async (request) => ({ received: request.body }),
    );
    routes.get("/explode", async () => {
      throw new Error("database password is hunter2");
    });
  }
}
