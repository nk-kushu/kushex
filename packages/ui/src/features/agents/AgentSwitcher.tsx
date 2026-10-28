import { Dropdown, Typography } from "antd";
import { IconCheck, IconLayoutGrid, IconPlus, IconSelector } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useAgentsQuery } from "../../shared/api/kushexApi";
import { paths } from "../workbench/navigation";
import { AgentBadge } from "./AgentsHome";
import { CreateAgentDialog } from "./CreateAgentDialog";

/** The explorer's title: the open agent, and a menu to switch to or create another. */
export function AgentSwitcher({ name }: Readonly<{ name: string }>) {
  const navigate = useNavigate();
  const agents = useAgentsQuery();
  const [creating, setCreating] = useState(false);
  const open = (agent: string) => void navigate(paths.agents(agent));

  return (
    <>
      <Dropdown
        trigger={["click"]}
        menu={{
          onClick: ({ key }) => {
            if (key === "new") setCreating(true);
            else if (key === "all") void navigate(paths.agents());
            else open(key.replace(/^agent:/, ""));
          },
          items: [
            {
              type: "group",
              label: "Switch agent",
              children: (agents.data?.entries ?? []).map((agent) => ({
                key: `agent:${agent.name}`,
                label: `${agent.displayName ?? agent.name}${agent.plugin ? ` · ${agent.plugin.name}` : ""}`,
                extra: agent.name === name ? <IconCheck size={14} /> : undefined,
              })),
            },
            { type: "divider" },
            { key: "new", label: "New agent…", icon: <IconPlus size={14} /> },
            { key: "all", label: "All agents", icon: <IconLayoutGrid size={14} /> },
          ],
        }}
      >
        <button
          type="button"
          aria-label={`Agent ${name}, switch agent`}
          className="kx:flex kx:w-full kx:min-w-0 kx:cursor-pointer kx:items-center kx:gap-2.5 kx:border-0 kx:bg-transparent kx:px-3 kx:py-2 kx:text-left kx:hover:bg-fill"
        >
          <AgentBadge />
          <span className="kx:flex kx:min-w-0 kx:flex-1 kx:flex-col">
            <Typography.Text strong className="kx:truncate kx:leading-tight">
              {name}
            </Typography.Text>
            <Typography.Text
              type="secondary"
              className="kx:truncate kx:text-[11px] kx:leading-tight"
            >
              {agents.data?.entries.find((agent) => agent.name === name)?.plugin?.name ??
                `agents/${name}`}
            </Typography.Text>
          </span>
          <span aria-hidden className="kx:inline-flex kx:text-text-muted">
            <IconSelector size={16} />
          </span>
        </button>
      </Dropdown>
      {creating && (
        <CreateAgentDialog
          onClose={() => setCreating(false)}
          onCreated={(agent) => {
            setCreating(false);
            open(agent);
          }}
        />
      )}
    </>
  );
}
