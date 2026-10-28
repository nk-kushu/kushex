import { Alert, Button, Empty, List, Modal, Space, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { errorMessage } from "../../shared/api/errorMessage";
import { useChatThreadsQuery, useDeleteChatThreadsMutation } from "../../shared/api/kushexApi";
import { chatCleared, selectChat } from "../runs/runsSlice";
import { paths } from "../workbench/navigation";

export function ChatThreadsScreen({ projectId }: Readonly<{ projectId: string }>) {
  const threads = useChatThreadsQuery(projectId);
  const [remove, deleting] = useDeleteChatThreadsMutation();
  const [error, setError] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((state) => selectChat(state, projectId).threadId);
  const navigate = useNavigate();
  const confirm = (id?: string) =>
    Modal.confirm({
      title: id ? "Delete this thread?" : "Delete all threads?",
      content: "This permanently deletes the saved conversation and its messages.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await remove({ projectId, id }).unwrap();
          if (!id || id === selectedId) dispatch(chatCleared(projectId));
          setError(null);
        } catch (failure) {
          setError(errorMessage(failure));
        }
      },
    });
  return (
    <div className="kx:p-6">
      <Space className="kx:mb-4" wrap>
        <Button onClick={() => void navigate(paths.files(projectId))}>Back to files</Button>
        <Typography.Title level={3} className="kx:m-0">
          Saved threads
        </Typography.Title>
        <Button
          danger
          disabled={!threads.data?.length}
          loading={deleting.isLoading}
          onClick={() => confirm()}
        >
          Delete all
        </Button>
      </Space>
      {(error || threads.error) && (
        <Alert type="error" showIcon title={error ?? errorMessage(threads.error)} />
      )}
      <List
        loading={threads.isLoading}
        dataSource={[...(threads.data ?? [])]}
        locale={{ emptyText: <Empty description="No saved threads" /> }}
        renderItem={(thread) => (
          <List.Item
            actions={[
              <Button key="delete" danger onClick={() => confirm(thread.id)}>
                Delete
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={thread.title}
              description={`Updated ${new Date(thread.updatedAt).toLocaleString()}`}
            />
          </List.Item>
        )}
      />
    </div>
  );
}
