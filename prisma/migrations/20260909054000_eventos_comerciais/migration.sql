-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'CHECKOUT_START';
ALTER TYPE "EventType" ADD VALUE 'CHECKOUT_APPROVED';
ALTER TYPE "EventType" ADD VALUE 'CHECKOUT_REJECTED';
ALTER TYPE "EventType" ADD VALUE 'PURCHASE_COMPLETE';
ALTER TYPE "EventType" ADD VALUE 'SUBSCRIPTION_CANCEL';

