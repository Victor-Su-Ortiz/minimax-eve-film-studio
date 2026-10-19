import { apiError, assertLocalRequest } from "@/lib/http";
import { MAX_UPLOAD, registerUpload } from "@/lib/media";
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
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
