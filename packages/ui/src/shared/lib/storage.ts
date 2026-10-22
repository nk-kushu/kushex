/** localStorage that never throws (private mode, blocked storage, sandboxed iframes). */
export const safeStorage = {
  read(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  write(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Preferences are a convenience; losing them is acceptable.
    }
  },
};
