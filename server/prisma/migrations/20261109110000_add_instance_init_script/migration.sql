-- Add one-time initialization task support
ALTER TYPE "InstanceTaskType" ADD VALUE IF NOT EXISTS 'initialize';

ALTER TABLE "instance_tasks" ADD COLUMN "init_script" TEXT;
