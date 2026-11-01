-- Scheduled maintenance lifecycle and idempotent inbox notification delivery.
ALTER TABLE "status_components" DROP CONSTRAINT IF EXISTS "status_components_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "status_components_name_key" ON "status_components"("name");

CREATE TYPE "MaintenanceStatus" AS ENUM ('scheduled', 'active', 'completed', 'cancelled');

CREATE TABLE "status_maintenances" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'scheduled',
    "impact" VARCHAR(16) NOT NULL DEFAULT 'minor',
    "scheduled_start" TIMESTAMP(3) NOT NULL,
    "scheduled_end" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "status_maintenances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "status_maintenances_time_order_check" CHECK ("scheduled_start" < "scheduled_end")
);
CREATE INDEX "status_maintenances_status_scheduled_start_scheduled_end_idx" ON "status_maintenances"("status", "scheduled_start", "scheduled_end");

CREATE TABLE "status_maintenance_updates" (
    "id" SERIAL NOT NULL,
    "maintenance_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "status_maintenance_updates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "status_maintenance_updates_maintenance_id_created_at_idx" ON "status_maintenance_updates"("maintenance_id", "created_at");
ALTER TABLE "status_maintenance_updates" ADD CONSTRAINT "status_maintenance_updates_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "status_maintenances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "status_maintenance_deliveries" (
    "id" SERIAL NOT NULL,
    "maintenance_id" INTEGER NOT NULL,
    "event_key" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "status_maintenance_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "status_maintenance_deliveries_maintenance_id_event_key_user_id_key" ON "status_maintenance_deliveries"("maintenance_id", "event_key", "user_id");
CREATE INDEX "status_maintenance_deliveries_event_key_delivered_at_idx" ON "status_maintenance_deliveries"("event_key", "delivered_at");
ALTER TABLE "status_maintenance_deliveries" ADD CONSTRAINT "status_maintenance_deliveries_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "status_maintenances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
