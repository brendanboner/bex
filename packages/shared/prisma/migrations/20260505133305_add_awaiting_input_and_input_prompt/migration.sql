-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'AWAITING_INPUT';

-- AlterTable
ALTER TABLE "AgentRequest" ADD COLUMN     "inputPrompt" TEXT;
