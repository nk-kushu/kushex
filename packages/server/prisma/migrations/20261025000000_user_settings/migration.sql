CREATE TYPE "kushex"."ColorMode" AS ENUM ('system', 'light', 'dark');
CREATE TYPE "kushex"."Density" AS ENUM ('comfortable', 'compact');

CREATE TABLE "kushex"."UserSettings" (
    "actorId" TEXT NOT NULL,
    "colorMode" "kushex"."ColorMode" NOT NULL DEFAULT 'system',
    "density" "kushex"."Density" NOT NULL DEFAULT 'comfortable',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("actorId")
);
