"""Bank statement PDFs to transaction rows (CAP-5, decision 0010).

Reads the transaction table by word positions, so it needs no ruled
borders: the header row gives the withdrawal, deposit and balance columns,
each row starts at a date in the date column, and its remarks are the words
in the band between that row and the next. Works for ICICI's statement of
transactions; other banks' layouts are added with their own fixtures.

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
AMOUNT = re.compile(r"^-?[\d,]+\.\d{2}$")
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
ACCOUNT = re.compile(r"\b(?:account|a/c|acct)\.?\s*(?:no\.?|number)?\s*:?\s*[X*\d\s-]*?(\d{4})\b", re.I)
BANKS = [("icici", re.compile(r"\bICICI\b")), ("hdfc", re.compile(r"\bHDFC BANK\b", re.I)), ("hsbc", re.compile(r"\bHSBC\b")), ("sbi", re.compile(r"\bState Bank of India\b", re.I))]
HEADERS = {
    "debit": re.compile(r"^(withdrawals?|debits?|dr)$", re.I),
    "credit": re.compile(r"^(deposits?|credits?|cr)$", re.I),
    "balance": re.compile(r"^balance$", re.I),
}
# A gap this tall inside a band ends the row: what follows is page furniture.
MAX_LINE_GAP = 20


class WrongPassword(Exception):
    pass


class NotAStatement(Exception):
    pass


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


def _header(words: list):
    """The amount columns' centres and the header's bottom, from the first line naming all three."""
    for word in words:
        if not HEADERS["balance"].match(word["text"]):
            continue
        near = [w for w in words if abs(w["top"] - word["top"]) <= 12]
        columns = {}
        for key, pattern in HEADERS.items():
            hits = [w for w in near if pattern.match(w["text"])]
            if hits:
                columns[key] = (hits[0]["x0"] + hits[0]["x1"]) / 2
        if len(columns) == 3:
            return columns, max(w["bottom"] for w in near), min(w["x0"] for w in near if any(p.match(w["text"]) for p in HEADERS.values()))
    return None


def _page_rows(page, carry) -> list:
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
    found = _header(words)
    if found:
        columns, top, amounts_left = found
    elif carry:
        columns, top, amounts_left = carry["columns"], 0, carry["amounts_left"]
    else:
        return [], None
    body = [w for w in words if w["top"] > top + 1]
    anchors = [w for w in body if _date(w["text"]) and w["x1"] < amounts_left - 40]
    # The leftmost date column; value dates further right are left out.
    if not anchors:
        return [], {"columns": columns, "amounts_left": amounts_left}
    date_x = min(a["x0"] for a in anchors)
    anchors = sorted((a for a in anchors if abs(a["x0"] - date_x) < 5), key=lambda a: a["top"])
    date_right = max(a["x1"] for a in anchors)
    remarks = [w for w in body if w["x0"] > date_right + 4 and w["x1"] < amounts_left - 1 and not _date(w["text"])]
    numbers = [w for w in body if w["x0"] >= amounts_left - 30 and _amount(w["text"])]
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
        line = [w for w in numbers if abs(w["top"] - anchor["top"]) <= 3]
        values = {}
        for w in line:
            centre = (w["x0"] + w["x1"]) / 2
            key = min(columns, key=lambda k: abs(columns[k] - centre))
            values.setdefault(key, _amount(w["text"]))
        rows.append(
            Row(
                date=_date(anchor["text"]),
                lines=_lines([w for w in remarks if start <= w["top"] < end]),
                debit=values.get("debit"),
                credit=values.get("credit"),
                balance=values.get("balance"),
            )
        )
    return rows, {"columns": columns, "amounts_left": amounts_left}


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
    # The running balance should follow each row; rows where it doesn't were probably misread.
    mismatches = 0
    for previous, row in zip(rows, rows[1:]):
        if previous.balance and row.balance:
            expected = Decimal(previous.balance) - Decimal(row.debit or "0") + Decimal(row.credit or "0")
            if expected != Decimal(row.balance):
                mismatches += 1
    return {
        "bank": bank,
        "account_last4": account[1] if account else None,
        "rows": [r.__dict__ for r in rows],
        "warnings": [f"{mismatches} rows don't follow the running balance"] if mismatches else [],
    }
