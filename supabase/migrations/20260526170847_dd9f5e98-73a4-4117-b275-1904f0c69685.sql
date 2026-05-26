ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS player1_handicap integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS player2_handicap integer NOT NULL DEFAULT 0;