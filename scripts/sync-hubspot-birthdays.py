#!/usr/bin/env python3
"""
Pull benefactor + beneficiary birthdays from HubSpot contacts into
src/data/hubspot-birthdays.json (matched to sacred client-registry.json).

Usage:
  export HUBSPOT_ACCESS_TOKEN='pat-...'
  python3 scripts/sync-hubspot-birthdays.py
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TOKEN = os.environ.get("HUBSPOT_ACCESS_TOKEN", "").strip()
BASE = "https://api.hubapi.com"
ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / "src/data/client-registry.json"
OUT_PATH = ROOT / "src/data/hubspot-birthdays.json"

BLOCKED_EXACT = {
    "mohammad", "misha", "syed", "laiba", "labeba", "babar", "ashar",
    "wasfa", "saira", "fareeha", "huzaifa", "aliza", "shahma", "mahlaqa",
    "fawwad", "testben", "unknown",
}
BLOCKED_PHRASES = [
    "fawwad hashmey", "misbah javed sheikh", "misbah sheikh", "misbah javed",
    "mahlaqa kamran", "mohsyn ops qa",
]

CONTACT_PROPS = [
    "firstname", "lastname", "benefactor_name", "is_benefactor",
    "birthday", "date_of_birth", "relationship_to_benefactor",
]


def normalize(name: str) -> str:
    s = name.lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\b(dr|mr|mrs|ms|miss|syed|muhammad|mohammad|md)\b", " ", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(name: str) -> set[str]:
    return {t for t in normalize(name).split() if len(t) > 1}


def compact(name: str) -> str:
    return normalize(name).replace(" ", "")


def names_match(a: str, b: str) -> bool:
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return False
    if na == nb or na in nb or nb in na:
        return True
    if compact(a) == compact(b):
        return True
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return False
    overlap = len(ta & tb)
    min_size = min(len(ta), len(tb))
    return overlap >= max(2, min_size - 1)


def parse_hubspot_label(name: str) -> list[str]:
    raw = name.strip()
    if not raw:
        return []
    out: list[str] = []
    if ";" in raw:
        for part in raw.split(";"):
            out.extend(parse_hubspot_label(part.strip()))
        return list(dict.fromkeys(out))
    stripped = re.sub(r"\([^)]*\)", " ", raw)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    if stripped:
        out.append(stripped)
    m = re.match(r"^mohsyn\s+x\s+(.+)$", stripped, re.I)
    if m:
        inner = m.group(1).rstrip(".").strip()
        if inner:
            out.append(inner)
        if "/" in inner:
            for part in inner.split("/"):
                p = part.strip()
                if p:
                    out.append(p)
    return list(dict.fromkeys(out))


def match_registry(hubspot_name: str, registry: list[dict]) -> dict | None:
    labels = [hubspot_name, *parse_hubspot_label(hubspot_name)]
    for label in labels:
        norm = normalize(label)
        comp = compact(label)
        if not norm:
            continue
        for r in registry:
            names = [r["benefactor"], r["beneficiary"], *r.get("aliases", [])]
            if any(normalize(n) == norm or compact(n) == comp for n in names):
                return r
    for label in labels:
        for r in registry:
            names = [r["benefactor"], r["beneficiary"], *r.get("aliases", [])]
            if any(names_match(label, n) for n in names):
                return r
    return None


def is_excluded(name: str) -> bool:
    norm = normalize(name)
    if not norm or norm in BLOCKED_EXACT:
        return True
    for phrase in BLOCKED_PHRASES:
        if phrase in norm:
            return True
    parts = norm.split()
    if len(parts) == 1 and parts[0] in {"mohammad", "syed", "misha"}:
        return True
    return False


def parse_birthday(raw: str | None) -> str | None:
    if not raw or not raw.strip():
        return None
    s = raw.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        y, m, d = map(int, s.split("-"))
        if 1 <= m <= 12 and 1 <= d <= 31:
            return s
        return None
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= a <= 12 and 1 <= b <= 31:
            return f"{y:04d}-{a:02d}-{b:02d}"
    return None


def api_post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def fetch_all_contacts() -> list[dict]:
    all_rows: list[dict] = []
    after = None
    while True:
        body: dict = {
            "filterGroups": [
                {"filters": [{"propertyName": "benefactor_name", "operator": "HAS_PROPERTY"}]}
            ],
            "properties": CONTACT_PROPS,
            "limit": 100,
        }
        if after:
            body["after"] = after
        data = api_post("/crm/v3/objects/contacts/search", body)
        for row in data.get("results", []):
            p = row.get("properties", {})
            all_rows.append({
                "firstname": (p.get("firstname") or "").strip(),
                "lastname": (p.get("lastname") or "").strip(),
                "benefactor_name": (p.get("benefactor_name") or "").strip(),
                "is_benefactor": (p.get("is_benefactor") or "").strip(),
                "birthday": parse_birthday(p.get("birthday")) or parse_birthday(p.get("date_of_birth")),
                "relationship_to_benefactor": (p.get("relationship_to_benefactor") or "").strip() or None,
            })
        after = data.get("paging", {}).get("next", {}).get("after")
        if not after:
            break
    return all_rows


def pick_beneficiary_birthday(sacred_beneficiary: str, beneficiaries: list[dict]) -> str | None:
    parts = [p.strip() for p in re.split(r"[/,]", sacred_beneficiary) if p.strip()]
    for part in parts:
        for b in beneficiaries:
            if b.get("birthday") and names_match(part, b["name"]):
                return b["birthday"]
    for b in beneficiaries:
        if b.get("birthday"):
            return b["birthday"]
    return None


def main() -> None:
    if not TOKEN:
        raise SystemExit("Set HUBSPOT_ACCESS_TOKEN in environment")

    registry = json.loads(REGISTRY_PATH.read_text())["clients"]
    contacts = fetch_all_contacts()
    families: dict[str, dict] = {}

    for c in contacts:
        key = c["benefactor_name"]
        if not key or is_excluded(key):
            continue
        if key not in families:
            families[key] = {
                "hubspotKey": key,
                "benefactorBirthday": None,
                "beneficiaries": [],
            }
        fam = families[key]
        name = f"{c['firstname']} {c['lastname']}".strip()
        if c["is_benefactor"] == "true":
            if c["birthday"]:
                fam["benefactorBirthday"] = c["birthday"]
        elif name:
            fam["beneficiaries"].append({
                "name": name,
                "birthday": c["birthday"],
                "relationship": c["relationship_to_benefactor"],
            })

    records: list[dict] = []
    for fam in families.values():
        match = match_registry(fam["hubspotKey"], registry) or match_registry(
            fam["hubspotKey"].replace(" ", ""), registry
        )
        if not match:
            continue
        records.append({
            "id": match["id"],
            "benefactor": match["benefactor"],
            "beneficiary": match["beneficiary"],
            "hubspotKey": fam["hubspotKey"],
            "benefactorBirthday": fam["benefactorBirthday"],
            "beneficiaries": fam["beneficiaries"],
            "beneficiaryBirthday": pick_beneficiary_birthday(
                match["beneficiary"], fam["beneficiaries"]
            ),
        })

    records.sort(key=lambda r: r["benefactor"])

    # Merge duplicate HubSpot families that map to the same sacred client
    by_id: dict[str, dict] = {}
    for rec in records:
        existing = by_id.get(rec["id"])
        if not existing:
            by_id[rec["id"]] = rec
            continue
        if not existing["benefactorBirthday"] and rec["benefactorBirthday"]:
            existing["benefactorBirthday"] = rec["benefactorBirthday"]
        if not existing["beneficiaryBirthday"] and rec["beneficiaryBirthday"]:
            existing["beneficiaryBirthday"] = rec["beneficiaryBirthday"]
        seen = {b["name"] for b in existing["beneficiaries"]}
        for b in rec["beneficiaries"]:
            if b["name"] not in seen:
                existing["beneficiaries"].append(b)
                seen.add(b["name"])
        if not existing["beneficiaryBirthday"]:
            existing["beneficiaryBirthday"] = pick_beneficiary_birthday(
                existing["beneficiary"], existing["beneficiaries"]
            )

    records = sorted(by_id.values(), key=lambda r: r["benefactor"])
    summary = {
        "hubspotContactFamilies": len(families),
        "matchedSacredClients": len(records),
        "withBenefactorBirthday": sum(1 for r in records if r["benefactorBirthday"]),
        "withBeneficiaryBirthday": sum(1 for r in records if r["beneficiaryBirthday"]),
    }
    payload = {
        "syncedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "summary": summary,
        "clients": records,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    print(
        f"Wrote {OUT_PATH.name}: {summary['matchedSacredClients']} clients matched "
        f"({summary['withBenefactorBirthday']} benefactor b-days, "
        f"{summary['withBeneficiaryBirthday']} beneficiary b-days)"
    )


if __name__ == "__main__":
    main()
