import { Tabs, Typography } from "antd";

export function BottomPanel() {
  return (
    <div className="kx:h-full kx:overflow-auto kx:bg-surface kx:px-3">
      <Tabs
        size="small"
        items={[
          { key: "problems", label: "Problems", children: <Typography.Text type="secondary">No problems</Typography.Text> },
          { key: "output", label: "Output", children: <Typography.Text type="secondary">No output</Typography.Text> },
        ]}
      />
    </div>
  );
}
