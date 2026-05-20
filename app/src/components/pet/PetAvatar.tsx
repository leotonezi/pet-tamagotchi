interface PetAvatarProps {
  happiness: number;
  isAlive: boolean;
  size?: "sm" | "md" | "lg";
}

function getEmoji(happiness: number, isAlive: boolean): string {
  if (!isAlive) return "💀";
  if (happiness >= 70) return "😺";
  if (happiness >= 40) return "😐";
  return "😢";
}

export function PetAvatar({ happiness, isAlive, size = "md" }: PetAvatarProps) {
  const sizes = { sm: "text-4xl", md: "text-6xl", lg: "text-8xl" };
  const emoji = getEmoji(happiness, isAlive);

  return (
    <div
      className={`flex items-center justify-center select-none ${sizes[size]}`}
      role="img"
      aria-label={isAlive ? `Pet mood: ${emoji}` : "Pet is deceased"}
    >
      {emoji}
    </div>
  );
}
