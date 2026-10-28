CREATE TABLE "kushex"."ChatThread" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "actorId" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "kushex"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChatThread_actorId_projectId_updatedAt_idx" ON "kushex"."ChatThread"("actorId", "projectId", "updatedAt");
CREATE TABLE "kushex"."ChatTurn" (
  "id" UUID NOT NULL,
  "threadId" UUID NOT NULL,
  "agentName" VARCHAR(63) NOT NULL,
  "message" TEXT NOT NULL,
  "files" JSONB NOT NULL,
  "debug" BOOLEAN NOT NULL,
  "events" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatTurn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatTurn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "kushex"."ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChatTurn_threadId_createdAt_id_idx" ON "kushex"."ChatTurn"("threadId", "createdAt", "id");
