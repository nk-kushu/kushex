-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "kushex";

-- CreateTable
CREATE TABLE "kushex"."Project" (
    "id" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kushex"."Workspace" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "path" VARCHAR(4096) NOT NULL,
    "branch" TEXT,
    "revision" TEXT,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_actorId_createdAt_id_idx" ON "kushex"."Project"("actorId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_projectId_key" ON "kushex"."Workspace"("projectId");

-- AddForeignKey
ALTER TABLE "kushex"."Workspace" ADD CONSTRAINT "Workspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "kushex"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
