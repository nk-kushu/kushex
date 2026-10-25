import { useProjectQuery, useProjectsQuery } from "../../shared/api/kushexApi";
import { Avatar, Button, Input, Select, Tooltip, Typography } from "antd";
import { IconMoon, IconSun, IconSunMoon } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { AppIcon } from "../../shared/components/AppIcon";
import { SearchIcon, SettingsIcon, UserIcon } from "../../shared/lib/icons";
import { borderB } from "../../shared/lib/styles";
import { colorModeChanged, selectColorMode, type ColorMode } from "../settings/settingsSlice";
import { paths, useOpenProject } from "./navigation";
import { selectProjectId } from "./workbenchSlice";

const nextColorMode: Readonly<Record<ColorMode, ColorMode>> = {
  light: "dark",
  dark: "system",
  system: "light",
};
const colorModeIcon = { light: IconSun, dark: IconMoon, system: IconSunMoon } as const;

export function TopBar({ compact }: Readonly<{ compact?: boolean }>) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const openProject = useOpenProject();
  const project = useAppSelector(selectProjectId);
  const projects = useProjectsQuery(0);
  const selected = useProjectQuery(project ?? "", { skip: !project });
  const choices = [...(projects.data?.entries ?? [])];
  const selectedProject = selected.data;
  if (selectedProject && !choices.some((entry) => entry.id === selectedProject.id))
    choices.push(selectedProject);
  const colorMode = useAppSelector(selectColorMode);

  return (
    <header
      className={`kx:flex kx:h-12 kx:shrink-0 kx:items-center kx:gap-3 kx:bg-surface kx:px-3 ${borderB}`}
    >
      <Typography.Text strong className="kx:shrink-0">
        Kushex
      </Typography.Text>
      <Select
        aria-label="Project"
        size="small"
        placeholder="Project"
        value={project ?? undefined}
        onChange={openProject}
        options={choices.map((project) => ({ value: project.id, label: project.name }))}
        className="kx:w-44"
      />
      {!compact && (
        <Input
          aria-label="Search"
          size="small"
          placeholder="Search"
          prefix={<AppIcon icon={SearchIcon} size="sm" />}
          className="kx:mx-auto kx:max-w-sm"
        />
      )}
      <div className="kx:ml-auto kx:flex kx:items-center kx:gap-1">
        <Tooltip title={`Color mode: ${colorMode}`}>
          <Button
            type="text"
            onClick={() => dispatch(colorModeChanged(nextColorMode[colorMode]))}
            icon={<AppIcon icon={colorModeIcon[colorMode]} label={`Color mode: ${colorMode}`} />}
          />
        </Tooltip>
        <Button
          type="text"
          onClick={() => void navigate(paths.settings())}
          icon={<AppIcon icon={SettingsIcon} label="Settings" />}
        />
        <Avatar size="small" icon={<AppIcon icon={UserIcon} size="sm" />} />
      </div>
    </header>
  );
}
