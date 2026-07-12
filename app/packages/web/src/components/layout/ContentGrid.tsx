import type { CSSProperties, ReactNode } from "react";

interface ContentGridProps {
  columns?: string;
  gap?: number;
  children: ReactNode;
}

export function ContentGrid({ columns = "1fr", gap = 20, children }: ContentGridProps) {
  const style: CSSProperties = { gridTemplateColumns: columns, gap };
  return (
    <div className="content-grid" style={style}>
      {children}
    </div>
  );
}
