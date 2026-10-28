import { Alert, Button, Input, Spin, Typography } from "antd";
import { IconChevronRight, IconPlus, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { errorMessage } from "../../shared/api/errorMessage";
import { useAgentsQuery } from "../../shared/api/kushexApi";
import { AppIcon } from "../../shared/components/AppIcon";
import { AgentsIcon } from "../../shared/lib/icons";
import { borderAll } from "../../shared/lib/styles";
import { CreateAgentDialog } from "./CreateAgentDialog";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];
/** "3 days ago", "just now". */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const unit = UNITS.find(([, size]) => Math.abs(seconds) >= size);
  return unit ? relative.format(Math.round(seconds / unit[1]), unit[0]) : "just now";
}

export function AgentBadge({ size = "md" }: Readonly<{ size?: "sm" | "md" | "lg" }>) {
  const box = { sm: "kx:size-6", md: "kx:size-8", lg: "kx:size-10" }[size];
  return (
    <span
      aria-hidden
      className={`kx:inline-flex kx:shrink-0 kx:items-center kx:justify-center kx:bg-primary/12 kx:text-primary ${box}`}
    >
      <AppIcon icon={AgentsIcon} size={size === "sm" ? "sm" : "lg"} />
    </span>
  );
}

/** The Agents page without an agent open: every agent as a card, and creating one. */
export function AgentsHome({ onOpen }: Readonly<{ onOpen: (name: string) => void }>) {
  const agents = useAgentsQuery(undefined, { refetchOnMountOrArgChange: true });
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const entries = agents.data?.entries ?? [];
  const shown = entries.filter((agent) =>
    `${agent.name} ${agent.displayName ?? ""} ${agent.plugin?.name ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <div className="kx:h-full kx:overflow-auto kx:bg-surface-muted">
      <div className="kx:mx-auto kx:flex kx:max-w-4xl kx:flex-col kx:gap-6 kx:px-4 kx:py-8 kx:md:px-8">
        <header className="kx:flex kx:flex-wrap kx:items-end kx:justify-between kx:gap-4">
          <div>
            <Typography.Title level={3} className="kx:mb-1">
              Agents
            </Typography.Title>
            <Typography.Text type="secondary">
              Agents are code: each one is a folder of files you edit, run and debug here.
            </Typography.Text>
          </div>
          <Button type="primary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            New agent
          </Button>
        </header>

        {agents.isLoading && <Spin className="kx:self-center kx:p-8" aria-label="Loading agents" />}
        {agents.error && (
          <Alert
            type="error"
            showIcon
            title={errorMessage(agents.error)}
            action={<Button onClick={() => void agents.refetch()}>Retry</Button>}
          />
        )}

        {agents.data && entries.length === 0 && (
          <div
            className={`kx:flex kx:flex-col kx:items-center kx:gap-3 kx:bg-surface kx:px-6 kx:py-12 kx:text-center ${borderAll}`}
          >
            <AgentBadge size="lg" />
            <Typography.Title level={5} className="kx:m-0">
              No agents yet
            </Typography.Title>
            <Typography.Text type="secondary" className="kx:max-w-sm">
              Create one to start from a kushibot template, then shape its prompts and tools.
            </Typography.Text>
            <Button type="primary" onClick={() => setCreating(true)}>
              Create your first agent
            </Button>
          </div>
        )}

        {entries.length > 0 && (
          <section aria-label="Agents" className="kx:flex kx:flex-col kx:gap-3">
            {entries.length > 6 && (
              <Input
                allowClear
                aria-label="Search agents"
                placeholder="Search agents"
                prefix={<IconSearch size={14} />}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="kx:max-w-xs"
              />
            )}
            <ul className="kx:m-0 kx:grid kx:list-none kx:grid-cols-1 kx:gap-3 kx:p-0 kx:sm:grid-cols-2 kx:lg:grid-cols-3">
              {shown.map((agent) => (
                <li key={agent.name}>
                  <button
                    type="button"
                    onClick={() => onOpen(agent.name)}
                    className={`kx:group kx:flex kx:w-full kx:cursor-pointer kx:items-center kx:gap-3 kx:bg-surface kx:p-4 kx:text-left kx:transition-colors kx:hover:border-primary kx:focus-visible:border-primary kx:focus-visible:outline-none ${borderAll}`}
                  >
                    <AgentBadge />
                    <span className="kx:flex kx:min-w-0 kx:flex-1 kx:flex-col">
                      <span className="kx:truncate kx:font-medium kx:text-text">
                        {agent.displayName ?? agent.name}
                      </span>
                      <span className="kx:truncate kx:text-xs kx:text-text-muted">
                        {agent.plugin ? `${agent.plugin.name} · ` : ""}Updated{" "}
                        {timeAgo(agent.updatedAt)}
                      </span>
                    </span>
                    <span className="kx:inline-flex kx:text-text-muted kx:transition-transform kx:group-hover:translate-x-0.5 kx:group-hover:text-primary">
                      <IconChevronRight size={16} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {shown.length === 0 && (
              <Typography.Text type="secondary">No agents match “{query.trim()}”.</Typography.Text>
            )}
          </section>
        )}
      </div>
      {creating && (
        <CreateAgentDialog
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            onOpen(name);
          }}
        />
      )}
    </div>
  );
}
