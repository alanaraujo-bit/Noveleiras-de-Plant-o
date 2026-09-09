-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'EDITOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PREMIUM', 'VIP');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AccessTier" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "NovelaStatus" AS ENUM ('ONGOING', 'COMPLETED', 'COMING_SOON');

-- CreateEnum
CREATE TYPE "MediaProvider" AS ENUM ('LOCAL', 'RAILWAY', 'OBJECT_STORE', 'CDN', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('THOUGHT', 'REVIEW', 'THEORY');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SESSION_START', 'SESSION_HEARTBEAT', 'SESSION_END', 'SCREEN_VIEW', 'ONBOARDING_STEP', 'ONBOARDING_COMPLETE', 'SIGN_UP', 'SIGN_IN', 'SIGN_OUT', 'NOVELA_VIEW', 'EPISODE_VIEW', 'PLAY_START', 'PLAY_PROGRESS', 'PLAY_PAUSE', 'PLAY_SEEK', 'PLAY_COMPLETE', 'PLAY_ABANDON', 'PLAY_ERROR', 'SEARCH', 'SEARCH_RESULT_CLICK', 'CATEGORY_OPEN', 'FAVORITE_ADD', 'FAVORITE_REMOVE', 'FEED_VIEW', 'POST_CREATE', 'POST_LIKE', 'POST_COMMENT', 'PAYWALL_VIEW', 'PAYWALL_CTA', 'PREFERENCES_UPDATE', 'PWA_INSTALLED', 'CLIENT_ERROR');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateEnum
CREATE TYPE "LogChannel" AS ENUM ('APP', 'SERVER', 'STREAMING', 'MEDIA', 'AUTH', 'PAYMENTS', 'JOBS', 'INTEGRATIONS', 'ADMIN');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MediaServerStatus" AS ENUM ('UNKNOWN', 'ONLINE', 'DEGRADED', 'OFFLINE');

-- CreateEnum
CREATE TYPE "ScanState" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "MediaAssetState" AS ENUM ('DISCOVERED', 'READY', 'PROCESSING', 'MISSING', 'BROKEN', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "TranscodeState" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'FAILED', 'REFUNDED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('POST', 'COMMENT', 'USER');

-- CreateEnum
CREATE TYPE "ReportState" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "avatarSeed" TEXT NOT NULL DEFAULT '1',
    "avatarKey" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "onboardedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "favoriteGenreIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoplayNext" BOOLEAN NOT NULL DEFAULT true,
    "dataSaver" BOOLEAN NOT NULL DEFAULT false,
    "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
    "spoilerGuard" BOOLEAN NOT NULL DEFAULT true,
    "notifyReleases" BOOLEAN NOT NULL DEFAULT true,
    "notifyCommunity" BOOLEAN NOT NULL DEFAULT true,
    "preferredQuality" TEXT NOT NULL DEFAULT 'auto',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" TEXT,
    "externalCustomerId" TEXT,
    "externalId" TEXT,
    "priceCents" INTEGER,
    "trialEndsAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'web',
    "osName" TEXT,
    "browser" TEXT,
    "screenW" INTEGER,
    "screenH" INTEGER,
    "standalone" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "language" TEXT,
    "timezone" TEXT,
    "referrer" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "screenViews" INTEGER NOT NULL DEFAULT 0,
    "watchedMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Genre" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Novela" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "status" "NovelaStatus" NOT NULL DEFAULT 'ONGOING',
    "accessTier" "AccessTier" NOT NULL DEFAULT 'FREE',
    "ageRating" TEXT NOT NULL DEFAULT '14',
    "year" INTEGER NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Brasil',
    "posterKey" TEXT NOT NULL,
    "heroKey" TEXT NOT NULL,
    "accent" TEXT NOT NULL DEFAULT '#B3325A',
    "trailerKey" TEXT,
    "editorialNote" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "searchText" TEXT NOT NULL DEFAULT '',
    "featuredRank" INTEGER,
    "cast" JSONB NOT NULL DEFAULT '[]',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "watchedMs" BIGINT NOT NULL DEFAULT 0,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Novela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NovelaGenre" (
    "novelaId" TEXT NOT NULL,
    "genreId" TEXT NOT NULL,

    CONSTRAINT "NovelaGenre_pkey" PRIMARY KEY ("novelaId","genreId")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "novelaId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "novelaId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "accessTier" "AccessTier" NOT NULL DEFAULT 'FREE',
    "isBonus" BOOLEAN NOT NULL DEFAULT false,
    "mediaKey" TEXT NOT NULL,
    "mediaProvider" "MediaProvider" NOT NULL DEFAULT 'LOCAL',
    "mediaFormat" TEXT NOT NULL DEFAULT 'mp4',
    "thumbKey" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "watchedMs" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "novelaId" TEXT NOT NULL,
    "positionSec" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "watchedMs" INTEGER NOT NULL DEFAULT 0,
    "playCount" INTEGER NOT NULL DEFAULT 1,
    "abandonedAt" INTEGER,
    "firstPlayAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "novelaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "term" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "clickedNovelaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "novelaId" TEXT,
    "episodeId" TEXT,
    "kind" "PostKind" NOT NULL DEFAULT 'THOUGHT',
    "body" TEXT NOT NULL,
    "spoiler" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostLike" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "novelaId" TEXT,
    "episodeId" TEXT,
    "valueMs" INTEGER,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "path" TEXT,
    "platform" TEXT,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "before" JSONB,
    "after" JSONB,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "ip" TEXT,
    "userAgent" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppLog" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "channel" "LogChannel" NOT NULL DEFAULT 'APP',
    "message" TEXT NOT NULL,
    "correlationId" TEXT,
    "userId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "path" TEXT,
    "stack" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedNote" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaServer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LOCAL',
    "baseUrl" TEXT,
    "tokenHash" TEXT,
    "status" "MediaServerStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastBeatAt" TIMESTAMP(3),
    "uptimeSec" INTEGER,
    "agentVersion" TEXT,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaLibrary" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "serverId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoImport" BOOLEAN NOT NULL DEFAULT true,
    "publishOnImport" BOOLEAN NOT NULL DEFAULT false,
    "lastScanAt" TIMESTAMP(3),
    "lastScanState" TEXT,
    "lastNovelas" INTEGER NOT NULL DEFAULT 0,
    "lastEpisodes" INTEGER NOT NULL DEFAULT 0,
    "lastFiles" INTEGER NOT NULL DEFAULT 0,
    "lastBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryScan" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "serverId" TEXT,
    "state" "ScanState" NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "processedFiles" INTEGER NOT NULL DEFAULT 0,
    "novelasCreated" INTEGER NOT NULL DEFAULT 0,
    "novelasUpdated" INTEGER NOT NULL DEFAULT 0,
    "episodesCreated" INTEGER NOT NULL DEFAULT 0,
    "episodesUpdated" INTEGER NOT NULL DEFAULT 0,
    "filesIndexed" INTEGER NOT NULL DEFAULT 0,
    "filesMissing" INTEGER NOT NULL DEFAULT 0,
    "bytesTotal" BIGINT NOT NULL DEFAULT 0,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "requestedBy" TEXT,
    "full" BOOLEAN NOT NULL DEFAULT false,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LibraryScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaServerBeat" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION,
    "ramUsedMb" INTEGER,
    "ramTotalMb" INTEGER,
    "gpuPercent" DOUBLE PRECISION,
    "vramUsedMb" INTEGER,
    "vramTotalMb" INTEGER,
    "diskUsedGb" DOUBLE PRECISION,
    "diskTotalGb" DOUBLE PRECISION,
    "netUpKbps" DOUBLE PRECISION,
    "netDownKbps" DOUBLE PRECISION,
    "activeStreams" INTEGER NOT NULL DEFAULT 0,
    "transcodes" INTEGER NOT NULL DEFAULT 0,
    "queueDepth" INTEGER NOT NULL DEFAULT 0,
    "uptimeSec" INTEGER,
    "loadAvg" DOUBLE PRECISION,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaServerBeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "serverId" TEXT,
    "mediaKey" TEXT NOT NULL,
    "provider" "MediaProvider" NOT NULL DEFAULT 'LOCAL',
    "path" TEXT,
    "episodeId" TEXT,
    "variant" TEXT NOT NULL DEFAULT 'original',
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "sizeBytes" BIGINT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "codecVideo" TEXT,
    "codecAudio" TEXT,
    "bitrateKbps" INTEGER,
    "frameRate" DOUBLE PRECISION,
    "container" TEXT,
    "checksum" TEXT,
    "state" "MediaAssetState" NOT NULL DEFAULT 'DISCOVERED',
    "stateNote" TEXT,
    "lastProbedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscodeJob" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "serverId" TEXT,
    "episodeId" TEXT,
    "profile" TEXT NOT NULL,
    "state" "TranscodeState" NOT NULL DEFAULT 'QUEUED',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "speed" DOUBLE PRECISION,
    "etaSec" INTEGER,
    "fps" DOUBLE PRECISION,
    "gpuUsed" BOOLEAN NOT NULL DEFAULT false,
    "inputKey" TEXT,
    "outputKey" TEXT,
    "outputs" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "requestedBy" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TranscodeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'PREMIUM',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "PaymentStatus" NOT NULL DEFAULT 'APPROVED',
    "provider" TEXT,
    "externalId" TEXT,
    "method" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "state" "ReportState" NOT NULL DEFAULT 'OPEN',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Preference_userId_key" ON "Preference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_plan_status_idx" ON "Subscription"("plan", "status");

-- CreateIndex
CREATE INDEX "AppSession_userId_startedAt_idx" ON "AppSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AppSession_deviceId_idx" ON "AppSession"("deviceId");

-- CreateIndex
CREATE INDEX "AppSession_startedAt_idx" ON "AppSession"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_slug_key" ON "Genre"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Novela_slug_key" ON "Novela"("slug");

-- CreateIndex
CREATE INDEX "Novela_status_releasedAt_idx" ON "Novela"("status", "releasedAt");

-- CreateIndex
CREATE INDEX "Novela_viewCount_idx" ON "Novela"("viewCount");

-- CreateIndex
CREATE INDEX "Novela_isFeatured_featuredRank_idx" ON "Novela"("isFeatured", "featuredRank");

-- CreateIndex
CREATE INDEX "NovelaGenre_genreId_idx" ON "NovelaGenre"("genreId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_novelaId_number_key" ON "Season"("novelaId", "number");

-- CreateIndex
CREATE INDEX "Episode_novelaId_number_idx" ON "Episode"("novelaId", "number");

-- CreateIndex
CREATE INDEX "Episode_releasedAt_idx" ON "Episode"("releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_seasonId_number_key" ON "Episode"("seasonId", "number");

-- CreateIndex
CREATE INDEX "WatchProgress_userId_updatedAt_idx" ON "WatchProgress"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "WatchProgress_userId_novelaId_updatedAt_idx" ON "WatchProgress"("userId", "novelaId", "updatedAt");

-- CreateIndex
CREATE INDEX "WatchProgress_novelaId_idx" ON "WatchProgress"("novelaId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchProgress_userId_episodeId_key" ON "WatchProgress"("userId", "episodeId");

-- CreateIndex
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Favorite_novelaId_idx" ON "Favorite"("novelaId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_novelaId_key" ON "Favorite"("userId", "novelaId");

-- CreateIndex
CREATE INDEX "SearchQuery_normalized_idx" ON "SearchQuery"("normalized");

-- CreateIndex
CREATE INDEX "SearchQuery_createdAt_idx" ON "SearchQuery"("createdAt");

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "Post_novelaId_createdAt_idx" ON "Post"("novelaId", "createdAt");

-- CreateIndex
CREATE INDEX "PostLike_userId_idx" ON "PostLike"("userId");

-- CreateIndex
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_type_createdAt_idx" ON "Event"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Event_userId_createdAt_idx" ON "Event"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_novelaId_createdAt_idx" ON "Event"("novelaId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_episodeId_createdAt_idx" ON "Event"("episodeId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_actorId_createdAt_idx" ON "AdminAudit"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_targetType_targetId_idx" ON "AdminAudit"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminAudit_action_createdAt_idx" ON "AdminAudit"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AppLog_createdAt_idx" ON "AppLog"("createdAt");

-- CreateIndex
CREATE INDEX "AppLog_level_createdAt_idx" ON "AppLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "AppLog_channel_createdAt_idx" ON "AppLog"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "AppLog_correlationId_idx" ON "AppLog"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_status_severity_lastSeenAt_idx" ON "Alert"("status", "severity", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Alert_openedAt_idx" ON "Alert"("openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaServer_slug_key" ON "MediaServer"("slug");

-- CreateIndex
CREATE INDEX "MediaServer_status_idx" ON "MediaServer"("status");

-- CreateIndex
CREATE INDEX "MediaLibrary_enabled_idx" ON "MediaLibrary"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "MediaLibrary_serverId_path_key" ON "MediaLibrary"("serverId", "path");

-- CreateIndex
CREATE INDEX "LibraryScan_state_queuedAt_idx" ON "LibraryScan"("state", "queuedAt");

-- CreateIndex
CREATE INDEX "LibraryScan_libraryId_queuedAt_idx" ON "LibraryScan"("libraryId", "queuedAt");

-- CreateIndex
CREATE INDEX "MediaServerBeat_serverId_createdAt_idx" ON "MediaServerBeat"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_episodeId_idx" ON "MediaAsset"("episodeId");

-- CreateIndex
CREATE INDEX "MediaAsset_state_idx" ON "MediaAsset"("state");

-- CreateIndex
CREATE INDEX "MediaAsset_checksum_idx" ON "MediaAsset"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_mediaKey_variant_key" ON "MediaAsset"("mediaKey", "variant");

-- CreateIndex
CREATE INDEX "TranscodeJob_state_priority_queuedAt_idx" ON "TranscodeJob"("state", "priority", "queuedAt");

-- CreateIndex
CREATE INDEX "TranscodeJob_episodeId_idx" ON "TranscodeJob"("episodeId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE INDEX "Report_state_createdAt_idx" ON "Report"("state", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovelaGenre" ADD CONSTRAINT "NovelaGenre_novelaId_fkey" FOREIGN KEY ("novelaId") REFERENCES "Novela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovelaGenre" ADD CONSTRAINT "NovelaGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_novelaId_fkey" FOREIGN KEY ("novelaId") REFERENCES "Novela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_novelaId_fkey" FOREIGN KEY ("novelaId") REFERENCES "Novela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_novelaId_fkey" FOREIGN KEY ("novelaId") REFERENCES "Novela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_novelaId_fkey" FOREIGN KEY ("novelaId") REFERENCES "Novela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchQuery" ADD CONSTRAINT "SearchQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_novelaId_fkey" FOREIGN KEY ("novelaId") REFERENCES "Novela"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AppSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaLibrary" ADD CONSTRAINT "MediaLibrary_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MediaServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryScan" ADD CONSTRAINT "LibraryScan_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "MediaLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryScan" ADD CONSTRAINT "LibraryScan_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MediaServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaServerBeat" ADD CONSTRAINT "MediaServerBeat_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MediaServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MediaServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscodeJob" ADD CONSTRAINT "TranscodeJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

