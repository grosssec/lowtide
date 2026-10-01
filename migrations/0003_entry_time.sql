-- When an entry is known to the minute (bank alert emails, cash typed in), so a balance checked the same day
-- counts only what came after it. ISO date-time in UTC; NULL for statement and CSV rows.
ALTER TABLE transactions ADD COLUMN at TEXT;
