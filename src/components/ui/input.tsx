import { InputHTMLAttributes } from "react";
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const cls = "border rounded px-2 py-1 w-full";
  return <input {...props} className={`${cls} ${props.className||""}`} />;
}
