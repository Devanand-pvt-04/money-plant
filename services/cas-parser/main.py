"""CAS and statement parsing service (NW-3, CAP-5, decision 0010).

Reads a CAMS or KFintech Consolidated Account Statement with casparser and
returns the folios, schemes, units, valuation and transactions; reads a bank
statement PDF into transaction rows (statement.py). Only the parse-cas and
parse-statement edge functions call it, with a shared token; the phone never does.

Nothing is stored: the file and password live in memory for one request.
Investor details (name, email, phone, address, PAN, nominees) are dropped
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
from casparser.types import CASData
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
        "statement": {"from": _text(period.get("from")), "to": _text(period.get("to"))},
        "cas_type": _text(data.get("cas_type")),
        "file_type": _text(data.get("file_type")),
        "warnings": [str(w) for w in data.get("parse_warnings", [])],
        "folios": folios,
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
    # NSDL and CDSL statements list demat holdings; stocks wait (decision 0010).
    if not isinstance(parsed, CASData):
        raise HTTPException(status_code=422, detail="demat_not_supported")
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
    except statement.NotAStatement:
        raise HTTPException(status_code=422, detail="not_a_statement")
    finally:
        del data
