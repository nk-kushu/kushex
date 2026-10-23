import { Empty } from "antd";

export function EmptyMain({ text }: Readonly<{ text: string }>) {
  return (
    <div className="kx:flex kx:h-full kx:items-center kx:justify-center kx:bg-surface">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />
    </div>
  );
}
