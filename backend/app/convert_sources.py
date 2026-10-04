from __future__ import annotations

from pathlib import Path

import pyarrow.csv as csv
import pyarrow.parquet as parquet

from app.db import RAW_DIR

TABLES = ["categories", "customers", "products", "orders", "order_items", "payments", "returns"]


def convert_sources(source_dir: Path = RAW_DIR) -> dict[str, int]:
    """Convert the seven supplied Parquet tables to headered CSV without changing columns."""
    missing = [name for name in TABLES if not (source_dir / f"{name}.parquet").is_file()]
    if missing:
        raise FileNotFoundError(
            f"Missing Parquet tables in {source_dir}: " + ", ".join(f"{name}.parquet" for name in missing)
        )

    row_counts: dict[str, int] = {}
    for name in TABLES:
        table = parquet.read_table(source_dir / f"{name}.parquet")
        csv.write_csv(table, source_dir / f"{name}.csv")
        row_counts[name] = table.num_rows
    return row_counts


def main() -> None:
    counts = convert_sources()
    print("Converted supplied Parquet tables to CSV:")
    for name, rows in counts.items():
        print(f"  {name}: {rows:,} rows")


if __name__ == "__main__":
    main()
