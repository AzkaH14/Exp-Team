#!/usr/bin/env python3
"""
Sync sacred client registry from Google Sheet → src/data/client-registry.json

Requires in environment (or dashboard/.env.local):
  GOOGLE_SERVICE_ACCOUNT_JSON  — full service account JSON string
  GOOGLE_SHEETS_ID             — defaults to Mohsyn live sheet

Share the sheet with the service account email (Viewer).

Usage:
  cd dashboard && export $(grep -v '^#' .env.local | xargs) && python3 scripts/sync-sacred-sheet.py
"""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src/data/client-registry.json"
SUPPLEMENT = ROOT / "src/data/client-registry-supplement.json"
SHEET_ID = os.environ.get("GOOGLE_SHEETS_ID", "1pTj0G-cXt30Vx2A_qiLwIA9M2rQ4tqZPe60AGnUwcis")
SHEET_RANGE = os.environ.get("GOOGLE_SHEETS_RANGE", "Sheet1!A:Z")

HEADER_MAP = {
    "benefactor": "benefactor",
    "benefactor name": "benefactor",
    "client": "benefactor",
    "client name": "benefactor",
    "name": "benefactor",
    "beneficiary": "beneficiary",
    "beneficiary name": "beneficiary",
    "city": "city",
    "serving city": "city",
    "sign up date": "signupDate",
    "signup date": "signupDate",
    "onboarding date": "signupDate",
    "status": "status",
}


def slug(name: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", name.lower()))


def get_token(sa: dict) -> str:
    try:
        import jwt  # type: ignore
    except ImportError:
        raise SystemExit("pip install pyjwt cryptography")

    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": sa["client_email"],
            "scope": "https://www.googleapis.com/auth/spreadsheets.readonly",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        },
        sa["private_key"],
        algorithm="RS256",
    )
    data = urllib.parse.urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["access_token"]


def fetch_rows(token: str) -> list[list[str]]:
    rng = urllib.parse.quote(SHEET_RANGE)
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{rng}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read()).get("values", [])


def parse_city(raw: str) -> str:
    c = (raw or "").strip()
    if re.search(r"islamabad|rawalpindi", c, re.I):
        return "Islamabad"
    if re.search(r"karachi", c, re.I):
        return "Karachi"
    if re.search(r"lahore", c, re.I):
        return "Lahore"
    return "Other"


def main() -> None:
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        raise SystemExit(
            "Set GOOGLE_SERVICE_ACCOUNT_JSON in .env.local and share the sheet with the service account email."
        )
    sa = json.loads(raw)
    rows = fetch_rows(get_token(sa))
    if len(rows) < 2:
        raise SystemExit("Sheet empty or unreadable")

    headers = [h.lower().strip() for h in rows[0]]
    col = {}
    for i, h in enumerate(headers):
        key = HEADER_MAP.get(h)
        if key and key not in col:
            col[key] = i

    if "benefactor" not in col:
        raise SystemExit(f"No benefactor column. Headers: {headers}")

    supplement = {}
    if SUPPLEMENT.exists():
        supplement = json.loads(SUPPLEMENT.read_text()).get("byBenefactor", {})

    clients = []
    for row in rows[1:]:
        benefactor = (row[col["benefactor"]] if col["benefactor"] < len(row) else "").strip()
        if not benefactor:
            continue
        sup = supplement.get(benefactor, {})
        beneficiary = sup.get("beneficiary")
        if not beneficiary:
            beneficiary = "TBC"
            if "beneficiary" in col and col["beneficiary"] < len(row):
                beneficiary = row[col["beneficiary"]].strip() or "TBC"
        city = sup.get("city") or parse_city(
            row[col["city"]] if "city" in col and col["city"] < len(row) else ""
        )
        status = sup.get("status", "active")
        if "status" in col and col["status"] < len(row):
            s = row[col["status"]].lower()
            if "pause" in s:
                status = "pause"
            elif "cancel" in s:
                status = "cancelled"
            elif "gratis" in s:
                status = "gratis"
        clients.append(
            {
                "id": slug(benefactor),
                "benefactor": benefactor,
                "beneficiary": beneficiary,
                "city": city,
                "signupDate": None,
                "serviceTier": "premium",
                "status": status,
                "country": None,
                "linkedin": None,
                "biraUrl": None,
                "aliases": sup.get("aliases", []),
                "source": "sacred",
            }
        )

    summary = {
        "total": len(clients),
        "active": sum(1 for c in clients if c["status"] == "active"),
        "pause": sum(1 for c in clients if c["status"] == "pause"),
        "cancelled": sum(1 for c in clients if c["status"] == "cancelled"),
        "gratis": sum(1 for c in clients if c["status"] == "gratis"),
        "byCity": {
            "Islamabad": sum(1 for c in clients if c["city"] == "Islamabad"),
            "Karachi": sum(1 for c in clients if c["city"] == "Karachi"),
            "Lahore": sum(1 for c in clients if c["city"] == "Lahore"),
            "Other": sum(1 for c in clients if c["city"] == "Other"),
        },
    }

    payload = {
        "version": 3,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": f"Google Sheet ({SHEET_ID})",
        "sheetUrl": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}",
        "summary": summary,
        "clients": clients,
    }
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {len(clients)} clients from Google Sheet → {OUT.name}")


if __name__ == "__main__":
    main()
