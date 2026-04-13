"""Regenerate events.json from Lineup_2026.xlsx or Lineup 2026.xlsx (run: python import_lineup.py)."""
import json
import os
from datetime import datetime, time

import openpyxl

BASE = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(BASE, "events.json")

XLSX_CANDIDATES = [
    os.path.join(BASE, "Lineup2026.xlsx"),
    os.path.join(BASE, "Lineup_2026.xlsx"),
    os.path.join(BASE, "Lineup 2026.xlsx"),
]


def fmt_time(v):
    if not isinstance(v, time):
        return None
    if v.second or v.microsecond:
        return v.strftime("%H:%M:%S")
    return v.strftime("%H:%M")


def fmt_val(v, h):
    if v is None or v == "":
        return None
    if isinstance(v, time):
        return fmt_time(v)
    if isinstance(v, datetime):
        return v.strftime("%H:%M:%S" if (v.second or v.microsecond) else "%H:%M")
    if isinstance(v, float) and h in ("sequenceId", "durationMinutes", "prepTime"):
        if v == int(v):
            return int(v)
        return v
    return v


def resolve_xlsx_path():
    for path in XLSX_CANDIDATES:
        if os.path.isfile(path):
            return path
    raise FileNotFoundError(
        "No lineup workbook found. Place one of: "
        + ", ".join(os.path.basename(p) for p in XLSX_CANDIDATES)
    )


def normalize_item(obj):
    """Map spreadsheet column names to the JSON schema the app expects."""
    # Column G in Lineup 2026.xlsx (header often "perfomers/speakers"; output key Presenter(s))
    presenter_sources = (
        "perfomers/speakers",
        "perfomers_speakers",
        "peformers/speakers",
        "peformers_speakers",
        "performers/speakers",
        "performers_speakers",
        "artist(s)",
    )
    for src in presenter_sources:
        if src in obj:
            obj["Presenter(s)"] = obj.pop(src)
            break
    if "Coordinator" in obj:
        obj["coordinator"] = obj.pop("Coordinator")
    return obj


def main():
    xlsx_path = resolve_xlsx_path()
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    raw_headers = list(rows[0])
    headers = []
    for h in raw_headers:
        if h is None:
            break
        s = str(h).strip()
        if s == "descrption1":
            s = "description1"
        if s in (
            "perfomers/speakers",
            "perfomers_speakers",
            "peformers/speakers",
            "peformers_speakers",
            "performers/speakers",
            "performers_speakers",
            "artist(s)",
        ):
            s = "Presenter(s)"
        if s.lower().startswith("overlap"):
            break
        headers.append(s)

    old = {}
    try:
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            old = json.load(f)
    except OSError:
        pass

    items = []
    for row in rows[1:]:
        cells = list(row[: len(headers)])
        if len(cells) < len(headers):
            cells = list(cells) + [None] * (len(headers) - len(cells))
        if all(x is None or (isinstance(x, str) and x.strip() == "") for x in cells):
            break
        def cell(name):
            if name not in headers:
                return None
            i = headers.index(name)
            return cells[i] if i < len(cells) else None

        d1 = cell("description1")
        d2 = cell("description2")
        all_text = " ".join(str(v) for v in cells if v is not None).lower()
        if "total time" in all_text:
            break

        obj = {}
        for h, v in zip(headers, cells):
            obj[h] = fmt_val(v, h)
        items.append(normalize_item(obj))

    out = {"items": items}
    for k in ("eventName1", "eventName2", "eventName", "evnetName1", "evnetName2", "subtitle"):
        if k in old and old[k] is not None:
            out[k] = old[k]
    if "eventName1" not in out and "eventName2" not in out:
        legacy = old.get("eventName") or "Rongali Bihu 2026, DFW"
        out["eventName2"] = legacy

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("Wrote", JSON_PATH, "from", os.path.basename(xlsx_path), "items:", len(items))


if __name__ == "__main__":
    main()
