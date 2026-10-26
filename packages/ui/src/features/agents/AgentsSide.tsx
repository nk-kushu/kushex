import { Alert, Button, Form, Input, Menu, Modal, Spin, Typography } from "antd";
import { useState } from "react";
import type { CreateAgentRequest } from "@kushex/contracts";
import { errorMessage } from "../../shared/api/errorMessage";
import { useAgentsQuery, useCreateAgentMutation } from "../../shared/api/kushexApi";
import { AppIcon } from "../../shared/components/AppIcon";
import { AddIcon, AgentsIcon } from "../../shared/lib/icons";
import { PaneHeader } from "../workbench/PaneHeader";

/** Same rule as the server: the name is also the file name. */
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export function AgentsSide({
  selected,
  onOpen,
}: Readonly<{ selected?: string; onOpen: (name: string) => void }>) {
  const [creating, setCreating] = useState(false);
  const agents = useAgentsQuery(undefined, { refetchOnMountOrArgChange: true });
  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <PaneHeader
        title="Agents"
        extra={
          <Button
            type="text"
            size="small"
            onClick={() => setCreating(true)}
            icon={<AppIcon icon={AddIcon} label="New agent" />}
          />
        }
      />
      {agents.isLoading && <Spin className="kx:p-4" aria-label="Loading agents" />}
      {agents.error && (
        <Alert
          className="kx:m-2"
          type="error"
          showIcon
          title={errorMessage(agents.error)}
          action={<Button onClick={() => void agents.refetch()}>Retry</Button>}
        />
      )}
      {agents.data?.entries.length === 0 && (
        <Typography.Paragraph type="secondary" className="kx:p-3">
          No agents yet. Create one to start from a kushibot template.
        </Typography.Paragraph>
      )}
      <Menu
        mode="inline"
        aria-label="Agents"
        className="kx:min-h-0 kx:flex-1 kx:overflow-auto"
        style={{ borderInlineEnd: "none" }}
        selectedKeys={selected ? [selected] : []}
        onClick={({ key }) => onOpen(key)}
        items={agents.data?.entries.map((agent) => ({
          key: agent.name,
          label: agent.name,
          icon: <AppIcon icon={AgentsIcon} size="sm" />,
        }))}
      />
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

function CreateAgentDialog({
  onClose,
  onCreated,
}: Readonly<{ onClose: () => void; onCreated: (name: string) => void }>) {
  const [form] = Form.useForm<CreateAgentRequest>();
  const [create, result] = useCreateAgentMutation();
  const name = Form.useWatch("name", form);
  const submit = async (input: CreateAgentRequest) => {
    try {
      onCreated((await create(input).unwrap()).name);
    } catch {
      /* The mutation error is rendered in the dialog. */
    }
  };
  return (
    <Modal open title="New agent" onCancel={onClose} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(input) => void submit(input)}>
        <Form.Item
          name="name"
          label="Agent name"
          extra={`Saved as agents/${name || "<name>"}/agent.ts`}
          rules={[
            { required: true, message: "Enter a name." },
            {
              pattern: AGENT_NAME_PATTERN,
              message: "Use lowercase letters, digits and dashes, starting with a letter.",
            },
          ]}
        >
          <Input maxLength={63} placeholder="code-reviewer" />
        </Form.Item>
        {result.error && (
          <Alert className="kx:mb-4" type="error" showIcon title={errorMessage(result.error)} />
        )}
        <Button htmlType="submit" type="primary" loading={result.isLoading}>
          Create agent
        </Button>
      </Form>
    </Modal>
  );
}
