import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => ({ from }),
}));

// Every request below is made by u2. The document belongs to u1.
vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = "u2";
        res.locals.userEmail = "u2@test.local";
        next();
    },
}));

import { documentsRouter } from "../../routes/documents";

const OWNER = "u1";

type Row = Record<string, unknown>;

/**
 * As in library.crossTenant.test.ts, the fake ENFORCES .eq() filters: a fake
 * that ignored them would let these tests pass with the scoping removed.
 */
function seed(tables: Record<string, Row[]>) {
    from.mockImplementation((table: string) => {
        const filters: { col: string; val: unknown }[] = [];
        const rows = () =>
            (tables[table] ?? []).filter((r) =>
                filters.every((f) => r[f.col] === f.val),
            );
        const query: Record<string, unknown> = {};
        const chain = () => query;
        for (const m of ["select", "update", "delete", "order", "limit", "in", "or", "is"]) {
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

function app() {
    const a = express();
    a.use(express.json());
    a.use("/single-documents", documentsRouter);
    return a;
}

/** A personal document: no project, workflow or org to inherit access from. */
const PERSONAL_DOC: Row = {
    id: "doc-a",
    user_id: OWNER,
    project_id: null,
    workflow_id: null,
    org_id: null,
    current_version_id: "v1",
    file_type: "docx",
};

beforeEach(() => {
    from.mockReset();
    seed({ documents: [PERSONAL_DOC] });
});

describe("reading another user's personal document", () => {
    // ensureDocAccess falls through to the creator check for a document with
    // no project, workflow or org, and u2 is not the creator. Each of these
    // handlers fetches the row by id — without a user_id filter — and relies
    // entirely on that check, which is what these tests defend.
    const paths = [
        ["the document itself", "/single-documents/doc-a"],
        ["its display payload", "/single-documents/doc-a/display"],
        ["its download url", "/single-documents/doc-a/url"],
        ["its docx bytes", "/single-documents/doc-a/docx"],
        ["its version history", "/single-documents/doc-a/versions"],
    ] as const;

    for (const [what, path] of paths) {
        it(`refuses ${what}`, async () => {
            const res = await request(app()).get(path);

            expect(res.status).toBe(404);
            // The refusal must not confirm the document exists.
            expect(JSON.stringify(res.body)).not.toContain(OWNER);
        });
    }
});

describe("writing to another user's personal document", () => {
    it("does not delete it", async () => {
        const res = await request(app()).delete("/single-documents/doc-a");

        expect(res.status).toBe(404);
    });
});

describe("listing", () => {
    it("does not include another user's documents", async () => {
        const res = await request(app()).get("/single-documents/");

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain("doc-a");
    });
});
