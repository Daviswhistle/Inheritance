import type { HTMLAttributes } from "react";

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={`rounded border bg-white ${className ?? ""}`} {...rest} />;
}
export const CardHeader = (p: HTMLAttributes<HTMLDivElement>) =>
  <div className={`p-4 border-b ${p.className ?? ""}`} {...p} />;
export const CardTitle = (p: HTMLAttributes<HTMLHeadingElement>) =>
  <h3 className={`font-semibold ${p.className ?? ""}`} {...p} />;
export const CardContent = (p: HTMLAttributes<HTMLDivElement>) =>
  <div className={`p-4 ${p.className ?? ""}`} {...p} />;
