import type { UserSettingsDto, UpdateUserSettingsRequest } from "@kushex/contracts";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { SettingsRepository } from "./SettingsRepository.js";

export class SettingsService {
  constructor(private readonly settings: SettingsRepository) {}

  async find(context: RequestContext): Promise<UserSettingsDto> {
    return (
      (await this.settings.find(context.actor.id)) ?? {
        colorMode: "system",
        density: "comfortable",
        splitterSizes: {},
      }
    );
  }

  update(context: RequestContext, input: UpdateUserSettingsRequest): Promise<UserSettingsDto> {
    return this.settings.update(context.actor.id, input);
  }
}
