import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

/* danger 를 추가한다. 파괴적이고 되돌리기 어려운 조작이 "변경" 버튼과 같은 모양이면
   사용자가 구분할 방법이 없다 — Vault 탭의 "Cancel (set heir to me)" 가 정확히 그
   상태였다(취소는 갱신 기한 전에만 가능하고, 되돌리려면 상속인을 다시 지정해야 한다).
   색으로 구분하는 것은 장식이 아니라 안전장치다. */
type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type ButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & {
  className?: string;
  variant?: Variant;
  size?: Size;
};

const base = "btn";

const variants: Record<Variant, string> = {
  primary: "btn-primary",
  outline: "btn-outline",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

const sizes: Record<Size, string> = {
  sm: "btn-sm",
  md: "btn-md",
  lg: "btn-lg",
};

export function Button({ className = "", variant = "outline", size = "md", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`${base} ${variants[variant]} ${sizes[size]} shadow-soft ${className}`}
    />
  );
}
