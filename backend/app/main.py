from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.analytics import get_dashboard, get_data_range
from app.db import DB_NAME, connect, initialize_database
from app.etl import SOURCE_TABLES, ensure_loaded


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    ensure_loaded()
    yield


app = FastAPI(title="OpsVista API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    connection = connect(read_only=True)
    try:
        row_count = int(connection.execute("SELECT COUNT(*) FROM orders").fetchone()[0])
        first_date, last_date = get_data_range(connection)
    finally:
        connection.close()
    return {
        "status": "ok",
        "database": DB_NAME,
        "orders": row_count,
        "first_order_date": first_date.isoformat(),
        "last_order_date": last_date.isoformat(),
    }


@app.get("/api/filters")
def filters() -> dict:
    connection = connect(read_only=True)
    try:
        countries = [row[0] for row in connection.execute("SELECT DISTINCT shipping_country FROM orders ORDER BY 1").fetchall()]
        channels = [row[0] for row in connection.execute("SELECT DISTINCT channel FROM orders ORDER BY 1").fetchall()]
        first_date, last_date = get_data_range(connection)
        table_counts = {
            table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in SOURCE_TABLES
        }
    finally:
        connection.close()
    return {
        "countries": ["All countries", *countries],
        "channels": ["All channels", *channels],
        "data_range": {"start": first_date.isoformat(), "end": last_date.isoformat()},
        "table_counts": table_counts,
    }


@app.get("/api/dashboard")
def dashboard(
    days: int = Query(default=30, ge=7, le=90),
    country: str = Query(default="All countries", min_length=1, max_length=60),
    channel: str = Query(default="All channels", min_length=1, max_length=40),
    order_limit: int = Query(default=10, ge=10, le=100),
) -> dict:
    if days not in {7, 30, 90}:
        raise HTTPException(status_code=422, detail="days must be one of 7, 30, or 90")
    if order_limit not in {10, 25, 50, 100}:
        raise HTTPException(status_code=422, detail="order_limit must be one of 10, 25, 50, or 100")

    connection = connect(read_only=True)
    try:
        known_countries = {"All countries", *[row[0] for row in connection.execute("SELECT DISTINCT shipping_country FROM orders").fetchall()]}
        known_channels = {"All channels", *[row[0] for row in connection.execute("SELECT DISTINCT channel FROM orders").fetchall()]}
    finally:
        connection.close()
    if country not in known_countries:
        raise HTTPException(status_code=422, detail="Unknown country")
    if channel not in known_channels:
        raise HTTPException(status_code=422, detail="Unknown channel")
    try:
        return get_dashboard(days=days, country=country, channel=channel, order_limit=order_limit)
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
