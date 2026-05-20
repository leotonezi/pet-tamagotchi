interface DeathOverlayProps {
  petName: string;
}

export function DeathOverlay({ petName }: DeathOverlayProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-red-800 bg-red-950/50 p-8 text-center">
      <span className="text-6xl">💀</span>
      <h2 className="text-2xl font-bold text-red-300">{petName} has passed away</h2>
      <p className="text-slate-400 max-w-sm">
        Your pet has unfortunately passed away. Actions are disabled, but you
        can still view their stats.
      </p>
    </div>
  );
}
