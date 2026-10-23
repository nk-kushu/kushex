import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ReadinessCheck, ReadinessCheckResult } from "../../app/health/ReadinessCheck.js";
import { ReadinessProbe } from "../../app/health/ReadinessProbe.js";
import { ErrorResponder } from "./ErrorResponder.js";
import { HealthController } from "./HealthController.js";
import type { HttpController } from "./HttpController.js";
import { HttpServer } from "./HttpServer.js";

const logger = pino({ level: "silent" });

class StubCheck implements ReadinessCheck {
  constructor(
    readonly name: string,
    private readonly result: ReadinessCheckResult,
  ) {}

  async check(): Promise<ReadinessCheckResult> {
    return this.result;
  }
}

class ExampleController implements HttpController {
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

describe("HttpServer", () => {
  let server: HttpServer | undefined;

  afterEach(async () => {
    await server?.stop(new AbortController().signal);
    server = undefined;
  });

  async function start(checks: readonly ReadinessCheck[] = []): Promise<string> {
    const readiness = new ReadinessProbe(checks, 1000, logger);
    server = new HttpServer({ host: "127.0.0.1", port: 0 }, logger, new ErrorResponder(logger), [
      new HealthController(readiness),
      new ExampleController(),
    ]);
    await server.start();
    return `http://127.0.0.1:${server.port}`;
  }

  it("reports liveness independently of readiness", async () => {
    const base = await start([new StubCheck("database", { ready: false, reason: "down" })]);

    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({ status: "ok" });
    expect((await fetch(`${base}/health`, { method: "HEAD" })).status).toBe(200);
  });

  it("reports readiness from all checks", async () => {
    const ready = await start([new StubCheck("database", { ready: true })]);
    const okResponse = await fetch(`${ready}/health/ready`);
    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({
      status: "ready",
      checks: { database: { ready: true } },
    });
  });

  it("returns 503 with failing check reasons when not ready", async () => {
    const base = await start([
      new StubCheck("database", { ready: true }),
      new StubCheck("migrations", { ready: false, reason: "1 pending migration(s)." }),
    ]);
    const response = await fetch(`${base}/health/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      checks: {
        database: { ready: true },
        migrations: { ready: false, reason: "1 pending migration(s)." },
      },
    });
  });

  it("rejects other methods on health routes with 405", async () => {
    const base = await start();
    const response = await fetch(`${base}/health`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(await response.json()).toEqual({
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed.",
    });
  });

  it("returns a consistent 404 body for unknown routes", async () => {
    const base = await start();
    const response = await fetch(`${base}/missing?x=1`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      message: "Route GET /missing not found.",
    });
  });

  it("validates request bodies with Zod and passes parsed values to handlers", async () => {
    const base = await start();
    const post = (body: string) =>
      fetch(`${base}/examples`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

    const valid = await post(JSON.stringify({ name: "a", count: "3" }));
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ received: { name: "a", count: 3 } });

    const invalid = await post(JSON.stringify({ name: "" }));
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as { details: { path: string }[] };
    expect(body).toMatchObject({ code: "VALIDATION_FAILED", message: "Request body is invalid." });
    expect(body.details.map((detail) => detail.path)).toEqual(["name", "count"]);
  });

  it("maps malformed JSON to a 400 error body", async () => {
    const base = await start();
    const response = await fetch(`${base}/examples`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("hides unexpected error details behind a 500 response", async () => {
    const base = await start();
    const response = await fetch(`${base}/explode`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });
});
