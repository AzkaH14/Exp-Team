#!/usr/bin/env python3
"""Sync report JSON from client-utilization-dashboard to mohsyn-dashboard."""

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / "client-utilization-dashboard" / "public"
DEST = ROOT / "src" / "data"

FILES = {
    "analytics.json": "analytics.json",
    "data.json": "tickets.json",
}


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)

    for src_name, dest_name in FILES.items():
        src = SOURCE / src_name
        dest = DEST / dest_name

        if not src.exists():
            print(f"SKIP: {src} not found")
            continue

        if src_name == "data.json":
            with open(src, encoding="utf-8") as f:
                data = json.load(f)
            with open(dest, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            print(f"Synced {src} -> {dest} ({len(data)} records)")
        else:
            shutil.copy2(src, dest)
            print(f"Copied {src} -> {dest}")

    print("Done.")


if __name__ == "__main__":
    main()
// test commit ....