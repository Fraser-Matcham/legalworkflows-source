import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordAudit, findProfileUserByEmail } = vi.hoisted(() => ({
    recordAudit: vi.fn(),
    findProfileUserByEmail: vi.fn(),
}));

vi.mock("../audit", () => ({ recordAudit }));
vi.mock("../userLookup", () => ({ findProfileUserByEmail }));

import {
    deleteProjectGrant,
    removeGrantsForEmail,
    upsertProjectGrant,
} from "../projectAccess";

/**
 * Minimal stand-in for the grant table. Only the three shapes these functions
 * use are supported; anything else would be scaffolding for its own sake.
 */
function makeDb(opts: { deleted?: unknown[]; upsertError?: string } = {}) {
    return {
        from() {
            const chain: Record<string, unknown> = {};
            const self = () => chain;
            chain.upsert = self;
            chain.delete = self;
            chain.eq = self;
            chain.select = (..._args: unknown[]) => {
                // delete().eq().select() resolves to the removed rows;
                // upsert().select().single() resolves to the written row.
                const result = {
                    data: opts.deleted ?? [],
                    error: null,
                    single: () =>
                        Promise.resolve(
                            opts.upsertError
                                ? { data: null, error: { message: opts.upsertError } }
                                : { data: { id: "g1" }, error: null },
                        ),
                    then: (res: (v: unknown) => unknown) =>
                        Promise.resolve({
                            data: opts.deleted ?? [],
                            error: null,
                        }).then(res),
                };
                return result;
            };
            return chain;
        },
    } as never;
}

beforeEach(() => {
    recordAudit.mockReset();
    findProfileUserByEmail.mockReset();
    findProfileUserByEmail.mockResolvedValue({ user_id: "u2" });
});

describe("granting access", () => {
    it("records the actor, the subject and the resulting role", async () => {
        await upsertProjectGrant(makeDb(), {
            projectId: "p1",
            email: " Recipient@Example.com ",
            role: "editor",
            createdBy: "actor-1",
            actorEmail: "actor@example.com",
        });

        expect(recordAudit).toHaveBeenCalledTimes(1);
        const [, event] = recordAudit.mock.calls[0];
        expect(event).toMatchObject({
            userId: "actor-1",
            userEmail: "actor@example.com",
            action: "project.access.granted",
            projectId: "p1",
            // Normalised, so the trail records the address actually granted
            // rather than whatever casing the caller typed.
            title: "recipient@example.com",
            detail: { subject_email: "recipient@example.com", role: "editor" },
        });
    });

    it("records nothing when the write fails", async () => {
        const result = await upsertProjectGrant(makeDb({ upsertError: "boom" }), {
            projectId: "p1",
            email: "recipient@example.com",
            role: "editor",
            createdBy: "actor-1",
        });

        expect(result.ok).toBe(false);
        expect(recordAudit).not.toHaveBeenCalled();
    });

    it("records nothing when validation rejects the request", async () => {
        await upsertProjectGrant(makeDb(), {
            projectId: "p1",
            email: "not-an-email",
            role: "editor",
            createdBy: "actor-1",
        });

        expect(recordAudit).not.toHaveBeenCalled();
    });
});

describe("revoking access", () => {
    it("records the actor and the subject when a grant is removed", async () => {
        await deleteProjectGrant(makeDb({ deleted: [{ id: "g1" }] }), {
            projectId: "p1",
            email: "Recipient@Example.com",
            actorId: "actor-1",
            actorEmail: "actor@example.com",
        });

        expect(recordAudit).toHaveBeenCalledTimes(1);
        const [, event] = recordAudit.mock.calls[0];
        expect(event).toMatchObject({
            userId: "actor-1",
            action: "project.access.revoked",
            projectId: "p1",
            title: "recipient@example.com",
            detail: { subject_email: "recipient@example.com" },
        });
    });

    it("records nothing when no grant was there to remove", async () => {
        // A 404 for a grant that never existed is not an access change, and
        // logging it would make the trail describe attempts rather than facts.
        const result = await deleteProjectGrant(makeDb({ deleted: [] }), {
            projectId: "p1",
            email: "absent@example.com",
            actorId: "actor-1",
        });

        expect(result).toEqual({ ok: true, removed: false });
        expect(recordAudit).not.toHaveBeenCalled();
    });
});

describe("purging every grant for a departing account", () => {
    it("records how much access was revoked", async () => {
        await removeGrantsForEmail(
            makeDb({ deleted: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
            " Gone@Example.com ",
            { actorId: "gone-user", actorEmail: "gone@example.com" },
        );

        expect(recordAudit).toHaveBeenCalledTimes(1);
        const [, event] = recordAudit.mock.calls[0];
        expect(event).toMatchObject({
            userId: "gone-user",
            action: "project.access.purged",
            title: "gone@example.com",
            detail: { subject_email: "gone@example.com", revoked_count: 3 },
        });
        // No single project owns a purge, so projectId is deliberately unset.
        expect(event.projectId).toBeUndefined();
    });

    it("records nothing for an account with no email", async () => {
        await removeGrantsForEmail(makeDb(), null, { actorId: "gone-user" });
        expect(recordAudit).not.toHaveBeenCalled();
    });
});
