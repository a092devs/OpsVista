"""Load the supplied CSV tables into the project's PostgreSQL schema."""

from __future__ import annotations

import argparse
from pathlib import Path

from app.db import DB_NAME, RAW_DIR, connect, initialize_database
from app.convert_sources import convert_sources

SOURCE_TABLES = ["categories", "customers", "products", "orders", "order_items", "payments", "returns"]
ANALYTICS_TABLES = ["order_item_analytics", "order_sales_summary", "payment_by_order"]
DROP_ORDER = ["returns", "payments", "order_items", "orders", "products", "customers", "categories"]
REQUIRED_FILES = [*(f"{table}.csv" for table in SOURCE_TABLES), "ecommerce_orders.schema.sql"]
INDEXES = (
    "CREATE INDEX IF NOT EXISTS orders_ordered_at_idx ON orders (ordered_at)",
    "CREATE INDEX IF NOT EXISTS orders_country_ordered_at_idx ON orders (shipping_country, ordered_at)",
    "CREATE INDEX IF NOT EXISTS orders_channel_ordered_at_idx ON orders (channel, ordered_at)",
    "CREATE INDEX IF NOT EXISTS orders_customer_ordered_at_idx ON orders (customer_id, ordered_at)",
    "CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id)",
    "CREATE INDEX IF NOT EXISTS payments_order_id_idx ON payments (order_id)",
    "CREATE INDEX IF NOT EXISTS returns_order_item_id_idx ON returns (order_item_id)",
)


def _table_names(connection) -> set[str]:
    """Return tables already present in the dedicated OpsVista schema."""
    return {
        row[0]
        for row in connection.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'opsvista'"
        ).fetchall()
    }


def _source_table_statements(schema_path: Path) -> list[str]:
    """Read table definitions from the shared schema and skip its import commands."""
    source_sql = schema_path.read_text(encoding="utf-8")
    table_ddl = source_sql.split("\nCOPY categories", maxsplit=1)[0]
    return [statement.strip() for statement in table_ddl.split(";") if statement.strip()]


def _copy_csv_sources(connection) -> None:
    """Stream each source CSV through PostgreSQL's client-side COPY protocol."""
    with connection.cursor() as cursor:
        for table in SOURCE_TABLES:
            source_path = RAW_DIR / f"{table}.csv"
            with source_path.open("r", encoding="utf-8", newline="") as source:
                with cursor.copy(
                    f"COPY {table} FROM STDIN WITH (FORMAT CSV, HEADER TRUE)"
                ) as copy:
                    copy.write(source.read())


def _ensure_indexes(connection) -> None:
    """Add the indexes used by dashboard date filters and table joins."""
    for statement in INDEXES:
        connection.execute(statement)


