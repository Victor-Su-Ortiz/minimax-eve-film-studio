import { apiError, assertLocalRequest } from "@/lib/http";
import { MAX_UPLOAD, registerUpload } from "@/lib/media";
import { get, del } from "@vercel/blob";
import { cloudStorage } from "@/lib/store";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    if (
      cloudStorage() &&
      request.headers.get("content-type")?.includes("application/json")
    ) {
      const input = await request.json();
      if (
        typeof input.blobPath !== "string" ||
        !/^uploads\/[a-f0-9-]{36}$/.test(input.blobPath)
      )
        throw new Error("Invalid upload receipt.");
      const result = await get(input.blobPath, { access: "private" });
      if (!result || result.statusCode !== 200 || result.blob.size > MAX_UPLOAD)
        throw new Error("The upload is missing or exceeds 32 MB.");
      const file = new File(
        [await new Response(result.stream).arrayBuffer()],
        String(input.name || "reference").slice(0, 150),
        { type: result.blob.contentType },
      );
      const asset = await registerUpload(file);
      await del(input.blobPath).catch(() => undefined);
      return Response.json({ asset });
    }
    if (
      Number(request.headers.get("content-length")) >
      MAX_UPLOAD + 1024 * 1024
    )
      throw new Error("Upload limit is 32 MB.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file to upload.");
    return Response.json({ asset: await registerUpload(file) });
  } catch (error) {
    return apiError(error);
  }
}
