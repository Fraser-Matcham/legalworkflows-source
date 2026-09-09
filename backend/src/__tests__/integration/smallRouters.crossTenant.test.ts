import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc, verifyDownload, downloadFile } = vi.hoisted(() => ({
    from: vi.fn(),
    rpc: vi.fn(),
    verifyDownload: vi.fn(),
    downloadFile: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => ({ from, rpc }),
}));

vi.mock("../../lib/downloadTokens", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../../lib/downloadTokens")>();
    return { ...actual, verifyDownload };
});

vi.mock("../../lib/storage", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/storage")>();
    return { ...actual, downloadFile };
});

// Every request below is made by u2. The fixtures belong to u1.
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

import { downloadsRouter } from "../../routes/downloads";
import { quickActionsRouter } from "../../routes/quickActions";

const OWNER = "u1";

type Row = Record<string, unknown>;

let seeded: Record<string, Row[]> = {};
const rowsOf = (table: string) => seeded[table] ?? [];

/** As in the sibling files, the fake ENFORCES .eq() filters. */
function seed(tables: Record<string, Row[]>) {
    seeded = tables;
    from.mockImplementation((table: string) => {
        const filters: { col: string; val: unknown }[] = [];
        const rows = () =>
            (tables[table] ?? []).filter((r) =>
                filters.every((f) => r[f.col] === f.val),
            );
        const query: Record<string, unknown> = {};
        const chain = () => query;
        for (const m of ["select", "update", "insert", "order", "limit", "in", "or", "is"]) {
            query[m] = chain;
        }
        // delete() actually removes the matching rows, so a test can assert
        // that another tenant's row SURVIVED rather than trusting a status
        // code. quick_actions returns 204 whether or not anything matched.
        //
        // The removal happens when the query is AWAITED, not as each .eq() is
        // chained: applying it per-filter would delete after .eq("id", …) and
        // before .eq("user_id", …), which looks exactly like the route
        // ignoring tenancy. That false alarm is easy to raise and hard to
        // unsee, so the fake defers.
        let deleting = false;
        query.delete = () => {
            deleting = true;
            return query;
        };
        const applyDelete = () => {
            if (!deleting) return;
            const doomed = new Set(rows());
            tables[table] = (tables[table] ?? []).filter((r) => !doomed.has(r));
        };
        query.eq = (col: string, val: unknown) => {
            filters.push({ col, val });
            return query;
        };
        query.single = () =>
            Promise.resolve({ data: rows()[0] ?? null, error: null });
        query.maybeSingle = query.single;
        query.then = (res: (v: unknown) => unknown) => {
            const data = rows();
            applyDelete();
            return Promise.resolve({ data, error: null }).then(res);
        };
        return query;
    });
}

function app(mount: string, router: express.Router) {
    const a = express();
    a.use(express.json());
    a.use(mount, router);
    return a;
}

beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });
    verifyDownload.mockReset();
    downloadFile.mockReset();
});

describe("a download token issued for another user's file", () => {
    it("is refused even though the token itself is valid", async () => {
        // The signature check passes: this is a genuine, unexpired token for
        // a real storage path. What must stop u2 is the access check on the
        // document behind it — a signed URL is not, on its own, authority.
        verifyDownload.mockReturnValue({
            path: "documents/u1/contract.docx",
            filename: "contract.docx",
        });
        seed({
            document_versions: [
                {
                    id: "v1",
                    document_id: "doc-a",
                    storage_path: "documents/u1/contract.docx",
                    deleted_at: null,
                },
            ],
            documents: [
                {
                    id: "doc-a",
                    user_id: OWNER,
                    project_id: null,
                    org_id: null,
                    workflow_id: null,
                },
            ],
        });

        const res = await request(app("/download", downloadsRouter)).get(
            "/download/a-valid-token",
        );

        expect(res.status).toBe(404);
        // The file must never be read from storage for a caller who cannot
        // see the document.
        expect(downloadFile).not.toHaveBeenCalled();
    });
});

describe("another user's quick actions", () => {
    beforeEach(() => {
        seed({
            quick_actions: [
                { id: "qa-a", user_id: OWNER, label: "u1's private action" },
            ],
        });
    });

    it("are not listed", async () => {
        const res = await request(app("/quick-actions", quickActionsRouter)).get(
            "/quick-actions/",
        );

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain("qa-a");
        expect(JSON.stringify(res.body)).not.toContain("private action");
    });

    it("cannot be renamed", async () => {
        const res = await request(app("/quick-actions", quickActionsRouter))
            .patch("/quick-actions/qa-a")
            .send({ label: "renamed by u2" });

        expect(res.status).toBe(404);
    });

    it("survive a delete issued by another user", async () => {
        // The handler scopes the delete by user_id and then returns 204
        // regardless of whether anything matched. That is idempotent rather
        // than leaky — it does not disclose whether the id exists — so the
        // security property to assert is the DATA outcome, not the status.
        const res = await request(
            app("/quick-actions", quickActionsRouter),
        ).delete("/quick-actions/qa-a");

        expect(res.status).toBe(204);
        expect(rowsOf("quick_actions").map((r) => r.id)).toEqual(["qa-a"]);
    });
});
