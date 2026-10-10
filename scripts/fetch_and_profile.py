#!/usr/bin/env python3
"""Download, reduce, and profile NOAA's harmonized marine microplastics data."""

from __future__ import annotations

import csv
import json
import math
import ssl
import statistics
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import certifi


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SERVICE = (
    "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/"
    "Hub_Microplastics_Replace/FeatureServer/0/query"
)

FIELDS = [
    "UniqueID",
    "Date__MM_DD_YYYY_",
    "Latitude__degree_",
    "Longitude_degree_",
    "Location_Oceans",
    "Location_Regions",
    "Country",
    "Medium",
    "Sampling_Method",
    "Standardized_Nurdle__Amount",
    "Microplastics_measurement",
    "Unit",
    "Concentration_class_text",
    "Short_Reference",
    "ObjectId",
]

OUTPUT_FIELDS = [
    "id",
    "date",
    "year",
    "latitude",
    "longitude",
    "ocean",
    "region",
    "country",
    "medium",
    "sampling_method",
    "measurement",
    "unit",
    "concentration_class",
    "reference",
]


def request_json(params: dict[str, str | int]) -> dict:
    url = SERVICE + "?" + urllib.parse.urlencode(params)
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(url, timeout=60, context=ssl_context) as response:
        return json.load(response)


def iso_date(value: int | float | None) -> str:
    if value is None:
        return ""
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()


def clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return str(value).strip()


def fetch_all() -> list[dict]:
    count = request_json({"where": "1=1", "returnCountOnly": "true", "f": "json"})[
        "count"
    ]
    records: list[dict] = []
    page_size = 1000

    for offset in range(0, count, page_size):
        payload = request_json(
            {
                "where": "1=1",
                "outFields": ",".join(FIELDS),
                "returnGeometry": "false",
                "orderByFields": "ObjectId ASC",
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "f": "json",
            }
        )
        if "error" in payload:
            raise RuntimeError(payload["error"])
        records.extend(feature["attributes"] for feature in payload["features"])
        print(f"Downloaded {len(records):,} / {count:,}")

    if len(records) != count:
        raise RuntimeError(f"Expected {count} records, downloaded {len(records)}")
    return records


def transform(records: list[dict]) -> list[dict[str, str]]:
    rows = []
    for record in records:
        date = iso_date(record.get("Date__MM_DD_YYYY_"))
        # NOAA stores standardized Nurdle Patrol counts in a separate field.
        # Both fields remain comparable only within their stated unit.
        measurement = record.get("Microplastics_measurement")
        if measurement is None and record.get("Standardized_Nurdle__Amount") not in (None, ""):
            measurement = record.get("Standardized_Nurdle__Amount")
        row = {
            "id": clean(record.get("UniqueID") or record.get("ObjectId")),
            "date": date,
            "year": date[:4] if date else "",
            "latitude": clean(record.get("Latitude__degree_")),
            "longitude": clean(record.get("Longitude_degree_")),
            "ocean": clean(record.get("Location_Oceans")),
            "region": clean(record.get("Location_Regions")),
            "country": clean(record.get("Country")),
            "medium": clean(record.get("Medium")),
            "sampling_method": clean(record.get("Sampling_Method")),
            "measurement": clean(measurement),
            "unit": clean(record.get("Unit")),
            "concentration_class": clean(record.get("Concentration_class_text")),
            "reference": clean(record.get("Short_Reference")),
        }
        rows.append(row)
    return rows


def describe_numeric(values: list[float]) -> dict[str, float | int | None]:
    values = sorted(values)
    if not values:
        return {"count": 0, "min": None, "max": None, "mean": None, "median": None}
    return {
        "count": len(values),
        "min": values[0],
        "max": values[-1],
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
    }


def profile(rows: list[dict[str, str]]) -> dict:
    missing = {field: sum(not row[field] for row in rows) for field in OUTPUT_FIELDS}
    categories = {}
    for field in ["medium", "unit", "concentration_class", "ocean", "sampling_method"]:
        categories[field] = Counter(row[field] or "(missing)" for row in rows).most_common()

    valid_dates = [row["date"] for row in rows if row["date"]]
    measurements_by_unit: dict[str, list[float]] = {}
    for row in rows:
        if row["measurement"] and row["unit"]:
            measurements_by_unit.setdefault(row["unit"], []).append(float(row["measurement"]))

    exact_duplicates = len(rows) - len({tuple(row[field] for field in OUTPUT_FIELDS) for row in rows})
    duplicate_ids = sum(count - 1 for count in Counter(row["id"] for row in rows).values() if count > 1)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_rows": len(rows),
        "source_columns": 34,
        "derived_rows": len(rows),
        "derived_columns": len(OUTPUT_FIELDS),
        "date_min": min(valid_dates) if valid_dates else None,
        "date_max": max(valid_dates) if valid_dates else None,
        "missing_counts": missing,
        "unique_counts": {field: len({row[field] for row in rows if row[field]}) for field in OUTPUT_FIELDS},
        "exact_duplicate_rows_in_derived_file": exact_duplicates,
        "duplicate_nonempty_ids": duplicate_ids,
        "categories": categories,
        "measurement_summary_by_unit": {
            unit: describe_numeric(values) for unit, values in measurements_by_unit.items()
        },
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    records = fetch_all()
    rows = transform(records)

    with (DATA_DIR / "microplastics.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    with (DATA_DIR / "profile.json").open("w", encoding="utf-8") as handle:
        json.dump(profile(rows), handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    print(f"Wrote {len(rows):,} rows to {DATA_DIR / 'microplastics.csv'}")


if __name__ == "__main__":
    main()
