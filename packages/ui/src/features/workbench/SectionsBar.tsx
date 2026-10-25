import { Segmented } from "antd";
import { useNavigate } from "react-router";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { borderT } from "../../shared/lib/styles";
import { paths, useActivity } from "./navigation";
import { mobileViewChanged, selectMobileView, selectProjectId } from "./workbenchSlice";

type MobileTab = "projects" | "files" | "tasks" | "notes" | "chat";

/** Narrow screens switch pages, and the chat, from a bottom bar. */
export function SectionsBar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const activity = useActivity();
  const view = useAppSelector(selectMobileView);
  const projectId = useAppSelector(selectProjectId);
  const current: MobileTab = view === "chat" ? "chat" : activity === "settings" ? "projects" : activity;
  const select = (tab: MobileTab) => {
    if (tab === "chat") return dispatch(mobileViewChanged("chat"));
    void navigate(tab === "files" ? paths.files(projectId) : paths[tab]());
    dispatch(mobileViewChanged(tab === "files" || tab === "notes" ? "side" : "main"));
  };
  return (
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
  );
}
