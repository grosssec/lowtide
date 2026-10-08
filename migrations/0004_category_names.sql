-- Category names follow a household budget (shared/import/categorize.ts CATEGORIES); older names are renamed.
UPDATE transactions SET category = CASE category
  WHEN 'Leisure' THEN 'Fun'
  WHEN 'Transport' THEN 'Transportation'
  WHEN 'Tuition' THEN 'Education'
  WHEN 'Health insurance' THEN 'Insurance'
  WHEN 'Received from people' THEN 'Money from people'
  WHEN 'Side income' THEN 'Freelance & side jobs'
  WHEN 'Other income' THEN 'Freelance & side jobs'
  WHEN 'Card rewards' THEN 'Refunds'
  WHEN 'From Cash App' THEN 'Freelance & side jobs'
  WHEN 'Paychecks (via Inter)' THEN 'Job pay (via Inter)'
  ELSE category END;
UPDATE transactions SET kind = 'income' WHERE category = 'Freelance & side jobs' AND amount > 0 AND kind = 'transfer';
UPDATE rules SET category = CASE category
  WHEN 'Leisure' THEN 'Fun'
  WHEN 'Transport' THEN 'Transportation'
  WHEN 'Tuition' THEN 'Education'
  WHEN 'Health insurance' THEN 'Insurance'
  WHEN 'Received from people' THEN 'Money from people'
  WHEN 'Side income' THEN 'Freelance & side jobs'
  WHEN 'Other income' THEN 'Freelance & side jobs'
  WHEN 'Card rewards' THEN 'Refunds'
  WHEN 'From Cash App' THEN 'Freelance & side jobs'
  WHEN 'Paychecks (via Inter)' THEN 'Job pay (via Inter)'
  ELSE category END;
