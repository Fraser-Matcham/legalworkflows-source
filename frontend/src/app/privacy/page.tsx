import Link from "next/link";
import type { Metadata } from "next";
import {
    LegalDocument,
    LegalSection,
} from "@/app/components/shared/LegalDocument";
import {
    ICO_REGISTRATION_NUMBER,
    OPERATOR_NAME,
    POSTAL_ADDRESS,
    PRIVACY_EMAIL,
    SERVICE_DOMAIN,
    SUB_PROCESSORS,
    TRADING_NAME,
} from "@/app/lib/operatorDetails";

export const metadata: Metadata = {
    title: "Privacy Policy",
    description: `How ${TRADING_NAME} handles personal data, under UK GDPR.`,
};

export default function PrivacyPage() {
    return (
        <LegalDocument
            title="Privacy Policy"
            summary={`${OPERATOR_NAME}, trading as ${TRADING_NAME} at ${SERVICE_DOMAIN}, is responsible for the personal data described here. This policy says what is collected, why, who it reaches, how long it is kept, and what you can ask us to do about it. It is written to be accurate about this service rather than generic.`}
        >
            <LegalSection heading="1. Two different roles">
                <p>
                    This matters more here than in most services, because of
                    what our customers upload.
                </p>
                <p>
                    For <strong>your account data</strong> — your name, email
                    address, sign-in records — we are the{" "}
                    <strong>controller</strong>. We decide why and how it is
                    processed, and this policy governs it.
                </p>
                <p>
                    For <strong>the documents you upload</strong>, which in a
                    legal practice usually contain personal data about your own
                    clients and third parties, you are the controller and we are
                    your <strong>processor</strong>. We act on your
                    instructions: we store that content, process it when you ask
                    us to, and delete it when you tell us to. If your firm needs
                    a data processing agreement recording that, ask us at{" "}
                    <Link
                        href={`mailto:${PRIVACY_EMAIL}`}
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        {PRIVACY_EMAIL}
                    </Link>
                    .
                </p>
            </LegalSection>

            <LegalSection heading="2. What we hold">
                <p>
                    <strong>Account data.</strong> Your email address, your
                    name if you give one, your password in hashed form, and
                    multi-factor authentication settings. Organisation
                    membership and invitations where you belong to one.
                </p>
                <p>
                    <strong>Your content.</strong> Documents you upload and
                    every version of them, PDF renditions, extracted text,
                    documents the assistant generates, your chats with the
                    assistant, tabular reviews and their cells, workflows, and
                    the export archives you request.
                </p>
                <p>
                    <strong>Records of use.</strong> One log line per request
                    carrying a request identifier, your user id, the route
                    pattern, the response status and how long it took.{" "}
                    <em>
                        Request bodies, response bodies, headers, cookies, query
                        strings and your IP address are never written to those
                        logs.
                    </em>
                </p>
                <p>
                    <strong>An audit trail</strong> of significant actions —
                    signing in, uploading, editing, exporting, granting or
                    revoking access to a project. Being straightforward about
                    this: audit records are not content-free. They store your id
                    and email address, document filenames, and for a chat they
                    store a title, which where a chat has not yet been named is
                    the first 120 characters of your message. We keep that
                    detail deliberately — an audit trail that cannot say what
                    happened is not an audit trail — and we treat those records
                    as your data, which is why deleting your account deletes
                    them.
                </p>
            </LegalSection>

            <LegalSection heading="3. Why we process it, and our lawful basis">
                <ul className="list-disc space-y-1.5 pl-5">
                    <li>
                        <strong>To provide the service</strong> you asked for —
                        storing documents, running the assistant, sharing with
                        colleagues.{" "}
                        <em>Performance of our contract with you.</em>
                    </li>
                    <li>
                        <strong>To keep accounts and content secure</strong> —
                        authentication, rate limiting, the audit trail,
                        investigating misuse.{" "}
                        <em>
                            Our legitimate interests in running a secure
                            service, and yours in your material staying
                            confidential.
                        </em>
                    </li>
                    <li>
                        <strong>To send account emails</strong> — confirming
                        your address, resetting your password.{" "}
                        <em>Performance of our contract with you.</em>
                    </li>
                    <li>
                        <strong>To meet legal obligations</strong> where they
                        apply. <em>Legal obligation.</em>
                    </li>
                </ul>
                <p>
                    We do not use your data for advertising, we do not profile
                    you, and we make no decisions about you by automated means
                    that produce legal or similarly significant effects.
                </p>
            </LegalSection>

            <LegalSection heading="4. AI providers, and what is sent to them">
                <p>
                    When you use the assistant or run a review, the relevant
                    document text and your prompt are sent to the AI provider
                    that serves the model in use, so that it can answer. That is
                    how the feature works; there is no way to use it without
                    that transfer.
                </p>
                <p>
                    <strong>
                        Your content is not used to train AI models.
                    </strong>{" "}
                    There is no training pipeline in this service and no path
                    that feeds stored content back to a provider for that
                    purpose.
                </p>
                <p>
                    If you configure your own provider key, your content goes to
                    that provider under your agreement with them, and their
                    retention terms apply rather than ours.
                </p>
            </LegalSection>

            <LegalSection heading="5. Who else processes it">
                <p>
                    These are our sub-processors. Nobody else receives your
                    content.
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                        <thead>
                            <tr className="border-b border-gray-200 text-gray-900">
                                <th className="py-2 pr-4 font-semibold">Who</th>
                                <th className="py-2 pr-4 font-semibold">
                                    What for
                                </th>
                                <th className="py-2 font-semibold">Where</th>
                            </tr>
                        </thead>
                        <tbody>
                            {SUB_PROCESSORS.map((processor) => (
                                <tr
                                    key={processor.name}
                                    className="border-b border-gray-100 align-top"
                                >
                                    <td className="py-2 pr-4 font-medium text-gray-900">
                                        {processor.name}
                                    </td>
                                    <td className="py-2 pr-4">
                                        {processor.purpose}
                                    </td>
                                    <td className="py-2">
                                        {processor.location}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p>
                    Where a sub-processor is outside the UK, the transfer is
                    made under the UK&apos;s approved safeguards — the
                    International Data Transfer Agreement, or the UK Addendum to
                    the EU Standard Contractual Clauses.
                </p>
                <p>
                    We may also disclose data where the law requires it. If we
                    receive such a demand and are permitted to tell you, we
                    will.
                </p>
            </LegalSection>

            <LegalSection heading="6. How long we keep it">
                <p>
                    Plainly:{" "}
                    <strong>
                        nothing you upload expires automatically.
                    </strong>{" "}
                    There is no scheduled purge and no archival tier. Your
                    content lives until something deletes it — you, someone in
                    your organisation with the right to, or deleting your
                    account.
                </p>
                <p>
                    We would rather say that than quote a retention period the
                    service does not enforce. If your firm needs content deleted
                    on a defined schedule, tell us and we will agree how.
                </p>
                <p>
                    <strong>Deleting your account</strong> removes your
                    documents and their stored bytes, your chats and reviews,
                    your workflows, and your audit records. Two deliberate
                    exceptions: content belonging to an organisation stays with
                    that organisation, so a colleague&apos;s work does not
                    vanish when you leave; and where we are required to keep
                    something by law, we keep that and nothing more.
                </p>
            </LegalSection>

            <LegalSection heading="7. How it is protected">
                <ul className="list-disc space-y-1.5 pl-5">
                    <li>Traffic is encrypted in transit; content is encrypted at rest by our storage providers.</li>
                    <li>
                        Sessions use a cookie that JavaScript cannot read, and
                        multi-factor authentication is available and
                        recommended.
                    </li>
                    <li>
                        Access to one customer&apos;s data by another is
                        prevented in the application and tested for
                        specifically: automated checks fail our build if a route
                        can reach data without establishing whose it is.
                    </li>
                    <li>
                        Secrets are stripped from logs by design, and a test
                        plants canary values to prove it.
                    </li>
                </ul>
                <p>
                    No service can promise absolute security. If a breach
                    affects your personal data and is likely to present a risk
                    to you, we will tell you and the Information
                    Commissioner&apos;s Office as the law requires.
                </p>
            </LegalSection>

            <LegalSection heading="8. Cookies">
                <p>
                    We set one cookie, to keep you signed in. It is strictly
                    necessary for the service to work, which is why you are not
                    asked to consent to it.
                </p>
                <p>
                    <strong>
                        There is no analytics, advertising or tracking
                        technology in this service
                    </strong>{" "}
                    — no third-party scripts of any kind.
                </p>
            </LegalSection>

            <LegalSection heading="9. Your rights">
                <p>
                    Under UK GDPR you may ask us to give you a copy of your
                    personal data, correct it, delete it, restrict or object to
                    how we use it, or provide it in a portable form. Where we
                    rely on legitimate interests you may object, and we will
                    stop unless we have compelling grounds not to.
                </p>
                <p>
                    Much of this you can do yourself: Settings lets you export
                    your data and delete your account without asking us. For
                    anything else, write to{" "}
                    <Link
                        href={`mailto:${PRIVACY_EMAIL}`}
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        {PRIVACY_EMAIL}
                    </Link>
                    . We respond within one month.
                </p>
                <p>
                    Where the request concerns documents you uploaded about
                    someone else, you are the controller of that data and the
                    request belongs to you — tell us what you need and we will
                    help you meet it.
                </p>
                <p>
                    You may complain to the Information Commissioner&apos;s
                    Office at{" "}
                    <Link
                        href="https://ico.org.uk/make-a-complaint/"
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        ico.org.uk
                    </Link>
                    , though we would appreciate the chance to put things right
                    first.
                </p>
            </LegalSection>

            <LegalSection heading="10. Children">
                <p>
                    This is a professional tool and is not intended for anyone
                    under 18. We do not knowingly collect their data.
                </p>
            </LegalSection>

            <LegalSection heading="11. Changes">
                <p>
                    If this policy changes we will update the date at the top,
                    and where the change materially affects you we will tell you
                    by email or in the application before it takes effect.
                </p>
            </LegalSection>

            <LegalSection heading="12. Contact">
                <p>
                    {OPERATOR_NAME}, trading as {TRADING_NAME}, is the data
                    controller for your account data.
                </p>
                <p>
                    <Link
                        href={`mailto:${PRIVACY_EMAIL}`}
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        {PRIVACY_EMAIL}
                    </Link>
                    {POSTAL_ADDRESS ? (
                        <>
                            <br />
                            {POSTAL_ADDRESS}
                        </>
                    ) : null}
                    {ICO_REGISTRATION_NUMBER ? (
                        <>
                            <br />
                            ICO registration {ICO_REGISTRATION_NUMBER}
                        </>
                    ) : null}
                </p>
            </LegalSection>
        </LegalDocument>
    );
}
