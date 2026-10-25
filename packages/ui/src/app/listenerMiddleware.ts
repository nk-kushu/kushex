import type { UpdateUserSettingsRequest, UserSettingsDto } from "@kushex/contracts";
import { createListenerMiddleware, isAnyOf, type TypedStartListening } from "@reduxjs/toolkit";
import {
  colorModeChanged,
  densityChanged,
  splitterSizesChanged,
  settingsRequested,
  settingsSaveRetried,
  settingsLoaded,
  settingsLoadFailed,
  settingsSaveErrorChanged,
} from "../features/settings/settingsSlice";
import { kushexApi } from "../shared/api/kushexApi";
import type { AppDispatch, RootState } from "./store";

/** Hydration and save ordering belong to one panel store. */
export function createListeners() {
  const listenerMiddleware = createListenerMiddleware();
  const startListening = listenerMiddleware.startListening as TypedStartListening<
    RootState,
    AppDispatch
  >;
  const edited = new Set<keyof UserSettingsDto>();
  const failed = new Set<keyof UserSettingsDto>();
  let loading = false;
  let loaded = false;
  let saves = Promise.resolve();

  startListening({
    actionCreator: settingsRequested,
    effect: async (_action, api) => {
      if (loading || loaded) return;
      loading = true;
      const request = api.dispatch(
        kushexApi.endpoints.settings.initiate(undefined, { subscribe: false, forceRefetch: true }),
      );
      try {
        const settings = await request.unwrap();
        api.dispatch(
          settingsLoaded({
            ...(!edited.has("colorMode") ? { colorMode: settings.colorMode } : {}),
            ...(!edited.has("density") ? { density: settings.density } : {}),
            // Splitters moved before the load finished keep their local sizes.
            splitterSizes: { ...settings.splitterSizes, ...api.getState().settings.splitterSizes },
          }),
        );
        loaded = true;
      } catch {
        api.dispatch(settingsLoadFailed());
      } finally {
        loading = false;
      }
    },
  });

  startListening({
    matcher: isAnyOf(colorModeChanged, densityChanged, splitterSizesChanged, settingsSaveRetried),
    effect: (action, api) => {
      const state = api.getState().settings;
      const patch: UpdateUserSettingsRequest = colorModeChanged.match(action)
        ? { colorMode: action.payload }
        : densityChanged.match(action)
          ? { density: action.payload }
          : splitterSizesChanged.match(action)
            ? { splitterSizes: { [action.payload.id]: action.payload.sizes } }
            : {
                ...(failed.has("colorMode") ? { colorMode: state.colorMode } : {}),
                ...(failed.has("density") ? { density: state.density } : {}),
                // The server merges by id, so resending every splitter is safe.
                ...(failed.has("splitterSizes") ? { splitterSizes: state.splitterSizes } : {}),
              };
      const fields = Object.keys(patch) as (keyof UserSettingsDto)[];
      if (!fields.length) return;
      fields.forEach((field) => edited.add(field));
      // Save only changed fields, and send successive edits in dispatch order.
      saves = saves.then(async () => {
        const request = api.dispatch(kushexApi.endpoints.updateSettings.initiate(patch));
        try {
          await request.unwrap();
          fields.forEach((field) => failed.delete(field));
        } catch {
          fields.forEach((field) => failed.add(field));
        } finally {
          request.reset();
          api.dispatch(settingsSaveErrorChanged(failed.size > 0));
        }
      });
    },
  });

  return listenerMiddleware;
}
