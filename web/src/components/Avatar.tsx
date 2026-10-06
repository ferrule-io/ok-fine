import { clsx } from "clsx";
import { Bot, User } from "lucide-react";
import { actorKind, hue, initials } from "../lib/format.js";

export interface AvatarProps {
  actor: string;
  size?: number;
  className?: string;
}

export function Avatar({ actor, size = 28, className }: AvatarProps) {
  const h = hue(actor);
  const letters = initials(actor);
  const kind = actorKind(actor);

  const glyphSize = Math.max(10, Math.round(size * 0.42));
  const fontSize = Math.max(10, Math.round(size * 0.4));

  return (
    <div
      className={clsx("relative inline-flex shrink-0 select-none", className)}
      style={{ width: size, height: size }}
      title={actor}
    >
      <div
        className="flex h-full w-full items-center justify-center rounded-full font-medium text-white shadow-xs"
        style={{
          background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))`,
          fontSize,
        }}
      >
        {letters}
      </div>
      <div
        className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-surface text-muted ring-1 ring-border"
        style={{ width: glyphSize + 4, height: glyphSize + 4 }}
      >
        {kind === "human" ? <User size={glyphSize} /> : <Bot size={glyphSize} />}
      </div>
    </div>
  );
}
