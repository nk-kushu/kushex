import { Alert, Form, Input, Modal, Typography, type InputRef } from "antd";
import { useRef } from "react";
import type { CreateAgentRequest } from "@kushex/contracts";
import { errorMessage } from "../../shared/api/errorMessage";
import { useCreateAgentMutation } from "../../shared/api/kushexApi";
import { borderAll } from "../../shared/lib/styles";

/** Same rule as the server: the name is also the folder name. */
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export function CreateAgentDialog({
  onClose,
  onCreated,
}: Readonly<{ onClose: () => void; onCreated: (name: string) => void }>) {
  const [form] = Form.useForm<CreateAgentRequest>();
  const input = useRef<InputRef>(null);
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
    <Modal
      open
      title="New agent"
      onCancel={onClose}
      destroyOnHidden
      afterOpenChange={(open) => open && input.current?.focus()}
      okText="Create agent"
      okButtonProps={{ htmlType: "submit", loading: result.isLoading }}
      modalRender={(dialog) => (
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(input) => void submit(input)}
        >
          {dialog}
        </Form>
      )}
    >
      <Typography.Paragraph type="secondary">
        An agent is a folder of TypeScript files, started from a kushibot template. You can add
        prompts, tools and tests to it afterwards.
      </Typography.Paragraph>
      <Form.Item
        name="name"
        label="Agent name"
        rules={[
          { required: true, message: "Enter a name." },
          {
            pattern: AGENT_NAME_PATTERN,
            message: "Use lowercase letters, digits and dashes, starting with a letter.",
          },
        ]}
      >
        <Input ref={input} maxLength={63} placeholder="code-reviewer" />
      </Form.Item>
      <div className={`kx:bg-surface-muted kx:px-3 kx:py-2 kx:font-mono kx:text-xs ${borderAll}`}>
        <span className="kx:text-text-muted">Saved as </span>agents/{name || "<name>"}/agent.ts
      </div>
      {result.error && (
        <Alert className="kx:mt-4" type="error" showIcon title={errorMessage(result.error)} />
      )}
    </Modal>
  );
}
