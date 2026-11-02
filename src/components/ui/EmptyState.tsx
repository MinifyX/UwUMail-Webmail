import clsx from "clsx";
import type { ReactNode } from "react";
import { NyuScene, type SceneName } from "@/components/nyu/scenes";

interface EmptyStateProps {
  scene: SceneName;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  /** Smaller scene for dense places like the Pro layout. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ scene, title, body, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={clsx("flex flex-col items-center justify-center gap-3 px-8 py-12 text-center", className)}>
      <NyuScene
        name={scene}
        className={clsx("h-auto animate-pop drop-shadow-[var(--uwu-shadow-nyu)]", compact ? "w-[150px]" : "w-[240px]")}
      />
      <p className="max-w-[320px] text-reading font-bold text-ink">{title}</p>
      {body && <p className="max-w-[300px] text-meta text-muted">{body}</p>}
      {action}
    </div>
  );
}
