-- Track productions that were only correct after pre-send self-correction.
-- These count as productions, but not correct_productions, so profile
-- accuracy reflects cold production instead of assisted repair.

ALTER TABLE vocabulary
  ADD COLUMN IF NOT EXISTS self_corrected_productions integer NOT NULL DEFAULT 0;

ALTER TABLE grammar_gaps
  ADD COLUMN IF NOT EXISTS self_corrected_productions integer NOT NULL DEFAULT 0;
