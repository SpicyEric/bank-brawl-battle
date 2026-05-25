CREATE TABLE public.match_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  mode TEXT NOT NULL,
  difficulty INTEGER,
  winner TEXT,
  player1_label TEXT,
  player2_label TEXT,
  client_id TEXT,
  data JSONB NOT NULL
);

CREATE INDEX idx_match_records_created_at ON public.match_records (created_at DESC);

ALTER TABLE public.match_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert match records"
ON public.match_records FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Anyone can read match records"
ON public.match_records FOR SELECT
TO public
USING (true);