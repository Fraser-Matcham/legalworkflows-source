import { describe, expect, it } from "vitest";

import {
    clearTurnReadsForDocument,
    duplicateReadDocumentResult,
    findTextMatches,
    normalizeWithMap,
    safeGeneratedFilename,
} from "../documentOps";
import type { TurnReadState } from "../documentOps";

/**
 * Characterisation tests for the pure helpers document operations are built
 * on. They record what these functions do today — including the lossy cases —
 * so a later change to them shows up as a failing test rather than as a
 * differently named download or a silently missed search hit.
 */

describe("safeGeneratedFilename", () => {
    it("keeps ASCII letters, digits, spaces and hyphens", () => {
        expect(safeGeneratedFilename("Quarterly Report", "docx")).toBe(
            "Quarterly Report.docx",
        );
    });

    it("deletes accented characters instead of transliterating them", () => {
        // The filter is /[^a-zA-Z0-9 -]/g, so "É"/"é" and the apostrophe are
        // dropped outright: a French title survives only in mangled form.
        expect(safeGeneratedFilename("Contrat d'Été", "docx")).toBe(
            "Contrat dt.docx",
        );
    });

    it("loses a fully non-Latin title and falls back to 'document'", () => {
        // Every character is stripped, the result is empty, and the `||`
        // fallback replaces the user's title wholesale.
        expect(safeGeneratedFilename("契約書", "docx")).toBe("document.docx");
    });

    it("falls back to 'document' for empty, punctuation-only and non-string titles", () => {
        expect(safeGeneratedFilename("", "docx")).toBe("document.docx");
        expect(safeGeneratedFilename("!!!", "docx")).toBe("document.docx");
        expect(safeGeneratedFilename(undefined as never, "docx")).toBe(
            "document.docx",
        );
    });

    it("strips underscores and dots, so version suffixes run together", () => {
        expect(safeGeneratedFilename("my_report v2.1", "xlsx")).toBe(
            "myreport v21.xlsx",
        );
    });

    it("truncates the title to 64 characters, excluding the extension", () => {
        const name = safeGeneratedFilename("A".repeat(70), "docx");
        expect(name).toBe(`${"A".repeat(64)}.docx`);
    });
});

describe("normalizeWithMap", () => {
    it("lowercases, collapses whitespace runs, and maps back to original indices", () => {
        const { norm, origIdx } = normalizeWithMap("  Hello   World  ");

        // Leading whitespace still emits one space: prevSpace starts false, so
        // the normalised form is " hello world " rather than "hello world".
        expect(norm).toBe(" hello world ");
        expect(origIdx).toHaveLength(norm.length);
        // Each normalised character points at where it came from.
        expect(norm[1]).toBe("h");
        expect(origIdx[1]).toBe(2);
    });

    it("drops punctuation without splitting words when asked", () => {
        const { norm } = normalizeWithMap("U.S. foo, bar", {
            stripPunctuation: true,
        });

        // "U.S." collapses to "us" rather than "u s", while "foo, bar" keeps
        // its separating space.
        expect(norm).toBe("us foo bar");
    });
});

describe("findTextMatches", () => {
    it("matches across a line break and returns the original text as the excerpt", () => {
        const text = "hello\nworld and hello world";
        const { hits, totalMatches } = findTextMatches({
            text,
            query: "Hello World",
            maxResults: 1,
            contextChars: 5,
        });

        // Matching runs on the whitespace-collapsed, lowercased form, so the
        // query spans the newline; the excerpt is sliced from the original.
        expect(totalMatches).toBe(2);
        expect(hits).toHaveLength(1);
        expect(hits[0].excerpt).toBe("hello\nworld");
        // Context is whitespace-collapsed and ellipsised at a truncated edge.
        expect(hits[0].context).toBe("hello world and…");
    });

    it("counts every match but returns at most maxResults hits", () => {
        const { hits, totalMatches } = findTextMatches({
            text: "ab ab ab ab",
            query: "ab",
            maxResults: 2,
            contextChars: 0,
        });

        expect(totalMatches).toBe(4);
        expect(hits).toHaveLength(2);
    });

    it("numbers hits sequentially from startIndex, not by position in the text", () => {
        const { hits } = findTextMatches({
            text: "ab ab",
            query: "ab",
            maxResults: 5,
            contextChars: 0,
            startIndex: 10,
        });

        // `index` is a running counter offset by startIndex — despite the
        // name it is not the character offset of the match.
        expect(hits.map((h) => h.index)).toEqual([10, 11]);
    });

    it("returns nothing for a whitespace-only query", () => {
        expect(
            findTextMatches({
                text: "abc",
                query: "   ",
                maxResults: 5,
                contextChars: 2,
            }),
        ).toEqual({ hits: [], totalMatches: 0 });
    });
});

describe("turn read state helpers", () => {
    it("reports a repeat read without repeating the document text", () => {
        const payload = JSON.parse(
            duplicateReadDocumentResult({
                docLabel: "doc-0",
                documentId: "document-1",
                versionId: "version-2",
            }),
        );

        expect(payload).toMatchObject({
            ok: true,
            already_read: true,
            doc_id: "doc-0",
            document_id: "document-1",
            version_id: "version-2",
        });
        // The content field carries an explanation, not the document.
        expect(payload.content).toContain("already read");
    });

    it("defaults a missing version id to null rather than omitting it", () => {
        const payload = JSON.parse(
            duplicateReadDocumentResult({ docLabel: "doc-0" }),
        );

        expect(payload.version_id).toBeNull();
        expect(payload.document_id).toBeUndefined();
    });

    it("clears every turn-read entry for one document and leaves the rest", () => {
        const state: TurnReadState = new Map([
            ["k1", { documentId: "doc-a" }],
            ["k2", { documentId: "doc-b" }],
            ["k3", { documentId: "doc-a" }],
        ] as never);

        clearTurnReadsForDocument(state, "doc-a");

        expect([...state.keys()]).toEqual(["k2"]);
    });

    it("is a no-op when there is no turn-read state", () => {
        expect(() =>
            clearTurnReadsForDocument(undefined, "doc-a"),
        ).not.toThrow();
    });
});
