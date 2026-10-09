-- A target can now ask for days per week, per month, or both at once.
-- NULL means no target on that period. period and days_required are still written
-- (they are NOT NULL) but are no longer read.
ALTER TABLE targets ADD COLUMN week_days INTEGER CHECK (week_days BETWEEN 0 AND 7);
ALTER TABLE targets ADD COLUMN month_days INTEGER CHECK (month_days BETWEEN 0 AND 31);
UPDATE targets SET
  week_days = CASE WHEN period = 'week' THEN days_required END,
  month_days = CASE WHEN period = 'month' THEN days_required END;
