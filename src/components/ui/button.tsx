import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement>;
export function Button({ className, ...props }: Props) {
  return <button className={`px-3 py-1.5 rounded border ${className ?? ""}`} {...props} />;
}
