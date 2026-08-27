#!/usr/bin/env python3
"""Discover HubSpot ticket properties and search for Dr Isha session notes."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://api.hubapi.com"
SEARCH_TERMS = [
    "cognitive rehabilitation",
    "Clock Drawing",
    "orientation training",
    "Ms. Shehnaz participated",
    "fruit naming",
]


def load_env_local() -> None:
    env_path = ROOT / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def api(method: str, path: str, body: dict | None = None) -> dict:
    token = os.environ.get("HUBSPOT_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("Set HUBSPOT_ACCESS_TOKEN or add to dashboard/.env.local")

    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read())


def main() -> None:
    load_env_local()

    print("=== Ticket property definitions (name + label) ===")
    props = api("GET", "/crm/v3/properties/tickets?archived=false")
    interesting = []
    for p in props.get("results", []):
        name = p.get("name", "")
        label = (p.get("label") or "").lower()
        if any(
            k in label or k in name.lower()
            for k in (
                "note",
                "session",
                "clinical",
                "analysis",
                "physio",
                "doctor",
                "content",
                "description",
                "comment",
                "summary",
                "report",
                "insight",
                "feedback",
                "outcome",
            )
        ):
            interesting.append((name, p.get("label"), p.get("type")))
    for name, label, typ in sorted(interesting):
        print(f"  {name:40} | {label:35} | {typ}")
    print(f"  ... {len(interesting)} interesting of {len(props.get('results', []))} total")

    print("\n=== Search tickets containing cognitive rehabilitation text ===")
    for term in SEARCH_TERMS[:2]:
        search = api(
            "POST",
            "/crm/v3/objects/tickets/search",
            {
                "filterGroups": [
                    {
                        "filters": [
                            {
                                "propertyName": "content",
                                "operator": "CONTAINS_TOKEN",
                                "value": term.split()[0],
                            }
                        ]
                    }
                ],
                "properties": ["subject", "content", "ticket_sub_category", "benefactor_name"],
                "limit": 5,
            },
        )
        print(f"\nTerm '{term}' in content: {search.get('total', 0)} hits")
        for row in search.get("results", []):
            p = row.get("properties", {})
            content = p.get("content") or ""
            if term.lower() not in content.lower():
                continue
            print(f"  {row['id']} | {p.get('benefactor_name')} | {p.get('subject', '')[:50]}")
            idx = content.lower().find(term.lower())
            print(f"    snippet: {content[max(0,idx-20):idx+200].replace(chr(10),' ')[:220]}")

    print("\n=== Sample Tarim physio ticket - all populated properties ===")
    sample = api(
        "POST",
        "/crm/v3/objects/tickets/search",
        {
            "filterGroups": [
                {
                    "filters": [
                        {"propertyName": "benefactor_name", "operator": "CONTAINS_TOKEN", "value": "Tarim"},
                        {"propertyName": "ticket_sub_category", "operator": "CONTAINS_TOKEN", "value": "physio"},
                    ]
                }
            ],
            "properties": [p[0] for p in interesting] + ["subject", "content"],
            "limit": 3,
            "sorts": [{"propertyName": "closed_date", "direction": "DESCENDING"}],
        },
    )
    for row in sample.get("results", []):
        p = row.get("properties", {})
        print(f"\nTicket {row['id']} | {p.get('subject')}")
        for key, val in sorted(p.items()):
            if not val or not str(val).strip():
                continue
            if key in {"createdate", "hs_lastmodifieddate", "hs_object_id"}:
                continue
            text = str(val)
            if len(text) > 120:
                text = text[:120] + "…"
            print(f"  {key}: {text}")

        assoc = api("GET", f"/crm/v4/objects/tickets/{row['id']}/associations/notes")
        note_ids = [str(x.get("toObjectId")) for x in assoc.get("results", [])]
        print(f"  associated notes: {len(note_ids)}")
        if note_ids:
            note_batch = api(
                "POST",
                "/crm/v3/objects/notes/batch/read",
                {
                    "properties": ["hs_note_body", "hs_timestamp"],
                    "inputs": [{"id": nid} for nid in note_ids[:5]],
                },
            )
            for n in note_batch.get("results", []):
                body = (n.get("properties", {}).get("hs_note_body") or "").replace("\n", " ")
                print(f"    NOTE ({len(body)} chars): {body[:280]}")


if __name__ == "__main__":
    main()
