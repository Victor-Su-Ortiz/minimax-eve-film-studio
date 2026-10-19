"use client";
import { upload } from "@vercel/blob/client";
import type { Asset, ConnectionStatus } from "./domain";
export async function uploadStudioFile(file: File): Promise<{ asset: Asset }> {
  const statusResponse = await fetch("/api/status");
  if (!statusResponse.ok)
    throw new Error("Could not read studio configuration.");
  const status = (await statusResponse.json()) as ConnectionStatus;
  let response: Response;
  if (status.storage === "cloud") {
    const blob = await upload(`uploads/${crypto.randomUUID()}`, file, {
      access: "private",
      handleUploadUrl: "/api/assets/upload",
      contentType: file.type,
      multipart: true,
    });
    response = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobPath: blob.pathname, name: file.name }),
    });
  } else {
    const form = new FormData();
    form.set("file", file);
    response = await fetch("/api/assets", { method: "POST", body: form });
  }
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Could not upload this reference.");
  return body;
}
