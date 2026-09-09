import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => ({ from, rpc }),
}));

// Every request in this file is made by u2. The fixtures below belong to u1.
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

import { libraryRouter } from "../../routes/library";

const OWNER = "u1";
const CALLER = "u2";

type Row = Record<string, unknown>;

/**
 * A fake that ENFORCES .eq() filters rather than ignoring them.
 *
 * This is the whole point of the file: if the fake returned seeded rows
 * regardless of the filters, every test here would pass with or without the
 * `.eq("user_id", …)` scoping and would prove nothing. Because it filters,
 * deleting a scoping clause in the route makes the other tenant's row visible
 * and turns these tests red.
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
        query.select = chain;
        query.update = chain;
        query.delete = chain;
        query.order = chain;
        query.limit = chain;
        query.in = chain;
        query.or = chain;
        query.is = chain;
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

    // The RPCs scope on p_user_id, so honour it the same way.
    rpc.mockImplementation((_name: string, args: Record<string, unknown>) => {
        const owned = (tables.__rpc_rows ?? []).filter(
            (r) => r.user_id === args.p_user_id,
        );
        return Promise.resolve({ data: owned, error: null });
    });
}

function app() {
    const a = express();
    a.use(express.json());
    a.use("/library", libraryRouter);
    return a;
}

beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
});

describe("library reads are scoped to the caller", () => {
    it("does not return another user's document ids", async () => {
        seed({ __rpc_rows: [{ id: "doc-a", user_id: OWNER }] });

        const res = await request(app()).get("/library/file/ids");

        expect(res.status).toBe(200);
        // u1's document must not appear in u2's id list.
        expect(JSON.stringify(res.body)).not.toContain("doc-a");
        // And the scoping argument itself is the caller, asserted directly
        // rather than by searching the payload for a substring.
        expect(rpc.mock.calls[0][1]).toMatchObject({ p_user_id: CALLER });
    });

    it("passes the caller's id to the library search", async () => {
        seed({ __rpc_rows: [{ id: "doc-a", user_id: OWNER }] });

        const res = await request(app()).get("/library/file?view=search");

        expect(res.status).toBe(200);
        expect(rpc.mock.calls[0][1]).toMatchObject({ p_user_id: CALLER });
    });
});

describe("library writes refuse another user's resources", () => {
    it("will not delete a folder belonging to another user", async () => {
        seed({
            library_folders: [
                { id: "folder-a", user_id: OWNER, library_kind: "file", parent_folder_id: null },
            ],
        });

        const res = await request(app()).delete(
            "/library/file/folders/folder-a",
        );

        // The handler lists only the caller's folders, so u1's folder is not
        // among them and the request is refused rather than executed.
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ detail: "Folder not found" });
    });

    it("will not rename a document belonging to another user", async () => {
        seed({
            documents: [
                {
                    id: "doc-a",
                    user_id: OWNER,
                    project_id: null,
                    library_kind: "file",
                    current_version_id: "v1",
                },
            ],
        });

        const res = await request(app())
            .patch("/library/file/documents/doc-a")
            .send({ filename: "stolen.docx" });

        expect(res.status).toBe(404);
    });

    it("will not move another user's document into a folder", async () => {
        seed({
            library_folders: [
                { id: "folder-b", user_id: CALLER, library_kind: "file", parent_folder_id: null },
            ],
            documents: [
                { id: "doc-a", user_id: OWNER, project_id: null, library_kind: "file" },
            ],
        });

        const res = await request(app())
            .patch("/library/file/documents/doc-a/folder")
            .send({ folder_id: "folder-b" });

        expect(res.status).toBe(404);
    });
});
