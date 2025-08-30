import { ButtonHTMLAttributes } from "react";
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = "px-3 py-2 border rounded bg-white hover:bg-gray-100";
  return <button {...props} className={`${cls} ${props.className||""}`} />;
}
