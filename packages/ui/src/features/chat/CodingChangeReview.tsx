import { Alert, Button, Space, Tag } from "antd";
import { useState } from "react";
import { errorMessage } from "../../shared/api/errorMessage";
import {
  useApplyCodingProposalMutation,
  useReconcileCodingProposalMutation,
  useCodingProposalReviewQuery,
} from "../../shared/api/kushexApi";
import { ChangeReview } from "./ChangeReview";

/** This preview decides presentation only; the server validates the persisted evidence. */
export function codingResultPreview(value: unknown): { summary: string; count: number } | null {
  if (
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    value.schemaVersion === 1 &&
    "presentation" in value &&
    value.presentation === "changes" &&
    "message" in value &&
    typeof value.message === "string" &&
    "result" in value
  ) {
    const result = value.result;
    if (
      result &&
      typeof result === "object" &&
      "changedPaths" in result &&
      Array.isArray(result.changedPaths) &&
      result.changedPaths.length > 0
    ) {
      return { summary: value.message, count: result.changedPaths.length };
    }
  }
  if (!value || typeof value !== "object" || !("outcome" in value) || !("result" in value))
    return null;
  const outcome = value.outcome;
  if (
    !outcome ||
    typeof outcome !== "object" ||
    !("status" in outcome) ||
    outcome.status !== "finished" ||
    !("outcome" in outcome)
  )
    return null;
  const completed = outcome.outcome;
  if (
    !completed ||
    typeof completed !== "object" ||
    !("status" in completed) ||
    completed.status !== "completed"
  )
    return null;
  const result = value.result;
  if (
    !result ||
    typeof result !== "object" ||
    !("changedPaths" in result) ||
    !Array.isArray(result.changedPaths) ||
    !result.changedPaths.length ||
    !("summary" in result) ||
    typeof result.summary !== "string" ||
    !("unresolved" in result) ||
    !Array.isArray(result.unresolved) ||
    result.unresolved.length
  )
    return null;
  return { summary: result.summary, count: result.changedPaths.length };
}

export function CodingChangeReview({
  projectId,
  runId,
  summary,
  count,
}: Readonly<{ projectId: string; runId: string; summary: string; count: number }>) {
  const query = useCodingProposalReviewQuery(
    { projectId, runId },
    { refetchOnMountOrArgChange: true },
  );
  const [publish, publishing] = useApplyCodingProposalMutation();
  const [reconcile, reconciling] = useReconcileCodingProposalMutation();
  const [open, setOpen] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = query.currentData;
  const loading = query.isFetching;
  const status = uncertain ? "pending" : review?.status;
  const displayedError = error ?? (query.error ? errorMessage(query.error) : null);

  const refresh = async () => {
    setError(null);
    try {
      await query.refetch().unwrap();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const apply = async () => {
    if (!review || publishing.isLoading || status !== "ready") return;
    setError(null);
    setUncertain(true);
    try {
      const outcome = await publish({ projectId, runId, digest: review.digest }).unwrap();
      await query.refetch().unwrap();
      setUncertain(false);
      if (!outcome.effect && outcome.status !== "pending")
        setError("The changes could not be applied. Reload the review and try again.");
    } catch (failure) {
      // A lost response may have followed a write: only status reconciliation is allowed now.
      setError(errorMessage(failure));
    }
  };

  const checkStatus = async () => {
    if (!review) return;
    setError(null);
    try {
      await reconcile({ projectId, runId, digest: review.digest }).unwrap();
      await query.refetch().unwrap();
      setUncertain(false);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <div className="kx:flex kx:flex-col kx:gap-2 kx:rounded-xl kx:bg-fill kx:p-3">
      <div className="kx:whitespace-pre-wrap">{review?.summary ?? summary}</div>
      <Space wrap>
        <Tag>
          {count} {count === 1 ? "file" : "files"} changed
        </Tag>
        {status === "applied" && <Tag color="success">Applied</Tag>}
        {status === "pending" && <Tag color="warning">Application pending</Tag>}
        {status === "not-applied" && <Tag color="error">Not applied</Tag>}
        <Button
          aria-label="Review changes"
          onClick={() => {
            setOpen(true);
            void refresh();
          }}
          loading={loading}
          disabled={!review || loading}
        >
          Review changes
        </Button>
        {displayedError && !open && (
          <Button size="small" onClick={() => void refresh()}>
            Retry review
          </Button>
        )}
      </Space>
      {displayedError && !open && <Alert type="error" showIcon title={displayedError} />}
      {review && (
        <ChangeReview
          key={review.digest}
          proposalId={review.id}
          summary={review.summary}
          changes={review.changes}
          open={open}
          applying={publishing.isLoading || reconciling.isLoading}
          applied={status === "applied"}
          status={status}
          code={review.code}
          checking={loading}
          error={displayedError}
          onClose={() => setOpen(false)}
          onApply={() => void apply()}
          onCheck={() => void checkStatus()}
        />
      )}
    </div>
  );
}
