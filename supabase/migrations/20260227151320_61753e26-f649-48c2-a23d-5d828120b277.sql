-- Fix room joining: allow claiming player2 slot in waiting rooms while preserving member updates
DROP POLICY IF EXISTS "Room members can update" ON public.game_rooms;

CREATE POLICY "Room members can update or join waiting room"
ON public.game_rooms
FOR UPDATE
USING (
  (auth.uid() = player1_id OR auth.uid() = player2_id)
  OR (status = 'waiting' AND player2_id IS NULL)
)
WITH CHECK (
  (auth.uid() = player1_id OR auth.uid() = player2_id)
  OR (status = 'waiting' AND player2_id = auth.uid())
);