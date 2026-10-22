import { combineSlices, configureStore } from "@reduxjs/toolkit";
import { settingsSlice } from "../features/settings/settingsSlice";
import { createListeners } from "./listenerMiddleware";
import type { StoreOptions } from "./storeOptions";

const rootReducer = combineSlices(settingsSlice);

export type RootState = ReturnType<typeof rootReducer>;

export type MakeStoreOptions = StoreOptions & Readonly<{ preloadedState?: Partial<RootState> }>;

/** Created per panel instance, never as a module-level singleton. */
export function makeStore({ preloadedState, ...options }: MakeStoreOptions) {
  const listeners = createListeners(options);
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefault) => getDefault({ thunk: { extraArgument: options } }).prepend(listeners.middleware),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore["dispatch"];
export type { StoreOptions };
