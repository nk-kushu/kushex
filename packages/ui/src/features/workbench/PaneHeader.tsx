import { Typography } from "antd";
import type { ReactNode } from "react";
import { borderB } from "../../shared/lib/styles";

/** Small uppercase title row at the top of the side view and chat panel. */
export function PaneHeader({ title, extra }: Readonly<{ title: ReactNode; extra?: ReactNode }>) {
  return (
    <div className={`kx:flex kx:h-10 kx:shrink-0 kx:items-center kx:justify-between kx:gap-2 kx:px-3 ${borderB}`}>
      <Typography.Text type="secondary" strong className="kx:text-xs kx:tracking-wide kx:uppercase">
        {title}
      </Typography.Text>
      {extra && <div className="kx:flex kx:items-center kx:gap-1">{extra}</div>}
    </div>
  );
}
