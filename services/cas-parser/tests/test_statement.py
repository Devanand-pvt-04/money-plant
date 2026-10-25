import io

import pytest

import statement
from synthetic_statement import ROWS, build


def read(data, password=None):
    return statement.read_statement(io.BytesIO(data), password)


def test_reads_every_row_across_pages():
    result = read(build())
    assert result["bank"] == "icici"
    assert result["account_last4"] == "1234"
    assert result["warnings"] == []
    rows = result["rows"]
    assert len(rows) == len(ROWS)
    assert rows[0] == {
        "date": "2026-10-01",
        "lines": ["RENTOK", "UPI/RENTOK/XXabcd@hdfcban/Pay/HDFC", "BANK/600000000001/ICI00000000000000000001"],
        "debit": "12500.00",
        "credit": None,
        "balance": "87500.00",
    }
    assert rows[2]["credit"] == "766.50" and rows[2]["debit"] is None
    assert rows[3]["credit"] == "6315.81"
    assert rows[4]["lines"] == ["Self", "BIL/INFT/ABC1234567/CC BillPay-0000/Self"]
    # The first row of the second page, and nothing from the footer.
    assert rows[4]["date"] == "2026-10-03"
    assert all("www" not in line for row in rows for line in row["lines"])


def test_never_returns_the_holder_or_full_account_number():
    text = repr(read(build()))
    assert "A PERSON" not in text and "SOME STREET" not in text and "000000001234" not in text


def test_password_protected_statement():
    data = build(password="secret1")
    with pytest.raises(statement.WrongPassword):
        read(data, "nope")
    assert len(read(data, "secret1")["rows"]) == len(ROWS)


def test_flags_rows_that_break_the_running_balance():
    # Row 3's printed balance is off by a rupee, so rows 3 and 4 don't follow.
    assert read(build(misprint_row=3))["warnings"] == ["2 rows don't follow the running balance"]


def test_not_a_statement():
    with pytest.raises(statement.NotAStatement):
        read(b"not a pdf")
