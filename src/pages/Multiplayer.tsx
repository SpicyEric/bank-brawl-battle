import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMusic } from '@/hooks/useMusic';
import { createRoom, joinRoom, subscribeToRoom, updateRoom, createGameChannel } from '@/lib/multiplayer';
import { ArrowLeft, Copy, Check, Users, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type LobbyState = 'menu' | 'creating' | 'hosting' | 'joining' | 'waiting';

const Multiplayer = () => {
  const navigate = useNavigate();
  const { muted, toggleMute } = useMusic();
  const [state, setState] = useState<LobbyState>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [opponentJoined, setOpponentJoined] = useState(false);

  // Create a room
  const handleCreate = useCallback(async () => {
    setState('creating');
    try {
      const { roomCode, roomId } = await createRoom();
      setRoomCode(roomCode);
      setRoomId(roomId);
      setState('hosting');
    } catch (e: any) {
      toast.error('Fehler beim Erstellen: ' + e.message);
      setState('menu');
    }
  }, []);

  // Join a room
  const handleJoin = useCallback(async () => {
    if (joinInput.length < 5) {
      setError('Code muss 5 Zeichen lang sein');
      return;
    }
    setError('');
    setState('waiting');
    try {
      const { roomId } = await joinRoom(joinInput);
      setRoomId(roomId);
      setRoomCode(joinInput.toUpperCase());
      // Navigate to game with multiplayer params
      navigate(`/game?mode=multi&room=${roomId}&role=player2`);
    } catch (e: any) {
      setError(e.message);
      setState('joining');
    }
  }, [joinInput, navigate]);

  // Listen for opponent joining
  useEffect(() => {
    if (state !== 'hosting' || !roomId) return;
    const unsub = subscribeToRoom(roomId, (room) => {
      if (room.player2_id) {
        setOpponentJoined(true);
        setTimeout(() => {
          navigate(`/game?mode=multi&room=${roomId}&role=player1`);
        }, 1000);
      }
    });
    return unsub;
  }, [state, roomId, navigate]);

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-6 relative">
      {/* Back button */}
      <button
        onClick={() => state === 'menu' ? navigate('/') : setState('menu')}
        className="absolute top-6 left-6 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <ArrowLeft size={20} />
      </button>

      <div className="w-full max-w-xs">
        {state === 'menu' && (
          <div className="space-y-6 text-center">
            <div>
              <h1 className="text-3xl font-black text-foreground mb-1">⚔️ Multiplayer</h1>
              <p className="text-sm text-muted-foreground">Spiele gegen einen Freund</p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleCreate}
                className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 active:scale-[0.97] transition-all"
              >
                🏠 Raum erstellen
              </button>
              <button
                onClick={() => setState('joining')}
                className="w-full py-4 rounded-xl bg-secondary text-secondary-foreground font-bold text-base hover:bg-accent active:scale-[0.97] transition-all"
              >
                🔗 Raum beitreten
              </button>
            </div>
          </div>
        )}

        {state === 'creating' && (
          <div className="text-center space-y-4">
            <Loader2 className="animate-spin mx-auto text-primary" size={32} />
            <p className="text-muted-foreground">Raum wird erstellt...</p>
          </div>
        )}

        {state === 'hosting' && (
          <div className="text-center space-y-6">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Dein Raum-Code:</p>
              <div className="flex items-center justify-center gap-2">
                <p className="text-4xl font-mono font-black tracking-[0.3em] text-foreground">
                  {roomCode}
                </p>
                <button
                  onClick={copyCode}
                  className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                >
                  {copied ? <Check size={18} className="text-success" /> : <Copy size={18} />}
                </button>
              </div>
            </div>

            <div className="py-4 rounded-xl bg-card border border-border">
              {opponentJoined ? (
                <div className="flex items-center justify-center gap-2 text-success font-semibold">
                  <Users size={18} />
                  Gegner beigetreten! Starte...
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="animate-spin text-muted-foreground" size={20} />
                  <p className="text-sm text-muted-foreground">Warte auf Gegner...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {state === 'joining' && (
          <div className="space-y-6 text-center">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-1">Raum beitreten</h2>
              <p className="text-sm text-muted-foreground">Gib den 5-stelligen Code ein</p>
            </div>

            <input
              type="text"
              maxLength={5}
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="CODE"
              className="w-full text-center text-3xl font-mono font-black tracking-[0.3em] py-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {error && <p className="text-sm text-danger">{error}</p>}

            <button
              onClick={handleJoin}
              disabled={joinInput.length < 5}
              className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Beitreten
            </button>
          </div>
        )}

        {state === 'waiting' && (
          <div className="text-center space-y-4">
            <Loader2 className="animate-spin mx-auto text-primary" size={32} />
            <p className="text-muted-foreground">Trete bei...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Multiplayer;
