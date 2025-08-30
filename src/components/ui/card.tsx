import { ReactNode } from "react";
export function Card({children}:{children:ReactNode}) {
  return <div className="border rounded bg-white">{children}</div>;
}
export function CardHeader({children}:{children:ReactNode}) {
  return <div className="p-4 border-b">{children}</div>;
}
export function CardTitle({children}:{children:ReactNode}) {
  return <div className="text-lg font-semibold">{children}</div>;
}
export function CardContent({children}:{children:ReactNode}) {
  return <div className="p-4">{children}</div>;
}
