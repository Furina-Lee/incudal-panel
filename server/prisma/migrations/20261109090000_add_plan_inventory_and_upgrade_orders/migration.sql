CREATE TYPE "InstancePlanUpgradeOrderStatus" AS ENUM ('pending', 'fulfilled', 'failed', 'cancelled', 'expired');
CREATE TYPE "PlanInventoryReservationStatus" AS ENUM ('reserved', 'released', 'consumed');

ALTER TABLE "package_plans"
  ADD COLUMN "max_instances" INTEGER,
  ADD COLUMN "reserved_instances" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "instance_plan_upgrade_orders" (
  "id" SERIAL NOT NULL,
  "order_no" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "instance_id" INTEGER NOT NULL,
  "source_plan_id" INTEGER NOT NULL,
  "target_plan_id" INTEGER NOT NULL,
  "source_instance_version" INTEGER NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "cpu_delta" INTEGER NOT NULL,
  "memory_delta" INTEGER NOT NULL,
  "disk_delta" INTEGER NOT NULL,
  "status" "InstancePlanUpgradeOrderStatus" NOT NULL DEFAULT 'pending',
  "reservation_status" "PlanInventoryReservationStatus" NOT NULL DEFAULT 'reserved',
  "reservation_released_at" TIMESTAMP(3),
  "recharge_record_id" INTEGER,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "fulfilled_at" TIMESTAMP(3),
  "failure_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "instance_plan_upgrade_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instance_plan_upgrade_orders_order_no_key" ON "instance_plan_upgrade_orders"("order_no");
CREATE UNIQUE INDEX "instance_plan_upgrade_orders_recharge_record_id_key" ON "instance_plan_upgrade_orders"("recharge_record_id");
CREATE INDEX "instance_plan_upgrade_orders_user_id_status_created_at_idx" ON "instance_plan_upgrade_orders"("user_id", "status", "created_at");
CREATE INDEX "instance_plan_upgrade_orders_instance_id_status_idx" ON "instance_plan_upgrade_orders"("instance_id", "status");
CREATE INDEX "instance_plan_upgrade_orders_status_expires_at_idx" ON "instance_plan_upgrade_orders"("status", "expires_at");
CREATE INDEX "instance_plan_upgrade_orders_source_plan_id_status_idx" ON "instance_plan_upgrade_orders"("source_plan_id", "status");
CREATE INDEX "instance_plan_upgrade_orders_target_plan_id_status_idx" ON "instance_plan_upgrade_orders"("target_plan_id", "status");

ALTER TABLE "instance_plan_upgrade_orders"
  ADD CONSTRAINT "instance_plan_upgrade_orders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "instance_plan_upgrade_orders_instance_id_fkey"
    FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "instance_plan_upgrade_orders_source_plan_id_fkey"
    FOREIGN KEY ("source_plan_id") REFERENCES "package_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "instance_plan_upgrade_orders_target_plan_id_fkey"
    FOREIGN KEY ("target_plan_id") REFERENCES "package_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "instance_plan_upgrade_orders_recharge_record_id_fkey"
    FOREIGN KEY ("recharge_record_id") REFERENCES "recharge_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
