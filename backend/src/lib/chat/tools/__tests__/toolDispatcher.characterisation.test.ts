import { describe, expect, it, vi } from "vitest";

import { runToolCalls } from "../toolDispatcher";
import type { DocStore } from "../../types";

/**
 * Characterisation tests for runToolCalls' dispatch loop.
 *
 * These describe what the dispatcher does today, not what it ought to do. The
 * loop is a bare if/else-if chain with no trailing `else`, so several inputs
 * fall through it silently. That is the behaviour worth pinning before anyone
 * changes this file: a silent no-op looks identical to a tool that ran and had
 * nothing to say.
 */

const EMPTY_DOC_STORE: DocStore = new Map();

function call(name: string, args: unknown = {}) {
    return {
        id: `call-${name}`,
        function: {
            name,
            arguments: typeof args === "string" ? args : JSON.stringify(args),
        },
    };
}

async function dispatch(
    toolCalls: ReturnType<typeof call>[],
    extra: Partial<{
        tabularStore: unknown;
        docIndex: unknown;
    }> = {},
) {
    const write = vi.fn();
    const result = await runToolCalls(
        toolCalls,
        EMPTY_DOC_STORE,
        "user-1",
        {} as never,
        write,
        undefined,
        extra.tabularStore as never,
        extra.docIndex as never,
    );
    return { result, write };
}

describe("runToolCalls dispatch", () => {
    it("ignores an unknown tool name without result, event or error", async () => {
        const { result, write } = await dispatch([call("no_such_tool")]);

        // No branch matches and there is no trailing else, so the call is
        // dropped: the model receives no tool response for a call it made.
        expect(result.toolResults).toEqual([]);
        expect(write).not.toHaveBeenCalled();
    });

    it("swallows malformed tool arguments rather than throwing", async () => {
        // JSON.parse is wrapped in try/catch with an empty handler, so args
        // silently become {} and dispatch proceeds as if none were supplied.
        await expect(
            dispatch([call("no_such_tool", "{not valid json")]),
        ).resolves.toBeDefined();
    });

    it("drops read_table_cells when no tabular store is supplied", async () => {
        // The branch is guarded by `&& tabularStore`, so without one the call
        // falls through the chain instead of reporting that it cannot run.
        const { result, write } = await dispatch([
            call("read_table_cells", { review_id: "r1", doc_ids: ["d1"] }),
        ]);

        expect(result.toolResults).toEqual([]);
        expect(write).not.toHaveBeenCalled();
    });

    it("drops edit_document when no doc index is supplied", async () => {
        const { result } = await dispatch([
            call("edit_document", { doc_id: "doc-0", edits: [] }),
        ]);

        expect(result.toolResults).toEqual([]);
        expect(result.docsEdited).toEqual([]);
    });

    it("drops replicate_document when no doc index is supplied", async () => {
        const { result } = await dispatch([
            call("replicate_document", { doc_id: "doc-0" }),
        ]);

        expect(result.toolResults).toEqual([]);
        expect(result.docsReplicated).toEqual([]);
    });

    it("records no ask_inputs event when the call carries no items", async () => {
        // Guarded by `if (event.items.length > 0)`.
        const { result } = await dispatch([call("ask_inputs", {})]);

        expect(result.askInputsEvents).toEqual([]);
    });

    it("returns every result bucket even when nothing dispatched", async () => {
        // Callers destructure all eleven buckets unconditionally, so they are
        // always present and empty rather than undefined.
        const { result } = await dispatch([]);

        expect(result).toEqual({
            toolResults: [],
            docsRead: [],
            docsFound: [],
            docsCreated: [],
            docsReplicated: [],
            workflowsApplied: [],
            docsEdited: [],
            askInputsEvents: [],
            courtlistenerEvents: [],
            caseCitationEvents: [],
            mcpEvents: [],
        });
    });
});
