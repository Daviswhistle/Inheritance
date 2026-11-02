export type ToastType = "info" | "success" | "error";
export type Toast = { id: number; type: ToastType; msg: string };

// Bound transient feedback without allowing success messages to evict errors.
export function enqueueToast(current: Toast[], next: Toast): Toast[] {
  const unique = [...current.filter(item => item.msg !== next.msg || item.type !== next.type), next];
  const errors = unique.filter(item => item.type === "error").slice(-2);
  if (errors.length === 2) return errors;
  const others = unique.filter(item => item.type !== "error").slice(-(2 - errors.length));
  return [...errors, ...others].sort((a, b) => a.id - b.id);
}
