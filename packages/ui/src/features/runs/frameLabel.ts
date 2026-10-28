import type { DebugCallFrameDto } from "@kushex/contracts";

/** `agent.ts:13`, or the script's file name for code outside the agent. */
export function locationLabel(location: DebugCallFrameDto["location"]): string {
  const file = location.file ?? location.url.split("/").at(-1) ?? location.url;
  return `${file}:${location.line}`;
}

/** `chat (agent.ts:13)`. */
export const frameLabel = (frame: DebugCallFrameDto) =>
  `${frame.name} (${locationLabel(frame.location)})`;
