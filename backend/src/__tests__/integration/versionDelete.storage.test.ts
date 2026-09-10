/**
 * Deleting one version must hand its bytes to the durable cleanup job, and
 * must include the extracted-text cache.
 *
 * Both halves are regressions waiting to happen, and neither is visible from
 * the response: the route returns 200 whether the objects are removed, leaked,
 * or left behind entirely. Only the calls it makes can tell you.
 *
 * - Fire-and-forget `deleteFile(...).catch(() => {})` swallows a storage
 *   failure, and the path columns are nulled in the same handler, so the
 *   bytes end up with nothing pointing at them. deleteDocumentAndVersionFiles
 *   already learned this and moved to the queue.
 * - `extracted-text/<versionId>.txt` holds the version's full plain text and
 *   is keyed by version id, so it sits outside the per-user prefixes the
 *   account-deletion sweep walks. Deleting the document used to be the only
 *   path that reached it.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
const { enqueueStorageCleanup, deleteFile } = vi.hoisted(() => ({
    enqueueStorageCleanup: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
}));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => ({ from }),
}));

vi.mock("../../lib/dbq/enqueue", () => ({ enqueueStorageCleanup }));

// Only deleteFile is replaced; the key helpers stay real so the assertion
// below is checking the actual extracted-text key, not a stub of one.
vi.mock("../../lib/storage", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    deleteFile,
}));

vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { locals: Record<string, unknown> },
        next: () => void,
    ) => {
        res.locals.userId = "owner-1";
        res.locals.userEmail = "owner@test.local";
        next();
    },
}));

import { documentsRouter } from "../../routes/documents";

const DOC = "doc-1";
const KEEP = "ver-keep";
const DOOMED = "ver-doomed";

type Row = Record<string, unknown>;

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

beforeEach(() => {
    vi.clearAllMocks();
    seed({
        documents: [
            {
                id: DOC,
                user_id: "owner-1",
                project_id: null,
                org_id: null,
                workflow_id: null,
                current_version_id: KEEP,
            },
        ],
        document_versions: [
            {
                id: KEEP,
                document_id: DOC,
                storage_path: "documents/owner-1/doc-1/source.docx",
                pdf_storage_path: null,
                version_number: 2,
                created_at: "2026-01-02T00:00:00Z",
                deleted_at: null,
            },
            {
                id: DOOMED,
                document_id: DOC,
                storage_path: "documents/owner-1/doc-1/versions/v1.docx",
                pdf_storage_path: "documents/owner-1/doc-1/v1.pdf",
                version_number: 1,
                created_at: "2026-01-01T00:00:00Z",
                deleted_at: null,
            },
        ],
    });
});

describe("deleting one document version", () => {
    it("hands every object to the durable cleanup job, never deletes inline", async () => {
        await request(app())
            .delete(`/single-documents/${DOC}/versions/${DOOMED}`)
            .expect(200);

        expect(enqueueStorageCleanup).toHaveBeenCalledTimes(1);
        const keys = enqueueStorageCleanup.mock.calls[0][1] as string[];
        expect(keys).toContain("documents/owner-1/doc-1/versions/v1.docx");
        expect(keys).toContain("documents/owner-1/doc-1/v1.pdf");

        // A swallowed inline delete is the bug; the queue is the fix.
        expect(deleteFile).not.toHaveBeenCalled();
    });

    it("includes the extracted-text cache, which holds the version's full text", async () => {
        await request(app())
            .delete(`/single-documents/${DOC}/versions/${DOOMED}`)
            .expect(200);

        const keys = enqueueStorageCleanup.mock.calls[0][1] as string[];
        expect(keys).toContain(`extracted-text/${DOOMED}.txt`);
    });

    it("never enqueues an empty or null-bearing key", async () => {
        await request(app())
            .delete(`/single-documents/${DOC}/versions/${DOOMED}`)
            .expect(200);

        const keys = enqueueStorageCleanup.mock.calls[0][1] as string[];
        expect(keys.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
    });

    it("refuses to delete the only remaining version", async () => {
        seed({
            documents: [
                {
                    id: DOC,
                    user_id: "owner-1",
                    project_id: null,
                    org_id: null,
                    workflow_id: null,
                    current_version_id: KEEP,
                },
            ],
            document_versions: [
                {
                    id: KEEP,
                    document_id: DOC,
                    storage_path: "documents/owner-1/doc-1/source.docx",
                    pdf_storage_path: null,
                    version_number: 1,
                    created_at: "2026-01-01T00:00:00Z",
                    deleted_at: null,
                },
            ],
        });

        await request(app())
            .delete(`/single-documents/${DOC}/versions/${KEEP}`)
            .expect(400);

        expect(enqueueStorageCleanup).not.toHaveBeenCalled();
    });
});