def _ensure_analytics_tables(connection) -> None:
    """Build stable refund, sales, and payment totals once for dashboard queries."""
    if set(ANALYTICS_TABLES).issubset(_table_names(connection)):
        return

    for table in ANALYTICS_TABLES:
        connection.execute(f"DROP TABLE IF EXISTS {table}")

    connection.execute(
        """CREATE TABLE order_item_analytics AS
           SELECT oi.order_item_id, oi.order_id, oi.product_id, oi.quantity,
                  oi.unit_price, oi.discount_amount,
                  COALESCE(r.refund_amount, 0) AS refund_amount,
                  COALESCE(r.return_events, 0) AS return_events
           FROM order_items oi
           LEFT JOIN (
               SELECT order_item_id, SUM(refund_amount) AS refund_amount,
                      COUNT(*) AS return_events
               FROM returns GROUP BY order_item_id
           ) r ON r.order_item_id = oi.order_item_id"""
    )
    connection.execute(
        """CREATE TABLE order_sales_summary AS
           SELECT order_id,
                  SUM(GREATEST(quantity * unit_price - discount_amount - refund_amount, 0)) AS net_sales,
                  SUM(quantity * unit_price) AS gross_sales,
                  SUM(discount_amount) AS discounts,
                  SUM(refund_amount) AS refunds,
                  SUM(return_events) AS return_events,
                  SUM(quantity) AS units
           FROM order_item_analytics GROUP BY order_id"""
    )
    connection.execute(
        """CREATE TABLE payment_by_order AS
           SELECT order_id, COUNT(*) AS payment_attempts,
                  SUM(CASE WHEN LOWER(status) = 'captured' THEN 1 ELSE 0 END) AS captured_attempts,
                  SUM(CASE WHEN LOWER(status) = 'failed' THEN 1 ELSE 0 END) AS failed_attempts
           FROM payments GROUP BY order_id"""
    )
    for statement in (
        "CREATE INDEX order_item_analytics_order_id_idx ON order_item_analytics (order_id)",
        "CREATE UNIQUE INDEX order_item_analytics_item_id_idx ON order_item_analytics (order_item_id)",
        "CREATE UNIQUE INDEX order_sales_summary_order_id_idx ON order_sales_summary (order_id)",
        "CREATE UNIQUE INDEX payment_by_order_order_id_idx ON payment_by_order (order_id)",
    ):
        connection.execute(statement)


def load_csv_sources(reload: bool = False) -> dict[str, int]:
    """Load the supplied seven-table CSV bundle into PostgreSQL."""
    missing = [name for name in REQUIRED_FILES if not (RAW_DIR / name).exists()]
    csv_missing = [name for name in REQUIRED_FILES if name.endswith(".csv") and not (RAW_DIR / name).exists()]
    parquet_available = all((RAW_DIR / f"{table}.parquet").exists() for table in SOURCE_TABLES)
    if csv_missing and parquet_available:
        # Regenerate CSV inputs from the original Parquet files when needed.
        convert_sources()
        missing = [name for name in REQUIRED_FILES if not (RAW_DIR / name).exists()]
    if missing:
        raise FileNotFoundError(
            "Missing source files under " + str(RAW_DIR) + ": " + ", ".join(missing)
        )

    initialize_database()
    connection = connect()
    try:
        existing = _table_names(connection)
        # Rebuild partial imports together so foreign-key relationships stay consistent.
        if reload or not set(SOURCE_TABLES).issubset(existing):
            for table in ANALYTICS_TABLES:
                connection.execute(f"DROP TABLE IF EXISTS {table}")
            for table in DROP_ORDER:
                connection.execute(f"DROP TABLE IF EXISTS {table}")
            for statement in _source_table_statements(RAW_DIR / "ecommerce_orders.schema.sql"):
                connection.execute(statement)
            _copy_csv_sources(connection)

        _ensure_indexes(connection)
        _ensure_analytics_tables(connection)

        counts = {
            table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in SOURCE_TABLES
        }
        connection.commit()
        return counts
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def ensure_loaded() -> dict[str, int]:
    """Reuse an existing import or load the supplied CSV files once."""
    connection = connect()
    try:
        existing = _table_names(connection)
        if set(SOURCE_TABLES).issubset(existing):
            _ensure_indexes(connection)
            _ensure_analytics_tables(connection)
            counts = {
                table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
                for table in SOURCE_TABLES
            }
            connection.commit()
            return counts
    finally:
        connection.close()
    return load_csv_sources()


def main() -> None:
    """Run the CSV import from the backend folder."""
    parser = argparse.ArgumentParser(description="Load the supplied OpsVista CSV tables into PostgreSQL")
    parser.add_argument("--reload", action="store_true", help="rebuild the OpsVista tables from CSV")
    args = parser.parse_args()

    counts = load_csv_sources(reload=args.reload)
    print(f"Loaded {counts['orders']:,} orders and {counts['order_items']:,} line items into PostgreSQL database '{DB_NAME}'")


if __name__ == "__main__":
    main()
