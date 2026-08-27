#!/usr/bin/env python3
"""
HubSpot API discovery — compare live payload shape vs dashboard sheet JSON.
Requires HUBSPOT_ACCESS_TOKEN in environment (never commit the token).

Usage:
  export HUBSPOT_ACCESS_TOKEN='pat-...'
  python3 scripts/hubspot-discovery.py
"""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TOKEN = os.environ.get("HUBSPOT_ACCESS_TOKEN", "")
BASE = "https://api.hubapi.com"
ROOT = Path(__file__).resolve().parent.parent
SHEET_TICKETS = ROOT / "src/data/tickets.json"
SHEET_ANALYTICS = ROOT / "src/data/analytics.json"

MAR_2026_MS = int(datetime(2026, 3, 1, tzinfo=timezone.utc).timestamp() * 1000)
JUN_2026_MS = int(datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp() * 1000)

TICKET_PROPS = [
    "subject",
    "content",
    "ticket_category",
    "ticket_sub_category",
    "serving_city",
    "benefactor_name",
    "benefactor_email",
    "hs_all_associated_contact_firstnames",
    "hs_all_associated_contact_emails",
    "createdate",
    "closed_date",
    "hs_ticket_priority",
    "hs_pipeline_stage",
]


def api(method: str, path: str, body: dict | None = None) -> dict:
    if not TOKEN:
        raise SystemExit("Set HUBSPOT_ACCESS_TOKEN in environment")
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def hubspot_to_dashboard_ticket(row: dict) -> dict:
    """Map HubSpot ticket properties → dashboard Ticket shape."""
    p = row.get("properties", {})
    tid = row.get("id", "")
    created = p.get("createdate", "")
    closed = p.get("closed_date") or ""
    month = ""
    if created:
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            month = dt.strftime("%b %Y")
        except ValueError:
            pass

    cat_full = p.get("ticket_category") or ""
    cat_short = cat_full.split()[0] if cat_full else ""

    def fmt_date(iso: str) -> str:
        if not iso:
            return ""
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            return dt.strftime("%d %b %Y")
        except ValueError:
            return iso

    client = (p.get("benefactor_name") or p.get("hs_all_associated_contact_firstnames") or "").strip()
    email = p.get("benefactor_email") or p.get("hs_all_associated_contact_emails") or ""
    if ";" in email:
        email = email.split(";")[0].strip()

    return {
        "id": tid,
        "ticketNumber": f"MOH-{tid[-5:]}",
        "client": client,
        "email": email or None,
        "city": p.get("serving_city") or "",
        "category": cat_short,
        "categoryFull": cat_full,
        "subCategory": p.get("ticket_sub_category") or "",
        "name": p.get("subject") or "",
        "description": (p.get("content") or "")[:500],
        "created": fmt_date(created),
        "closed": fmt_date(closed),
        "month": month,
        "priority": (p.get("hs_ticket_priority") or "normal").lower(),
    }


def main() -> None:
    print("=== HubSpot account ===")
    acct = api("GET", "/account-info/v3/details")
    print(f"  portalId: {acct.get('portalId')}")
    print(f"  timezone: {acct.get('timeZone')}")

    print("\n=== Mar–May 2026 ticket count (createdate) ===")
    search = api(
        "POST",
        "/crm/v3/objects/tickets/search",
        {
            "filterGroups": [
                {
                    "filters": [
                        {"propertyName": "createdate", "operator": "GTE", "value": str(MAR_2026_MS)},
                        {"propertyName": "createdate", "operator": "LT", "value": str(JUN_2026_MS)},
                    ]
                }
            ],
            "limit": 1,
        },
    )
    print(f"  HubSpot total: {search.get('total')}")
    if SHEET_ANALYTICS.exists():
        analytics = json.loads(SHEET_ANALYTICS.read_text())
        print(f"  Sheet KPI totalTickets: {analytics['kpis']['totalTickets']}")
        print(f"  Sheet uniqueClients: {analytics['kpis']['uniqueClients']}")

    print("\n=== Field mapping (verified ticket 43226820885) ===")
    sample = api(
        "GET",
        f"/crm/v3/objects/tickets/43226820885?properties={','.join(TICKET_PROPS)}",
    )
    mapped = hubspot_to_dashboard_ticket(sample)
    if SHEET_TICKETS.exists():
        sheet_list = json.loads(SHEET_TICKETS.read_text())
        sheet_row = next((t for t in sheet_list if t["id"] == "43226820885"), None)
        if sheet_row:
            print("  HubSpot → Dashboard mapping:")
            for key in sheet_row:
                hs_val = mapped.get(key, "—")
                sh_val = sheet_row.get(key)
                match = "✓" if str(hs_val).strip() == str(sh_val).strip() else "~"
                print(f"    {match} {key}: hubspot={hs_val!r} sheet={sh_val!r}")

    print("\n=== Latest 3 tickets (live) ===")
    recent = api(
        "POST",
        "/crm/v3/objects/tickets/search",
        {
            "filterGroups": [
                {"filters": [{"propertyName": "ticket_category", "operator": "HAS_PROPERTY"}]}
            ],
            "properties": TICKET_PROPS,
            "limit": 3,
            "sorts": [{"propertyName": "createdate", "direction": "DESCENDING"}],
        },
    )
    for row in recent.get("results", []):
        m = hubspot_to_dashboard_ticket(row)
        print(f"  {m['ticketNumber']} | {m['client']} | {m['categoryFull']} | {m['city']} | {m['month']}")

    print("\nDone. See architecture mapping in README or docs.")


if __name__ == "__main__":
    main()
