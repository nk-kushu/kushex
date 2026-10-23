import { Button, Card, Typography } from "antd";
import { useAppDispatch } from "../../app/hooks";
import { AppIcon } from "../../shared/components/AppIcon";
import { AddIcon } from "../../shared/lib/icons";
import { projectOpened } from "../workbench/workbenchSlice";

const projects = ["Project one", "Project two", "Project three"];

export function ProjectsScreen() {
  const dispatch = useAppDispatch();
  return (
    <div className="kx:h-full kx:overflow-auto kx:p-6">
      <div className="kx:mb-6 kx:flex kx:items-center kx:justify-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Projects
        </Typography.Title>
        <Button type="primary" icon={<AppIcon icon={AddIcon} />}>
          New project
        </Button>
      </div>
      <div className="kx:grid kx:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] kx:gap-4">
        {projects.map((name) => (
          <Card key={name} hoverable onClick={() => dispatch(projectOpened(name))} role="button" aria-label={`Open ${name}`}>
            <Card.Meta title={name} description="description" />
            <div className="kx:h-10" />
          </Card>
        ))}
      </div>
    </div>
  );
}
