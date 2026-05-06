-- Migration: Per-user KPI targets
-- Adds user_id to kpi_targets so each user can track personal goals.

-- Add user_id column (NULL means global/team default)
ALTER TABLE kpi_targets ADD COLUMN user_id INTEGER DEFAULT NULL;

-- Drop old unique constraint by recreating index (SQLite has no DROP CONSTRAINT)
DROP INDEX IF EXISTS idx_kpi_targets_ym;

-- Composite unique: same user can only have one target per month
CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_targets_user_ym
  ON kpi_targets(IFNULL(user_id, 0), year, month);

CREATE INDEX IF NOT EXISTS idx_kpi_targets_ym ON kpi_targets(year, month);
