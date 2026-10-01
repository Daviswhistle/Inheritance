import type { ReactNode } from "react";

type BaseProps = { children: ReactNode; className?: string };

export function Card({ children, className = "" }: BaseProps) {
  return <section className={`card-surface ${className}`}>{children}</section>;
}
export function CardHeader({ children, className = "" }: BaseProps) {
  return <div className={`card-header p-4 border-b border-slate-200 ${className}`}>{children}</div>;
}
export function CardTitle({ children, className = "" }: BaseProps) {
  return <h2 className={`card-title text-lg font-semibold tracking-tight ${className}`}>{children}</h2>;
}
export function CardContent({ children, className = "" }: BaseProps) {
  return <div className={`card-content p-4 ${className}`}>{children}</div>;
}
