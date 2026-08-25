import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/rbac";

/**
 * Wraps a route handler body so UnauthorizedError/ForbiddenError from
 * lib/auth/rbac.ts consistently become 401/403 responses, and any other
 * thrown error becomes a 500 without leaking internals.
 */
export async function withApiErrorHandling<T>(
  handler: () => Promise<T>
): Promise<NextResponse> {
  try {
    const result = await handler();
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
