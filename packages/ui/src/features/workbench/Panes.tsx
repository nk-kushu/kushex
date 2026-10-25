import { Grid, Splitter } from "antd";
import type { ReactNode } from "react";
import { useAppSelector } from "../../app/hooks";
import { ChatPanel } from "../chat/ChatPanel";
import { usePersistedSplitter } from "../settings/usePersistedSplitter";
import { selectMobileView } from "./workbenchSlice";

/** What a page puts in the side view, main area and whether the chat panel shows. */
type Screen = Readonly<{ side?: ReactNode; main: ReactNode; chat?: boolean }>;

export const useNarrow = () => Grid.useBreakpoint().md === false;

function WideLayout({ screen }: Readonly<{ screen: Screen }>) {
  // Splitter reads `defaultSize` only on mount, so remount it when the set of panels changes.
  const panelSet = `${screen.side ? "side-" : ""}main${screen.chat ? "-chat" : ""}`;
  // Each panel set saves its own sizes, so Files and Notes share one and Projects another.
  const { splitter, size } = usePersistedSplitter(`workbench:${panelSet}`, panelSet.split("-").length);
  const main = screen.side ? 1 : 0;
  return (
    <Splitter key={panelSet} className="kx:min-w-0 kx:flex-1" {...splitter}>
      {screen.side && (
        <Splitter.Panel size={size(0)} defaultSize={240} min={160} max="40%" collapsible>
          {screen.side}
        </Splitter.Panel>
      )}
      <Splitter.Panel size={size(main)} min={320}>
        <main className="kx:h-full">{screen.main}</main>
      </Splitter.Panel>
      {screen.chat && (
        <Splitter.Panel size={size(main + 1)} defaultSize={340} min={260} max="50%" collapsible>
          <ChatPanel />
        </Splitter.Panel>
      )}
    </Splitter>
  );
}

function NarrowLayout({ screen }: Readonly<{ screen: Screen }>) {
  const view = useAppSelector(selectMobileView);
  const region = view === "chat" ? <ChatPanel /> : view === "side" && screen.side ? screen.side : screen.main;
  return <main className="kx:min-w-0 kx:flex-1 kx:overflow-auto">{region}</main>;
}

/** Lays out one page: wide screens show its regions side by side, narrow ones one at a time. */
export function Panes(screen: Screen) {
  return useNarrow() ? <NarrowLayout screen={screen} /> : <WideLayout screen={screen} />;
}
