import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeStore } from "../../app/store";
import { FakeEventSource } from "../../test/mockApi";
import { RunTabSync } from "./RunTabSync";
import {
  breakpointToggled,
  breakpointsCleared,
  messageSent,
  refreshBreakpointPreferences,
  runStarted,
} from "./runsSlice";

/** Separate channels deliver asynchronous structured-clone messages, like browser tabs. */
class TabChannel {
  static peers = new Set<TabChannel>();
  static sent = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    TabChannel.peers.add(this);
  }
  postMessage(value: unknown) {
    TabChannel.sent++;
    for (const peer of TabChannel.peers) {
      if (peer !== this && peer.name === this.name) {
        const data = structuredClone(value);
        queueMicrotask(() => {
          if (TabChannel.peers.has(peer)) peer.onmessage?.({ data } as MessageEvent);
        });
      }
    }
  }
  close() {
    TabChannel.peers.delete(this);
  }
}

const cleanup: (() => void)[] = [];
const run = {
  id: "debug-run",
  agentName: "coding",
  projectId: "project",
  debug: true,
  status: "starting" as const,
  startedAt: "2026-10-26T00:00:00Z",
};

beforeEach(() => {
  TabChannel.peers.clear();
  TabChannel.sent = 0;
  FakeEventSource.instances.length = 0;
  vi.stubGlobal("BroadcastChannel", TabChannel);
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  for (const stream of FakeEventSource.instances)
    stream.emit({ type: "status", status: "completed" });
});

it("shares breakpoints between an already-open editor and chat without echo loops", async () => {
  const editor = makeStore({});
  const chat = makeStore({});
  cleanup.push(new RunTabSync(editor, {}).connect(), new RunTabSync(chat, {}).connect());
  editor.dispatch(breakpointToggled({ agentName: "coding", file: "agent.ts", line: 47 }));
  await waitFor(() =>
    expect(chat.getState().runs.breakpoints).toEqual({ coding: { "agent.ts": [47] } }),
  );
  chat.dispatch(messageSent({ projectId: "project", text: "debug", files: [], debug: true }));
  expect(JSON.parse(localStorage.getItem("kushex:default:runs")!).breakpoints).toEqual({
    coding: { "agent.ts": [47] },
  });
  editor.dispatch(breakpointsCleared("coding"));
  await waitFor(() => expect(chat.getState().runs.breakpoints).toEqual({}));
  expect(TabChannel.sent).toBe(4); // Two joins, one addition, one removal.
});

it("reads the latest saved breakpoints before a queued tab message arrives", () => {
  const chat = makeStore({});
  localStorage.setItem(
    "kushex:default:runs",
    JSON.stringify({ breakpoints: { coding: { "agent.ts": [47] } } }),
  );
  const selected = chat.dispatch(refreshBreakpointPreferences());
  expect(selected.coding).toEqual({ "agent.ts": [47] });
  chat.dispatch(messageSent({ projectId: "project", text: "debug", files: [], debug: true }));
  expect(JSON.parse(localStorage.getItem("kushex:default:runs")!).breakpoints.coding).toEqual({
    "agent.ts": [47],
  });
});

it("lets an editor tab follow a debug run started in the project tab", async () => {
  const editor = makeStore({});
  const chat = makeStore({});
  cleanup.push(new RunTabSync(editor, {}).connect(), new RunTabSync(chat, {}).connect());
  chat.dispatch(runStarted(run));
  await waitFor(() => expect(editor.getState().runs.debugRunId).toBe(run.id));
  expect(editor.getState().runs.chats.project?.entries).toHaveLength(1);
  expect(FakeEventSource.instances).toHaveLength(2);
  expect(TabChannel.sent).toBeLessThanOrEqual(4);
});

it("discovers an active debug session when the editor tab opens later", async () => {
  const chat = makeStore({});
  cleanup.push(new RunTabSync(chat, {}).connect());
  chat.dispatch(runStarted(run));
  const editor = makeStore({});
  cleanup.push(new RunTabSync(editor, {}).connect());
  await waitFor(() => expect(editor.getState().runs.debugRunId).toBe(run.id));
  expect(FakeEventSource.instances).toHaveLength(2);
});

it("keeps different panel instances and disconnected tabs isolated", async () => {
  const editor = makeStore({ instanceId: "first" });
  const other = makeStore({ instanceId: "second" });
  const disconnect = new RunTabSync(editor, { instanceId: "first" }).connect();
  cleanup.push(disconnect, new RunTabSync(other, { instanceId: "second" }).connect());
  editor.dispatch(breakpointToggled({ agentName: "coding", file: "agent.ts", line: 47 }));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(other.getState().runs.breakpoints).toEqual({});
  disconnect();
  const sent = TabChannel.sent;
  editor.dispatch(breakpointsCleared("coding"));
  expect(TabChannel.sent).toBe(sent);
});
