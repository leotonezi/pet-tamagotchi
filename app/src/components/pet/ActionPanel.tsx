import { ActionButton } from "./ActionButton";

interface ActionPanelProps {
  petName: string;
  isAlive: boolean;
  onFeed: () => void;
  onWalk: () => void;
  onBathe: () => void;
  onSleep: () => void;
  onPlay: () => void;
  onCheckStatus: () => void;
  loading?: boolean;
}

export function ActionPanel({
  isAlive,
  onFeed,
  onWalk,
  onBathe,
  onSleep,
  onPlay,
  onCheckStatus,
  loading = false,
}: ActionPanelProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Actions
      </h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <ActionButton
          label="Feed"
          emoji="🍖"
          onClick={onFeed}
          disabled={!isAlive}
          loading={loading}
        />
        <ActionButton
          label="Walk"
          emoji="🦮"
          onClick={onWalk}
          disabled={!isAlive}
          loading={loading}
        />
        <ActionButton
          label="Bathe"
          emoji="🛁"
          onClick={onBathe}
          disabled={!isAlive}
          loading={loading}
        />
        <ActionButton
          label="Sleep"
          emoji="😴"
          onClick={onSleep}
          disabled={!isAlive}
          loading={loading}
        />
        <ActionButton
          label="Play"
          emoji="🎮"
          onClick={onPlay}
          disabled={!isAlive}
          loading={loading}
        />
        <ActionButton
          label="Status"
          emoji="🩺"
          onClick={onCheckStatus}
          disabled={!isAlive}
          loading={loading}
        />
      </div>
    </div>
  );
}
