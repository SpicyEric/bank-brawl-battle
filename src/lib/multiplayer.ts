import { supabase } from '@/integrations/supabase/client';

// Generate a 5-character alphanumeric room code
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Ensure anonymous auth session
export async function ensureAnonymousSession(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user!.id;
}

// Create a new game room
export async function createRoom(): Promise<{ roomCode: string; roomId: string }> {
  const playerId = await ensureAnonymousSession();
  const roomCode = generateRoomCode();

  const { data, error } = await supabase
    .from('game_rooms')
    .insert({
      room_code: roomCode,
      player1_id: playerId,
      status: 'waiting',
    })
    .select()
    .single();

  if (error) throw error;
  return { roomCode: data.room_code, roomId: data.id };
}

// Join an existing room by code
export async function joinRoom(roomCode: string): Promise<{ roomId: string; role: 'player1' | 'player2' }> {
  const playerId = await ensureAnonymousSession();
  const code = roomCode.toUpperCase().trim();

  const { data: room, error: fetchErr } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('room_code', code)
    .single();

  if (fetchErr || !room) throw new Error('Raum nicht gefunden');
  if (room.status !== 'waiting') throw new Error('Raum ist nicht mehr verfügbar');
  if (room.player1_id === playerId) return { roomId: room.id, role: 'player1' };
  if (room.player2_id) throw new Error('Raum ist bereits voll');

  const { error: updateErr } = await supabase
    .from('game_rooms')
    .update({ player2_id: playerId })
    .eq('id', room.id);

  if (updateErr) throw updateErr;
  return { roomId: room.id, role: 'player2' };
}

// Subscribe to room changes via Realtime
export function subscribeToRoom(
  roomId: string,
  onUpdate: (room: any) => void
) {
  const channel = supabase
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` },
      (payload) => {
        onUpdate(payload.new);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Update room data
export async function updateRoom(roomId: string, updates: Record<string, any>) {
  const { error } = await supabase
    .from('game_rooms')
    .update(updates)
    .eq('id', roomId);
  if (error) throw error;
}

// Broadcast game actions via Realtime channel (for real-time battle sync)
export function createGameChannel(roomId: string, onMessage: (event: string, payload: any) => void) {
  const channel = supabase.channel(`game-${roomId}`, {
    config: { broadcast: { self: false } },
  });

  channel
    .on('broadcast', { event: 'game_action' }, ({ payload }) => {
      onMessage(payload.action, payload.data);
    })
    .subscribe();

  const send = (action: string, data: any) => {
    channel.send({
      type: 'broadcast',
      event: 'game_action',
      payload: { action, data },
    });
  };

  return { channel, send, unsubscribe: () => supabase.removeChannel(channel) };
}
