-- Apartment order everywhere: Onar, Cosmos, Iris, Helios, then any others after them.
UPDATE "rooms"
SET "calendar_sort_index" = CASE lower(coalesce("display_name", "code"))
  WHEN 'onar' THEN 0
  WHEN 'cosmos' THEN 1
  WHEN 'iris' THEN 2
  WHEN 'helios' THEN 3
  ELSE coalesce("calendar_sort_index", 0) + 4
END;
