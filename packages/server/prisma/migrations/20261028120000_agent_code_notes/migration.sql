CREATE TABLE "kushex"."AgentCodeNotes" (
    "agentName" VARCHAR(63) NOT NULL,
    "content" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentCodeNotes_pkey" PRIMARY KEY ("agentName")
);
