"""Bank statement PDFs to transaction rows (CAP-5, decision 0010).

Reads the transaction table by word positions, so it needs no ruled
borders: the header row gives the withdrawal, deposit and balance columns,
each row starts at a date in the date column, and its remarks are the words
in the band between that row and the next. Two table shapes are read:
separate withdrawal and deposit columns with the remarks before them (ICICI's
statement of transactions), and one amount column with a DR/CR type column and
the remarks after the balance (PNB ONE's statement of account). Rows printed
newest first are returned oldest first. Other layouts are added with their own
fixtures.

Only rows leave this module: the account holder's name and address, the
branch and the full account number are never returned.
"""

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Optional

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect

DATE = re.compile(r"^(\d{2})[./-](\d{2})[./-](\d{4})$")
DATE_MON = re.compile(r"^(\d{2})[-/ ]([A-Za-z]{3})[-/ ](\d{2}|\d{4})$")
# Some banks print one decimal place when the second is zero (17481.7, 50.0).
AMOUNT = re.compile(r"^-?[\d,]+\.\d{1,2}$")
TYPE = re.compile(r"^(DR|CR)\.?$", re.I)
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
ACCOUNT = re.compile(r"\b(?:account|a/c|acct)\.?\s*(?:no\.?|number)?\s*:?\s*[X*\d\s-]*?(\d{4})\b", re.I)
BANKS = [
    ("icici", re.compile(r"\bICICI\b")),
    ("hdfc", re.compile(r"\bHDFC BANK\b", re.I)),
    ("hsbc", re.compile(r"\bHSBC\b")),
    ("sbi", re.compile(r"\bState Bank of India\b", re.I)),
    ("pnb", re.compile(r"\bPunjab National Bank\b|\bPNB ONE\b|\bPUNB0", re.I)),
]
HEADERS = {
    "debit": re.compile(r"^(withdrawals?|debits?|dr)$", re.I),
    "credit": re.compile(r"^(deposits?|credits?|cr)$", re.I),
    "balance": re.compile(r"^balance(\s*\(inr\))?$", re.I),
}
# One amount column whose direction is in a DR/CR type column.
SIGNED_HEADERS = {
    "amount": re.compile(r"^amount(\s*\(inr\))?$", re.I),
    "type": re.compile(r"^(type|dr/cr|cr/dr)$", re.I),
    "balance": HEADERS["balance"],
}
REMARKS_HEADER = re.compile(r"^(remarks|narration|particulars|description|details)$", re.I)
# A gap this tall inside a band ends the row: what follows is page furniture.
MAX_LINE_GAP = 20


class WrongPassword(Exception):
    pass


class NotAStatement(Exception):
    pass


class NoText(Exception):
    """The PDF has no text to read: a scan, or a copy saved through "Print to PDF"."""


@dataclass
class Row:
    date: str
    lines: list
    debit: Optional[str]
    credit: Optional[str]
    balance: Optional[str]


def _date(text: str) -> Optional[str]:
    if m := DATE.match(text):
        return f"{m[3]}-{m[2]}-{m[1]}"
    if (m := DATE_MON.match(text)) and m[2].lower() in MONTHS:
        year = m[3] if len(m[3]) == 4 else f"20{m[3]}"
        return f"{year}-{MONTHS[m[2].lower()]:02d}-{m[1]}"
    return None


def _amount(text: str) -> Optional[str]:
    if not AMOUNT.match(text):
        return None
    try:
        return format(Decimal(text.replace(",", "")), "f")
    except InvalidOperation:
        return None


def _lines(words: list) -> list:
    """Words grouped into lines by their top, left to right, stopping at a large gap."""
    out, last_top = [], None
    for word in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if last_top is not None and word["top"] - last_top > MAX_LINE_GAP:
            break
        if out and abs(word["top"] - last_top) <= 2:
            out[-1].append(word["text"])
        else:
            out.append([word["text"]])
            last_top = word["top"]
    return [" ".join(line) for line in out]


def _header(words: list) -> Optional[dict]:
    """The table's layout from the first line naming its amount columns: their
    centres, the header's bottom, where the amounts start, and, when the
    remarks come after the balance, where that column's header starts."""
    # A short header row sits close to the first row; the row's line, found by its date, isn't header.
    row_tops = [w["top"] for w in words if _date(w["text"])]
    for word in words:
        if not HEADERS["balance"].match(word["text"]):
            continue
        near = [w for w in words if abs(w["top"] - word["top"]) <= 12 and not any(abs(w["top"] - t) <= 3 for t in row_tops)]
        for patterns in (HEADERS, SIGNED_HEADERS):
            columns = {}
            for key, pattern in patterns.items():
                hits = [w for w in near if pattern.match(w["text"])]
                if hits:
                    columns[key] = (hits[0]["x0"] + hits[0]["x1"]) / 2
            if len(columns) < 3:
                continue
            remarks = [w["x0"] for w in near if REMARKS_HEADER.match(w["text"]) and w["x0"] > columns["balance"]]
            return {
                "columns": columns,
                "top": max(w["bottom"] for w in near),
                "amounts_left": min(w["x0"] for w in near if any(p.match(w["text"]) for p in patterns.values())),
                "remarks_after": min(remarks) if remarks else None,
            }
    return None


