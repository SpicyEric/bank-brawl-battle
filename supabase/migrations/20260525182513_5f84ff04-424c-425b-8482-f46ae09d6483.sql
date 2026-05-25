CREATE TABLE public.unit_types (
  unit_type TEXT NOT NULL PRIMARY KEY,
  aura_zones JSONB NOT NULL DEFAULT '{"zones":[]}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.unit_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read unit types" ON public.unit_types FOR SELECT USING (true);
CREATE POLICY "Anyone can insert unit types" ON public.unit_types FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update unit types" ON public.unit_types FOR UPDATE USING (true) WITH CHECK (true);