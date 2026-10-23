import { Badge, Typography } from "antd";
import { useAppSelector } from "../../app/hooks";
import { borderT } from "../../shared/lib/styles";
import { selectProjectName } from "./workbenchSlice";

export function StatusBar() {
  const project = useAppSelector(selectProjectName);
  return (
    <footer role="status" className={`kx:flex kx:h-7 kx:shrink-0 kx:items-center kx:gap-6 kx:bg-surface kx:px-3 kx:text-xs ${borderT}`}>
      <Badge status="success" text={<span className="kx:text-xs">connected</span>} />
      <Typography.Text type="secondary" className="kx:text-xs">
        {project ? `${project} · main` : "no project"}
      </Typography.Text>
      <Typography.Text type="secondary" className="kx:mx-auto kx:text-xs">
        agent: idle
      </Typography.Text>
      <Typography.Text type="secondary" className="kx:text-xs kx:tabular-nums">
        Ln 12, Col 4
      </Typography.Text>
    </footer>
  );
}
