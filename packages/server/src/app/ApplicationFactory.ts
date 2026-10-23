import { fileURLToPath } from "node:url";
import { type Logger as PinoLogger, pino } from "pino";
import type { ServerConfig } from "../config/ServerConfig.js";
import { DatabaseReadinessCheck } from "../infrastructure/database/DatabaseReadinessCheck.js";
import { PrismaDatabase } from "../infrastructure/database/PrismaDatabase.js";
import { PrismaMigrationReadinessCheck } from "../infrastructure/database/PrismaMigrationReadinessCheck.js";
import { ErrorResponder } from "../transport/http/ErrorResponder.js";
import { HealthController } from "../transport/http/HealthController.js";
import { HttpServer } from "../transport/http/HttpServer.js";
import { Application } from "./Application.js";
import { ReadinessProbe } from "./health/ReadinessProbe.js";

/** Readiness must answer within the Compose probe timeout (3 s). */
const READINESS_TIMEOUT_MS = 2000;

/** Composition root: selects concrete implementations and wires them together. */
export class ApplicationFactory {
  readonly logger: PinoLogger;

  constructor(
    private readonly config: ServerConfig,
    /** Resolved relative to the package root in both `src/app` and `dist/app`. */
    private readonly migrationsDirectory = fileURLToPath(
      new URL("../../prisma/migrations/", import.meta.url),
    ),
  ) {
    this.logger = pino({ level: config.logLevel, base: { service: "kushex-server" } });
  }

  createServer(): Application {
    const database = new PrismaDatabase(this.config.database, this.logger);
    const readiness = new ReadinessProbe(
      [
        new DatabaseReadinessCheck(database.client),
        new PrismaMigrationReadinessCheck(database.client, this.migrationsDirectory),
      ],
      READINESS_TIMEOUT_MS,
      this.logger,
    );
    const http = new HttpServer(this.config.http, this.logger, new ErrorResponder(this.logger), [
      new HealthController(readiness),
    ]);
    return new Application([database, http], this.config.shutdownTimeoutMs, this.logger);
  }
}
