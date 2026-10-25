export type NotificationPermission = "unknown" | "granted" | "denied";
export type NotificationWatchState = "unknown" | "registered" | "not_registered";
export type NotificationRequestFailure = {
  category: "expected" | "unexpected";
  errorCode: string | null;
  error: unknown;
};
export type NotificationPermissionValue = { notifications: boolean } | null;

const EXPECTED_PERMISSION_ERRORS = new Set([
  "already_granted",
  "already_requested",
  "permission_disabled",
  "user_rejected",
]);

export function classifyNotificationPermissionError(error: unknown): NotificationRequestFailure {
  const errorCode = error && typeof error === "object"
    && "error_code" in error && typeof error.error_code === "string"
    ? error.error_code
    : null;
  return {
    category: errorCode && EXPECTED_PERMISSION_ERRORS.has(errorCode) ? "expected" : "unexpected",
    errorCode,
    error,
  };
}

/**
 * Always read permission state after the request, including SDK exceptions.
 * A known state such as already_granted is an outcome, not an app failure.
 */
export async function requestAndReadNotificationPermission(
  request: () => Promise<unknown>,
  read: () => Promise<NotificationPermissionValue>,
): Promise<{ permission: NotificationPermissionValue; failure: NotificationRequestFailure | null }> {
  let failure: NotificationRequestFailure | null = null;
  try {
    await request();
  } catch (error) {
    failure = classifyNotificationPermissionError(error);
  }

  let permission: NotificationPermissionValue = null;
  try {
    permission = await read();
  } catch {
    permission = null;
  }
  return { permission, failure };
}

export function notificationHealth(input: {
  backendEnabled: boolean;
  permission: NotificationPermission;
  asked: boolean;
  hasWatchTarget: boolean;
  watchState: NotificationWatchState;
  deliveryNote: string;
}): { level: "checking" | "off" | "broken" | "ok"; text: string } {
  if (!input.backendEnabled) return { level: "checking", text: "" };
  if (input.permission === "denied" && input.asked) {
    return { level: "broken", text: "World App is blocking notifications — turn them on in World App → Settings." };
  }
  if (input.permission !== "granted") return { level: "off", text: "Notifications are off." };
  if (!input.hasWatchTarget) {
    return { level: "ok", text: "Notifications are on for this wallet." };
  }
  if (input.watchState === "not_registered") {
    return { level: "broken", text: "This vault is not being watched." };
  }
  if (input.watchState === "registered") {
    if (input.deliveryNote) {
      return {
        level: "broken",
        text: "World App took the request but did not deliver it (" + input.deliveryNote + ").",
      };
    }
    return {
      level: "ok",
      text: "Reminders are enabled for you. Your heir must enable their own notifications separately.",
    };
  }
  return { level: "checking", text: "Checking notification status…" };
}
