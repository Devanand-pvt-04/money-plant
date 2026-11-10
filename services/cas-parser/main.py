"""CAS and statement parsing service (NW-3, CAP-5, decision 0010).

Reads a CAMS or KFintech Consolidated Account Statement with casparser and
returns the folios, schemes, units, valuation and transactions; reads an NSDL
or CDSL statement into each demat account's shares, bonds and funds and the
NPS schemes (NW-5, decision 0014); reads a bank
statement PDF into transaction rows (statement.py). Only the parse-cas and
parse-statement edge functions call it, with a shared token; the phone never does.

Nothing is stored: the file and password live in memory for one request.
Investor details (name, email, phone, address, PAN, nominees, DP and client
IDs, PRAN beyond its last 4 digits) are dropped
before the response, so only what the ledger needs leaves this service.
"""

import hmac
import io
import os
from decimal import Decimal
from enum import Enum
from typing import Any, Optional

import casparser
import statement
from casparser.exceptions import IncorrectPasswordError, ParserException
from casparser.types import CASData, NSDLCASData
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

MAX_BYTES = 10 * 1024 * 1024

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def _check_token(token: Optional[str]) -> None:
    expected = os.environ.get("SERVICE_TOKEN", "")
    if not expected or not hmac.compare_digest((token or "").encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="unauthorised")


def _text(value: Any) -> Optional[str]:
    """Decimals and dates as strings, so no amount passes through a float."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, Enum):
        return value.name
    return str(value)


def trim(data: dict) -> dict:
    """The parts of casparser's output the app uses, without investor details."""
    folios = []
    for folio in data.get("folios", []):
        schemes = []
        for scheme in folio.get("schemes", []):
            valuation = scheme.get("valuation") or {}
            schemes.append(
                {
                    "name": scheme.get("scheme"),
                    "isin": scheme.get("isin"),
                    "amfi": scheme.get("amfi"),
                    "rta": scheme.get("rta"),
                    "type": scheme.get("type"),
                    "units": _text(scheme.get("close")),
                    "valuation": {
                        "date": _text(valuation.get("date")),
                        "nav": _text(valuation.get("nav")),
                        "cost": _text(valuation.get("cost")),
                        "value": _text(valuation.get("value")),
                    },
                    "transactions": [
                        {
                            "date": _text(t.get("date")),
                            "type": _text(t.get("type")),
                            "amount": _text(t.get("amount")),
                            "units": _text(t.get("units")),
                            "nav": _text(t.get("nav")),
                        }
                        for t in scheme.get("transactions", [])
                    ],
                }
            )
        folios.append({"folio": folio.get("folio"), "amc": folio.get("amc"), "schemes": schemes})
    period = data.get("statement_period") or {}
    return {
        "kind": "funds",
        "statement": {"from": _text(period.get("from")), "to": _text(period.get("to"))},
        "cas_type": _text(data.get("cas_type")),
        "file_type": _text(data.get("file_type")),
        "warnings": [str(w) for w in data.get("parse_warnings", [])],
        "folios": folios,
    }


def _last4(value: Any) -> Optional[str]:
    digits = "".join(ch for ch in str(value or "") if ch.isalnum())
    return digits[-4:] if len(digits) >= 4 else None


def trim_demat(data: dict) -> dict:
    """NW-5: shares, bonds and funds per demat account, and NPS, without owners or IDs."""
    accounts = []
    for account in data.get("accounts", []):
        accounts.append(
            {
                "depository": _text(account.get("type")),
                "dp": _text(account.get("name")),
                "client": _last4(account.get("client_id")),
                "equities": [
                    {
                        "name": e.get("name"),
                        "isin": e.get("isin"),
                        "symbol": e.get("symbol"),
                        "units": _text(e.get("num_shares")),
                        "price": _text(e.get("price")),
                        "value": _text(e.get("value")),
                    }
                    for e in account.get("equities", [])
                ],
                "bonds": [
                    {
                        "name": b.get("name"),
                        "isin": b.get("isin"),
                        "units": _text(b.get("num_bonds")),
                        "price": _text(b.get("market_price")),
                        "value": _text(b.get("value")),
                    }
                    for b in account.get("bonds", [])
                ],
                "funds": [
                    {
                        "name": f.get("name"),
                        "isin": f.get("isin"),
                        "amfi": f.get("amfi"),
                        "units": _text(f.get("balance")),
                        "price": _text(f.get("nav")),
                        "value": _text(f.get("value")),
                        "cost": _text(f.get("total_cost")),
                    }
                    for f in account.get("mutual_funds", [])
                ],
            }
        )
    nps = data.get("nps")
    period = data.get("statement_period") or {}
    return {
        "kind": "demat",
        "statement": {"from": _text(period.get("from")), "to": _text(period.get("to"))},
        "file_type": _text(data.get("file_type")),
        "warnings": [str(w) for w in data.get("parse_warnings", [])],
        "accounts": accounts,
        "nps": None
        if not nps
        else {
            "pran": _last4(nps.get("pran")),
            "schemes": [
                {
                    "name": s.get("scheme"),
                    "manager": s.get("fund_manager"),
                    "tier": s.get("tier"),
                    "units": _text(s.get("units")),
                    "price": _text(s.get("nav")),
                    "value": _text(s.get("value")),
                }
                for s in nps.get("schemes", [])
            ],
        },
    }


@app.get("/health")
def health() -> dict:
    """Wakes the service after Render's free tier has put it to sleep."""
    return {"ok": True}


@app.post("/cas")
async def cas(
    file: UploadFile = File(...),
    password: str = Form(...),
    x_service_token: Optional[str] = Header(default=None),
) -> dict:
    _check_token(x_service_token)
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="too_large")
    try:
        parsed = casparser.read_cas_pdf(io.BytesIO(data), password)
    except IncorrectPasswordError:
        raise HTTPException(status_code=422, detail="wrong_password")
    except ParserException:
        raise HTTPException(status_code=422, detail="not_a_cas")
    finally:
        del data
    if isinstance(parsed, NSDLCASData):
        return trim_demat(parsed.model_dump(by_alias=True))
    if not isinstance(parsed, CASData):
        raise HTTPException(status_code=422, detail="not_a_cas")
    return trim(parsed.model_dump(by_alias=True))


@app.post("/statement")
async def bank_statement(
    file: UploadFile = File(...),
    password: str = Form(default=""),
    x_service_token: Optional[str] = Header(default=None),
) -> dict:
    _check_token(x_service_token)
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="too_large")
    try:
        return statement.read_statement(io.BytesIO(data), password or None)
    except statement.WrongPassword:
        raise HTTPException(status_code=422, detail="wrong_password")
    except statement.NoText:
        raise HTTPException(status_code=422, detail="no_text")
    except statement.NotAStatement:
        raise HTTPException(status_code=422, detail="not_a_statement")
    finally:
        del data
