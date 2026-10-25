/** Options every store instance is created with. */
export type StoreOptions = Readonly<{
  /** Panel instance identifier; persisted settings are scoped to the backend user. */
  instanceId?: string;
  /** Same-origin API prefix. Default /api. */
  apiBaseUrl?: string;
}>;
