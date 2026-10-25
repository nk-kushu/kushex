import { Avatar, Button, Card, Divider, Input, List, Segmented, Select, Table, Tag, Timeline, Typography } from "antd";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { AppIcon } from "../../shared/components/AppIcon";
import { FillTabs } from "../../shared/components/FillTabs";
import { AddIcon, FilterIcon, UserIcon } from "../../shared/lib/icons";
import { borderB, borderR, borderT } from "../../shared/lib/styles";
import { paths } from "../workbench/navigation";

type Status = "backlog" | "in-progress" | "in-review" | "done";
type TaskItem = { key: string; title: string; status: Status; tags: string[] };

const columns: readonly { status: Status; title: string }[] = [
  { status: "backlog", title: "Backlog" },
  { status: "in-progress", title: "In progress" },
  { status: "in-review", title: "In review" },
  { status: "done", title: "Done" },
];

const tasks: TaskItem[] = [
  { key: "t1", title: "Task title", status: "backlog", tags: ["tag", "tag"] },
  { key: "t2", title: "Task title", status: "backlog", tags: ["tag"] },
  { key: "t3", title: "Task title", status: "in-progress", tags: ["tag", "tag"] },
  { key: "t4", title: "Task title", status: "in-progress", tags: ["tag"] },
  { key: "t5", title: "Task title", status: "in-review", tags: ["tag"] },
  { key: "t6", title: "Task title", status: "done", tags: ["tag"] },
];

function TaskCard({ task, onOpen }: Readonly<{ task: TaskItem; onOpen: () => void }>) {
  return (
    <Card size="small" hoverable onClick={onOpen} role="button" aria-label={`Open ${task.title}`}>
      <div className="kx:flex kx:flex-col kx:gap-2">
        <Typography.Text strong>{task.title}</Typography.Text>
        <div className="kx:flex kx:items-center kx:gap-1">
          {task.tags.map((tag, index) => (
            <Tag key={index}>{tag}</Tag>
          ))}
          <Avatar size="small" className="kx:ml-auto" icon={<AppIcon icon={UserIcon} size="sm" />} />
        </div>
      </div>
    </Card>
  );
}

