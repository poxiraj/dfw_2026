"""Regenerate events.json from Lineup 2026.xlsx (run: python import_lineup.py)."""
import json
from datetime import datetime, time

import openpyxl

BASE = __file__.replace("\\", "/").rsplit("/", 1)[0]
XLSX = f"{BASE}/Lineup 2026.xlsx"
JSON_PATH = f"{BASE}/events.json"


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


def main():
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
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
        if isinstance(d1, str) and "total time" in d1.lower():
            break
        if isinstance(d2, str) and "total time" in d2.lower():
            break

        obj = {}
        for h, v in zip(headers, cells):
            obj[h] = fmt_val(v, h)
        items.append(obj)

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
    print("Wrote", JSON_PATH, "items:", len(items))


if __name__ == "__main__":
    main()
