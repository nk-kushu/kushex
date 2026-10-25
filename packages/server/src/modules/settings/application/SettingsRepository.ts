import type { UserSettingsDto, UpdateUserSettingsRequest } from "@kushex/contracts";

export interface SettingsRepository {
  find(actorId: string): Promise<UserSettingsDto | null>;
  /** Omitted fields keep their value; `splitterSizes` merges into the saved map by id. */
  update(actorId: string, input: UpdateUserSettingsRequest): Promise<UserSettingsDto>;
}
