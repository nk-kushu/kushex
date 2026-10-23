import type { ReadinessCheck, ReadinessCheckResult } from "../../app/health/ReadinessCheck.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

export class DatabaseReadinessCheck implements ReadinessCheck {
  readonly name = "database";

  constructor(private readonly client: PrismaClient) {}

  async check(): Promise<ReadinessCheckResult> {
    await this.client.$queryRaw`SELECT 1`;
    return { ready: true };
  }
}
