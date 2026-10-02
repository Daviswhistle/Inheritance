import type { CSSProperties } from "react";

export type IconName = "vault" | "send" | "inherit" | "help" | "arrow" | "check" | "bell" | "heart" | "world";

const paths: Record<IconName, string[]> = {
  vault: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z", "M12 7v2m0 6v2m-5-5h2m6 0h2M6 7v2m0 6v2"],
  send: ["M7 17 17 7M7 7h10v10", "M5 3H3v18h18v-2"],
  inherit: ["M8 6h8M12 3v6", "M5 13h14v7H5z", "M3 10h18v3H3zM12 13v7", "M12 10C4 10 5 3 8 4c3 0 4 6 4 6Zm0 0c8 0 7-7 4-6-3 0-4 6-4 6Z"],
  help: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", "M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 16h.01"],
  arrow: ["M4 12h16m-6-6 6 6-6 6"],
  check: ["m5 12 4 4L19 6"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"],
  heart: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"],
  world: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", "M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"],
};

export function Icon({ name, size = 22, className = "", style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true" focusable="false">
    {paths[name].map((d, i) => <path d={d} key={i} />)}
  </svg>;
}

export function Brand() {
  return <div className="brand"><span className="brand-mark"><Icon name="vault" size={23} /></span><span className="brand-name">Inheritance<span className="brand-caption">A vault for someone you love</span></span></div>;
}
