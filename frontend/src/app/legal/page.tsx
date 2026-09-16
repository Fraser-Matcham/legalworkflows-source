import Link from "next/link";
import type { Metadata } from "next";
import { SiteLogo } from "@/app/components/site-logo";
import {
    LICENCE_NAME,
    LICENCE_URL,
    MODIFICATION_DATE,
    COPYRIGHT_HOLDER,
    COPYRIGHT_YEAR,
    UPSTREAM_NAME,
    UPSTREAM_ORG,
    UPSTREAM_URL,
    correspondingSourceUrl,
} from "@/app/lib/legalNotice";

/**
 * Appropriate Legal Notices, per section 5(d) of the GNU Affero General Public
 * License: a convenient and prominently visible feature displaying a copyright
 * notice, stating that there is no warranty, that licensees may convey the work
 * under the licence, and how to view a copy of the licence.
 *
 * Deliberately a public route rather than a settings tab. The notices have to be
 * reachable by anyone interacting with the service, which under section 13
 * includes users who reach it over a network without signing in.
 *
 * A server component: the content is static, so there is no reason to ship it to
 * the client or gate it behind auth state.
 */
export const metadata: Metadata = {
    title: "Legal notices",
    description:
        "Copyright, warranty and licence notices for this service, and how to view the licence.",
};

export default function LegalNoticesPage() {
    // The literal expression is required: Next substitutes NEXT_PUBLIC_* at
    // build time by textual match on exactly this form.
    const sourceUrl = correspondingSourceUrl(process.env.NEXT_PUBLIC_SOURCE_URL);

    return (
        <main className="mx-auto w-full max-w-2xl px-6 py-16">
            <div className="mb-10">
                <SiteLogo size="md" />
            </div>

            <h1 className="text-2xl font-semibold text-gray-900">Legal notices</h1>

            <section className="mt-8 space-y-4 text-sm leading-relaxed text-gray-700">
                <p data-testid="copyright-notice">
                    Copyright © {COPYRIGHT_YEAR} {COPYRIGHT_HOLDER}. Portions
                    copyright {UPSTREAM_ORG} and its contributors.
                </p>

                <p>
                    This service is a modified version of{" "}
                    <Link
                        href={UPSTREAM_URL}
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        {UPSTREAM_NAME}
                    </Link>{" "}
                    by {UPSTREAM_ORG}. Modified by {COPYRIGHT_HOLDER}, beginning{" "}
                    {MODIFICATION_DATE}.
                </p>

                <p data-testid="licence-notice">
                    This program is free software: you can redistribute it and/or
                    modify it under the terms of the {LICENCE_NAME} as published by
                    the Free Software Foundation, either version 3 of the License,
                    or (at your option) any later version. Licensees may convey the
                    work under this licence.
                </p>

                <p data-testid="warranty-notice">
                    This program is distributed in the hope that it will be useful,
                    but <strong>WITHOUT ANY WARRANTY</strong>; without even the
                    implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
                    PURPOSE. See the {LICENCE_NAME} for more details.
                </p>

                <p data-testid="source-offer">
                    The complete source code of the version of this program you
                    are using — its Corresponding Source, as the licence calls
                    it — is available at no charge at{" "}
                    <Link
                        href={sourceUrl}
                        className="break-all underline underline-offset-2 hover:text-gray-900"
                    >
                        {sourceUrl}
                    </Link>
                    .
                </p>

                <p data-testid="third-party-notices">
                    This service includes third-party open-source components.
                    Their licences and attributions are listed in{" "}
                    <code>THIRD-PARTY-NOTICES.md</code>, distributed with the
                    source of this program.
                </p>

                <p data-testid="licence-link">
                    You can view a copy of the {LICENCE_NAME} at{" "}
                    <Link
                        href={LICENCE_URL}
                        className="underline underline-offset-2 hover:text-gray-900"
                    >
                        {LICENCE_URL}
                    </Link>
                    . A copy is also distributed with the source of this program, in
                    the file <code>LICENSE</code> at the root of the source tree.
                </p>
            </section>
        </main>
    );
}
