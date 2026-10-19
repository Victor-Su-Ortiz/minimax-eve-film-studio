import { connectionStatus } from "@/lib/config";
import { apiError, assertLocalRequest } from "@/lib/http";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  try {
    assertLocalRequest(request);
    return Response.json(connectionStatus());
  } catch (error) {
    return apiError(error, 403);
  }
}
