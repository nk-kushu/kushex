import { Button } from "antd";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { AppIcon } from "../../../shared/components/AppIcon";
import { borderB, borderT } from "../../../shared/lib/styles";

/**
 * A collapsible view of the debug side panel, like VS Code's Variables or Call Stack.
 * Open sections share the panel's height.
 */
export function DebugSection({
  label,
  title = label,
  actions,
  children,
}: Readonly<{
  /** The section's accessible name. */
  label: string;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(true);
  return (
    <section
      aria-label={label}
      className={`kx:flex kx:flex-col kx:bg-surface ${borderT} ${
        open ? "kx:min-h-24 kx:flex-1 kx:basis-0" : "kx:shrink-0"
      }`}
    >
      <div
        className={`kx:flex kx:h-8 kx:shrink-0 kx:items-center kx:gap-1 kx:pr-1 ${open ? borderB : ""}`}
      >
        <Button
          type="text"
          size="small"
          aria-expanded={open}
          className="kx:flex-1 kx:justify-start kx:text-xs kx:font-semibold kx:uppercase"
          onClick={() => setOpen(!open)}
          icon={<AppIcon icon={open ? IconChevronDown : IconChevronRight} size="sm" />}
        >
          {title}
        </Button>
        {actions}
      </div>
      {open && <div className="kx:min-h-0 kx:flex-1 kx:overflow-auto kx:p-1">{children}</div>}
    </section>
  );
}