function Board({ onOpen }: Readonly<{ onOpen: (task: TaskItem) => void }>) {
  return (
    <div className="kx:grid kx:h-full kx:min-w-[48rem] kx:grid-cols-4">
      {columns.map((column, index) => (
        <section key={column.status} aria-label={column.title} className={`kx:flex kx:min-h-0 kx:flex-col ${index < columns.length - 1 ? borderR : ""}`}>
          <Typography.Text type="secondary" strong className={`kx:px-3 kx:py-2 ${borderB}`}>
            {column.title}
          </Typography.Text>
          <div className="kx:flex kx:flex-col kx:gap-2 kx:overflow-auto kx:p-2">
            {tasks
              .filter((task) => task.status === column.status)
              .map((task) => (
                <TaskCard key={task.key} task={task} onOpen={() => onOpen(task)} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskTable({ onOpen }: Readonly<{ onOpen: (task: TaskItem) => void }>) {
  return (
    <Table<TaskItem>
      size="small"
      rowKey="key"
      pagination={false}
      dataSource={tasks}
      onRow={(task) => ({ onClick: () => onOpen(task), style: { cursor: "pointer" } })}
      columns={[
        { title: "Title", dataIndex: "title" },
        { title: "Status", dataIndex: "status", render: (status: Status) => <Tag>{columns.find((c) => c.status === status)?.title}</Tag> },
        { title: "Tags", dataIndex: "tags", render: (tags: string[]) => tags.map((tag, i) => <Tag key={i}>{tag}</Tag>) },
      ]}
    />
  );
}

function TaskDetail({ task }: Readonly<{ task: TaskItem }>) {
  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <div className={`kx:flex kx:items-center kx:gap-2 kx:px-4 kx:py-3 ${borderB}`}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {task.title}
        </Typography.Title>
        <Select
          aria-label="Status"
          size="small"
          defaultValue={task.status}
          className="kx:ml-auto kx:w-36"
          options={columns.map((column) => ({ value: column.status, label: column.title }))}
        />
        <Button size="small" aria-label="More">
          ⋯
        </Button>
      </div>
      <div className="kx:grid kx:min-h-0 kx:flex-1 kx:grid-cols-[1fr_16rem] kx:overflow-auto">
        <section aria-label="Description" className={`kx:p-4 ${borderR}`}>
          <Typography.Text strong>Description</Typography.Text>
          <Typography.Paragraph type="secondary">Description text</Typography.Paragraph>
          <Divider />
          <Typography.Text strong>Activity</Typography.Text>
          <Timeline className="kx:mt-3" items={[{ content: "activity" }, { content: "activity" }]} />
        </section>
        <section aria-label="Details" className="kx:flex kx:flex-col kx:gap-4 kx:p-4">
          <div>
            <Typography.Text type="secondary">Assignee</Typography.Text>
            <div className="kx:mt-1 kx:flex kx:items-center kx:gap-2">
              <Avatar size="small" icon={<AppIcon icon={UserIcon} size="sm" />} />
              <span>Person</span>
            </div>
          </div>
          <div>
            <Typography.Text type="secondary">Links</Typography.Text>
            <List size="small" dataSource={["thread", "file", "note"]} renderItem={(item) => <List.Item>· {item}</List.Item>} />
          </div>
        </section>
      </div>
      <div className={`kx:flex kx:justify-end kx:p-3 ${borderT}`}>
        <Button type="primary">Start with agent</Button>
      </div>
    </div>
  );
}

export function TasksScreen() {
  const [view, setView] = useState<"board" | "list">("board");
  const navigate = useNavigate();
  const { taskId } = useParams();
  const task = tasks.find((item) => item.key === taskId);
  const [open, setOpen] = useState<TaskItem[]>([]);
  // The task in the URL always has a tab, also when reached by link or history.
  if (task && !open.includes(task)) setOpen([...open, task]);
  if (taskId && !task) return <Navigate to={paths.tasks()} replace />;
  const active = task?.key ?? "overview";
  const openTask = (item: TaskItem) => void navigate(paths.tasks(item.key));

  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <div className={`kx:flex kx:flex-wrap kx:items-center kx:gap-3 kx:px-4 kx:py-2 ${borderB}`}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Tasks
        </Typography.Title>
        <Segmented<"board" | "list">
          aria-label="View"
          size="small"
          value={view}
          onChange={setView}
          options={[
            { label: "Board", value: "board" },
            { label: "List", value: "list" },
          ]}
        />
        <Input aria-label="Filter" size="small" placeholder="Filter" prefix={<AppIcon icon={FilterIcon} size="sm" />} className="kx:w-48" />
        <Button type="primary" size="small" className="kx:ml-auto" icon={<AppIcon icon={AddIcon} />}>
          Task
        </Button>
      </div>
      <div className="kx:min-h-0 kx:flex-1">
        <FillTabs
          type="editable-card"
          hideAdd
          size="small"
          activeKey={active}
          onChange={(key) => void navigate(paths.tasks(key === "overview" ? undefined : key))}
          onEdit={(key, action) => {
            if (action !== "remove") return;
            setOpen((current) => current.filter((task) => task.key !== key));
            if (active === key) void navigate(paths.tasks());
          }}
          items={[
            {
              key: "overview",
              label: view === "board" ? "Board" : "List",
              closable: false,
              children: <div className="kx:h-full kx:overflow-auto">{view === "board" ? <Board onOpen={openTask} /> : <TaskTable onOpen={openTask} />}</div>,
            },
            ...open.map((task) => ({ key: task.key, label: task.title, children: <TaskDetail task={task} /> })),
          ]}
        />
      </div>
    </div>
  );
}
