
-- Game rooms for multiplayer
CREATE TABLE public.game_rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  player1_id UUID,
  player2_id UUID,
  player1_units JSONB,
  player2_units JSONB,
  player1_ready BOOLEAN DEFAULT false,
  player2_ready BOOLEAN DEFAULT false,
  winner TEXT CHECK (winner IN ('player1', 'player2', 'draw', NULL)),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Matchmaking queue
CREATE TABLE public.matchmaking_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;

-- Game rooms: anyone can read rooms by code (needed to join)
CREATE POLICY "Anyone can read rooms" ON public.game_rooms FOR SELECT USING (true);

-- Anyone can create rooms (anonymous players)
CREATE POLICY "Anyone can create rooms" ON public.game_rooms FOR INSERT WITH CHECK (true);

-- Only room members can update
CREATE POLICY "Room members can update" ON public.game_rooms FOR UPDATE
  USING (auth.uid() = player1_id OR auth.uid() = player2_id);

-- Matchmaking: open access for anonymous players
CREATE POLICY "Anyone can join queue" ON public.matchmaking_queue FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read queue" ON public.matchmaking_queue FOR SELECT USING (true);
CREATE POLICY "Players can delete own entry" ON public.matchmaking_queue FOR DELETE USING (auth.uid() = player_id);

-- Enable realtime for game rooms
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;

-- Index for room code lookups
CREATE INDEX idx_game_rooms_code ON public.game_rooms (room_code);
CREATE INDEX idx_matchmaking_queue_created ON public.matchmaking_queue (created_at);
