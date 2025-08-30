import type { InputHTMLAttributes } from "react";

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`border rounded px-2 py-1 w-full ${className ?? ""}`} {...p} />;
}
