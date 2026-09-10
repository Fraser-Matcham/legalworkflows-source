import type { NextRequest } from "next/server";
import { resolveApiBaseUrl } from "@/app/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The validation this used to carry inline now lives in @/app/lib/env, so the
// startup guard in src/instrumentation.ts and this proxy cannot disagree about
// what a valid API_BASE_URL is. In production the guard means an invalid value
// never gets this far: the server refuses to start rather than answering every
// request with the 502 below, which reads as a backend outage.
function backendOrigin() {
    return resolveApiBaseUrl(process.env.API_BASE_URL, {
        production: process.env.NODE_ENV === "production",
    });
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
    const { path } = await context.params;
    const requestPath = `/${path.map(encodeURIComponent).join("/")}`;

    try {
        const upstreamUrl = new URL(`${backendOrigin()}${requestPath}`);
        upstreamUrl.search = request.nextUrl.search;

        const headers = new Headers(request.headers);
        headers.delete("host");
        headers.delete("connection");
        headers.delete("content-length");
        headers.set("x-forwarded-host", request.nextUrl.host);
        headers.set(
            "x-forwarded-proto",
            request.nextUrl.protocol.replace(":", ""),
        );

        const init: RequestInit & { duplex?: "half" } = {
            method: request.method,
            headers,
            cache: "no-store",
            redirect: "manual",
        };
        if (request.method !== "GET" && request.method !== "HEAD") {
            init.body = request.body;
            init.duplex = "half";
        }

        const upstream = await fetch(upstreamUrl, init);
        const responseHeaders = new Headers(upstream.headers);
        // Fetch implementations may transparently decompress the response.
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");

        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders,
        });
    } catch (error) {
        console.error("[api-gateway] upstream request failed", {
            path: requestPath,
            error: error instanceof Error ? error.message : String(error),
        });
        return Response.json(
            { detail: "The API is temporarily unavailable." },
            { status: 502 },
        );
    }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
