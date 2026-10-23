export type ReadinessCheckResult = Readonly<{ ready: true } | { ready: false; reason: string }>;

/** One dependency that must be usable before the server accepts application traffic. */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<ReadinessCheckResult>;
}
