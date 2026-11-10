import io

import pytest

import statement
from synthetic_pnb_statement import ROWS, build


def read(data, password=None):
    return statement.read_statement(io.BytesIO(data), password)


def test_reads_amount_and_type_columns_oldest_first():
    result = read(build())
    assert result["bank"] == "pnb"
    assert result["account_last4"] == "1234"
    assert result["warnings"] == []
    rows = result["rows"]
    assert len(rows) == len(ROWS)
    # PNB prints newest first; the app wants the closing balance last.
    assert [r["date"] for r in rows] == sorted(r["date"] for r in rows)
    assert rows[0] == {
        "date": "2026-11-01",
        "lines": ["UPI/DR/600000000006/SOME", "SHOP/SBIN/someshop@oksb/Se"],
        "debit": "310.0",
        "credit": None,
        "balance": "19690.0",
    }
    assert rows[1]["credit"] == "82.6" and rows[1]["debit"] is None
    assert rows[2]["lines"] == ["000000PU00000001 : Closure Proceeds"]
    assert rows[2]["credit"] == "100000.0"
    assert rows[-1] == {
        "date": "2026-11-10",
        "lines": ["UPI/DR/600000000001/TEA STALL/YESB/q000000001@ybl/S"],
        "debit": "40.0",
        "credit": None,
        "balance": "117708.05",
    }


def test_leaves_out_the_notes_after_the_table():
    rows = read(build())["rows"]
    text = " ".join(line for row in rows for line in row["lines"])
    assert "Generated" not in text and "constituent" not in text and "Page" not in text


def test_never_returns_the_holder_or_full_account_number():
    text = repr(read(build()))
    assert "A PERSON" not in text and "SOME STREET" not in text and "0000000100001234" not in text


def test_flags_rows_that_break_the_running_balance():
    assert read(build(misprint_row=3))["warnings"] == ["2 rows don't follow the running balance"]


def test_one_day_statement_ordered_by_balance():
    # Every row on 10 Nov: only the balances tell which came last.
    rows = read(build(rows=ROWS[:3]))["rows"]
    assert [r["debit"] for r in rows] == ["3.55", "2000.0", "40.0"]
    assert result_warnings(rows) == []


def result_warnings(rows):
    return [r for r in zip(rows, rows[1:]) if float(r[0]["balance"]) - float(r[1]["debit"] or 0) + float(r[1]["credit"] or 0) - float(r[1]["balance"]) > 0.001]


def test_pdf_without_text():
    from reportlab.pdfgen import canvas

    out = io.BytesIO()
    c = canvas.Canvas(out)
    c.rect(50, 50, 100, 100)
    c.showPage()
    c.save()
    with pytest.raises(statement.NoText):
        read(out.getvalue())
