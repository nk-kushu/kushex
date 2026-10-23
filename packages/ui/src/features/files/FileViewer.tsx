import { Alert, Button, Empty, Spin, Typography } from "antd";
import { lazy, Suspense } from "react";
import { useFileQuery } from "../../shared/api/kushexApi";
import { errorMessage } from "../../shared/api/errorMessage";

const TextFileViewer = lazy(() => import("./TextFileViewer"));

export function FileViewer({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  const file = useFileQuery({ projectId, path }, { refetchOnMountOrArgChange: true });
  const tooLarge = file.error && "status" in file.error && file.error.status === 413;
  return (
    <section aria-label={`${path} viewer`} className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <div className="kx:flex kx:shrink-0 kx:items-center kx:justify-between kx:gap-2 kx:px-3 kx:py-1">
        <Typography.Text type="secondary">
          {path} · read only
          {file.currentData ? ` · ${file.currentData.size.toLocaleString()} bytes` : ""}
        </Typography.Text>
        <Button
          aria-label="Refresh file"
          size="small"
          onClick={() => void file.refetch()}
          loading={file.isFetching}
        >
          Refresh file
        </Button>
      </div>
      {file.isLoading && <Spin aria-label="Loading file" />}
      {file.error && (
        <Alert
          type={tooLarge ? "warning" : "error"}
          showIcon
          title={tooLarge ? "File is too large to preview" : "File could not be opened"}
          description={errorMessage(file.error)}
        />
      )}
      {!file.error && file.currentData?.kind === "binary" && (
        <Empty description="Binary file — preview unavailable" />
      )}
      {!file.error && file.currentData?.kind === "text" && (
        <Suspense fallback={<Spin />}>
          <TextFileViewer path={path} content={file.currentData.content} />
        </Suspense>
      )}
    </section>
  );
}
