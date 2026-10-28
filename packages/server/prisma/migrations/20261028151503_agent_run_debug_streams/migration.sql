-- CreateTable
CREATE TABLE "kushex"."AgentRunDebugStream" (
    "scopeId" VARCHAR(256) NOT NULL,
    "scopeProjectId" VARCHAR(256) NOT NULL,
    "streamId" VARCHAR(300) NOT NULL,
    "workspaceId" VARCHAR(256),
    "runId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "agentName" VARCHAR(63) NOT NULL,
    "runStartedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunDebugStream_pkey" PRIMARY KEY ("scopeId","scopeProjectId","streamId")
);

-- CreateIndex
CREATE INDEX "AgentRunDebugStream_runId_createdAt_idx" ON "kushex"."AgentRunDebugStream"("runId", "createdAt");
