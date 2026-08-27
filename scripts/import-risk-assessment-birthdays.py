#!/usr/bin/env python3
"""
Import birthdays from Beneficiary Information & Risk Assessment documents
(DOCX + PDF) into src/data/client-risk-assessment.json.

Usage:
  python3 scripts/import-risk-assessment-birthdays.py [folder]
  Default folder: ~/Downloads/drive-download-20260615T111204Z-3-001
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / "src/data/client-registry.json"
OUT_PATH = ROOT / "src/data/client-risk-assessment.json"
DEFAULT_DIR = Path.home() / "Downloads/drive-download-20260618T064911Z-3-001"

EXCLUDED_PHRASES = [
    "amna salim", "rumina iftikhar", "haris siddiqui", "fareeha ahmed",
    "shahma zahid", "ashar ahmed", "babar khan javed", "saira asad",
    "karim ali", "wasfa fatima", "wasfa", "misbah javed", "mohammad",
    "misha", "syed", "laiba", "labeba", "huzaifa", "aliza maftun",
    "mahlaqa", "fawwad", "testben", "unknown",
]

SKIP_NAMES = {
    "birthday", "age", "customer", "cnic", "general information",
    "medical information", "table of contents", "beneficiary",
    "beneficiaries", "risk assessment",
}

INVALID_DATE_PHRASES = [
    "not shared", "to be shared", "has not been shared", "not been shared",
    "client has not", "to be generated", "n/a", "tbc", "unknown",
]


def normalize(name: str) -> str:
    s = name.lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\b(dr|mr|mrs|ms|miss|syed|muhammad|mohammad|md)\b", " ", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


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


def parse_label(name: str) -> list[str]:
    raw = name.strip()
    if not raw:
        return []
    out: list[str] = []
    if ";" in raw:
        for part in raw.split(";"):
            out.extend(parse_label(part.strip()))
        return list(dict.fromkeys(out))
    stripped = re.sub(r"\([^)]*\)", " ", raw)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    if stripped:
        out.append(stripped)
    return list(dict.fromkeys(out))


def is_excluded(name: str) -> bool:
    n = normalize(name)
    if not n:
        return True
    return any(phrase in n or n == phrase for phrase in EXCLUDED_PHRASES)


def match_registry(label: str, registry: list[dict]) -> dict | None:
    labels = [label, *parse_label(label)]
    for lbl in labels:
        norm = normalize(lbl)
        comp = compact(lbl)
        if not norm:
            continue
        for r in registry:
            names = [r["benefactor"], r["beneficiary"], *r.get("aliases", [])]
            if any(normalize(n) == norm or compact(n) == comp for n in names):
                return r
    for lbl in labels:
        for r in registry:
            names = [r["benefactor"], r["beneficiary"], *r.get("aliases", [])]
            if any(names_match(lbl, n) for n in names):
                return r
    return None


def benefactor_from_filename(filename: str) -> str:
    name = re.sub(r"\.(docx|pdf)$", "", filename, flags=re.I)
    name = re.sub(r"[-_]?Beneficiary Information.*$", "", name, flags=re.I).strip()
    name = name.lstrip("_").strip()
    name = re.sub(r"\s+Beneficiary Information.*$", "", name, flags=re.I).strip()
    return name


FILENAME_ALIASES_RAW = {
    "a nisar akbar family": "A Nisar Akbar",
    "akbar family": "A Nisar Akbar",
    "akhtars": "Hafiz Talha Javed",
    "habib family": "Muhammad Umar Habib",
    "ghazanfar family": "Syed Muddassir Ghazanffar",
    "aquil family": "Talha Aquil",
    "azhar family": "Azhar Biabani",
    "goraya family": "Goraya",
    "janjua 1": "Kashif Janjua",
    "janjua 2": "Asif Janjua",
    "safeeullah family": "Syed Safee Ullah Shah",
    "subzwari family": "Danish Subzwari",
    "tajammul family": "Tajammul",
    "umar family": "Umar Farooq",
    "muzaffar ali family": "Muzaffar Ali",
    "khilji family": "Khilji",
    "emergency jamil akbar family": "Jamil Akbar",
    "emergency lakhani family": "Uzma Lakhani",
    "emergency raazi hassan family": "Raazi Hassan",
    "fahim sulaiman family": "Adeel Fahim",
    "faryda fayyaz": "Zohare Haider",
    "ms shaheena salim": "Shaheena Salim",
    "mudassir sheikh": "Syed Muddassir Ghazanffar",
    "muhammad rehman": "Abdul Rehman",
    "syed faraz family": "Syed Faraz Ali",
    "azhar ratnani": "Azhar Biabani",
    "dr faisal khan": "Dr. Faisal Khan",
    "salma bukhari family": "Salma Bukhari",
    "mahsud": "Mahsud",
    "beenish tariq": "Beenish Tariq",
    "jaffrey family": "Shahab Jaffrey",
    "khalida farooq": "Ambassador Ahmed Farooq",
    "ayesha zia": "Khurram Zia",
    "kiran fatima": "Khurram Zia",
    "hasan lodhi": "Hassan Hanif C/O Hassan Lodhi",
}
FILENAME_ALIASES = {normalize(k): v for k, v in FILENAME_ALIASES_RAW.items()}


def resolve_benefactor(filename: str, registry: list[dict]) -> dict | None:
    raw = benefactor_from_filename(filename)
    key = normalize(raw)
    if key in FILENAME_ALIASES:
        raw = FILENAME_ALIASES[key]
    match = match_registry(raw, registry)
    if match:
        return match
    # Try without "Family" suffix
    if " family" in key:
        return match_registry(raw.replace(" Family", "").replace(" family", ""), registry)
    return None


def is_invalid_date(raw: str) -> bool:
    s = raw.strip().lower()
    if not s or len(s) < 4:
        return True
    return any(p in s for p in INVALID_DATE_PHRASES)


def parse_date_token(raw: str) -> str | None:
    if is_invalid_date(raw):
        return None
    s = raw.strip()

    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= a <= 12 and 1 <= b <= 31:
            return f"{y:04d}-{a:02d}-{b:02d}"

    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1900 <= y <= 2030 and 1 <= mo <= 12 and 1 <= d <= 31:
            return s

    # October 24th, 1944 / October 24, 1944 / January 1, 1945
    m = re.match(
        r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+"
        r"(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$",
        s,
        re.I,
    )
    if m:
        months = {
            "january": 1, "february": 2, "march": 3, "april": 4,
            "may": 5, "june": 6, "july": 7, "august": 8,
            "september": 9, "october": 10, "november": 11, "december": 12,
        }
        mo = months[m.group(1).lower()]
        d = int(m.group(2))
        y = int(m.group(3))
        if 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"

    # Year only e.g. 1952 or 1961
    m = re.match(r"^(\d{4})$", s)
    if m:
        y = int(m.group(1))
        if 1900 <= y <= 2030:
            return f"{y:01d}-01-01"

    return None


def extract_text_docx(path: Path) -> str:
    result = subprocess.run(
        ["textutil", "-convert", "txt", "-stdout", str(path)],
        capture_output=True,
        text=True,
    )
    return result.stdout or ""


def extract_text_pdf(path: Path) -> str:
    if not PdfReader:
        return ""
    try:
        reader = PdfReader(str(path))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception:
        return ""


def collapse_text(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def parse_birthday_block(text: str) -> tuple[list[str], list[str]]:
    """Return (names, birthdays) from General Information birthday table."""
    lines = [ln.strip() for ln in text.splitlines()]

    # Line-based (DOCX via textutil)
    line_names: list[str] = []
    line_dates: list[str] = []
    for i, line in enumerate(lines):
        if line.lower() == "birthday":
            # Names: walk up from birthday until section header or gap
            j = i - 1
            while j >= 0:
                prev = lines[j].strip()
                if not prev:
                    j -= 1
                    continue
                low = prev.lower()
                if low in SKIP_NAMES or low.startswith("3.") or "information" in low:
                    break
                if re.match(r"^\d+\.", prev):
                    break
                if len(prev) > 2 and not prev.isdigit():
                    line_names.insert(0, prev)
                j -= 1

            # Dates: walk down until Age
            k = i + 1
            while k < len(lines):
                nxt = lines[k].strip()
                if not nxt:
                    k += 1
                    continue
                if nxt.lower() == "age" or nxt.lower().startswith("customer"):
                    break
                if nxt.isdigit() and len(nxt) <= 3:
                    k += 1
                    continue
                parsed = parse_date_token(nxt)
                if parsed:
                    line_dates.append(parsed)
                elif not is_invalid_date(nxt):
                    for part in re.split(r"\s{2,}|\t", nxt):
                        p = parse_date_token(part.strip())
                        if p:
                            line_dates.append(p)
                k += 1
            break

    if line_names and line_dates:
        return line_names, line_dates
    if line_dates:
        return line_names, line_dates

    # PDF / collapsed text fallback (also when line parse found names but no dates)
    flat = collapse_text(text)
    m = re.search(
        r"General\s+Information\s+(.+?)\s+Birthday\s+(.+?)\s+Age",
        flat,
        re.I,
    )
    if not m:
        m = re.search(r"Birthday\s+(.+?)\s+Age", flat, re.I)
        if m:
            date_chunk = m.group(1)
            pre = flat[: m.start()]
            name_bits = re.findall(
                r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:Birthday)",
                pre,
            )
            if not name_bits:
                name_bits = re.findall(
                    r"Information\s+((?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*)+?)\s+Birthday",
                    pre,
                    re.I,
                )
            if name_bits:
                raw_names = name_bits[-1].strip()
                names = [n.strip() for n in re.split(r"\s{2,}|,(?=\s*[A-Z])|&", raw_names) if n.strip()]
            dates = []
            for token in re.findall(
                r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}/\d{1,2}/\d{4}",
                date_chunk,
                re.I,
            ):
                p = parse_date_token(token.strip())
                if p:
                    dates.append(p)
            if dates:
                return names, dates
        return [], []

    # names from chunk before birthday - last 1-3 capitalized name groups
    pre = m.group(1)
    name_candidates = re.findall(r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)", pre)
    names = name_candidates[-3:] if name_candidates else []
    date_chunk = m.group(2)
    dates: list[str] = []
    dates: list[str] = []
    for token in re.findall(
        r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}/\d{1,2}/\d{4}",
        date_chunk,
        re.I,
    ):
        p = parse_date_token(token)
        if p:
            dates.append(p)

    return names, dates


def pick_primary_beneficiary_birthday(
    sacred_beneficiary: str, beneficiaries: list[dict]
) -> str | None:
    parts = [p.strip() for p in re.split(r"[/,]", sacred_beneficiary) if p.strip()]
    for part in parts:
        for b in beneficiaries:
            if b.get("birthday") and names_match(part, b["name"]):
                return b["birthday"]
    for b in beneficiaries:
        if b.get("birthday"):
            return b["birthday"]
    return None


def process_file(path: Path, registry: list[dict]) -> dict | None:
    if path.name.startswith(".") or "Atomic habits" in path.name:
        return None

    record_match = resolve_benefactor(path.name, registry)
    if not record_match:
        return None

    if path.suffix.lower() == ".docx":
        text = extract_text_docx(path)
    elif path.suffix.lower() == ".pdf":
        text = extract_text_pdf(path)
    else:
        return None

    names, dates = parse_birthday_block(text)
    if not dates:
        return None

    beneficiaries: list[dict] = []
    for idx, bday in enumerate(dates):
        name = names[idx] if idx < len(names) else f"Beneficiary {idx + 1}"
        beneficiaries.append({"name": name, "birthday": bday})

    return {
        "id": record_match["id"],
        "benefactor": record_match["benefactor"],
        "beneficiary": record_match["beneficiary"],
        "sourceFile": path.name,
        "benefactorBirthday": None,
        "beneficiaries": beneficiaries,
        "beneficiaryBirthday": pick_primary_beneficiary_birthday(
            record_match["beneficiary"], beneficiaries
        ),
    }


def main() -> None:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DIR
    if not folder.exists():
        raise SystemExit(f"Folder not found: {folder}")

    registry = json.loads(REGISTRY_PATH.read_text())["clients"]
    files = sorted([*folder.glob("*.docx"), *folder.glob("*.pdf")])

    by_id: dict[str, dict] = {}
    unmatched: list[str] = []

    for path in files:
        match = resolve_benefactor(path.name, registry)
        if not match:
            if "Beneficiary Information" in path.name or "Risk Assessment" in path.name:
                unmatched.append(path.name)
            continue
        if is_excluded(match["benefactor"]):
            continue
        rec = process_file(path, registry)
        if not rec:
            continue
        existing = by_id.get(rec["id"])
        if not existing:
            by_id[rec["id"]] = rec
            continue
        # Merge: prefer more complete data
        if not existing["beneficiaryBirthday"] and rec["beneficiaryBirthday"]:
            existing["beneficiaryBirthday"] = rec["beneficiaryBirthday"]
        if not existing["benefactorBirthday"] and rec["benefactorBirthday"]:
            existing["benefactorBirthday"] = rec["benefactorBirthday"]
        seen = {b["name"] for b in existing["beneficiaries"]}
        for b in rec["beneficiaries"]:
            if b["name"] not in seen:
                existing["beneficiaries"].append(b)
                seen.add(b["name"])

    records = sorted(by_id.values(), key=lambda r: r["benefactor"])
    summary = {
        "filesScanned": len(files),
        "matchedClients": len(records),
        "withBeneficiaryBirthday": sum(1 for r in records if r["beneficiaryBirthday"]),
        "withBenefactorBirthday": sum(1 for r in records if r["benefactorBirthday"]),
        "unmatchedFiles": len(unmatched),
    }

    payload = {
        "version": 1,
        "source": "Beneficiary Information & Risk Assessment documents",
        "importedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceFolder": str(folder),
        "summary": summary,
        "clients": records,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    print(
        f"Wrote {OUT_PATH.name}: {summary['matchedClients']} clients, "
        f"{summary['withBeneficiaryBirthday']} beneficiary birthdays "
        f"({summary['unmatchedFiles']} files unmatched)"
    )
    if unmatched[:8]:
        print("Unmatched sample:", ", ".join(unmatched[:8]))


if __name__ == "__main__":
    main()
