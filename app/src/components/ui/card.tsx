import type { ReactNode } from "react";

type BaseProps = { children: ReactNode; className?: string };

export function Card({ children, className = "" }: BaseProps) {
  return <div className={`card-surface ${className}`}>{children}</div>;
}
export function CardHeader({ children, className = "" }: BaseProps) {
  return <div className={`p-4 border-b border-slate-200 ${className}`}>{children}</div>;
}
export function CardTitle({ children, className = "" }: BaseProps) {
  return <div className={`text-lg font-semibold tracking-tight ${className}`}>{children}</div>;
}
export function CardContent({ children, className = "" }: BaseProps) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
