import { Typography } from "antd";
import { useAppSelector } from "../../app/hooks";
import { useProjectQuery } from "../../shared/api/kushexApi";
import { borderT } from "../../shared/lib/styles";
import { selectProjectId } from "./workbenchSlice";

export function StatusBar() {
  const projectId = useAppSelector(selectProjectId);
  const { data: project } = useProjectQuery(projectId ?? "", { skip: !projectId });
  return (
    <footer
      role="status"
      className={`kx:flex kx:h-7 kx:shrink-0 kx:items-center kx:gap-6 kx:bg-surface kx:px-3 kx:text-xs ${borderT}`}
    >
      <Typography.Text type="secondary" className="kx:text-xs">
        {project
          ? `${project.name} · ${project.workspace.path}`
          : projectId
            ? "Workspace selected"
            : "no project"}
      </Typography.Text>
      <Typography.Text type="secondary" className="kx:ml-auto kx:text-xs">
        Project workspace
      </Typography.Text>
    </footer>
  );
}
