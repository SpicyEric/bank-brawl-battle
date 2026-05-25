ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS player1_roster jsonb,
  ADD COLUMN IF NOT EXISTS player2_roster jsonb,
  ADD COLUMN IF NOT EXISTS player1_roster_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player2_roster_ready boolean NOT NULL DEFAULT false;