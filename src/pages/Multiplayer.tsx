import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, joinRoom, subscribeToRoom, updateRoom, getRoomById } from '@/lib/multiplayer';
import { ArrowLeft, Copy, Check, Users, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import menuBg from '@/assets/menu-bg.png';

type LobbyState = 'menu' | 'creating' | 'hosting' | 'joining' | 'waiting' | 'joined' | 'starting';
type PlayerRole = 'player1' | 'player2';

const Multiplayer = () => {
  const navigate = useNavigate();
  const [state, setState] = useState<LobbyState>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [myRole, setMyRole] = useState<PlayerRole | null>(null);
  const [joinInput, setJoinInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [opponentJoined, setOpponentJoined] = useState(false);
  const hasNavigatedRef = useRef(false);

  const navigateToGame = useCallback((role: PlayerRole, nextRoomId: string) => {
    if (hasNavigatedRef.current) return;
    hasNavigatedRef.current = true;
    navigate(`/game?mode=multi&room=${nextRoomId}&role=${role}`);
  }, [navigate]);

  const resetLobby = useCallback(() => {
    setState('menu');
    setRoomCode('');
    setRoomId('');
    setMyRole(null);
    setJoinInput('');
    setCopied(false);
    setError('');
    setOpponentJoined(false);
    hasNavigatedRef.current = false;
  }, []);

  // Create a room (host)
  const handleCreate = useCallback(async () => {
    setState('creating');
    setError('');
    try {
      const { roomCode, roomId } = await createRoom();
      hasNavigatedRef.current = false;
      setRoomCode(roomCode);
      setRoomId(roomId);
      setMyRole('player1');
      setOpponentJoined(false);
      setState('hosting');
    } catch (e: any) {
      toast.error('Fehler beim Erstellen: ' + e.message);
      setState('menu');
    }
  }, []);

  // Join a room (guest)
  const handleJoin = useCallback(async () => {
    if (joinInput.length < 5) {
      setError('Code muss 5 Zeichen lang sein');
      return;
    }

    setError('');
    setState('waiting');

    try {
      const { roomId, role } = await joinRoom(joinInput);
      hasNavigatedRef.current = false;
      setRoomId(roomId);
      setRoomCode(joinInput.toUpperCase().trim());
      setMyRole(role);

      if (role === 'player1') {
        setState('hosting');
        return;
      }

      setOpponentJoined(true);
      setState('joined');
      toast.success('Raum beigetreten. Warte auf Start durch Host.');
    } catch (e: any) {
      setError(e.message);
      setState('joining');
    }
  }, [joinInput]);

  const handleStartMatch = useCallback(async () => {
    if (!roomId) return;
    setState('starting');

    try {
      await updateRoom(roomId, { status: 'starting' });
      navigateToGame('player1', roomId);
    } catch (e: any) {
      toast.error('Start fehlgeschlagen: ' + e.message);
      setState('hosting');
    }
  }, [roomId, navigateToGame]);

  // Keep room state in sync (Realtime + polling fallback)
  useEffect(() => {
    if (!roomId || !myRole || !['hosting', 'joined', 'starting'].includes(state)) return;

    let disposed = false;

    const handleRoomUpdate = (room: any) => {
      if (disposed || !room) return;

      if (room.player2_id) {
        setOpponentJoined(true);
      } else if (myRole === 'player1') {
        setOpponentJoined(false);
      }

      if (room.status === 'starting') {
        navigateToGame(myRole, roomId);
      }
    };

    const unsub = subscribeToRoom(roomId, handleRoomUpdate);
    const pollId = window.setInterval(async () => {
      try {
        const room = await getRoomById(roomId);
        handleRoomUpdate(room);
      } catch {
        // silent fallback loop
      }
    }, 1200);

    (async () => {
      try {
        const room = await getRoomById(roomId);
        handleRoomUpdate(room);
      } catch {
        // ignore initial fetch errors
      }
    })();

    return () => {
      disposed = true;
      unsub();
      window.clearInterval(pollId);
    };
  }, [state, roomId, myRole, navigateToGame]);

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 relative overflow-hidden">
      <img src={menuBg} alt="" className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300" />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] pointer-events-none transition-opacity duration-300" />

      <button
        onClick={() => state === 'menu' ? navigate('/') : resetLobby()}
        className="absolute top-6 left-6 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors z-10"
      >
        <ArrowLeft size={20} />
      </button>

      <div className="w-full max-w-xs relative z-10">
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
                <p className="text-4xl font-mono font-black tracking-[0.3em] text-foreground">{roomCode}</p>
                <button
                  onClick={copyCode}
                  className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                >
                  {copied ? <Check size={18} className="text-success" /> : <Copy size={18} />}
                </button>
              </div>
            </div>

            <div className="py-4 px-4 rounded-xl bg-card border border-border space-y-3">
              {opponentJoined ? (
                <>
                  <div className="flex items-center justify-center gap-2 text-success font-semibold">
                    <Users size={18} />
                    Mitspieler ist beigetreten
                  </div>
                  <button
                    onClick={handleStartMatch}
                    className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 active:scale-[0.97] transition-all"
                  >
                    <span className="inline-flex items-center justify-center gap-2">
                      <Play size={16} />
                      Spiel starten
                    </span>
                  </button>
                </>
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

        {state === 'joined' && (
          <div className="text-center space-y-4">
            <div className="py-4 rounded-xl bg-card border border-border">
              <div className="flex items-center justify-center gap-2 text-success font-semibold">
                <Users size={18} />
                Verbunden mit Raum {roomCode}
              </div>
            </div>
            <Loader2 className="animate-spin mx-auto text-primary" size={28} />
            <p className="text-muted-foreground">Warte, bis der Host das Spiel startet...</p>
          </div>
        )}

        {state === 'starting' && (
          <div className="text-center space-y-4">
            <Loader2 className="animate-spin mx-auto text-primary" size={32} />
            <p className="text-muted-foreground">Spiel wird gestartet...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Multiplayer;

