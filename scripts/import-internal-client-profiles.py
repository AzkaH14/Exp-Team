#!/usr/bin/env python3
"""
Import hobbies, engagement notes, medical highlights from Mohsyn internal
client profile PDFs (Islamabad, Lahore, Karachi) into client-enrichment.json.

Usage:
  python3 scripts/import-internal-client-profiles.py
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    raise SystemExit("Install pypdf: pip install pypdf")

ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / "src/data/client-registry.json"
OUT_PATH = ROOT / "src/data/client-enrichment.json"

PDFS = [
    (Path.home() / "Downloads/Internal Client profile Islamabad.pdf", "Islamabad"),
    (Path.home() / "Downloads/Internal client profile Lahore.pdf", "Lahore"),
    (Path.home() / "Downloads/Internal Client profile Karachi.pdf", "Karachi"),
]

BLOCKED_PHRASES = [
    "amna salim",
    "rumina iftikhar",
    "haris siddiqui",
    "fareeha ahmed",
    "shahma zahid",
    "ashar ahmed",
    "babar khan javed",
    "saira asad",
    "karim ali",
    "wasfa fatima",
    "wasfa",
    "misbah javed",
    "mohammad",
    "misha",
    "syed",
    "laiba",
    "labeba",
    "huzaifa",
    "aliza maftun",
    "mahlaqa",
    "fawwad",
    "testben",
    "unknown",
]

FILENAME_ALIASES_RAW = {
    "faryda fayz": "Zohare Haider",
    "faryda fayyaz": "Zohare Haider",
    "bukhari family": "Salma Bukhari",
    "salma bukhari & family": "Salma Bukhari",
    "the janjuas": "Kashif Janjua",
    "the janjua family": "Kashif Janjua",
    "nisar family": "A Nisar Akbar",
    "akbar family": "A Nisar Akbar",
    "mr akbar miss maqsooda": "A Nisar Akbar",
    "tarim family": "Tarim Wasim",
    "miss azra mr sagheer": "Fahd Saghir",
    "usman umar family": "Omar Biabani",
    "noureen akbar family": "Shahzad Akbar",
    "dr najeeb samreen muzaffar": "Dr. Najeeb Ahmed",
    "azher ratnani": "Mohammed Azhar Ratnani",
    "bilal zehra": "Syeda Zehra Ali/Bilal",
    "anny adnan": "Anny Adnan Rafiq",
    "khurrum zia": "Khurram Zia",
    "kiran fatima": "Khurram Zia",
    "ms kiran fatima": "Khurram Zia",
    "shehzad jamal": "Shahzad Jamal",
    "mr hasan sarmad mrs neelam sarmad": "Hisham Hasan",
    "yasir siddique": "Yasir Siddiqui",
    "syed shahid ali": "Syeda Zehra Ali/Bilal",
    "ghazala siddiqui": "Madiha Ahsan",
    "dr qurratulain chundrigar": "Qurratulain Chundigar",
    "qurratulain chundrigar": "Qurratulain Chundigar",
}


def normalize(name: str) -> str:
    s = name.lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\b(dr|mr|mrs|ms|miss|syed|muhammad|mohammad|md)\b", " ", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


FILENAME_ALIASES = {normalize(k): v for k, v in FILENAME_ALIASES_RAW.items()}


def compact(name: str) -> str:
    return normalize(name).replace(" ", "")


def tokens(name: str) -> set[str]:
    return {t for t in normalize(name).split() if len(t) > 1}


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
    return overlap >= max(2, min(len(ta), len(tb)) - 1)


def is_excluded(name: str) -> bool:
    n = normalize(name)
    if not n:
        return True
    for phrase in BLOCKED_PHRASES:
        if phrase in n or n == phrase:
            return True
    return False


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def match_registry(label: str, registry: list[dict]) -> dict | None:
    key = normalize(label)
    if key in FILENAME_ALIASES:
        label = FILENAME_ALIASES[key]
    for r in registry:
        names = [r["benefactor"], r["beneficiary"], *r.get("aliases", [])]
        if any(names_match(label, n) for n in names):
            return r
    # Header often lists beneficiaries — try each segment
    for part in re.split(r"[/&,]", label):
        part = part.strip()
        if len(part) < 4:
            continue
        pk = normalize(part)
        if pk in FILENAME_ALIASES:
            part = FILENAME_ALIASES[pk]
        for r in registry:
            names = [r["benefactor"], r["beneficiary"], *r.get("aliases", [])]
            if any(names_match(part, n) for n in names):
                return r
    return None


def is_client_start(text: str, city: str) -> bool:
    t = collapse(text)
    if re.search(r"Client Profile:\s*.+\s+Location:", t, re.I):
        return True
    if re.match(rf"^.{{2,55}}\s*-\s*{city}\s*$", t, re.I):
        return True
    if re.match(rf"^.{{2,55}}\s*-\s*{city}\b", t, re.I) and len(t) < 90:
        return True
    return False


def extract_name_from_page(text: str, city: str) -> str | None:
    t = collapse(text)
    m = re.search(r"Client Profile:\s*(.+?)\s+Location:", t, re.I)
    if m:
        return m.group(1).strip()
    m = re.match(rf"^(.+?)\s*-\s*{city}\b", t, re.I)
    if m and len(m.group(1)) < 60:
        return m.group(1).strip()
    return None


def section(text: str, heading: str, stop: list[str]) -> str:
    pat = rf"{heading}\s*(.+?)(?:" + "|".join(re.escape(s) for s in stop) + r"|$)"
    m = re.search(pat, text, re.I | re.S)
    return collapse(m.group(1)) if m else ""


def parse_bullets(block: str) -> list[str]:
    if not block:
        return []
    items = re.split(r"\s*●\s*", block)
    out = []
    for item in items:
        item = collapse(item)
        if len(item) > 12:
            out.append(item)
    if not out and block:
        for sent in re.split(r"(?<=[.!?])\s+", block):
            s = collapse(sent)
            if len(s) > 20:
                out.append(s)
    return out


def extract_hobbies_interests(overview: str, notes: list[str]) -> tuple[list[str], list[str]]:
    hobbies: list[str] = []
    interests: list[str] = []
    blob = overview + " " + " ".join(notes)

    for m in re.finditer(
        r"(?:fondness for|loves?|enjoys?|passion for|hobby of|interested in)\s+([^.;]{3,60})",
        blob,
        re.I,
    ):
        phrase = collapse(m.group(1))
        if len(phrase) > 3:
            interests.append(phrase)

    hobby_kw = [
        "crafting", "doll-making", "doll making", "coffee", "cappuccino", "qawali",
        "physiotherapy", "sewing", "storytelling", "beauty routines", "nail care",
        "family outings", "cultural events", "conversation", "walking",
    ]
    low = blob.lower()
    for kw in hobby_kw:
        if kw in low:
            hobbies.append(kw)

    return list(dict.fromkeys(hobbies))[:8], list(dict.fromkeys(interests))[:8]


def detect_flags(text: str) -> tuple[bool, bool]:
    low = text.lower()
    low_touch = any(
        p in low
        for p in ["low-touch", "low touch", "very private", "minimal contact", "remote benefactor"]
    )
    indoor = any(
        p in low
        for p in ["indoor only", "indoor engagements", "mobility limited", "indoor visits"]
    )
    return low_touch, indoor


def parse_client_block(name: str, body: str, city: str, source_doc: str) -> dict:
    benefactor_m = re.search(
        r"Benefactor:\s*(?:●\s*)?Name:\s*([^●]+?)(?:●|Beneficiary:|Emergency|General|Medical|$)",
        body,
        re.I,
    )
    primary_m = re.search(r"Primary Benefactor:\s*([^G]+?)(?:General|Medical|$)", body, re.I)
    benefactor_label = ""
    if benefactor_m:
        benefactor_label = collapse(benefactor_m.group(1))
    elif primary_m:
        benefactor_label = collapse(primary_m.group(1))

    overview = section(
        body,
        "General Overview",
        ["Medical Notes", "Dreamweaver Notes", "Family", "Client Profile"],
    )
    medical = section(
        body,
        "Medical Notes",
        ["Dreamweaver Notes", "Family", "Client Profile", "General Overview"],
    )
    dream = section(
        body,
        "Dreamweaver Notes",
        ["Family", "Client Profile", "Faryda", "Salma", "Date:"],
    )
    engagement_notes = parse_bullets(dream)
    medical_highlights = parse_bullets(medical) or (
        [medical] if medical and len(medical) > 30 else []
    )
    hobbies, interests = extract_hobbies_interests(overview, engagement_notes)
    prefers_low, indoor = detect_flags(body)

    return {
        "headerName": name,
        "matchLabel": benefactor_label or name,
        "city": city,
        "sourceDoc": source_doc,
        "generalOverview": overview[:2000] if overview else "",
        "medicalHighlights": medical_highlights[:12],
        "hobbies": hobbies,
        "interests": interests,
        "engagementNotes": engagement_notes[:15],
        "prefersLowTouch": prefers_low,
        "indoorOnly": indoor,
    }


def extract_clients_from_pdf(path: Path, city: str) -> list[dict]:
    if not path.exists():
        print(f"Skip missing: {path}")
        return []
    reader = PdfReader(str(path))
    clients: list[dict] = []
    cur_name: str | None = None
    buf: list[str] = []

    for page in reader.pages:
        raw = page.extract_text() or ""
        c = collapse(raw)
        if is_client_start(raw, city) or (len(c) < 100 and extract_name_from_page(c, city)):
            if cur_name and buf:
                clients.append(parse_client_block(cur_name, " ".join(buf), city, path.name))
            cur_name = extract_name_from_page(c, city) or c[:60]
            buf = [c]
        elif cur_name:
            buf.append(c)

    if cur_name and buf:
        clients.append(parse_client_block(cur_name, " ".join(buf), city, path.name))
    return clients


def merge_profile(existing: dict | None, new: dict, registry_id: str) -> dict:
    if not existing:
        existing = {
            "benefactorId": registry_id,
            "hobbies": [],
            "interests": [],
            "engagementNotes": [],
            "medicalHighlights": [],
            "generalOverview": "",
            "beneficiaryBirthday": None,
            "benefactorBirthday": None,
            "anniversary": None,
            "prefersLowTouch": False,
            "indoorOnly": False,
            "citySource": new["city"],
            "sourceDoc": new["sourceDoc"],
            "source": "internal_doc",
        }

    def merge_list(key: str, limit: int = 20) -> None:
        seen = {x.lower() for x in existing.get(key, [])}
        for item in new.get(key, []):
            if item.lower() not in seen:
                existing[key].append(item)
                seen.add(item.lower())
        existing[key] = existing[key][:limit]

    merge_list("hobbies")
    merge_list("interests")
    merge_list("engagementNotes")
    merge_list("medicalHighlights", 15)

    if not existing.get("generalOverview") and new.get("generalOverview"):
        existing["generalOverview"] = new["generalOverview"]
    existing["prefersLowTouch"] = existing.get("prefersLowTouch") or new.get("prefersLowTouch")
    existing["indoorOnly"] = existing.get("indoorOnly") or new.get("indoorOnly")
    existing["citySource"] = new.get("city") or existing.get("citySource")
    existing["sourceDoc"] = new.get("sourceDoc") or existing.get("sourceDoc")
    return existing


def main() -> None:
    registry = json.loads(REGISTRY_PATH.read_text())["clients"]
    active_registry = [r for r in registry if not is_excluded(r["benefactor"])]

    by_id: dict[str, dict] = {}
    unmatched: list[str] = []
    skipped_excluded: list[str] = []

    for path, city in PDFS:
        blocks = extract_clients_from_pdf(path, city)
        print(f"{path.name}: {len(blocks)} sections")
        for block in blocks:
            label = block["matchLabel"]
            if is_excluded(label) or is_excluded(block["headerName"]):
                skipped_excluded.append(block["headerName"])
                continue
            match = match_registry(label, active_registry)
            if not match:
                match = match_registry(block["headerName"], active_registry)
            if not match:
                unmatched.append(f"{block['headerName']} ({city})")
                continue
            rid = match["id"]
            by_id[rid] = merge_profile(by_id.get(rid), block, rid)

    profiles = sorted(by_id.values(), key=lambda p: p["benefactorId"])
    payload = {
        "version": 2,
        "source": "Internal Client profile PDFs (Islamabad, Lahore, Karachi)",
        "importedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "summary": {
            "profilesImported": len(profiles),
            "withEngagementNotes": sum(1 for p in profiles if p.get("engagementNotes")),
            "withMedicalHighlights": sum(1 for p in profiles if p.get("medicalHighlights")),
            "unmatchedSections": len(unmatched),
            "skippedExcluded": len(skipped_excluded),
        },
        "profiles": profiles,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    print(
        f"Wrote {OUT_PATH.name}: {payload['summary']['profilesImported']} profiles "
        f"({payload['summary']['unmatchedSections']} unmatched, "
        f"{payload['summary']['skippedExcluded']} excluded)"
    )
    if unmatched[:12]:
        print("Unmatched sample:", "; ".join(unmatched[:12]))


if __name__ == "__main__":
    main()
