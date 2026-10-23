import { useLayoutEffect, useRef } from "react";

/** Keep the last readable item 32px above an anchored action at any text size. */
export function useActionClearance(active = true) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const action = ref.current;
    const main = action?.closest("main");
    if (!active || !action || !main) return;
    const previous = main.style.paddingBottom;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bottom = Number.parseFloat(getComputedStyle(action).bottom) || 0;
        main.style.paddingBottom = `${Math.ceil(action.getBoundingClientRect().height + bottom + 32)}px`;
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(action);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      main.style.paddingBottom = previous;
    };
  }, [active]);
  return ref;
}
