import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => ({ from, rpc }),
}));

// Every request below is made by u2. The workflow belongs to u1.
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

import { workflowsRouter } from "../../routes/workflows";

const OWNER = "u1";

type Row = Record<string, unknown>;

/** As in the sibling files, the fake ENFORCES .eq() filters. */
function seed(tables: Record<string, Row[]>) {
    from.mockImplementation((table: string) => {
        const filters: { col: string; val: unknown }[] = [];
        const rows = () =>
            (tables[table] ?? []).filter((r) =>
                filters.every((f) => r[f.col] === f.val),
            );
        const query: Record<string, unknown> = {};
        const chain = () => query;
        for (const m of ["select", "update", "delete", "insert", "order", "limit", "in", "or", "is"]) {
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
    rpc.mockResolvedValue({ data: [], error: null });
}

function app() {
    const a = express();
    a.use(express.json());
    a.use("/workflows", workflowsRouter);
    return a;
}

/** A personal workflow: no organisation to inherit access from. */
const PERSONAL_WORKFLOW: Row = {
    id: "wf-a",
    user_id: OWNER,
    org_id: null,
    title: "u1's private workflow",
};

beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    seed({ workflows: [PERSONAL_WORKFLOW] });
});

describe("reading another user's workflow", () => {
    // checkWorkflowAccess finds the row, sees u2 is neither the creator nor a
    // member of an owning organisation, and denies. Each handler resolves
    // access through it before touching the record.
    const reads = [
        ["the workflow itself", "/workflows/wf-a"],
        ["its assets", "/workflows/wf-a/assets"],
        ["the people who can see it", "/workflows/wf-a/people"],
        ["its shares", "/workflows/wf-a/shares"],
    ] as const;

    for (const [what, path] of reads) {
        it(`refuses ${what}`, async () => {
            const res = await request(app()).get(path);

            expect(res.status).toBe(404);
            // The refusal must not disclose the owner or the title.
            expect(JSON.stringify(res.body)).not.toContain(OWNER);
            expect(JSON.stringify(res.body)).not.toContain("private workflow");
        });
    }
});

describe("writing to another user's workflow", () => {
    it("does not update it", async () => {
        const res = await request(app())
            .patch("/workflows/wf-a")
            .send({ title: "renamed by u2" });

        expect(res.status).toBe(404);
    });

    it("does not replace it", async () => {
        const res = await request(app())
            .put("/workflows/wf-a")
            .send({ title: "replaced by u2" });

        expect(res.status).toBe(404);
    });

    it("does not delete it", async () => {
        const res = await request(app()).delete("/workflows/wf-a");

        expect(res.status).toBe(404);
    });

    it("does not share it onwards", async () => {
        // Sharing is the highest-privilege operation on a workflow: it lets
        // the caller widen access permanently, so it is the one most worth
        // proving is refused.
        const res = await request(app())
            .post("/workflows/wf-a/share")
            .send({ emails: ["accomplice@example.com"], role: "editor" });

        // 404, not 400: the body is valid, so the request reaches the access
        // check and is refused there. Asserting the exact status matters —
        // a malformed body 400s before the check and would look like a
        // passing denial test while proving nothing.
        expect(res.status).toBe(404);
    });
});
