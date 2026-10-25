import { Button, Tooltip } from "antd";
import type { Icon } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { useAppSelector } from "../../app/hooks";
import { AppIcon } from "../../shared/components/AppIcon";
import { FilesIcon, NotesIcon, ProjectsIcon, SettingsIcon, TasksIcon } from "../../shared/lib/icons";
import { borderR } from "../../shared/lib/styles";
import { paths, useActivity, type Activity } from "./navigation";
import { selectProjectId } from "./workbenchSlice";

const top: readonly { key: Activity; label: string; icon: Icon }[] = [
  { key: "projects", label: "Projects", icon: ProjectsIcon },
  { key: "files", label: "Files", icon: FilesIcon },
  { key: "tasks", label: "Tasks", icon: TasksIcon },
  { key: "notes", label: "Notes", icon: NotesIcon },
];

function ActivityButton({ item }: Readonly<{ item: { key: Activity; label: string; icon: Icon } }>) {
  const navigate = useNavigate();
  const projectId = useAppSelector(selectProjectId);
  const active = useActivity() === item.key;
  return (
    <Tooltip title={item.label} placement="right">
      <Button
        type={active ? "primary" : "text"}
        size="large"
        aria-pressed={active}
        onClick={() => void navigate(item.key === "files" ? paths.files(projectId) : paths[item.key]())}
        icon={<AppIcon icon={item.icon} size="lg" label={item.label} />}
      />
    </Tooltip>
  );
}

export function ActivityBar() {
  return (
    <nav aria-label="Activities" className={`kx:flex kx:w-12 kx:shrink-0 kx:flex-col kx:items-center kx:gap-1 kx:bg-surface kx:py-2 ${borderR}`}>
      {top.map((item) => (
        <ActivityButton key={item.key} item={item} />
      ))}
      <div className="kx:mt-auto">
        <ActivityButton item={{ key: "settings", label: "Settings", icon: SettingsIcon }} />
      </div>
    </nav>
  );
}
