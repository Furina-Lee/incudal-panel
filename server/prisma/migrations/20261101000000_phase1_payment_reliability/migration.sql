-- Phase 1 payment reliability: normalize callback keys and add a durable
-- idempotency key for newly-created recharge ledger entries.
-- Existing callback rows are retained deterministically; duplicate callback
-- markers are reduced to one row before the unique index is created.
WITH normalized AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider_id, order_no,
             COALESCE(NULLIF(btrim(trade_no), ''), '__NO_TRADE_NO__' || order_no)
           ORDER BY id
         ) AS row_number
  FROM payment_callbacks
)
DELETE FROM payment_callbacks
WHERE id IN (SELECT id FROM normalized WHERE row_number > 1);

UPDATE payment_callbacks
SET trade_no = COALESCE(NULLIF(btrim(trade_no), ''), '__NO_TRADE_NO__' || order_no);

-- Keep the Prisma field nullable for compatibility with older callback writers;
-- the application always stores the deterministic sentinel when the provider
-- does not return a trade number.
ALTER TABLE balance_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Protect historical recharge orders too. Only the oldest ledger row for an
-- order receives the key so pre-existing duplicate rows do not abort rollout;
-- they remain visible for manual financial review.
WITH ranked_recharge_logs AS (
  SELECT id, order_id,
         ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY id) AS row_number
  FROM balance_logs
  WHERE type = 'recharge' AND order_id IS NOT NULL
)
UPDATE balance_logs AS log
SET idempotency_key = 'recharge:' || ranked_recharge_logs.order_id
FROM ranked_recharge_logs
WHERE log.id = ranked_recharge_logs.id
  AND ranked_recharge_logs.row_number = 1;

CREATE UNIQUE INDEX IF NOT EXISTS "balance_logs_idempotency_key_key"
  ON balance_logs (idempotency_key);
