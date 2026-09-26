import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { className?: string };

// NOTE: index.css 는 Tailwind 가 아니라 손으로 정의한 유틸리티 모음이라,
// 여기 나열된 클래스 중 정의되지 않은 것은 조용히 무시된다.
// (예: 이전의 border-slate-300 / focus-visible:ring-* / placeholder:text-slate-400)
// 아래 클래스들은 모두 index.css 에 실제로 존재한다.
export function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-soft ${className}`}
    />
  );
}
