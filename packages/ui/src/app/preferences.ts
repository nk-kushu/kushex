import { safeStorage } from "../shared/lib/storage";
import { initialSettings, type SettingsState } from "../features/settings/settingsSlice";

const key = (instanceId: string) => `kushex:preferences:${instanceId}`;

/** Only preferences are persisted: color mode and density. */
export function loadPreferences(instanceId: string): SettingsState {
  const raw = safeStorage.read(key(instanceId));
  if (!raw) return initialSettings;
  try {
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return {
      colorMode: ["light", "dark", "system"].includes(parsed.colorMode as string)
        ? (parsed.colorMode as SettingsState["colorMode"])
        : initialSettings.colorMode,
      density: parsed.density === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return initialSettings;
  }
}

export function savePreferences(instanceId: string, settings: SettingsState): void {
  safeStorage.write(key(instanceId), JSON.stringify(settings));
}
