import Link from "next/link";
import type { Metadata } from "next";
import {
    LegalDocument,
    LegalSection,
} from "@/app/components/shared/LegalDocument";
import {
    CONTACT_EMAIL,
    GOVERNING_LAW,
    OPERATOR_NAME,
    SERVICE_DOMAIN,
    TRADING_NAME,
} from "@/app/lib/operatorDetails";

export const metadata: Metadata = {
    title: "Terms of Use",
    description: `The terms on which you may use ${TRADING_NAME}.`,
};

export default function TermsPage() {
    return (
        <LegalDocument
            title="Terms of Use"
            summary={`These terms are the agreement between you and ${OPERATOR_NAME}, who operates ${TRADING_NAME} at ${SERVICE_DOMAIN}. By creating an account or using the service you accept them. If you are using the service for your firm, you accept them on its behalf and confirm you are authorised to do so.`}
        >
            <LegalSection heading="1. What the service does">
                <p>
                    {TRADING_NAME} lets you upload documents and use an AI
                    assistant to read, summarise, compare, review and draft from
                    them. It produces suggestions and drafts. It does not
                    produce legal advice.
                </p>
                <p>
                    Nothing in the service creates a solicitor–client
                    relationship between you and us. We are not your lawyers and
                    we do not supervise your work. Where you use output in
                    client work, that work remains yours, and so does the
                    professional responsibility for it.
                </p>
            </LegalSection>

            <LegalSection heading="2. AI output must be checked">
                <p>
                    Large language models produce confident text that can be
                    wrong. They can misread a clause, miss one entirely,
                    misattribute a quotation, or cite authority that does not
                    say what the citation claims — or that does not exist.
                </p>
                <p>
                    <strong>
                        Output must be reviewed by a suitably qualified person
                        before it is relied on, sent to a client, or filed
                        anywhere it matters.
                    </strong>{" "}
                    Citations and quotations must be checked against the source.
                    We provide tools to make that checking easier; we do not
                    provide a substitute for it.
                </p>
            </LegalSection>

            <LegalSection heading="3. Your account">
                <p>
                    You must be 18 or over and give accurate registration
                    details. You are responsible for what happens under your
                    account, so keep your password to yourself and tell us
                    promptly at{" "}
                    <Link
                        href={`mailto:${CONTACT_EMAIL}`}
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        {CONTACT_EMAIL}
                    </Link>{" "}
                    if you think someone else has access to it.
                </p>
                <p>
                    We strongly recommend turning on multi-factor
                    authentication. For an account holding client material it is
                    the single most effective protection available to you.
                </p>
            </LegalSection>

            <LegalSection heading="4. Your content stays yours">
                <p>
                    You keep all rights in the documents you upload and the
                    material you create. We claim no ownership of it.
                </p>
                <p>
                    You grant us only the permission we need to run the service
                    for you: to store your content, process it, send it to the
                    AI provider when you ask for assistance, and show it back to
                    you and to people you have shared it with. That permission
                    ends when you delete the content or your account.
                </p>
                <p>
                    <strong>
                        We do not train AI models on your content, and we do not
                        sell it or share it for advertising.
                    </strong>
                </p>
                <p>
                    You confirm you have the right to upload what you upload,
                    including where it contains someone else&apos;s
                    confidential, privileged or personal information.
                </p>
            </LegalSection>

            <LegalSection heading="5. Acceptable use">
                <p>You must not:</p>
                <ul className="list-disc space-y-1.5 pl-5">
                    <li>
                        use the service unlawfully, or to produce anything
                        unlawful;
                    </li>
                    <li>
                        try to reach another customer&apos;s data, or probe,
                        scan or test the security of the service except with our
                        written permission;
                    </li>
                    <li>
                        upload malware, or content you know to be harmful to
                        recipients;
                    </li>
                    <li>
                        circumvent rate limits, usage limits or access controls,
                        or automate use in a way that degrades the service for
                        others;
                    </li>
                    <li>
                        resell or provide the service to a third party as your
                        own without our agreement.
                    </li>
                </ul>
                <p>
                    The software is open source and you have the rights the
                    licence gives you, including to study and modify it — see
                    the{" "}
                    <Link
                        href="/legal"
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        licence notices
                    </Link>
                    . Those rights concern the software, not this hosted
                    service, and exercising them does not permit you to attack
                    the deployment other people rely on.
                </p>
            </LegalSection>

            <LegalSection heading="6. Availability and change">
                <p>
                    We aim to keep the service available and will try to give
                    notice of planned maintenance, but we do not guarantee
                    uninterrupted availability, and we do not currently offer a
                    service-level agreement. If you need one, contact us.
                </p>
                <p>
                    We may change, add to or withdraw features. Where a change
                    materially reduces what the service does for you, we will
                    tell you.
                </p>
            </LegalSection>

            <LegalSection heading="7. Charges">
                <p>
                    Where a plan carries a charge, the amount and the billing
                    period are stated before you commit to it, and changes are
                    notified in advance. You are responsible for charges from
                    the AI provider where you use your own provider key.
                </p>
            </LegalSection>

            <LegalSection heading="8. Suspension and ending the agreement">
                <p>
                    You may stop using the service at any time and delete your
                    account from Settings. Deleting your account deletes your
                    content, as described in the{" "}
                    <Link
                        href="/privacy"
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        Privacy Policy
                    </Link>
                    . Content belonging to an organisation you were a member of
                    stays with the organisation.
                </p>
                <p>
                    We may suspend or end your access if you break these terms
                    in a way that is serious or that you do not put right after
                    we ask, or if we must do so to comply with the law or to
                    protect the service or its users. Where circumstances allow,
                    we will warn you first and give you a chance to export your
                    content.
                </p>
            </LegalSection>

            <LegalSection heading="9. Our responsibility to you">
                <p>
                    Nothing in these terms limits liability for death or
                    personal injury caused by negligence, for fraud or
                    fraudulent misrepresentation, or for anything else that
                    cannot lawfully be limited.
                </p>
                <p>
                    Subject to that, and because this is a business service: we
                    are not liable for loss of profit, loss of business,
                    business interruption, loss of anticipated savings, or
                    indirect or consequential loss; and our total liability
                    arising in any twelve-month period is limited to the greater
                    of the charges you paid us in that period and £100.
                </p>
                <p>
                    We are not liable for loss arising from output you relied on
                    without the review described in section 2, or from content
                    you uploaded without the right to do so.
                </p>
                <p>
                    Keep your own copies of anything important. The service is
                    not a system of record and is not a backup.
                </p>
            </LegalSection>

            <LegalSection heading="10. Your responsibility to us">
                <p>
                    If a third party brings a claim against us because of
                    content you uploaded or how you used the service in breach
                    of these terms, you will cover the reasonable losses and
                    costs we suffer as a result, provided we tell you promptly
                    and let you take part in the defence.
                </p>
            </LegalSection>

            <LegalSection heading="11. Changes to these terms">
                <p>
                    We may update these terms. The date at the top shows when
                    the current version took effect. Where a change materially
                    affects your rights we will give reasonable notice by email
                    or in the application before it applies. Continuing to use
                    the service after that means you accept the new terms.
                </p>
            </LegalSection>

            <LegalSection heading="12. Law and disputes">
                <p>
                    These terms are governed by the law of {GOVERNING_LAW}, and
                    the courts of {GOVERNING_LAW} have exclusive jurisdiction.
                </p>
                <p>
                    If something goes wrong, please contact us first at{" "}
                    <Link
                        href={`mailto:${CONTACT_EMAIL}`}
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        {CONTACT_EMAIL}
                    </Link>
                    . Most problems are quicker to fix than to argue about.
                </p>
            </LegalSection>

            <LegalSection heading="13. Contact">
                <p>
                    {OPERATOR_NAME}, trading as {TRADING_NAME}.
                    <br />
                    <Link
                        href={`mailto:${CONTACT_EMAIL}`}
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        {CONTACT_EMAIL}
                    </Link>
                </p>
            </LegalSection>
        </LegalDocument>
    );
}
