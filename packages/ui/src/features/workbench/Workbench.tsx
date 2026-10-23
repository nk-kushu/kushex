import { Grid, Segmented, Splitter } from "antd";
import { useState, type ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { borderT } from "../../shared/lib/styles";
import { ChatPanel } from "../chat/ChatPanel";
import { FilesMain } from "../files/FilesMain";
import { FilesSide } from "../files/FilesSide";
import { NotesMain } from "../notes/NotesMain";
import { NotesSide, notes } from "../notes/NotesSide";
import { ProjectsScreen } from "../projects/ProjectsScreen";
import { SettingsScreen } from "../settings/SettingsScreen";
import { TasksScreen } from "../tasks/TasksScreen";
import { ActivityBar } from "./ActivityBar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { activityChanged, mobileViewChanged, selectActivity, selectMobileView, type Activity, type MobileView } from "./workbenchSlice";

/** What each activity puts in the side view, main area and whether the chat panel shows. */
type Screen = Readonly<{ side?: ReactNode; main: ReactNode; chat: boolean }>;

function useScreen(activity: Activity, onMobileMain: () => void): Screen {
  const [note, setNote] = useState(notes[0]!.key);
  const noteTitle = notes.find((item) => item.key === note)?.title ?? "Note";
  switch (activity) {
    case "projects":
      return { main: <ProjectsScreen />, chat: false };
    case "files":
      return { side: <FilesSide />, main: <FilesMain />, chat: true };
    case "tasks":
      return { main: <TasksScreen />, chat: false };
    case "notes":
      return {
        side: (
          <NotesSide
            selected={note}
            onSelect={(key) => {
              setNote(key);
              onMobileMain();
            }}
          />
        ),
        main: <NotesMain key={note} title={noteTitle} />,
        chat: true,
      };
    case "settings":
      return { main: <SettingsScreen />, chat: false };
  }
}

function WideLayout({ screen }: Readonly<{ screen: Screen }>) {
  // Splitter reads `defaultSize` only on mount, so remount it when the set of panels changes.
  const panelSet = `${screen.side ? "side-" : ""}main${screen.chat ? "-chat" : ""}`;
  return (
    <div className="kx:flex kx:min-h-0 kx:flex-1">
      <ActivityBar />
      <Splitter key={panelSet} className="kx:min-w-0 kx:flex-1">
        {screen.side && (
          <Splitter.Panel defaultSize={240} min={160} max="40%" collapsible>
            {screen.side}
          </Splitter.Panel>
        )}
        <Splitter.Panel min={320}>
          <main className="kx:h-full">{screen.main}</main>
        </Splitter.Panel>
        {screen.chat && (
          <Splitter.Panel defaultSize={340} min={260} max="50%" collapsible>
            <ChatPanel />
          </Splitter.Panel>
        )}
      </Splitter>
    </div>
  );
}

type MobileTab = "projects" | "files" | "tasks" | "notes" | "chat";

function NarrowLayout({ screen, activity, view }: Readonly<{ screen: Screen; activity: Activity; view: MobileView }>) {
  const dispatch = useAppDispatch();
  const current: MobileTab = view === "chat" ? "chat" : activity === "settings" ? "projects" : activity;
  const region = view === "chat" ? <ChatPanel /> : view === "side" && screen.side ? screen.side : screen.main;
  const select = (tab: MobileTab) => {
    if (tab === "chat") return dispatch(mobileViewChanged("chat"));
    dispatch(activityChanged(tab));
    dispatch(mobileViewChanged(tab === "files" || tab === "notes" ? "side" : "main"));
  };
  return (
    <>
      <main className="kx:min-h-0 kx:flex-1 kx:overflow-auto">{region}</main>
      <nav aria-label="Sections" className={`kx:bg-surface kx:p-2 ${borderT}`}>
        <Segmented<MobileTab>
          block
          value={current}
          onChange={select}
          options={[
            { label: "Projects", value: "projects" },
            { label: "Files", value: "files" },
            { label: "Tasks", value: "tasks" },
            { label: "Notes", value: "notes" },
            { label: "Chat", value: "chat" },
          ]}
        />
      </nav>
    </>
  );
}

/** The panel's frame: top bar, activity bar, side view, main area, chat panel, status bar. */
export function Workbench() {
  const dispatch = useAppDispatch();
  const activity = useAppSelector(selectActivity);
  const view = useAppSelector(selectMobileView);
  const screens = Grid.useBreakpoint();
  const narrow = screens.md === false;
  const screen = useScreen(activity, () => dispatch(mobileViewChanged("main")));

  return (
    <div className="kx:flex kx:h-full kx:flex-col">
      <TopBar compact={narrow} />
      {narrow ? <NarrowLayout screen={screen} activity={activity} view={view} /> : <WideLayout screen={screen} />}
      {!narrow && <StatusBar />}
    </div>
  );
}
