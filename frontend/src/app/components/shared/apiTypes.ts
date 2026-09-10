/**
 * The API contract, re-declared on the frontend's side of the boundary.
 *
 * These nine types were imported directly from `backend/src` until now. Two
 * `import type` statements do not sound like much, but they were the reason
 * `frontend/Dockerfile` had to take the repository root as its build context
 * and copy the backend's sources into the image — which in turn meant the
 * frontend could not be built, tested or deployed as a component in its own
 * right.
 *
 * Duplicating them is the deliberate trade, and it is the same one AGENTS.md
 * fork rule 1 already makes for the Juralio boundary: "Re-declare shared types
 * on each side rather than importing them; a duplicated interface is the cost
 * of the boundary, not a smell."
 *
 * These describe JSON that arrives over HTTP. They are a *contract*, not a
 * convenience: the backend is free to change its internal representation, and
 * what must not change without a deliberate version bump is the shape on the
 * wire. `scripts/check-frontend-boundary.mjs` fails the build if anyone
 * reintroduces a direct import.
 *
 * Keep in step with:
 *   backend/src/lib/sourceDocuments.ts
 *   backend/src/lib/chat/types.ts
 *
 * Copyright 2026 Fraser Matcham. Licensed under the GNU Affero General Public
 * License v3.0.
 */

// --- from backend/src/lib/sourceDocuments.ts -------------------------------

export type SourceDocumentType =
    | "docx"
    | "pdf"
    | "spreadsheet"
    | "case"
    | "legislation";

export type SourceDocumentMetadata = {
    label: string;
    value: string;
    format?: "date";
};

export type SourceDocumentAction = {
    type: "download" | "link";
    url: string;
    label: string;
    title?: string;
};

export type SourceDocumentQuote = {
    quote: string;
    verification?: {
        verified: boolean;
        source_excerpt?: string;
        start_char?: number;
        end_char?: number;
    };
    target: {
        page?: number | string;
        sheet?: string;
        cell?: string;
        subdocument_id?: string;
    };
};

export type SourceSubdocument = {
    document_id: string;
    title: string;
    type: "html";
    html?: string | null;
    text?: string | null;
};

export type SourceDocument = {
    document_id: string;
    title: string;
    type: SourceDocumentType;
    metadata: SourceDocumentMetadata[];
    actions?: SourceDocumentAction[];
    quotes: SourceDocumentQuote[];
    subdocuments?: SourceSubdocument[];
    version_id?: string | null;
    version_number?: number | null;
};

// --- from backend/src/lib/chat/types.ts ------------------------------------

export type AskInputOption = {
    value: string;
};

export type AskInputItem =
    | {
          id: string;
          kind: "choice";
          question: string;
          options: AskInputOption[];
          allow_other: boolean;
          other_label: string;
          response_prefix?: string;
      }
    | {
          id: string;
          kind: "text";
          question: string;
          response_prefix?: string;
      }
    | {
          id: string;
          kind: "documents";
          document_types: string[];
          response_prefix?: string;
      };

export type AskInputsEvent = {
    type: "ask_inputs";
    items: AskInputItem[];
};

export type AskInputResponseItem =
    | {
          id: string;
          kind: "choice";
          question: string;
          answer?: string;
          skipped?: boolean;
      }
    | {
          id: string;
          kind: "text";
          question: string;
          answer?: string;
          skipped?: boolean;
      }
    | {
          id: string;
          kind: "documents";
          filenames: string[];
          skipped?: boolean;
      };
