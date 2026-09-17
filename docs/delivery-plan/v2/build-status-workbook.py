#!/usr/bin/env python3
"""Build delivery-status.xlsx from the two plain-text sources beside it.

    python3 docs/delivery-plan/v2/build-status-workbook.py

Reads docs/delivery-plan/backlog.csv for the ticket register and
docs/delivery-plan/v2/status.csv for each ticket's status, and writes
docs/delivery-plan/v2/delivery-status.xlsx.

Every count on the Summary sheet is a COUNTIF/COUNTIFS over the Tickets
sheet, so the workbook recalculates rather than carrying frozen totals.
openpyxl writes formulas without cached values, so after running this,
open the file once in a spreadsheet application (or recalculate it
headlessly) before anything reads the numbers programmatically.

Requires openpyxl. Nothing in CI runs this; it is a documentation tool.
"""

import csv
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HERE = Path(__file__).resolve().parent
BACKLOG = HERE.parent / "backlog.csv"
STATUS = HERE / "status.csv"
OUT = HERE / "delivery-status.xlsx"

STATUS_ORDER = ["Done", "In progress", "To do", "Deferred", "Superseded", "Won't do"]
STATUS_FILL = {
    "Done": "D9EAD3",
    "In progress": "FCE5CD",
    "To do": "E8EAED",
    "Deferred": "D9D2E9",
    "Superseded": "CFE2F3",
    "Won't do": "F4CCCC",
}
STATUS_TEXT = {
    "Done": "38761D",
    "In progress": "B45F06",
    "To do": "434343",
    "Deferred": "674EA7",
    "Superseded": "0B5394",
    "Won't do": "990000",
}
LEGEND = [
    ("Done", "Delivered and merged to the branch. The plan row carries a completion marker."),
    ("In progress", "Partly delivered: an epic or story whose children are not all done, or work waiting on a step only the operator can take."),
    ("To do", "Not started. Mostly stage 5 (run the platform on AWS) and the operator-side prerequisites."),
    ("Deferred", "Scoped and understood, deliberately held until after first production traffic."),
    ("Superseded", "Replaced by the stage 5 move off Supabase; the work no longer applies."),
    ("Won't do", "Decided against, with the reason recorded in the plan."),
]
PROVENANCE = [
    "Rolled up the Epic -> Story -> Sub-task hierarchy: a parent is Done only when every child is Done, and In progress when at least one child is.",
    "Sub-task statuses come from the completion markers in docs/delivery-plan/v2/plan.md, one row per ticket.",
    "The twelve tickets with no marker are resolved explicitly by the plan's ticket disposition table (2023 won't do; 2029-2031 done; 2038-2041 superseded by stage 5; 2066-2069 deferred).",
    "Tickets 2110-2126 are the new stage 5 scope: move off Supabase onto RDS PostgreSQL with self-hosted PostgREST and GoTrue.",
]

ARIAL = "Arial"
HDR_FILL = PatternFill("solid", fgColor="1F3864")
HDR_FONT = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
TITLE_FONT = Font(name=ARIAL, size=16, bold=True, color="1F3864")
SECTION_FONT = Font(name=ARIAL, size=11, bold=True, color="1F3864")
BODY = Font(name=ARIAL, size=10)
BODY_BOLD = Font(name=ARIAL, size=10, bold=True)
NOTE = Font(name=ARIAL, size=9, italic=True, color="595959")
_THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
PRIORITY_ORDER = {"Highest": 0, "High": 1, "Medium": 2, "Low": 3}


def load():
    tickets = list(csv.DictReader(BACKLOG.open(newline="")))
    status = {r["Issue Id"]: r for r in csv.DictReader(STATUS.open(newline=""))}
    missing = [t["Issue Id"] for t in tickets if t["Issue Id"] not in status]
    extra = [i for i in status if i not in {t["Issue Id"] for t in tickets}]
    if missing or extra:
        sys.exit(f"status.csv does not match backlog.csv. Missing: {missing}. Unknown: {extra}.")
    for t in tickets:
        t["Status"] = status[t["Issue Id"]]["Status"]
        t["Status note"] = status[t["Issue Id"]]["Status note"]
        if t["Status"] not in STATUS_FILL:
            sys.exit(f"Ticket {t['Issue Id']} has unknown status {t['Status']!r}.")
    return tickets


def status_cell(ws, row, col, value):
    c = ws.cell(row=row, column=col)
    c.fill = PatternFill("solid", fgColor=STATUS_FILL[value])
    c.font = Font(name=ARIAL, size=10, bold=True, color=STATUS_TEXT[value])
    c.alignment = Alignment(vertical="top", horizontal="center")


