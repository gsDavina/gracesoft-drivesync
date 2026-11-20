-- CreateEnum
CREATE TYPE "DriveFileStatus" AS ENUM ('SYNCED', 'SKIPPED');

-- AlterTable
ALTER TABLE "drive_files" ADD COLUMN     "skipCapabilityVersion" TEXT,
ADD COLUMN     "skipReason" TEXT,
ADD COLUMN     "status" "DriveFileStatus" NOT NULL DEFAULT 'SYNCED';

