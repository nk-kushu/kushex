import type { Icon as TablerIcon } from "@tabler/icons-react";
import { useTheme } from "antd-style";

type AppIconProps = Readonly<{
  icon: TablerIcon;
  size?: "sm" | "md" | "lg";
  /** Set when the icon is the only content (icon-only button); otherwise it is decorative. */
  label?: string;
}>;

/** All app icons go through here so size follows the antd theme and color is currentColor. */
export function AppIcon({ icon: Icon, size = "md", label }: AppIconProps) {
  const token = useTheme();
  const px = { sm: token.fontSizeSM, md: token.fontSize, lg: token.fontSizeLG }[size];
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="kx-icon kx:inline-flex">
      <Icon size={px + 2} stroke={1.75} />
    </span>
  );
}
