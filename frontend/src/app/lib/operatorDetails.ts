/**
 * Who operates this service, and how to reach them.
 *
 * The same idea as `legalNotice.ts`: these are compliance values, not copy.
 * The Terms of Use and the Privacy Policy both assert them, and UK GDPR
 * Article 13 requires the controller's identity and contact details to be
 * given to the data subject — so a wrong value here is a compliance defect
 * rather than a typo. Change them with whoever owns the legal position.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

/**
 * The data controller, and the party you contract with.
 *
 * A sole trader, as recorded in `legalNotice.ts`. If that ever becomes a
 * limited company, this and the company number below both change, and so does
 * the liability wording in the Terms.
 */
export const OPERATOR_NAME = "Fraser Matcham";

/** The name the service trades under. */
export const TRADING_NAME = "legalworkflows";

/** The public origin. Kept here so the policies and the links cannot diverge. */
export const SERVICE_DOMAIN = "legalworkflows.co.uk";

export const CONTACT_EMAIL = `support@${SERVICE_DOMAIN}`;
export const PRIVACY_EMAIL = `privacy@${SERVICE_DOMAIN}`;

/**
 * Date the current versions took effect. Shown on both policies: a policy
 * without a date cannot be relied on, because nobody can tell which version
 * they agreed to.
 */
export const POLICY_EFFECTIVE_DATE = "12 September 2026";

/**
 * The jurisdiction the Terms are governed by, and whose courts have
 * jurisdiction. England and Wales, the operator being a UK sole trader.
 */
export const GOVERNING_LAW = "England and Wales";

/**
 * Optional details that are published only once they exist.
 *
 * Neither is required for the policies to be lawful — Article 13 is satisfied
 * by a name and a means of contact — but both are expected by a law firm's
 * due-diligence questionnaire, and the ICO registration is a separate legal
 * obligation on the operator rather than on this code. They render only when
 * set, so the pages never display an empty field or a placeholder address.
 */
export const ICO_REGISTRATION_NUMBER = "";
export const POSTAL_ADDRESS = "";

/** Third parties that process data on the operator's behalf. */
export type SubProcessor = {
    name: string;
    purpose: string;
    /** Where the processing takes place, as far as the operator controls it. */
    location: string;
};

/**
 * The sub-processors this deployment actually uses.
 *
 * Taken from `docs/data-retention.md` rather than written from memory: the
 * database and object storage are the only two places client content rests,
 * and the model provider is the only place it is sent.
 */
export const SUB_PROCESSORS: readonly SubProcessor[] = [
    {
        name: "Supabase",
        purpose:
            "Hosted PostgreSQL database and the authentication system. Holds every record: accounts, documents and their metadata, chats, reviews, access grants and the audit trail.",
        location: "United Kingdom (London region)",
    },
    {
        name: "Amazon Web Services",
        purpose:
            "Hosting for the application itself, and object storage for file content — uploaded documents, PDF renditions, generated documents and export archives.",
        location: "United Kingdom (London region)",
    },
    {
        name: "Anthropic",
        purpose:
            "The AI model that answers questions about your documents. Document text and your prompts are sent to it when you use the assistant or a review.",
        location: "United States, under appropriate transfer safeguards",
    },
    {
        name: "Resend",
        purpose:
            "Sends account emails only — address confirmation and password resets. Never receives document content.",
        location: "United States, under appropriate transfer safeguards",
    },
];
