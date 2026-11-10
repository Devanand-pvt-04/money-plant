"""Builds an anonymised statement PDF laid out like PNB ONE's statement of
account (November 2026): a ruled grid of Date, Instrument ID, Amount(INR),
Type (DR/CR), Balance and Remarks, newest row first, remarks centred and
wrapped in the last column, amounts with one decimal place, and the bank's
notes straight after the table. The people, IDs and amounts are made up."""

import io

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

# Newest first, as PNB prints them. (date, amount, type, remarks lines)
ROWS = [
    ("10/11/2026", "40.0", "DR", ["UPI/DR/600000000001/TEA STALL/YESB/q000000001@ybl/S"]),
    ("10/11/2026", "2000.0", "DR", ["ACH/SOME MUTUAL FUND/12345"]),
    ("10/11/2026", "3.55", "DR", ["UPI/DR/600000000002/A", "MERCHANT/SBIN/merchant@sbi/"]),
    ("07/11/2026", "36.0", "DR", ["UPI/DR/600000000003/A FRIEND/SBIN/a.friend.1000-", "1@ok/Se"]),
    ("04/11/2026", "15.0", "CR", ["UPI/CR/600000000004/ANOTHER", "FRIEND/IOBA/another.friend1/"]),
    ("04/11/2026", "100000.0", "CR", ["000000PU00000001 : Closure Proceeds"]),
    ("03/11/2026", "82.6", "CR", ["UPI/CR/600000000005/Ms A", "Person/IDIB/a.person0001/"]),
    ("01/11/2026", "310.0", "DR", ["UPI/DR/600000000006/SOME", "SHOP/SBIN/someshop@oksb/Se"]),
]
OPENING = "20000.0"

# Column edges of the grid, as on PNB's statement.
EDGES = [50, 100, 148, 198, 222, 270, 470]


def balances(rows=ROWS, opening=OPENING) -> list:
    """Each row's balance after it, in the printed (newest first) order."""
    balance = round(float(opening) * 100)
    out = []
    for _date, amount, kind, _remarks in reversed(rows):
        paise = round(float(amount) * 100)
        balance += paise if kind == "CR" else -paise
        out.append(balance)
    # PNB drops a trailing zero: 17481.7, 275160.0, 272086.15.
    return [f"{b // 100}.{b % 100:02d}".removesuffix("0") if b % 10 == 0 else f"{b // 100}.{b % 100:02d}" for b in reversed(out)]


def build(rows=ROWS, per_page=5, misprint_row=None) -> bytes:
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=letter)
    width, height = letter
    printed = balances(rows)
    if misprint_row is not None:
        whole, _, frac = printed[misprint_row].partition(".")
        printed[misprint_row] = f"{int(whole) + 1}.{frac}"
    pages = [rows[i:i + per_page] for i in range(0, len(rows), per_page)]
    n = 0
    for page_no, page_rows in enumerate(pages, 1):
        y = height - 40
        if page_no == 1:
            c.setFont("Times-Bold", 12)
            c.drawString(50, y, "punjab national bank")
            y -= 40
            c.setFont("Times-Bold", 10)
            c.drawString(50, y, "Branch Details")
            c.setFont("Times-Roman", 8)
            for label, value in [("Branch Name:", "CHENNAI, SOMEWHERE"), ("IFSC:", "PUNB0000000")]:
                y -= 14
                c.drawString(50, y, label)
                c.drawString(140, y, value)
            y -= 30
            c.setFont("Times-Bold", 10)
            c.drawString(50, y, "Customer Details")
            c.setFont("Times-Roman", 8)
            for label, value in [("Customer Name:", "A PERSON"), ("Customer Address:", "1 SOME STREET, CHENNAI")]:
                y -= 14
                c.drawString(50, y, label)
                c.drawString(140, y, value)
            y -= 30
            c.setFont("Times-Bold", 10)
            c.drawString(50, y, "Statement of Account:0000000100001234 For Period: 01-11-2026 to 10-11-2026")
            y -= 24
        # Header row: a box per cell.
        c.setFont("Times-Roman", 7)
        c.setLineWidth(0.5)
        header_h = 12
        for (left, right), name in zip(zip(EDGES, EDGES[1:] + [width - 30]), ["Date", "Instrument ID", "Amount(INR)", "Type", "Balance", "Remarks"]):
            c.rect(left, y - header_h, right - left, header_h)
            c.drawCentredString((left + right) / 2, y - 9, name)
        y -= header_h
        for date, amount, kind, remarks in page_rows:
            row_h = 6 + 9 * len(remarks)
            for left, right in zip(EDGES, EDGES[1:] + [width - 30]):
                c.rect(left, y - row_h, right - left, row_h)
            c.drawCentredString((EDGES[0] + EDGES[1]) / 2, y - 9, date)
            c.drawCentredString((EDGES[2] + EDGES[3]) / 2, y - 9, amount)
            c.drawCentredString((EDGES[3] + EDGES[4]) / 2, y - 9, kind)
            c.drawCentredString((EDGES[4] + EDGES[5]) / 2, y - 9, printed[n])
            for i, line in enumerate(remarks):
                c.drawCentredString((EDGES[5] + width - 30) / 2, y - 9 - 9 * i, line)
            y -= row_h
            n += 1
        if page_no == len(pages):
            # The notes start right under the table and span the page.
            c.setFont("Times-Bold", 9)
            c.drawCentredString(width / 2, y - 14, "***Generated through PNB ONE***")
            c.setFont("Times-Roman", 8)
            c.drawString(50, y - 28, "Unless constituent notifies the bank immediately of any discrepancy found by him/her in his/her statement of Account,")
            c.drawString(50, y - 38, "it will be taken that he/she has found the account correct. Please maintain minimum average balance 1000.00.")
        c.setFont("Times-Roman", 7)
        c.drawString(50, 30, "Date: 10/11/2026 12:00:00")
        c.drawString(width - 80, 30, f"Page {page_no}")
        c.showPage()
    c.save()
    return out.getvalue()