def _page_rows(page, carry) -> list:
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
    layout = _header(words)
    if layout:
        top = layout["top"]
    elif carry:
        layout, top = carry, 0
    else:
        return [], None
    columns, amounts_left = layout["columns"], layout["amounts_left"]
    body = [w for w in words if w["top"] > top + 1]
    anchors = [w for w in body if _date(w["text"]) and w["x1"] < amounts_left - 40]
    # The leftmost date column; value dates further right are left out.
    if not anchors:
        return [], layout
    date_x = min(a["x0"] for a in anchors)
    anchors = sorted((a for a in anchors if abs(a["x0"] - date_x) < 5), key=lambda a: a["top"])
    date_right = max(a["x1"] for a in anchors)
    on_line = lambda w, anchor: abs(w["top"] - anchor["top"]) <= 3

    if layout["remarks_after"] is None:
        remarks = [w for w in body if w["x0"] > date_right + 4 and w["x1"] < amounts_left - 1 and not _date(w["text"])]
        numbers = [w for w in body if w["x0"] >= amounts_left - 30 and _amount(w["text"])]
        right = None
    else:
        # Amounts sit under their headers; whatever is right of them is remarks.
        numbers = [
            w for w in body
            if w["x0"] >= amounts_left - 30 and (_amount(w["text"]) or TYPE.match(w["text"])) and any(on_line(w, a) for a in anchors)
            and min(abs(c - (w["x0"] + w["x1"]) / 2) for c in columns.values()) <= 45
        ]
        right = max((w["x1"] for w in numbers), default=columns["balance"] + 30) + 2
        remarks = [w for w in body if w["x0"] > right]
    # Remarks may start a little above the date (ICICI prints the payee in bold first).
    first_remark = min((w["top"] for w in remarks if w["top"] <= anchors[0]["top"] + 2), default=anchors[0]["top"])
    lead = max(0.0, anchors[0]["top"] - first_remark)
    # Page furniture (footer boxes) below the last row ends it.
    rules = sorted(e["top"] for e in page.horizontal_edges if e["x1"] - e["x0"] > page.width / 2)

    rows = []
    for i, anchor in enumerate(anchors):
        start = anchor["top"] - lead - 1
        if i + 1 < len(anchors):
            end = anchors[i + 1]["top"] - lead - 1
        else:
            end = next((r for r in rules if r > anchor["bottom"] + 1), page.height)
            if right is not None:
                # In a grid, only the remarks wrap: the next line with words left of them is the notes after the table.
                end = min([end] + [w["top"] for w in body if w["top"] > anchor["bottom"] + 1 and w["x0"] < right])
        values, kind = {}, None
        for w in (w for w in numbers if on_line(w, anchor)):
            if TYPE.match(w["text"]):
                kind = kind or w["text"][:2].upper()
                continue
            centre = (w["x0"] + w["x1"]) / 2
            key = min((k for k in columns if k != "type"), key=lambda k: abs(columns[k] - centre))
            values.setdefault(key, _amount(w["text"]))
        if "amount" in values:
            amount = values.pop("amount")
            if kind == "CR":
                values["credit"] = amount
            elif kind == "DR":
                values["debit"] = amount
        rows.append(
            Row(
                date=_date(anchor["text"]),
                lines=_lines([w for w in remarks if start <= w["top"] < end]),
                debit=values.get("debit"),
                credit=values.get("credit"),
                balance=values.get("balance"),
            )
        )
    return rows, layout


def _breaks(rows: list) -> int:
    """How many rows don't follow the running balance of the row before them."""
    count = 0
    for previous, row in zip(rows, rows[1:]):
        if previous.balance and row.balance:
            expected = Decimal(previous.balance) - Decimal(row.debit or "0") + Decimal(row.credit or "0")
            if expected != Decimal(row.balance):
                count += 1
    return count


def read_statement(data, password: Optional[str]) -> dict:
    try:
        pdf = pdfplumber.open(data, password=password or "")
        pages = pdf.pages
    except Exception as error:
        # pdfplumber wraps pdfminer's errors.
        if any(isinstance(e, PDFPasswordIncorrect) for e in (error, error.__cause__, *error.args)):
            raise WrongPassword()
        raise NotAStatement()
    with pdf:
        if pages and not any(page.chars for page in pages):
            raise NoText()
        first = (pages[0].extract_text() or "") if pages else ""
        rows, carry = [], None
        for page in pages:
            page_rows, carry = _page_rows(page, carry)
            rows.extend(page_rows)
    rows = [r for r in rows if r.debit or r.credit]
    if not rows:
        raise NotAStatement()
    bank = next((name for name, pattern in BANKS if pattern.search(first)), None)
    account = ACCOUNT.search(first)
    # Oldest first: the app takes the last row's balance as the closing balance.
    # Rows of one day only can't be ordered by date, so the running balance decides.
    newest_first = rows[0].date > rows[-1].date or (rows[0].date == rows[-1].date and _breaks(rows[::-1]) < _breaks(rows))
    if newest_first:
        rows.reverse()
    # The running balance should follow each row; rows where it doesn't were probably misread.
    mismatches = _breaks(rows)
    return {
        "bank": bank,
        "account_last4": account[1] if account else None,
        "rows": [r.__dict__ for r in rows],
        "warnings": [f"{mismatches} rows don't follow the running balance"] if mismatches else [],
    }
