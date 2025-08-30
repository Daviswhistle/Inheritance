import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { className?: string };

export function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      {...props}
      className={`border rounded-md px-3 py-2 text-sm shadow-sm ${className}`}
    />
  );
}
