# OpsVista

OpsVista is a dashboard for exploring the supplied garden retailer data. It shows sales, orders, customers, products, payments, returns, and shipping time.

The dashboard uses **JavaScript and React** in the browser, **Python and FastAPI** for the API, and **PostgreSQL** to store the data.

## What you need

- Windows, macOS, or Linux
- Python 3.10 or newer
- PostgreSQL installed and running
- Node.js 20.19+ or 22.12+ and npm available in your terminal
- Your seven supplied Parquet files and local PostgreSQL credentials

The local `backend/.env` contains your database password, so it is ignored by Git. Never share or commit it.

## Prepare the local data and database settings

Before the first start, place these source files in `backend/data/raw/`:

`categories.parquet`, `customers.parquet`, `products.parquet`, `orders.parquet`, `order_items.parquet`, `payments.parquet`, and `returns.parquet`.

The Parquet files and generated CSV files are excluded from Git. The converter creates the CSV files from the Parquet files when you start the API for the first time.

Copy `backend/.env.example` to `backend/.env` and set `OPSVISTA_DB_PASSWORD` to your local PostgreSQL password. Keep `backend/.env` private and out of Git.

## Start OpsVista

Open two terminal windows in the project folder. Keep them open while using the dashboard.

### Window 1: start the API

Choose the setup commands for your operating system. These commands create a virtual environment, so the project packages stay together.

**Windows (CMD):**

```bat
cd backend
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m app.convert_sources
.venv\Scripts\python.exe -m app.etl
.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

**macOS or Linux (Terminal):**

```sh
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m app.convert_sources
.venv/bin/python -m app.etl
.venv/bin/python -m uvicorn app.main:app --reload
```

The converter makes CSV files from the supplied Parquet files. The importer creates the `opsvista` database and loads the seven CSV tables into its `opsvista` schema. On first start, it also builds indexed sales and payment summaries so date filters stay quick. If you replace the CSV files, run the reload command from `backend`:

- Windows (CMD): `.venv\Scripts\python.exe -m app.etl --reload`
- macOS or Linux: `.venv/bin/python -m app.etl --reload`

### Window 2: start the dashboard

With Node.js and npm available in the terminal, the same commands work on Windows, macOS, and Linux:

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Open **http://127.0.0.1:5173** in your browser. The API documentation is at **http://127.0.0.1:8000/docs**. Press `Ctrl+C` in each terminal to stop its server.

## Using the dashboard

- Choose a 7, 30, or 90 day reporting period.
- Filter by country or sales channel; the country menu includes search.
- Use the section links on the left to jump through the dashboard. They follow the page order, and the highlighted link follows the section currently in view.
- Click a KPI card to read how that number is calculated. Hover chart points or bars to see their values.
- Select a question-mark icon on a data panel to open its explanation. Hover a top-product row to see its sales details.
- Customer, payment, return, product, and channel cards update with the selected date range and filters.
- Select a recent order row to open its payment, delivery, return, and sales details.
- Choose to show 10, 25, 50, or 100 recent orders, search the loaded rows, and export visible rows as CSV.
- Select the moon or sun button to switch between light and dark themes. Your choice is remembered in that browser.
- On a phone or tablet, use the menu button to open the section links. The order table can scroll sideways when needed.

## How the data gets to the screen

1. `convert_sources.py` converts the supplied Parquet files to CSV without changing their columns.
2. `etl.py` loads the CSV files into PostgreSQL using the supplied SQL table definitions, then creates reusable sales and payment summaries.
3. FastAPI queries those summaries and the selected date range, then returns dashboard data from `/api` endpoints.
4. The JavaScript files `frontend/src/App.jsx` and `frontend/src/main.jsx` display that response as charts, summaries, and tables.

## Source data notes

The dashboard only uses the seven supplied tables: categories, customers, products, orders, order items, payments, and returns. The files contain 90,000 orders from 2023 through 2025.

The sources do not include a currency field, support tickets, or promised delivery times. Sales are shown in the source amount units; support KPIs and on-time delivery are not calculated. Customer email addresses are not returned by the API.

CSV and Parquet files, the local `.env`, and `node_modules` are excluded from Git.

## Project folders

```text
backend/app/       Python API, PostgreSQL connection, analytics, and import code
backend/data/raw/  Supplied Parquet and CSV files plus the SQL schema
frontend/src/      JavaScript dashboard and styles
```