def write_grid(ws, row, first_col_header, keys, range_ref, status_range):
    """A <dimension> x <status> matrix of COUNTIFS, with totals and % done."""
    for i, label in enumerate([first_col_header] + STATUS_ORDER + ["Total", "% done"]):
        c = ws.cell(row=row, column=1 + i, value=label)
        c.font, c.fill = HDR_FONT, HDR_FILL
        c.alignment = Alignment(horizontal="center" if i else "left", vertical="center")
    ws.row_dimensions[row].height = 20
    header_row, row = row, row + 1
    first = row
    for key in keys:
        ws.cell(row=row, column=1, value=key).font = BODY
        for i in range(len(STATUS_ORDER)):
            col = get_column_letter(2 + i)
            c = ws.cell(row=row, column=2 + i,
                        value=f"=COUNTIFS({range_ref},$A{row},{status_range},{col}${header_row})")
            c.font, c.alignment, c.border = BODY, Alignment(horizontal="center"), BOX
        c = ws.cell(row=row, column=8, value=f"=SUM(B{row}:G{row})")
        c.font, c.alignment, c.border = BODY_BOLD, Alignment(horizontal="center"), BOX
        c = ws.cell(row=row, column=9, value=f"=IFERROR(B{row}/H{row},0)")
        c.font, c.number_format = BODY, "0.0%"
        c.alignment, c.border = Alignment(horizontal="center"), BOX
        row += 1
    ws.cell(row=row, column=1, value="All").font = BODY_BOLD
    for col in range(2, 9):
        letter = get_column_letter(col)
        c = ws.cell(row=row, column=col, value=f"=SUM({letter}{first}:{letter}{row - 1})")
        c.font, c.alignment, c.border = BODY_BOLD, Alignment(horizontal="center"), BOX
    c = ws.cell(row=row, column=9, value=f"=IFERROR(B{row}/H{row},0)")
    c.font, c.number_format = BODY_BOLD, "0.0%"
    c.alignment, c.border = Alignment(horizontal="center"), BOX
    return row + 2


