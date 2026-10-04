"""PostgreSQL connection settings for the local OpsVista database."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg import sql

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
SCHEMA_NAME = "opsvista"

# Keep local credentials out of source files and load them from the ignored .env file.
load_dotenv(BACKEND_DIR / ".env")
DB_NAME = os.getenv("OPSVISTA_DB_NAME", "opsvista")


def _connection_parameters(database: str | None = None) -> dict[str, str | int]:
    """Build connection options from environment variables and local defaults."""
    password = os.getenv("OPSVISTA_DB_PASSWORD")
    if not password:
        raise RuntimeError("Set OPSVISTA_DB_PASSWORD in backend/.env before starting OpsVista.")

    return {
        "host": os.getenv("OPSVISTA_DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("OPSVISTA_DB_PORT", "5432")),
        "dbname": database or DB_NAME,
        "user": os.getenv("OPSVISTA_DB_USER", "postgres"),
        "password": password,
        "connect_timeout": 5,
    }


def connect(read_only: bool = False) -> psycopg.Connection:
    """Open the dedicated OpsVista schema in PostgreSQL."""
    options = f"-c search_path={SCHEMA_NAME}"
    if read_only:
        options += " -c default_transaction_read_only=on"
    return psycopg.connect(**_connection_parameters(), options=options)


def initialize_database() -> None:
    """Create the project database and schema when they do not exist."""
    parameters = _connection_parameters(database="postgres")
    with psycopg.connect(**parameters, autocommit=True) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (DB_NAME,),
        ).fetchone()
        if not exists:
            # Create only the project database; leave all other databases untouched.
            connection.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DB_NAME))
            )

    with psycopg.connect(**_connection_parameters()) as connection:
        connection.execute(
            sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(SCHEMA_NAME))
        )
