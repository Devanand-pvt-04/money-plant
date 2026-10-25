"""Builds an anonymised statement PDF laid out like ICICI's statement of
transactions (October 2026): the payee in bold above each row's date, the
UPI remarks wrapped below it, and separate withdrawal, deposit and balance
columns. The people, IDs and amounts are made up."""

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen import canvas

ROWS = [
    ("01.10.2026", "RENTOK", ["UPI/RENTOK/XXabcd@hdfcban/Pay/HDFC", "BANK/600000000001/ICI00000000000000000001"], "12500.00", None),
    ("01.10.2026", "ANNA IDLI", ["UPI/ANNA IDLI/XX123a@pty/UPI/YES BANK", "P/600000000002/ICI00000000000000000002"], "135.00", None),
    ("01.10.2026", "A FRIEND", ["UPI/A FRIEND/XXn124@okhdfcb/UPI/HDFC", "BANK/600000000003/HDF00000000000000000003"], None, "766.50"),
    ("02.10.2026", "WISE PAYME", ["MMT/IMPS/600000000004/RDA remittance /WISE", "PAYME/Yes Bank"], None, "6,315.81"),
    ("03.10.2026", "Self", ["BIL/INFT/ABC1234567/CC BillPay-0000/Self"], "10168.00", None),
    ("03.10.2026", "ANNA IDLI", ["UPI/ANNA IDLI/XX123a@pty/UPI/YES BANK", "P/600000000006/ICI00000000000000000006"], "70.00", None),
    ("04.10.2026", "ZEN CAFE", ["UPI/ZEN CAFE/XX9778@hdfcban/UPI/HDFC", "BANK/600000000007/ICI00000000000000000007"], "1134.00", None),
]
OPENING = "100000.00"


def build(rows=ROWS, per_page=4, password=None, misprint_row=None) -> bytes:
    out = io.BytesIO()
    encrypt = StandardEncryption(password, canPrint=1) if password else None
    c = canvas.Canvas(out, pagesize=A4, encrypt=encrypt)
    width, height = A4
    balance = float(OPENING.replace(",", ""))
    for start in range(0, len(rows), per_page):
        c.setFont("Helvetica-Bold", 14)
        c.drawString(250, height - 50, "ICICI Bank")
        y = height - 100
        if start == 0:
            c.setFont("Helvetica-Bold", 8)
            c.drawString(60, y, "Statement of Transactions in Saving Account no. 000000001234 in INR for the period October 1, 2026 - October 4, 2026")
            c.setFont("Helvetica", 8)
            c.drawString(20, y - 30, "A PERSON")
            c.drawString(20, y - 42, "1 SOME STREET, CHENNAI")
            y -= 80
        c.setFont("Helvetica-Bold", 8)
        for x, top, bottom in [(30, "S No.", ""), (65, "Transaction", "Date"), (125, "Cheque", "Number"), (250, "Transaction", "Remarks"),
                               (400, "Withdrawal", "Amount (INR)"), (470, "Deposit", "Amount (INR)"), (530, "Balance", "(INR)")]:
            c.drawString(x, y, top)
            if bottom:
                c.drawString(x, y - 10, bottom)
        y -= 30
        for n, (date, title, remarks, debit, credit) in enumerate(rows[start:start + per_page], start + 1):
            c.setFont("Helvetica-Bold", 8)
            c.drawString(192, y, title)
            c.setFont("Helvetica", 8)
            c.drawString(30, y - 5, str(n))
            c.drawString(61, y - 5, date)
            amount = float((debit or credit).replace(",", ""))
            balance += amount if credit else -amount
            if debit:
                c.drawRightString(453, y - 5, debit)
            if credit:
                c.drawRightString(516, y - 5, credit)
            c.drawRightString(560, y - 5, f"{balance + (1 if n == misprint_row else 0):.2f}")
            for i, line in enumerate(remarks):
                c.drawString(192, y - 12 - 10 * i, line)
            y -= 22 + 10 * len(remarks)
            c.setLineWidth(0.3)
            c.line(25, y + 6, 570, y + 6)
        # The footer box every page carries.
        c.rect(15, 40, width - 30, 60)
        c.drawString(200, 70, "www.example-bank.in   Dial your Bank 1800-0000")
        c.showPage()
    c.save()
    return out.getvalue()
