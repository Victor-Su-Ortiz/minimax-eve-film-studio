export function assertLocalRequest(request: Request) {
  const url = new URL(request.url);
  if (process.env.VERCEL && process.env.STUDIO_STORAGE === "cloud") {
    if (process.env.STUDIO_DEPLOYMENT_PROTECTED !== "true")
      throw new Error(
        "Enable deployment protection before serving this studio.",
      );
    const hosts = [
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.STUDIO_HOST,
    ].filter(Boolean);
    const host = request.headers.get("host") || url.host;
    if (!hosts.includes(host)) throw new Error("Unrecognized studio host.");
    const origin = request.headers.get("origin");
    if (origin && origin !== `https://${host}`)
      throw new Error("Cross-origin studio requests are not allowed.");
    return;
  }
  if (
    process.env.VERCEL ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("This private studio is available on localhost only.");
  // Next can normalize request.url to localhost even when the browser uses
  // 127.0.0.1. The validated Host header preserves the browser-facing origin.
  const host = request.headers.get("host") || url.host;
  const browserOrigin = new URL(`${url.protocol}//${host}`);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(browserOrigin.hostname))
    throw new Error("This private studio is available on localhost only.");
  const origin = request.headers.get("origin");
  if (origin && origin !== browserOrigin.origin)
    throw new Error("Cross-origin studio requests are not allowed.");
}
export function apiError(error: unknown, status = 400) {
  // Provider bodies, headers and raw subprocess errors may contain private data.
  const message =
    error instanceof Error
      ? error.message
      : "The operation could not be completed.";
  return Response.json(
    {
      error: message.startsWith("Command failed:")
        ? "Media processing failed. Check that the source is a readable video and FFmpeg is installed."
        : message,
    },
    { status },
  );
}
