export { createCodingAgent } from "./composition/createCodingAgent";
export type { CodingAgentOptions, CodingCheck } from "./CodingAgentOptions";

// Context compression. Opt in with `compression: { enabled: true }` in CodingAgentOptions;
// these exports let a host substitute its own policy, provider or verifier.
export { CompressingCodingSessions } from "./context/CompressingCodingSessions";
export { CompressingCodingTurn } from "./context/CompressingCodingTurn";
export { ConversationByteSizer } from "./context/ConversationByteSizer";
export { DedupingSummaryAcceptance } from "./context/DedupingSummaryAcceptance";
export { LedgerSnapshotPublisher } from "./context/LedgerSnapshotPublisher";
export { LedgerSnapshotVerifier } from "./context/LedgerSnapshotVerifier";
export { RecentWindowCompressionPolicy } from "./context/RecentWindowCompressionPolicy";
export { RepeatedObservationSummaryProvider } from "./context/RepeatedObservationSummaryProvider";
export { SessionContextLedger } from "./context/SessionContextLedger";
export { createCodingCompression } from "./context/createCodingCompression";
export type { CodingCompressionSettings } from "./context/createCodingCompression";
