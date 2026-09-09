// Audit events for direct project access grants.
//
// Kept beside projectAccess.ts rather than inside it: that file is inherited
// from upstream and still changes there, so the event shapes live here and the
// inherited functions call in once each (see fork rule 3 in AGENTS.md).
//
// These are the events a client security questionnaire asks about by name —
// who granted whom access to what, and who took it away. Every call goes
// through recordAudit, which never throws: an audit failure must not turn a
// successful share into a 500.

import { recordAudit } from "./audit";
import type { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

/** Who performed the action. Subject and resource are per-event. */
export type AccessAuditActor = {
    actorId: string;
    actorEmail?: string | null;
};

export const PROJECT_ACCESS_GRANTED = "project.access.granted";
export const PROJECT_ACCESS_REVOKED = "project.access.revoked";
export const PROJECT_ACCESS_PURGED = "project.access.purged";

/**
 * The subject goes in `title` as well as `detail` because the audit export's
 * CSV projection carries title but not detail: without it a reader of the
 * export sees that access changed but not whose.
 */
export async function recordProjectAccessGranted(
    db: Db,
    actor: AccessAuditActor,
    params: { projectId: string; subjectEmail: string; role: string },
): Promise<void> {
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail ?? null,
        action: PROJECT_ACCESS_GRANTED,
        projectId: params.projectId,
        title: params.subjectEmail,
        detail: {
            subject_email: params.subjectEmail,
            role: params.role,
        },
    });
}

export async function recordProjectAccessRevoked(
    db: Db,
    actor: AccessAuditActor,
    params: { projectId: string; subjectEmail: string },
): Promise<void> {
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail ?? null,
        action: PROJECT_ACCESS_REVOKED,
        projectId: params.projectId,
        title: params.subjectEmail,
        detail: { subject_email: params.subjectEmail },
    });
}

/**
 * Every grant addressed to one person removed at once, which happens when an
 * account is deleted. There is no single project to attribute it to, so the
 * count is the resource: "12 grants revoked" is the auditable fact.
 */
export async function recordProjectAccessPurged(
    db: Db,
    actor: AccessAuditActor,
    params: { subjectEmail: string; revokedCount: number },
): Promise<void> {
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail ?? null,
        action: PROJECT_ACCESS_PURGED,
        title: params.subjectEmail,
        detail: {
            subject_email: params.subjectEmail,
            revoked_count: params.revokedCount,
        },
    });
}
