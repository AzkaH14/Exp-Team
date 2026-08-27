import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

interface AppHeaderProps {
  title: string;
  description?: string;
  badge?: string;
  actions?: ReactNode;
}

export function AppHeader({ title, description, badge, actions }: AppHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {badge && <Badge variant="secondary">{badge}</Badge>}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
