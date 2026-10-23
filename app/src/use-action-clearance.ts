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
        const style = getComputedStyle(action);
        // WKWebView can keep the layout viewport tall while the keyboard only
        // shrinks visualViewport. Retain enough scroll range to bring a lower
        // input above that occluded area even when fixed actions are hidden.
        const occluded = Math.max(0, window.innerHeight - (window.visualViewport?.height ?? window.innerHeight));
        const bottom = style.display === "none" ? occluded : Number.parseFloat(style.bottom) || 0;
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
