import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Legacy cached JS may still poll this removed endpoint */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/dashboard/live") {
    return new NextResponse(null, {
      status: 204,
      headers: { Deprecation: "true" },
    });
  }
}

export const config = {
  matcher: "/api/dashboard/live",
};
