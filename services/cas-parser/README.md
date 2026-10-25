# cas-parser

A small Python service that reads a CAMS or KFintech CAS PDF with
[casparser](https://github.com/codereverser/casparser) for the mutual fund import (NW-3), and bank
statement PDFs with pdfplumber for statement import (CAP-5, `statement.py`), decision 0010.
Only the `parse-cas` and `parse-statement` edge functions call it; files and passwords are never
stored, and investor and account holder details are dropped before the response.

## Deploy on Render (free plan)

1. Sign in at https://render.com, choose **New > Blueprint** and pick this repository. Render reads `render.yaml`
   at the repo root and creates the `money-plant-cas-parser` web service in Singapore on the free plan.
2. When it asks for `SERVICE_TOKEN`, paste a long random string (for example the output of `openssl rand -hex 32`).
3. Give the edge function the same values:
   `npx supabase secrets set CAS_SERVICE_URL=https://<your-service>.onrender.com CAS_SERVICE_TOKEN=<the same string>`
4. Deploy the functions: `npx supabase functions deploy parse-cas`, `npx supabase functions deploy parse-statement` (same secrets) and `npx supabase functions deploy nav-prices` (daily NAVs; needs no secrets).

The free service sleeps after 15 minutes without requests, so the first import after a break waits about a minute.

## Test

```
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```
