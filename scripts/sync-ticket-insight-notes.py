#!/usr/bin/env python3
"""
Sync physio/doctor insight notes from HubSpot ticket activity timelines.

Reads tickets from src/data/tickets.json (or live HubSpot search), fetches:
  - CRM associations: notes, calls, emails, tasks, meetings, communications
  - Legacy engagements API (fallback when CRM associations are empty)

Writes src/data/ticket-notes.json for static/offline reports.

Usage:
  export HUBSPOT_ACCESS_TOKEN='pat-...'
  python3 scripts/sync-ticket-insight-notes.py
  python3 scripts/sync-ticket-insight-notes.py --sample 5   # debug first N physio tickets
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

TOKEN = os.environ.get("HUBSPOT_ACCESS_TOKEN", "").strip()
BASE = "https://api.hubapi.com"
ROOT = Path(__file__).resolve().parent.parent
TICKETS_PATH = ROOT / "src/data/tickets.json"
OUT_PATH = ROOT / "src/data/ticket-notes.json"
BATCH = 100


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
    global TOKEN
    TOKEN = os.environ.get("HUBSPOT_ACCESS_TOKEN", "").strip() or TOKEN
    if not TOKEN:
        raise SystemExit("Set HUBSPOT_ACCESS_TOKEN or add it to dashboard/.env.local")

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
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HubSpot {e.code} {path}: {text[:200]}") from e


def strip_html(raw: str) -> str:
    if not raw:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def ticket_needs_notes(t: dict) -> bool:
    blob = f"{t.get('subCategory','')} {t.get('categoryFull','')} {t.get('name','')}".lower()
    if re.search(r"physio|physiotherap", blob):
        return True
    if t.get("categoryFull") in {
        "Healthcare Services",
        "Medical Errands (non-emergency)",
        "Psychologist Call",
        "Emergency Services",
    }:
        return True
    return bool(re.search(r"\bdr\.?\b|doctor|mohsyn doctor|consultant|specialist", blob))


def chunk(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def assoc_ids(ticket_ids: list[str], assoc_type: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for batch in chunk(ticket_ids, BATCH):
        try:
            data = api(
                "POST",
                f"/crm/v4/associations/tickets/{assoc_type}/batch/read",
                {"inputs": [{"id": tid} for tid in batch]},
            )
        except RuntimeError:
            continue
        for row in data.get("results", []):
            tid = row.get("from", {}).get("id")
            ids = [str(t.get("toObjectId")) for t in row.get("to", [])]
            if tid and ids:
                out.setdefault(tid, []).extend(ids)
    return out


def read_objects(object_type: str, ids: list[str], properties: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for batch in chunk(ids, BATCH):
        try:
            data = api(
                "POST",
                f"/crm/v3/objects/{object_type}/batch/read",
                {"properties": properties, "inputs": [{"id": i} for i in batch]},
            )
        except RuntimeError:
            continue
        for row in data.get("results", []):
            out[row["id"]] = row.get("properties", {})
    return out


def compose_note(props: dict) -> str:
    return strip_html(props.get("hs_note_body") or "")


def compose_call(props: dict) -> str:
    return strip_html("\n".join(x for x in [props.get("hs_call_title"), props.get("hs_call_body")] if x))


def compose_email(props: dict) -> str:
    return strip_html("\n".join(x for x in [props.get("hs_email_subject"), props.get("hs_email_text")] if x))


def compose_task(props: dict) -> str:
    return strip_html("\n".join(x for x in [props.get("hs_task_subject"), props.get("hs_task_body")] if x))


def compose_meeting(props: dict) -> str:
    return strip_html(
        "\n".join(
            x
            for x in [
                props.get("hs_meeting_title"),
                props.get("hs_meeting_body"),
                props.get("hs_internal_meeting_notes"),
            ]
            if x
        )
    )


READERS = [
    ("notes", "notes", ["hs_note_body", "hs_timestamp", "hs_createdate"], compose_note),
    ("calls", "calls", ["hs_call_title", "hs_call_body", "hs_timestamp"], compose_call),
    ("emails", "emails", ["hs_email_subject", "hs_email_text", "hs_timestamp"], compose_email),
    ("tasks", "tasks", ["hs_task_subject", "hs_task_body", "hs_timestamp"], compose_task),
    (
        "meetings",
        "meetings",
        ["hs_meeting_title", "hs_meeting_body", "hs_internal_meeting_notes", "hs_timestamp"],
        compose_meeting,
    ),
]


def legacy_engagements(ticket_id: str) -> list[dict]:
    out: list[dict] = []
    offset = None
    for _ in range(8):
        qs = "limit=100"
        if offset is not None:
            qs += f"&offset={offset}"
        try:
            data = api("GET", f"/engagements/v1/engagements/associated/TICKET/{ticket_id}/paged?{qs}")
        except RuntimeError:
            break
        for row in data.get("results", []):
            eng = row.get("engagement", {})
            meta = row.get("metadata", {}) or {}
            typ = (eng.get("type") or "").upper()
            if typ == "NOTE":
                body = strip_html(meta.get("body") or "")
            elif typ == "CALL":
                body = strip_html("\n".join(x for x in [meta.get("title"), meta.get("body"), meta.get("disposition")] if x))
            elif typ == "TASK":
                body = strip_html("\n".join(x for x in [meta.get("subject"), meta.get("body")] if x))
            elif typ in {"EMAIL", "INCOMING_EMAIL", "FORWARDED_EMAIL"}:
                body = strip_html("\n".join(x for x in [meta.get("subject"), meta.get("text"), meta.get("html")] if x))
            else:
                body = strip_html(meta.get("body") or meta.get("text") or "")
            if len(body) < 8:
                continue
            ts = eng.get("timestamp")
            out.append(
                {
                    "id": f"legacy-{typ}-{eng.get('id')}",
                    "body": body,
                    "createdAt": datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
                    if isinstance(ts, (int, float))
                    else None,
                    "source": f"legacy:{typ.lower()}",
                }
            )
        if not data.get("hasMore"):
            break
        offset = data.get("offset")
    return out


def score_clinical_note(note: str) -> int:
    text = re.sub(r"\s+", " ", (note or "").strip())
    lower = text.lower()
    if not text:
        return -100
    score = 0
    if len(text) >= 80:
        score += 8
    if len(text) >= 200:
        score += 12
    if len(text) >= 500:
        score += 18
    if re.search(
        r"cognitive rehabilitation|session report|orientation training|clock drawing test|delayed recall|semantic memory|fruit naming",
        lower,
    ):
        score += 90
    if re.search(r"during today.s \d+-minute|scored \d+/\d+", lower):
        score += 45
    if re.search(r"finance (?:has been|group has been) updated|shared details with the finance", lower) and len(text) < 180:
        score -= 120
    return score


def rank_clinical_bodies(bodies: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for body in bodies:
        key = body.lower()[:220]
        if key in seen:
            continue
        seen.add(key)
        unique.append(body)
    return [b for b, _ in sorted(((b, score_clinical_note(b)) for b in unique), key=lambda x: (-x[1], -len(x[0])))]


def fetch_tickets_from_hubspot(since: str = "2025-11-01") -> list[dict]:
    since_ms = int(datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp() * 1000)
    props = [
        "subject",
        "content",
        "ticket_category",
        "ticket_sub_category",
        "serving_city",
        "benefactor_name",
        "benefactor_email",
        "createdate",
        "closed_date",
        "hs_ticket_priority",
    ]
    tickets: list[dict] = []
    after = None
    while True:
        body: dict = {
            "filterGroups": [
                {"filters": [{"propertyName": "createdate", "operator": "GTE", "value": str(since_ms)}]}
            ],
            "properties": props,
            "limit": 100,
            "sorts": [{"propertyName": "createdate", "direction": "DESCENDING"}],
        }
        if after:
            body["after"] = after
        data = api("POST", "/crm/v3/objects/tickets/search", body)
        for row in data.get("results", []):
            p = row.get("properties", {})
            tid = row["id"]
            created = p.get("createdate") or ""
            closed = p.get("closed_date") or ""
            cat_full = p.get("ticket_category") or ""
            client = (p.get("benefactor_name") or "").strip()
            try:
                created_label = (
                    datetime.fromisoformat(created.replace("Z", "+00:00"))
                    .strftime("%d %b %Y")
                    if created
                    else ""
                )
            except ValueError:
                created_label = created
            try:
                closed_label = (
                    datetime.fromisoformat(closed.replace("Z", "+00:00")).strftime("%d %b %Y")
                    if closed
                    else ""
                )
            except ValueError:
                closed_label = closed
            try:
                month_label = (
                    datetime.fromisoformat(created.replace("Z", "+00:00")).strftime("%b %Y")
                    if created
                    else ""
                )
            except ValueError:
                month_label = ""
            tickets.append(
                {
                    "id": tid,
                    "ticketNumber": f"MOH-{tid[-5:]}",
                    "client": client,
                    "email": (p.get("benefactor_email") or None),
                    "city": p.get("serving_city") or "Other",
                    "category": cat_full.split()[0] if cat_full else "",
                    "categoryFull": cat_full or "Unspecified",
                    "subCategory": p.get("ticket_sub_category") or "",
                    "name": p.get("subject") or "",
                    "description": (p.get("content") or "")[:4000],
                    "created": created_label,
                    "closed": closed_label or None,
                    "month": month_label,
                    "priority": (p.get("hs_ticket_priority") or "normal").lower(),
                }
            )
        after = data.get("paging", {}).get("next", {}).get("after")
        if not after:
            break
    return tickets


def main() -> None:
    load_env_local()
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=0, help="Only process first N eligible tickets")
    parser.add_argument(
        "--from-hubspot",
        action="store_true",
        help="Refresh ticket list from HubSpot API (writes tickets.json)",
    )
    args = parser.parse_args()

    if args.from_hubspot:
        tickets = fetch_tickets_from_hubspot()
        TICKETS_PATH.write_text(json.dumps(tickets, ensure_ascii=False), encoding="utf-8")
        print(f"Fetched {len(tickets)} tickets from HubSpot -> {TICKETS_PATH.name}")
    elif not TICKETS_PATH.exists():
        raise SystemExit(f"Missing {TICKETS_PATH}")

    tickets = json.loads(TICKETS_PATH.read_text(encoding="utf-8"))
    eligible = [t for t in tickets if ticket_needs_notes(t)]
    if args.sample:
        eligible = eligible[: args.sample]

    ticket_ids = [t["id"] for t in eligible]
    print(f"Eligible medical/physio tickets: {len(eligible)}")

    by_ticket: dict[str, dict] = {}
    by_source: dict[str, int] = {}
    seen: dict[str, set[str]] = {}

    for assoc_type, object_type, props, compose in READERS:
        associated = assoc_ids(ticket_ids, assoc_type)
        all_ids = sorted({i for ids in associated.values() for i in ids})
        if not all_ids:
            print(f"  {assoc_type}: 0 associations")
            continue
        bodies = read_objects(object_type, all_ids, props)
        hits = 0
        for tid, obj_ids in associated.items():
            for oid in obj_ids:
                body = compose(bodies.get(oid, {}))
                if len(body) < 8:
                    continue
                key = body.lower()[:240]
                seen.setdefault(tid, set())
                if key in seen[tid]:
                    continue
                seen[tid].add(key)
                rec = by_ticket.setdefault(
                    tid,
                    {
                        "ticketId": tid,
                        "ticketNumber": next((t["ticketNumber"] for t in eligible if t["id"] == tid), tid),
                        "notes": [],
                    },
                )
                rec["notes"].append(
                    {
                        "id": f"{object_type}-{oid}",
                        "body": body,
                        "createdAt": bodies.get(oid, {}).get("hs_timestamp"),
                        "source": object_type,
                    }
                )
                by_source[object_type] = by_source.get(object_type, 0) + 1
                hits += 1
        print(f"  {assoc_type}: {len(all_ids)} objects, {hits} note bodies attached")

    missing = [tid for tid in ticket_ids if tid not in by_ticket]
    print(f"Tickets still missing notes after CRM pass: {len(missing)} — trying legacy engagements API")
    for i, tid in enumerate(missing):
        legacy = legacy_engagements(tid)
        if not legacy:
            continue
        rec = by_ticket.setdefault(
            tid,
            {
                "ticketId": tid,
                "ticketNumber": next((t["ticketNumber"] for t in eligible if t["id"] == tid), tid),
                "notes": [],
            },
        )
        for note in legacy:
            key = note["body"].lower()[:240]
            seen.setdefault(tid, set())
            if key in seen[tid]:
                continue
            seen[tid].add(key)
            rec["notes"].append(note)
            src = note.get("source", "legacy")
            by_source[src] = by_source.get(src, 0) + 1
        if (i + 1) % 25 == 0:
            print(f"  legacy checked {i + 1}/{len(missing)}")
            time.sleep(0.15)

    for rec in by_ticket.values():
        if not rec["notes"]:
            continue
        ranked = rank_clinical_bodies([n["body"] for n in rec["notes"]])
        order = {body: idx for idx, body in enumerate(ranked)}
        rec["notes"].sort(key=lambda n: order.get(n["body"], 999))

    total_notes = sum(len(r["notes"]) for r in by_ticket.values())
    payload = {
        "syncedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "ticketsChecked": len(eligible),
            "ticketsWithNotes": len(by_ticket),
            "totalNotes": total_notes,
            "bySource": by_source,
        },
        "byTicketId": by_ticket,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(
        f"Wrote {OUT_PATH.name}: {len(by_ticket)} tickets, {total_notes} notes, sources={by_source}"
    )


if __name__ == "__main__":
    main()
