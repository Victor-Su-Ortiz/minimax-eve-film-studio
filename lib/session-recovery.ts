/** Only this server response confirms that the new turn was never accepted. */
export function isInactiveSession(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: number; code?: string };
  return value.status === 409 && value.code === "session_not_active";
}

export async function sendWithSessionRecovery(
  send: () => Promise<void>,
  reset: () => void,
  getError: () => unknown,
) {
  await send();
  if (!isInactiveSession(getError())) return;
  // Reset the local binding, leaving the old durable transcript and film intact.
  // Retry at most once, and never retry an ambiguous provider/transport failure.
  reset();
  await send();
}
