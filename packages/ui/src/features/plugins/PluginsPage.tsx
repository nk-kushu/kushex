import { Alert, Button, Card, Spin, Typography } from "antd";
import { Link, useParams } from "react-router";
import { usePluginsQuery } from "../../shared/api/kushexApi";
import { errorMessage } from "../../shared/api/errorMessage";
import { paths } from "../workbench/navigation";

/** Host-owned plugin browsing, shared by embedded and standalone workbenches. */
export function PluginsPage() {
  const { pluginId } = useParams();
  const plugins = usePluginsQuery();
  const entries = plugins.data?.entries ?? [];
  const shown = pluginId ? entries.filter((plugin) => plugin.id === pluginId) : entries;
  return (
    <div className="kx:h-full kx:overflow-auto kx:p-6">
      {pluginId && <Link to={paths.plugins()}>All plugins</Link>}
      <Typography.Title level={3}>Plugins</Typography.Title>
      <Typography.Paragraph>Installed local packages and their agents.</Typography.Paragraph>
      {plugins.isLoading && <Spin aria-label="Loading plugins" />}
      {plugins.error && (
        <Alert
          type="error"
          title={errorMessage(plugins.error)}
          action={<Button onClick={() => void plugins.refetch()}>Retry</Button>}
        />
      )}
      {plugins.data && !shown.length && (
        <Alert type="info" title={pluginId ? "Plugin unavailable" : "No plugins installed"} />
      )}
      <div className="kx:flex kx:flex-col kx:gap-4">
        {shown.map((plugin, index) => (
          <Card key={`${plugin.id}:${index}`} title={plugin.name}>
            <Typography.Paragraph>
              Version {plugin.version || "unknown"} · {plugin.agents.length} agents
            </Typography.Paragraph>
            {plugin.errors.map((error, index) => (
              <Alert key={index} type="error" title={error} />
            ))}
            {!pluginId && <Link to={paths.plugins(plugin.id)}>View agents</Link>}
            {pluginId && (
              <ul>
                {plugin.agents.map((agent, index) => (
                  <li key={`${agent.id}:${index}`}>
                    <Typography.Text strong>{agent.name}</Typography.Text>
                    {agent.description && (
                      <Typography.Paragraph>{agent.description}</Typography.Paragraph>
                    )}
                    {plugin.errors.length ? (
                      <Typography.Text type="secondary">Unavailable</Typography.Text>
                    ) : (
                      <Link to={paths.agents(agent.id)}>Open agent</Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
