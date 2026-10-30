import type { SplitterSizesDto, UserSettingsDto, UpdateUserSettingsRequest } from "@kushex/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { SettingsRepository } from "../application/SettingsRepository.js";

const select = { colorMode: true, density: true, editorFontSize: true, noteFontSize: true, splitterSizes: true } as const;

type Row = Omit<UserSettingsDto, "splitterSizes"> & { splitterSizes: unknown };

/** The column is only written through validated requests, so its shape is trusted. */
const toDto = (row: Row): UserSettingsDto => ({
  ...row,
  splitterSizes: row.splitterSizes as SplitterSizesDto,
});

export class PrismaSettingsRepository implements SettingsRepository {
  constructor(private readonly client: PrismaClient) {}

  async find(actorId: string): Promise<UserSettingsDto | null> {
    const row = await this.client.userSettings.findUnique({ where: { actorId }, select });
    return row && toDto(row);
  }

  update(actorId: string, { splitterSizes, ...fields }: UpdateUserSettingsRequest): Promise<UserSettingsDto> {
    return this.client.$transaction(async (tx) => {
      if (splitterSizes) {
        // jsonb `||` merges by splitter id in one statement, so concurrent saves of different splitters both land.
        await tx.$executeRaw`
          INSERT INTO "kushex"."UserSettings" ("actorId", "splitterSizes", "updatedAt")
          VALUES (${actorId}, ${JSON.stringify(splitterSizes)}::jsonb, now())
          ON CONFLICT ("actorId") DO UPDATE
          SET "splitterSizes" = "UserSettings"."splitterSizes" || EXCLUDED."splitterSizes",
              "updatedAt" = now()`;
      }
      // One database upsert preserves omitted fields, including concurrent first writes.
      const row = await tx.userSettings.upsert({
        where: { actorId },
        create: { actorId, ...fields },
        update: fields,
        select,
      });
      return toDto(row);
    });
  }
}
