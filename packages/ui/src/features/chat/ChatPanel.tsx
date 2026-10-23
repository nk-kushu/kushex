import { Button, Card, Input, Select, Tag, Typography } from "antd";
import { IconChevronRight } from "@tabler/icons-react";
import { useAppDispatch } from "../../app/hooks";
import { AppIcon } from "../../shared/components/AppIcon";
import { AddIcon, AttachIcon, MentionIcon } from "../../shared/lib/icons";
import { borderT } from "../../shared/lib/styles";
import { PaneHeader } from "../workbench/PaneHeader";
import { fileTabOpened } from "../workbench/workbenchSlice";

function UserMessage({ text }: Readonly<{ text: string }>) {
  return (
    <div className="kx:ml-6 kx:rounded-kx kx:bg-primary kx:px-3 kx:py-2 kx:text-white">{text}</div>
  );
}

function AgentMessage({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="kx:mr-6 kx:flex kx:flex-col kx:gap-2 kx:rounded-kx kx:bg-fill kx:px-3 kx:py-2 kx:text-text">{children}</div>;
}

function Step({ text }: Readonly<{ text: string }>) {
  return (
    <div className="kx:flex kx:items-center kx:gap-1 kx:text-text-muted">
      <AppIcon icon={IconChevronRight} size="sm" />
      <span>{text}</span>
    </div>
  );
}

export function ChatPanel() {
  const dispatch = useAppDispatch();
  return (
    <aside aria-label="Chat" className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <PaneHeader
        title="Chat"
        extra={
          <>
            <Select
              aria-label="Thread"
              size="small"
              defaultValue="t1"
              className="kx:w-32"
              options={[
                { value: "t1", label: "Thread" },
                { value: "t2", label: "Other thread" },
              ]}
            />
            <Button type="text" size="small" icon={<AppIcon icon={AddIcon} label="New thread" />} />
          </>
        }
      />
      <div className="kx:flex kx:min-h-0 kx:flex-1 kx:flex-col kx:gap-3 kx:overflow-auto kx:p-3">
        <UserMessage text="User message" />
        <AgentMessage>
          <span>Agent message</span>
          <div className="kx:flex kx:flex-col kx:gap-0.5">
            <Step text="step" />
            <Step text="step" />
          </div>
          <Card size="small" title="Changes" extra={<Typography.Text type="secondary">2 files</Typography.Text>}>
            <div className="kx:flex kx:items-center kx:justify-between kx:gap-2">
              <Typography.Text type="secondary">+12 −4</Typography.Text>
              <Button size="small" type="primary" onClick={() => dispatch(fileTabOpened({ key: "diff:file.ts", title: "file.ts", kind: "diff" }))}>
                Review
              </Button>
            </div>
          </Card>
        </AgentMessage>
      </div>
      <div className={`kx:flex kx:flex-col kx:gap-2 kx:p-3 ${borderT}`}>
        <div className="kx:flex kx:flex-wrap kx:gap-1">
          <Tag closable>chip</Tag>
          <Tag closable>chip</Tag>
        </div>
        <Input.TextArea aria-label="Message" placeholder="Message" autoSize={{ minRows: 2, maxRows: 6 }} />
        <div className="kx:flex kx:items-center kx:gap-1">
          <Button type="text" size="small" icon={<AppIcon icon={MentionIcon} label="Mention" />} />
          <Button type="text" size="small" icon={<AppIcon icon={AttachIcon} label="Attach" />} />
          <Button type="primary" size="small" className="kx:ml-auto">
            Send
          </Button>
        </div>
      </div>
    </aside>
  );
}
