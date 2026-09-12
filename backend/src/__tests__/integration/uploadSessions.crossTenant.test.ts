import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-tenant denial for routes/uploadSessions.ts (ticket 2059).
 *
 * An upload session is the handle to a client's documents while they are in
 * flight: the PUT URLs that accept bytes, the ability to seal a file, and the
 * ability to cancel the lot. Every route that takes a `:sessionId` must refuse
 * a session belonging to somebody else.
 *
 * The backend runs as service role against a policy-free schema, so there is
 * no database backstop: a route that forgets `.eq("user_id", …)` hands over
 * another tenant's session and nothing underneath objects. The fake below
 * ENFORCES `.eq()` filters for exactly that reason — drop the user_id filter
 * in loadOwnedSession and these tests go red rather than quietly passing.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => ({ from, rpc }),
}));

// storageEnabled must be forced on. The POST routes check it and return 503
// BEFORE the ownership lookup, so with the real (unconfigured) value every
// denial below would be a 503 about configuration rather than a 404 about
// tenancy — passing for a reason that has nothing to do with what is being
// tested. The calls themselves are stubbed: a denied request must never reach
// storage, so an accidental call is a loud failure rather than a real request.
vi.mock("../../lib/storage", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/storage")>();
    return {
        ...actual,
        storageEnabled: true,
        getSignedUploadUrl: vi.fn(async () => "https://storage.test/put"),
        headFile: vi.fn(async () => null),
        deleteFile: vi.fn(async () => {}),
    };
});

/** Swapped per test so the owner's own request can be checked too. */
let currentUser = { id: "u2", email: "u2@test.local" };

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = currentUser.id;
        res.locals.userEmail = currentUser.email;
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

import { uploadSessionsRouter } from "../../routes/uploadSessions";

// Real UUIDs: the routes validate :sessionId with z.string().uuid() BEFORE
// the ownership lookup, so a friendly id like "sess-1" 404s on format and the
// denial tests below would pass without any tenancy check at all. The owner
// control test at the bottom is what caught that.
const OWNER = "u1";
const SESSION = "3f8a1c2e-0b44-4d6f-9a11-7c2d5e8f0a31";
const FILE = "9b6d4e70-25c1-4f8a-b3d2-6e1f0a4c7b52";

type Row = Record<string, unknown>;

/** The fake enforces .eq() filters — that is the whole point of it. */
function seed(tables: Record<string, Row[]>) {
    from.mockImplementation((table: string) => {
        const filters: { col: string; val: unknown }[] = [];
        const rows = () =>
            (tables[table] ?? []).filter((r) =>
                filters.every((f) => r[f.col] === f.val),
            );
        const query: Record<string, unknown> = {};
        const chain = () => query;
        for (const m of [
            "select",
            "update",
            "insert",
            "upsert",
            "delete",
            "order",
            "limit",
            "in",
            "or",
            "is",
            "lt",
            "lte",
            "gt",
            "gte",
            "neq",
        ]) {
            query[m] = chain;
        }
        query.eq = (col: string, val: unknown) => {
            filters.push({ col, val });
            return query;
        };
        query.single = () =>
            Promise.resolve({ data: rows()[0] ?? null, error: null });
        query.maybeSingle = query.single;
        query.then = (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: rows(), error: null }).then(res);
        return query;
    });
}

const app = () => {
    const a = express();
    a.use(express.json());
    a.use("/upload-sessions", uploadSessionsRouter);
    return a;
};

/** One session, owned by u1, with one file still awaiting its bytes. */
const seedOwnerSession = () =>
    seed({
        upload_sessions: [
            {
                id: SESSION,
                user_id: OWNER,
                status: "pending_upload",
                type: "library",
                project_id: null,
                org_id: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            },
        ],
        upload_session_files: [
            {
                id: FILE,
                session_id: SESSION,
                user_id: OWNER,
                filename: "contract.docx",
                status: "pending_upload",
                storage_path: "uploads/u1/contract.docx",
                size_bytes: 1024,
            },
        ],
    });

beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });
    currentUser = { id: "u2", email: "u2@test.local" };
    seedOwnerSession();
});

describe("another user's upload session", () => {
    it("cannot be read", async () => {
        const res = await request(app()).get(`/upload-sessions/${SESSION}`);

        expect(res.status).toBe(404);
        // The wording must not confirm the session exists.
        expect(JSON.stringify(res.body)).not.toContain(OWNER);
    });

    it("cannot be issued fresh upload URLs", async () => {
        // The most valuable thing to steal here: a PUT URL accepts bytes into
        // somebody else's session.
        const res = await request(app())
            .post(`/upload-sessions/${SESSION}/urls`)
            .send({ file_ids: [FILE] });

        expect(res.status).toBe(404);
    });

    it("cannot have one of its files sealed", async () => {
        const res = await request(app())
            .post(`/upload-sessions/${SESSION}/files/${FILE}/complete`)
            // fileCompletionRequestSchema is .strict() and takes only
            // { failed?: boolean }. Unknown keys 400 before the ownership
            // lookup, which would make this a test of body validation.
            .send({ failed: false });

        expect(res.status).toBe(404);
    });

    it("cannot be cancelled", async () => {
        // Denial of service on another tenant's in-flight upload.
        const res = await request(app()).delete(
            `/upload-sessions/${SESSION}`,
        );

        expect(res.status).toBe(404);

        // The session survived: a 404 that had actually deleted the row would
        // be worse than one that had not.
        expect(
            (
                await from("upload_sessions")
                    .select("*")
                    .eq("id", SESSION)
                    .maybeSingle()
            ).data,
        ).not.toBeNull();
    });
});

describe("the owner's own session", () => {
    it("is readable, so the 404s above are about ownership and not a broken fixture", async () => {
        // Without this, every assertion above would still pass if the fixture
        // simply never matched anything.
        currentUser = { id: OWNER, email: "u1@test.local" };

        const res = await request(app()).get(`/upload-sessions/${SESSION}`);

        expect(res.status).toBe(200);
        expect(res.body.session.id).toBe(SESSION);
    });
});
