CREATE TABLE "kushex"."Note" (
    "id" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Note_actorId_pinned_updatedAt_idx" ON "kushex"."Note"("actorId", "pinned", "updatedAt");
