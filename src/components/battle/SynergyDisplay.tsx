import { SYNERGIES } from '@/lib/battleGame';

interface SynergyDisplayProps {
  synergies: string[];
  team: 'player' | 'enemy';
}

export function SynergyDisplay({ synergies, team }: SynergyDisplayProps) {
  const activeSynergies = synergies
    .map(id => SYNERGIES.find(s => s.id === id))
    .filter(Boolean);

  if (activeSynergies.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-lg ${
      team === 'player' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
    }`}>
      <span className="font-semibold">{team === 'player' ? '👤' : '💀'}</span>
      {activeSynergies.map(syn => (
        <span key={syn!.id} className="flex items-center gap-0.5">
          {syn!.emoji} {syn!.name}
        </span>
      ))}
    </div>
  );
}
