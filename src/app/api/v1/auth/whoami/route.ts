import type { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/authenticateApiKey";
import { apiSuccess, unauthorized } from "@/lib/api/apiResponse";

export async function POST(request: NextRequest) {
  const user = await authenticateApiKey(request);
  if (!user) return unauthorized();

  return apiSuccess({
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
  });
}
