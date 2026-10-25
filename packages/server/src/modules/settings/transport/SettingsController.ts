import type { UpdateUserSettingsRequest } from "@kushex/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../../transport/http/RequestContextFactory.js";
import type { SettingsService } from "../application/SettingsService.js";

export class SettingsController implements HttpController {
  constructor(
    private readonly settings: SettingsService,
    private readonly contexts: RequestContextFactory,
  ) {}

  register(routes: FastifyInstance): void {
    routes.get("/settings", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return this.settings.find(this.contexts.create(request));
    });
    routes.patch<{ Body: UpdateUserSettingsRequest }>(
      "/settings",
      {
        schema: {
          body: z
            .object({
              colorMode: z.enum(["system", "light", "dark"]).optional(),
              density: z.enum(["comfortable", "compact"]).optional(),
              splitterSizes: z
                .record(
                  z.string().regex(/^[a-z0-9:-]{1,64}$/),
                  z.array(z.number().min(0).max(1)).min(2).max(8),
                )
                .refine((sizes) => Object.keys(sizes).length <= 32, {
                  message: "At most 32 splitters per request.",
                })
                .optional(),
            })
            .strict()
            .refine((input) => Object.keys(input).length > 0, {
              message: "At least one setting is required.",
            }),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.settings.update(this.contexts.create(request), request.body);
      },
    );
  }
}
