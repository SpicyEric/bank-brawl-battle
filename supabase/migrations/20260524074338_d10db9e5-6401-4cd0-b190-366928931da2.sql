CREATE TABLE public.unit_icon_assignments (
  slot text NOT NULL CHECK (slot IN ('unit','attack','clone')),
  unit_type text NOT NULL,
  icon_filename text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot, unit_type)
);

ALTER TABLE public.unit_icon_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read icon assignments"
ON public.unit_icon_assignments FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert icon assignments"
ON public.unit_icon_assignments FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update icon assignments"
ON public.unit_icon_assignments FOR UPDATE
USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete icon assignments"
ON public.unit_icon_assignments FOR DELETE
USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.unit_icon_assignments;