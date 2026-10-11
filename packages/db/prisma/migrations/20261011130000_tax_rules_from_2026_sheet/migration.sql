-- The 2026 spreadsheet taxes each apartment on its own, 15% up to 12,000 €, 25% up to 24,000 €,
-- 35% up to 35,000 €, 45% above. Replace the first guess, but only where nobody has edited it since.
UPDATE "tax_rules"
SET "brackets" = '[{"upToCents":1200000,"rateBps":1500},{"upToCents":2400000,"rateBps":2500},{"upToCents":3500000,"rateBps":3500},{"upToCents":null,"rateBps":4500}]'::jsonb,
    "scope" = 'per_apartment',
    "note" = 'From the 2026 spreadsheet (Φύλλο3); to be confirmed with the accountant',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "year" IN (2025, 2026)
  AND "confirmed" = false
  AND "note" = 'From the spreadsheet; to be confirmed with the accountant'
  AND "brackets" = '[{"upToCents":1200000,"rateBps":1500},{"upToCents":3500000,"rateBps":3500},{"upToCents":null,"rateBps":4500}]'::jsonb;
