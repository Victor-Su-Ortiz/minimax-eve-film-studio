import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getProject, mediaPath } from "@/lib/store";
import { apiError, assertLocalRequest } from "@/lib/http";
import { ensureMedia } from "@/lib/media-storage";

export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertLocalRequest(request);
    const { id } = await context.params;
    const asset = (await getProject()).assets.find((a) => a.id === id);
    if (!asset)
      return Response.json({ error: "Asset not found." }, { status: 404 });
    const file = await ensureMedia(id);
    const { size } = await stat(file);
    const headers = new Headers({
      "Content-Type": asset.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    if (new URL(request.url).searchParams.has("download"))
      headers.set(
        "Content-Disposition",
        `attachment; filename="${asset.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      );
    let start = 0,
      end = size - 1,
      status = 200;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (start > end || start >= size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(
      createReadStream(file, { start, end }),
    ) as ReadableStream<Uint8Array>;
    return new Response(stream, { status, headers });
  } catch (error) {
    return apiError(error, 404);
  }
}
