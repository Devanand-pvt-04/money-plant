from decimal import Decimal

import pytest
from casparser.exceptions import IncorrectPasswordError
from fastapi.testclient import TestClient

import main
from casparser.types import CASData

SAMPLE = {
    "statement_period": {"from": "01-Apr-2026", "to": "24-Oct-2026"},
    "investor_info": {"name": "A Person", "email": "a@example.com", "address": "Somewhere", "mobile": "9999999999"},
    "cas_type": "DETAILED",
    "file_type": "CAMS",
    "parse_warnings": [],
    "folios": [
        {
            "folio": "1234567/89",
            "amc": "Example Mutual Fund",
            "name": "A Person",
            "PAN": "ABCDE1234F",
            "schemes": [
                {
                    "scheme": "Example Flexi Cap Fund - Direct Growth",
                    "isin": "INF000000001",
                    "amfi": "100001",
                    "rta": "CAMS",
                    "rta_code": "X1",
                    "type": "EQUITY",
                    "nominees": ["Someone"],
                    "open": Decimal("0"),
                    "close": Decimal("123.456"),
                    "close_calculated": Decimal("123.456"),
                    "valuation": {"date": "2026-10-24", "nav": Decimal("101.2345"), "cost": Decimal("12000.00"), "value": Decimal("12497.80")},
                    "transactions": [
                        {"date": "2026-10-15", "description": "SIP", "amount": Decimal("2499.88"), "units": Decimal("24.701"), "nav": Decimal("101.2000"), "type": "PURCHASE_SIP"},
                        {"date": "2026-10-15", "description": "Stamp", "amount": Decimal("0.12"), "units": None, "nav": None, "type": "STAMP_DUTY_TAX"},
                    ],
                }
            ],
        }
    ],
}


def sample(*args, **kwargs):
    return CASData.model_validate(SAMPLE)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", "secret")
    return TestClient(main.app)


def post(client, token="secret"):
    return client.post("/cas", files={"file": ("cas.pdf", b"%PDF-1.4", "application/pdf")}, data={"password": "pw"}, headers={"x-service-token": token})


def test_rejects_a_wrong_token(client, monkeypatch):
    monkeypatch.setattr(main.casparser, "read_cas_pdf", sample)
    assert post(client, token="nope").status_code == 401


def test_rejects_everything_when_no_token_is_configured(client, monkeypatch):
    monkeypatch.delenv("SERVICE_TOKEN")
    monkeypatch.setattr(main.casparser, "read_cas_pdf", sample)
    assert post(client, token="").status_code == 401


def test_returns_holdings_without_investor_details(client, monkeypatch):
    monkeypatch.setattr(main.casparser, "read_cas_pdf", sample)
    response = post(client)
    assert response.status_code == 200
    body = response.json()
    text = response.text
    for private in ("A Person", "a@example.com", "9999999999", "ABCDE1234F", "Somewhere", "Someone"):
        assert private not in text
    scheme = body["folios"][0]["schemes"][0]
    assert scheme["units"] == "123.456"
    assert scheme["valuation"] == {"date": "2026-10-24", "nav": "101.2345", "cost": "12000.00", "value": "12497.80"}
    assert scheme["transactions"][0] == {"date": "2026-10-15", "type": "PURCHASE_SIP", "amount": "2499.88", "units": "24.701", "nav": "101.2000"}
    assert body["statement"] == {"from": "01-Apr-2026", "to": "24-Oct-2026"}


def test_reports_a_wrong_password(client, monkeypatch):
    def wrong(*a, **k):
        raise IncorrectPasswordError("bad")

    monkeypatch.setattr(main.casparser, "read_cas_pdf", wrong)
    response = post(client)
    assert response.status_code == 422
    assert response.json()["detail"] == "wrong_password"


def test_wakes_up(client):
    assert client.get("/health").json() == {"ok": True}


def post_statement(client, data, password="", token="secret"):
    return client.post("/statement", files={"file": ("statement.pdf", data, "application/pdf")}, data={"password": password}, headers={"x-service-token": token})


def test_statement_needs_the_token(client):
    from synthetic_statement import build

    assert post_statement(client, build(), token="nope").status_code == 401


def test_reads_a_statement(client):
    from synthetic_statement import ROWS, build

    response = post_statement(client, build(password="pw1"), password="pw1")
    assert response.status_code == 200
    assert len(response.json()["rows"]) == len(ROWS)
    assert post_statement(client, build(password="pw1"), password="x").json()["detail"] == "wrong_password"
    assert post_statement(client, b"%PDF-1.4 nothing").json()["detail"] == "not_a_statement"


from casparser.types import NSDLCASData

DEMAT = {
    "statement_period": {"from": "01-Oct-2026", "to": "31-Oct-2026"},
    "investor_info": {"name": "A Person", "email": "a@example.com", "address": "Somewhere", "mobile": "9999999999"},
    "file_type": "CDSL",
    "parse_warnings": [],
    "accounts": [
        {
            "name": "EXAMPLE BROKING LIMITED",
            "type": "CDSL",
            "dp_id": "12081600",
            "client_id": "12081600 00123456",
            "folios": 0,
            "balance": Decimal("15250.00"),
            "owners": [{"name": "A Person", "PAN": "ABCDE1234F"}],
            "equities": [
                {"name": "EXAMPLE INDUSTRIES LTD", "isin": "INE000A01011", "num_shares": Decimal("10"), "price": Decimal("1200.50"), "value": Decimal("12005.00"), "symbol": "EXAMPLE"},
            ],
            "mutual_funds": [
                {"name": "Example Liquid Fund", "isin": "INF000000002", "balance": Decimal("1.5"), "nav": Decimal("2000"), "value": Decimal("3000"), "total_cost": Decimal("2900")},
            ],
            "bonds": [
                {"name": "SGB 2030 SERIES I", "isin": "IN0020230001", "num_bonds": Decimal("1"), "value": Decimal("7245.00"), "market_price": Decimal("7245.00")},
            ],
        }
    ],
    "nps": {
        "pran": "XXXXXXXX1234",
        "value": Decimal("50000"),
        "schemes": [
            {"scheme": "EXAMPLE PENSION FUND SCHEME E - TIER I", "fund_manager": "Example Pension Fund", "tier": "I", "asset_class": "E", "units": Decimal("1000.1234"), "nav": Decimal("50"), "value": Decimal("50006.17")},
        ],
    },
}


def demat(*args, **kwargs):
    return NSDLCASData.model_validate(DEMAT)


def test_returns_demat_holdings_without_owners_or_ids(client, monkeypatch):
    monkeypatch.setattr(main.casparser, "read_cas_pdf", demat)
    response = post(client)
    assert response.status_code == 200
    text = response.text
    for private in ("A Person", "a@example.com", "9999999999", "ABCDE1234F", "Somewhere", "12081600", "XXXXXXXX1234"):
        assert private not in text
    body = response.json()
    assert body["kind"] == "demat"
    account = body["accounts"][0]
    assert account["client"] == "3456"
    assert account["equities"][0] == {
        "name": "EXAMPLE INDUSTRIES LTD",
        "isin": "INE000A01011",
        "symbol": "EXAMPLE",
        "units": "10",
        "price": "1200.50",
        "value": "12005.00",
    }
    assert account["bonds"][0]["units"] == "1"
    assert account["funds"][0]["cost"] == "2900"
    assert body["nps"]["pran"] == "1234"
    assert body["nps"]["schemes"][0]["units"] == "1000.1234"
