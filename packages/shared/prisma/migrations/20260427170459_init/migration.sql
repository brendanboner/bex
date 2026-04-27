-- CreateEnum
CREATE TYPE "SkillStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "CredentialScope" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('API_TOKEN', 'USERNAME_PASSWORD', 'SSH_KEY', 'BASIC_AUTH', 'OAUTH2_CLIENT', 'USER_PREFERENCE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('OPENAPI_JSON', 'PDF', 'MARKDOWN', 'URL');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "AgentPosture" AS ENUM ('AUTONOMOUS', 'SUPERVISED', 'INTERACTIVE', 'DELIBERATE');

-- CreateEnum
CREATE TYPE "AgentBearing" AS ENUM ('ANALYTICAL', 'CONCISE', 'NARRATIVE', 'FORMAL');

-- CreateEnum
CREATE TYPE "AgentVerbosity" AS ENUM ('TERSE', 'STANDARD', 'DETAILED');

-- CreateEnum
CREATE TYPE "CompatibilityLevel" AS ENUM ('FULL', 'PARTIAL', 'NONE');

-- CreateEnum
CREATE TYPE "MeshTaskStatus" AS ENUM ('PENDING', 'ROUTING', 'RUNNING', 'AGGREGATING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "passwordHash" TEXT,
    "isSystemUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'DRAFT',
    "persona" JSONB NOT NULL DEFAULT '{}',
    "llmProvider" TEXT NOT NULL DEFAULT 'openai',
    "llmModel" TEXT NOT NULL DEFAULT 'gpt-4o',
    "llmConfig" JSONB NOT NULL DEFAULT '{}',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT NOT NULL,
    "personaId" TEXT,
    "charterId" TEXT,
    "credentialId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCharter" (
    "id" TEXT NOT NULL,
    "mandate" TEXT NOT NULL,
    "posture" "AgentPosture" NOT NULL DEFAULT 'SUPERVISED',
    "bearing" "AgentBearing" NOT NULL DEFAULT 'CONCISE',
    "verbosity" "AgentVerbosity" NOT NULL DEFAULT 'STANDARD',
    "conductBoundaries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escalationTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopeLimits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCharter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL,
    "status" "SkillStatus" NOT NULL DEFAULT 'DRAFT',
    "capabilities" TEXT[],
    "tools" JSONB NOT NULL DEFAULT '[]',
    "systemPrompt" TEXT,
    "learnedNotes" TEXT,
    "requiredCredentialType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSkill" (
    "agentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "AgentSkill_pkey" PRIMARY KEY ("agentId","skillId")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "label" TEXT NOT NULL,
    "rawContent" BYTEA,
    "url" TEXT,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "CredentialScope" NOT NULL,
    "credentialType" "CredentialType" NOT NULL DEFAULT 'API_TOKEN',
    "encryptedValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "allowedAgentPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelRef" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'QUEUED',
    "input" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'api',
    "turns" JSONB NOT NULL DEFAULT '[]',
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "output" TEXT,
    "errorMsg" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "sshEnabled" BOOLEAN NOT NULL DEFAULT false,
    "hostname" TEXT,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "credentialId" TEXT,
    "sshVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "agentId" TEXT NOT NULL,
    "cronExpr" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hostname" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "credentialId" TEXT,
    "sshVerified" BOOLEAN NOT NULL DEFAULT false,
    "apiVerified" BOOLEAN NOT NULL DEFAULT false,
    "apiBaseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillRegistryEntry" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "manifest" JSONB NOT NULL,
    "registryUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillRegistryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "domain" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggestedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schedule" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainConstraint" (
    "id" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "targetDomain" TEXT NOT NULL,
    "compatible" "CompatibilityLevel" NOT NULL,
    "notes" TEXT,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainConstraint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DynamicTool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "handlerType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "skillId" TEXT,
    "domain" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DynamicTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoordinatorSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "turns" JSONB NOT NULL DEFAULT '[]',
    "agentRequestIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RequestStatus" NOT NULL DEFAULT 'RUNNING',
    "channel" TEXT NOT NULL DEFAULT 'api',
    "output" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoordinatorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeshEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "taskType" TEXT NOT NULL,
    "taskPayload" JSONB NOT NULL,
    "requiredCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedAgentId" TEXT,
    "status" "MeshTaskStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeshEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiVersion" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "credentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDashboard" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "agentId" TEXT,
    "prompt" TEXT NOT NULL,
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "refreshMode" TEXT NOT NULL DEFAULT 'manual',
    "cronExpr" TEXT,
    "lastData" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainKnowledge" (
    "domain" TEXT NOT NULL,
    "docIndex" JSONB NOT NULL DEFAULT '[]',
    "entityGraph" JSONB NOT NULL DEFAULT '{}',
    "playbooks" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainKnowledge_pkey" PRIMARY KEY ("domain")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_charterId_key" ON "Agent"("charterId");

-- CreateIndex
CREATE INDEX "Agent_ownerId_idx" ON "Agent"("ownerId");

-- CreateIndex
CREATE INDEX "Agent_status_idx" ON "Agent"("status");

-- CreateIndex
CREATE INDEX "Agent_isDefault_idx" ON "Agent"("isDefault");

-- CreateIndex
CREATE INDEX "Skill_domain_idx" ON "Skill"("domain");

-- CreateIndex
CREATE INDEX "Skill_status_idx" ON "Skill"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_domain_version_key" ON "Skill"("domain", "version");

-- CreateIndex
CREATE INDEX "KnowledgeSource_skillId_idx" ON "KnowledgeSource"("skillId");

-- CreateIndex
CREATE INDEX "Credential_scope_idx" ON "Credential"("scope");

-- CreateIndex
CREATE INDEX "Credential_userId_idx" ON "Credential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_requestId_key" ON "ApprovalRequest"("requestId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedBy_idx" ON "ApprovalRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "AgentRequest_agentId_idx" ON "AgentRequest"("agentId");

-- CreateIndex
CREATE INDEX "AgentRequest_userId_idx" ON "AgentRequest"("userId");

-- CreateIndex
CREATE INDEX "AgentRequest_status_idx" ON "AgentRequest"("status");

-- CreateIndex
CREATE INDEX "AgentRequest_channel_idx" ON "AgentRequest"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_name_key" ON "Endpoint"("name");

-- CreateIndex
CREATE INDEX "Endpoint_tags_idx" ON "Endpoint"("tags");

-- CreateIndex
CREATE INDEX "Endpoint_sshEnabled_idx" ON "Endpoint"("sshEnabled");

-- CreateIndex
CREATE INDEX "ScheduledJob_agentId_idx" ON "ScheduledJob"("agentId");

-- CreateIndex
CREATE INDEX "ScheduledJob_enabled_idx" ON "ScheduledJob"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Target_name_key" ON "Target"("name");

-- CreateIndex
CREATE INDEX "Target_tags_idx" ON "Target"("tags");

-- CreateIndex
CREATE INDEX "SkillRegistryEntry_domain_idx" ON "SkillRegistryEntry"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "SkillRegistryEntry_domain_version_key" ON "SkillRegistryEntry"("domain", "version");

-- CreateIndex
CREATE INDEX "Persona_domain_idx" ON "Persona"("domain");

-- CreateIndex
CREATE INDEX "DomainConstraint_sourceDomain_idx" ON "DomainConstraint"("sourceDomain");

-- CreateIndex
CREATE INDEX "DomainConstraint_targetDomain_idx" ON "DomainConstraint"("targetDomain");

-- CreateIndex
CREATE UNIQUE INDEX "DomainConstraint_sourceDomain_targetDomain_key" ON "DomainConstraint"("sourceDomain", "targetDomain");

-- CreateIndex
CREATE UNIQUE INDEX "DynamicTool_name_key" ON "DynamicTool"("name");

-- CreateIndex
CREATE INDEX "DynamicTool_domain_idx" ON "DynamicTool"("domain");

-- CreateIndex
CREATE INDEX "DynamicTool_handlerType_idx" ON "DynamicTool"("handlerType");

-- CreateIndex
CREATE INDEX "CoordinatorSession_userId_idx" ON "CoordinatorSession"("userId");

-- CreateIndex
CREATE INDEX "CoordinatorSession_status_idx" ON "CoordinatorSession"("status");

-- CreateIndex
CREATE INDEX "MeshEvent_sessionId_idx" ON "MeshEvent"("sessionId");

-- CreateIndex
CREATE INDEX "MeshEvent_status_idx" ON "MeshEvent"("status");

-- CreateIndex
CREATE INDEX "MeshEvent_assignedAgentId_idx" ON "MeshEvent"("assignedAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "LLMConfig_name_key" ON "LLMConfig"("name");

-- CreateIndex
CREATE INDEX "LLMConfig_isDefault_idx" ON "LLMConfig"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "UserDashboard_slug_key" ON "UserDashboard"("slug");

-- CreateIndex
CREATE INDEX "UserDashboard_slug_idx" ON "UserDashboard"("slug");

-- CreateIndex
CREATE INDEX "UserDashboard_status_idx" ON "UserDashboard"("status");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_charterId_fkey" FOREIGN KEY ("charterId") REFERENCES "AgentCharter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AgentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRequest" ADD CONSTRAINT "AgentRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRequest" ADD CONSTRAINT "AgentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMConfig" ADD CONSTRAINT "LLMConfig_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