def build(tickets):
    wb = Workbook()
    del wb["Sheet"]

    # ---- Tickets: the register, one row per ticket, filterable -------------
    tk = wb.create_sheet("Tickets")
    cols = [
        ("Issue Id", 10), ("Parent Id", 10), ("Issue Type", 11), ("Summary", 56),
        ("Status", 13), ("Status note", 62), ("Phase", 27), ("Sprint", 10),
        ("Component", 15), ("Priority", 10), ("Repo", 22), ("Labels", 24),
        ("Acceptance Criteria", 60), ("Description", 80),
    ]
    for i, (name, width) in enumerate(cols, start=1):
        c = tk.cell(row=1, column=i, value=name)
        c.font, c.fill = HDR_FONT, HDR_FILL
        c.alignment = Alignment(vertical="center", horizontal="left")
        tk.column_dimensions[get_column_letter(i)].width = width
    tk.row_dimensions[1].height = 24

    for n, t in enumerate(tickets, start=2):
        values = [t[k] for k, _ in cols]
        for i, v in enumerate(values, start=1):
            c = tk.cell(row=n, column=i, value=v)
            c.font = BODY_BOLD if (i == 4 and t["Issue Type"] == "Epic") else BODY
            c.alignment = Alignment(vertical="top", wrap_text=i in (4, 6))
            c.border = BOX
        status_cell(tk, n, 5, t["Status"])
        tk.row_dimensions[n].height = 30
    last = len(tickets) + 1
    tk.freeze_panes = "D2"
    tk.auto_filter.ref = f"A1:N{last}"

    s_range = f"Tickets!$E$2:$E${last}"

    # ---- Summary ----------------------------------------------------------
    sm = wb.create_sheet("Summary", 0)
    sm.column_dimensions["A"].width = 34
    for col in "BCDEFGH":
        sm.column_dimensions[col].width = 14
    sm.column_dimensions["I"].width = 16

    sm["A1"] = "legalworkflows delivery plan - status"
    sm["A1"].font = TITLE_FONT
    sm["A2"] = ("Every count here is a live COUNTIF/COUNTIFS over the Tickets sheet. "
                "Change a status there and these follow.")
    sm["A2"].font = NOTE
    sm["A3"] = ("Sources: docs/delivery-plan/backlog.csv for the register, "
                "docs/delivery-plan/v2/status.csv for the statuses. Rebuild with "
                "docs/delivery-plan/v2/build-status-workbook.py.")
    sm["A3"].font = NOTE

    row = 5
    sm.cell(row=row, column=1, value="Headline").font = SECTION_FONT
    row += 1
    for i, label in enumerate(["Measure", "Tickets", "Share"]):
        c = sm.cell(row=row, column=1 + i, value=label)
        c.font, c.fill = HDR_FONT, HDR_FILL
        c.alignment = Alignment(horizontal="center" if i else "left", vertical="center")
    sm.row_dimensions[row].height = 20
    row += 1
    total_row = row
    headline = [
        ("Total tickets", f"=COUNTA({s_range})"),
        ("Complete (Done)", f'=COUNTIF({s_range},"Done")'),
        ("Active (In progress)", f'=COUNTIF({s_range},"In progress")'),
        ("Remaining (To do)", f'=COUNTIF({s_range},"To do")'),
        ("Deferred", f'=COUNTIF({s_range},"Deferred")'),
        ("Closed without delivery", f'=COUNTIF({s_range},"Superseded")+COUNTIF({s_range},"Won\'t do")'),
    ]
    for label, formula in headline:
        is_total = label == "Total tickets"
        sm.cell(row=row, column=1, value=label).font = BODY_BOLD if is_total else BODY
        c = sm.cell(row=row, column=2, value=formula)
        c.font = BODY_BOLD if is_total else BODY
        c.alignment, c.border = Alignment(horizontal="center"), BOX
        if not is_total:
            c = sm.cell(row=row, column=3, value=f"=IFERROR(B{row}/$B${total_row},0)")
            c.font, c.number_format = BODY, "0.0%"
            c.alignment, c.border = Alignment(horizontal="center"), BOX
        row += 1
    row += 1

    def uniques(field, preferred):
        seen = {t[field] for t in tickets}
        ordered = [v for v in preferred if v in seen]
        return ordered + sorted(seen - set(ordered))

    for title, field, col_letter, preferred in [
        ("By phase", "Phase", "G", []),
        ("By sprint", "Sprint", "H", []),
        ("By component", "Component", "I",
         ["Platform", "Backend", "Frontend", "Word Add-in", "Infrastructure", "Integration"]),
        ("By issue type", "Issue Type", "C", ["Epic", "Story", "Sub-task"]),
    ]:
        sm.cell(row=row, column=1, value=title).font = SECTION_FONT
        row += 1
        row = write_grid(sm, row, field, uniques(field, preferred),
                         f"Tickets!${col_letter}$2:${col_letter}${last}", s_range)

    sm.cell(row=row, column=1, value="What each status means").font = SECTION_FONT
    row += 1
    for name, meaning in LEGEND:
        sm.cell(row=row, column=1, value=name)
        status_cell(sm, row, 1, name)
        sm.cell(row=row, column=1).alignment = Alignment(horizontal="center", vertical="center")
        sm.cell(row=row, column=1).border = BOX
        c = sm.cell(row=row, column=2, value=meaning)
        c.font, c.alignment = BODY, Alignment(wrap_text=True, vertical="center")
        sm.merge_cells(start_row=row, start_column=2, end_row=row, end_column=9)
        sm.row_dimensions[row].height = 30
        row += 1
    row += 1

    sm.cell(row=row, column=1, value="Where the statuses come from").font = SECTION_FONT
    row += 1
    for line in PROVENANCE:
        c = sm.cell(row=row, column=1, value="- " + line)
        c.font, c.alignment = NOTE, Alignment(wrap_text=True, vertical="top")
        sm.merge_cells(start_row=row, start_column=1, end_row=row, end_column=9)
        sm.row_dimensions[row].height = 26
        row += 1
    sm.freeze_panes = "A5"

    # ---- Outstanding: everything not yet Done -----------------------------
    ot = wb.create_sheet("Outstanding")
    open_tickets = sorted(
        (t for t in tickets if t["Status"] in ("In progress", "To do")),
        key=lambda t: (t["Phase"], t["Sprint"], PRIORITY_ORDER.get(t["Priority"], 9), t["Issue Id"]),
    )
    ot["A1"] = "Outstanding work"
    ot["A1"].font = TITLE_FONT
    ot["A2"] = ("Every ticket not yet Done, ordered by phase, then sprint, then priority. "
                "Deferred, superseded and won't-do tickets are on the Tickets sheet.")
    ot["A2"].font = NOTE

    ocols = [("Issue Id", 10), ("Issue Type", 11), ("Summary", 56), ("Status", 13),
             ("Status note", 70), ("Phase", 27), ("Sprint", 10), ("Component", 15),
             ("Priority", 10)]
    for i, (name, width) in enumerate(ocols, start=1):
        c = ot.cell(row=4, column=i, value=name)
        c.font, c.fill = HDR_FONT, HDR_FILL
        c.alignment = Alignment(vertical="center", horizontal="left")
        ot.column_dimensions[get_column_letter(i)].width = width
    ot.row_dimensions[4].height = 22

    n = 5
    for t in open_tickets:
        for i, (key, _) in enumerate(ocols, start=1):
            c = ot.cell(row=n, column=i, value=t[key])
            c.font = BODY_BOLD if (i == 3 and t["Issue Type"] == "Epic") else BODY
            c.alignment = Alignment(vertical="top", wrap_text=i in (3, 5))
            c.border = BOX
        status_cell(ot, n, 4, t["Status"])
        ot.row_dimensions[n].height = 30
        n += 1
    ot.freeze_panes = "A5"
    ot.auto_filter.ref = f"A4:I{n - 1}"
    ot.cell(row=n + 1, column=1, value="Open tickets").font = BODY_BOLD
    c = ot.cell(row=n + 1, column=2,
                value=f'=COUNTIF({s_range},"In progress")+COUNTIF({s_range},"To do")')
    c.font, c.alignment, c.border = BODY_BOLD, Alignment(horizontal="center"), BOX
    ot.cell(row=n + 2, column=1,
            value="The rows are a snapshot; the count beside them is live from the Tickets sheet.").font = NOTE

    wb.active = 0
    wb.save(OUT)
    return len(tickets), len(open_tickets)


if __name__ == "__main__":
    total, outstanding = build(load())
    print(f"{OUT}: {total} tickets, {outstanding} outstanding")
