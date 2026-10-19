import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { assertLocalRequest, apiError } from "@/lib/http";
import { MAX_UPLOAD } from "@/lib/media";
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const body = (await request.json()) as HandleUploadBody;
    return Response.json(
      await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname) => {
          if (!/^uploads\/[a-f0-9-]{36}$/.test(pathname))
            throw new Error("Invalid upload path.");
          return {
            maximumSizeInBytes: MAX_UPLOAD,
            allowedContentTypes: [
              "image/png",
              "image/jpeg",
              "image/webp",
              "video/mp4",
              "video/quicktime",
              "audio/mpeg",
              "audio/wav",
              "audio/x-wav",
            ],
            addRandomSuffix: false,
            allowOverwrite: false,
            validUntil: Date.now() + 10 * 60 * 1000,
          };
        },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
