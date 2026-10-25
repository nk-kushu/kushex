import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { useState } from "react";
import type { CreateProjectRequest } from "@kushex/contracts";
import { errorMessage } from "../../shared/api/errorMessage";
import {
  useCreateProjectMutation,
  useLocationsQuery,
  useProjectsQuery,
} from "../../shared/api/kushexApi";
import { useOpenProject } from "../workbench/navigation";

export function ProjectsScreen() {
  const openProject = useOpenProject();
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const projects = useProjectsQuery(offset, { refetchOnMountOrArgChange: true });
  return (
    <div className="kx:h-full kx:overflow-auto kx:p-6">
      <div className="kx:mb-6 kx:flex kx:items-center kx:justify-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Projects
        </Typography.Title>
        <Space>
          <Button
            aria-label="Refresh projects"
            onClick={() => void projects.refetch()}
            loading={projects.isFetching}
          >
            Refresh projects
          </Button>
          <Button type="primary" onClick={() => setCreating(true)}>
            New project
          </Button>
        </Space>
      </div>
      {projects.isLoading && <Spin aria-label="Loading projects" />}
      {projects.error && <Alert type="error" showIcon title={errorMessage(projects.error)} />}
      {projects.currentData?.entries.length === 0 && (
        <Empty description="No projects yet. Choose a workspace to get started." />
      )}
      <div className="kx:grid kx:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] kx:gap-4">
        {projects.currentData?.entries.map((project) => (
          <Card key={project.id}>
            <Card.Meta
              title={project.name}
              description={project.description ?? project.workspace.path}
            />
            <div className="kx:mt-4">
              <Button
                onClick={() => openProject(project.id)}
                aria-label={`Open ${project.name}`}
              >
                Open project
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <Space className="kx:mt-4">
        {offset > 0 && (
          <Button onClick={() => setOffset(Math.max(0, offset - 100))}>Previous projects</Button>
        )}
        {projects.currentData?.nextOffset != null && (
          <Button onClick={() => setOffset(projects.currentData!.nextOffset!)}>
            Next projects
          </Button>
        )}
      </Space>
      {creating && <CreateProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateProjectDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const openProject = useOpenProject();
  const [form] = Form.useForm<CreateProjectRequest>();
  const [offset, setOffset] = useState(0);
  const locations = useLocationsQuery(offset, { refetchOnMountOrArgChange: true });
  const [create, result] = useCreateProjectMutation();
  const submit = async (input: CreateProjectRequest) => {
    try {
      const project = await create(input).unwrap();
      openProject(project.id);
      onClose();
    } catch {
      /* The mutation error is rendered in the dialog. */
    }
  };
  return (
    <Modal open title="New project" onCancel={onClose} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(input) => void submit(input)}>
        <Form.Item
          name="name"
          label="Project name"
          rules={[{ required: true, whitespace: true, max: 200 }]}
        >
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="path" label="Workspace directory" rules={[{ required: true }]}>
          <Select
            aria-label="Workspace directory"
            loading={locations.isFetching}
            options={locations.currentData?.entries.map((entry) => ({
              value: entry.path,
              label: entry.path,
            }))}
            placeholder="Choose a directory"
          />
        </Form.Item>
        {locations.error && (
          <Alert
            className="kx:mb-4"
            type="error"
            title={errorMessage(locations.error)}
            action={<Button onClick={() => void locations.refetch()}>Retry locations</Button>}
          />
        )}
        {locations.currentData?.entries.length === 0 && (
          <Typography.Paragraph type="secondary">
            No directories found. Add a checkout to the configured workspaces root, then refresh.
          </Typography.Paragraph>
        )}
        <Space className="kx:mb-4">
          <Button onClick={() => void locations.refetch()}>Refresh locations</Button>
          {offset > 0 && (
            <Button onClick={() => setOffset(Math.max(0, offset - 500))}>
              Previous directories
            </Button>
          )}
          {locations.currentData?.nextOffset != null && (
            <Button onClick={() => setOffset(locations.currentData!.nextOffset!)}>
              Next directories
            </Button>
          )}
        </Space>
        <Form.Item name="description" label="Description">
          <Input.TextArea maxLength={2000} />
        </Form.Item>
        {result.error && (
          <Alert className="kx:mb-4" type="error" showIcon title={errorMessage(result.error)} />
        )}
        <Button
          htmlType="submit"
          type="primary"
          loading={result.isLoading}
          disabled={!locations.data}
        >
          Create project
        </Button>
      </Form>
    </Modal>
  );
}
