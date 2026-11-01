-- Public status page: components, incidents, and incident updates.
CREATE TABLE "status_components" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_operational" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "status_components_name_key" ON "status_components"("name");
CREATE INDEX "status_components_sort_order_idx" ON "status_components"("sort_order");

CREATE TABLE "status_incidents" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "impact" VARCHAR(16) NOT NULL,
    "body" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "status_incidents_started_at_idx" ON "status_incidents"("started_at");

CREATE TABLE "status_incident_updates" (
    "id" SERIAL NOT NULL,
    "incident_id" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_incident_updates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "status_incident_updates_incident_id_created_at_idx" ON "status_incident_updates"("incident_id", "created_at");
ALTER TABLE "status_incident_updates" ADD CONSTRAINT "status_incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "status_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
