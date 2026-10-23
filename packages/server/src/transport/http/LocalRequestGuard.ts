import type { FastifyRequest } from "fastify";
import { ForbiddenError } from "../../errors/ForbiddenError.js";
import { HttpError } from "../../errors/HttpError.js";

/** Checks the original Host (never forwarded headers) and exact browser origins. */
export class LocalRequestGuard {
  private readonly origins: ReadonlySet<string>;
  private readonly hosts: ReadonlySet<string>;

  constructor(origins: readonly string[]) {
    this.origins = new Set(origins);
    this.hosts = new Set([
      "localhost",
      "127.0.0.1",
      "[::1]",
      ...origins.map((origin) => new URL(origin).hostname),
    ]);
  }

  check(request: FastifyRequest): void {
    const host = request.headers.host;
    let hostname: string;
    try {
      if (!host || /[\s/@\\?#]/.test(host)) throw new Error();
      const url = new URL(`http://${host}`);
      hostname = url.hostname;
    } catch {
      throw new ForbiddenError("Untrusted request host.");
    }
    if (!this.hosts.has(hostname)) throw new ForbiddenError("Untrusted request host.");
    const origin = request.headers.origin;
    if (origin !== undefined && !this.origins.has(origin))
      throw new ForbiddenError("Untrusted request origin.");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.headers["sec-fetch-site"] === "cross-site")
        throw new ForbiddenError("Cross-site requests are not allowed.");
      if (
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      ) {
        throw new HttpError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Mutating requests require application/json.",
        );
      }
    }
  }
}
