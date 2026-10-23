/** Options every store instance is created with. */
export type StoreOptions = Readonly<{
  /** Key for persisted preferences, so two panels on one page don't share them. */
  instanceId?: string;
  /** Same-origin API prefix. Default /api. */
  apiBaseUrl?: string;
}>;
