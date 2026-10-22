import { createListenerMiddleware, isAnyOf, type TypedStartListening } from "@reduxjs/toolkit";
import { colorModeChanged, densityChanged } from "../features/settings/settingsSlice";
import { savePreferences } from "./preferences";
import type { StoreOptions } from "./storeOptions";
import type { AppDispatch, RootState } from "./store";

/** One listener middleware per store: no listeners are shared between panel instances. */
export function createListeners(options: StoreOptions) {
  const listenerMiddleware = createListenerMiddleware();
  const startListening = listenerMiddleware.startListening as TypedStartListening<RootState, AppDispatch>;

  startListening({
    matcher: isAnyOf(colorModeChanged, densityChanged),
    effect: (_action, api) => {
      if (options.instanceId) savePreferences(options.instanceId, api.getState().settings);
    },
  });

  return listenerMiddleware;
}
