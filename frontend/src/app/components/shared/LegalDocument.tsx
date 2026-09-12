import Link from "next/link";
import type { ReactNode } from "react";
import { SiteLogo } from "@/app/components/site-logo";
import { POLICY_EFFECTIVE_DATE } from "@/app/lib/operatorDetails";

/**
 * The shell the Terms of Use and the Privacy Policy share.
 *
 * Both are public routes for the same reason `/legal` is: someone deciding
 * whether to sign up has to be able to read them before they have an account,
 * and the signup form asserts agreement to them. Server components — the
 * content is static, so there is no reason to ship it to the client or gate it
 * behind auth state.
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

export function LegalDocument({
    title,
    summary,
    children,
}: {
    title: string;
    /** One line saying what the document is for, before the detail starts. */
    summary: string;
    children: ReactNode;
}) {
    return (
        <main className="mx-auto w-full max-w-2xl px-6 py-16">
            <div className="mb-10">
                <SiteLogo size="md" />
            </div>

            <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>

            <p className="mt-3 text-sm text-gray-500">
                In effect from {POLICY_EFFECTIVE_DATE}.
            </p>

            <p className="mt-6 text-sm leading-relaxed text-gray-700">
                {summary}
            </p>

            <div className="mt-10 space-y-10">{children}</div>

            <nav className="mt-16 flex flex-wrap gap-x-6 gap-y-2 border-t border-gray-200 pt-6 text-sm text-gray-500">
                <Link
                    href="/terms"
                    className="underline underline-offset-2 hover:text-gray-900"
                >
                    Terms of Use
                </Link>
                <Link
                    href="/privacy"
                    className="underline underline-offset-2 hover:text-gray-900"
                >
                    Privacy Policy
                </Link>
                <Link
                    href="/legal"
                    className="underline underline-offset-2 hover:text-gray-900"
                >
                    Licence notices
                </Link>
            </nav>
        </main>
    );
}

/** One numbered section of a policy. */
export function LegalSection({
    heading,
    children,
}: {
    heading: string;
    children: ReactNode;
}) {
    return (
        <section className="space-y-4 text-sm leading-relaxed text-gray-700">
            <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
            {children}
        </section>
    );
}
