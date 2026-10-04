"""PostgreSQL analytics for the supplied order, item, payment, return, and customer tables."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from app.db import connect


def _json_value(value: Any) -> Any:
    """Convert PostgreSQL dates and decimals to JSON-friendly Python values."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _rows(connection, sql: str, parameters: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    """Return a query result as dictionaries using the SQL column names."""
    result = connection.execute(sql, parameters)
    columns = [column.name for column in result.description]
    return [
        {column: _json_value(value) for column, value in zip(columns, row)}
        for row in result.fetchall()
    ]


def _where(start: date, end: date, country: str, channel: str) -> tuple[str, tuple[Any, ...]]:
    # Keep filter values parameterized; only fixed SQL clauses are assembled here.
    conditions = ["o.ordered_at >= %s AND o.ordered_at < %s + INTERVAL '1 day'"]
    parameters: list[Any] = [start, end]
    if country != "All countries":
        conditions.append("o.shipping_country = %s")
        parameters.append(country)
    if channel != "All channels":
        conditions.append("o.channel = %s")
        parameters.append(channel.lower())
    return " AND ".join(conditions), tuple(parameters)


def _metrics(connection, start: date, end: date, country: str, channel: str) -> dict[str, Any]:
    # Join one precomputed sales and payment row to each order.
    where, parameters = _where(start, end, country, channel)
    query = f"""SELECT COUNT(*) AS orders,
           COALESCE(SUM(CASE WHEN LOWER(o.status) <> 'cancelled' THEN COALESCE(s.net_sales, 0) ELSE 0 END), 0) AS net_sales,
           COUNT(DISTINCT o.customer_id) AS customers,
           SUM(CASE WHEN COALESCE(s.return_events, 0) > 0 THEN 1 ELSE 0 END) AS returned_orders,
           COALESCE(SUM(s.return_events), 0) AS return_events,
           COALESCE(SUM(s.refunds), 0) AS refunds,
           SUM(CASE WHEN o.shipped_at IS NOT NULL THEN 1 ELSE 0 END) AS shipped_orders,
           AVG(CASE WHEN o.shipped_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (o.shipped_at - o.ordered_at)) / 86400.0 END) AS average_ship_days,
           COALESCE(SUM(COALESCE(p.payment_attempts, 0)), 0) AS payment_attempts,
           COALESCE(SUM(COALESCE(p.captured_attempts, 0)), 0) AS captured_attempts,
           COALESCE(SUM(COALESCE(p.failed_attempts, 0)), 0) AS failed_attempts
    FROM orders o
    LEFT JOIN order_sales_summary s ON s.order_id = o.order_id
    LEFT JOIN payment_by_order p ON p.order_id = o.order_id
    WHERE {where}"""
    return _rows(connection, query, parameters)[0]


def _percentage_change(current: float, previous: float) -> float:
    """Compute change against a prior period, defining a zero baseline as 0 or 100%."""
    if previous == 0:
        return 0.0 if current == 0 else 100.0
    return round((current - previous) / previous * 100, 1)


def _period_summary(
    connection,
    start: date,
    end: date,
    country: str,
    channel: str,
) -> dict[str, Any]:
    # Compare equal-length windows immediately before the selected period.
    current = _metrics(connection, start, end, country, channel)
    period_days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=period_days - 1)
    previous = _metrics(connection, previous_start, previous_end, country, channel)
    orders = int(current["orders"] or 0)
    payments = int(current["payment_attempts"] or 0)
    returned_orders = int(current["returned_orders"] or 0)
    shipped_orders = int(current["shipped_orders"] or 0)
    average_ship_days = current["average_ship_days"]
    payment_rate = (current["captured_attempts"] / payments * 100) if payments else 0
    previous_payment_rate = (
        previous["captured_attempts"] / previous["payment_attempts"] * 100
        if previous["payment_attempts"]
        else 0
    )
    return_rate = returned_orders / orders * 100 if orders else 0
    previous_return_rate = (
        previous["returned_orders"] / previous["orders"] * 100 if previous["orders"] else 0
    )
    return {
        "net_sales": round(float(current["net_sales"] or 0), 2),
        "orders": orders,
        "customers": int(current["customers"] or 0),
        "average_order_value": round(float(current["net_sales"] or 0) / orders, 2) if orders else 0,
        "payment_success_rate": round(payment_rate, 1),
        "payment_success_change": round(payment_rate - previous_payment_rate, 1),
        "failed_payments": int(current["failed_attempts"] or 0),
        "payment_attempts": payments,
        "captured_attempts": int(current["captured_attempts"] or 0),
        "return_rate": round(return_rate, 1),
        "return_rate_change": round(return_rate - previous_return_rate, 1),
        "returned_orders": returned_orders,
        "return_events": int(current["return_events"] or 0),
        "refunds": round(float(current["refunds"] or 0), 2),
        "shipped_orders": shipped_orders,
        "shipment_rate": round(shipped_orders / orders * 100, 1) if orders else 0,
        "average_ship_days": round(float(average_ship_days), 2) if average_ship_days is not None else None,
        "sales_change": _percentage_change(float(current["net_sales"] or 0), float(previous["net_sales"] or 0)),
        "orders_change": _percentage_change(float(orders), float(previous["orders"] or 0)),
        "customers_change": _percentage_change(float(current["customers"] or 0), float(previous["customers"] or 0)),
    }


def _build_insights(
    summary: dict[str, Any],
    channels: list[dict[str, Any]],
    return_reasons: list[dict[str, Any]],
) -> list[dict[str, str]]:
    insights: list[dict[str, str]] = []
    change = summary["sales_change"]
    if change >= 4:
        insights.append({"tone": "positive", "title": "Net sales are growing", "detail": f"Sales after discounts and refunds are up {change:.1f}% versus the previous period."})
    elif change <= -4:
        insights.append({"tone": "watch", "title": "Net sales have softened", "detail": f"Sales after discounts and refunds are down {abs(change):.1f}% versus the previous period."})
    else:
        insights.append({"tone": "neutral", "title": "Net sales are steady", "detail": "Sales are tracking within 4% of the previous period."})

    if summary["payment_attempts"]:
        failure_rate = 100 - summary["payment_success_rate"]
        tone = "watch" if failure_rate >= 5 else "positive"
        insights.append({
            "tone": tone,
            "title": "Payment performance",
            "detail": f"{summary['failed_payments']:,} of {summary['payment_attempts']:,} payment attempts failed ({failure_rate:.1f}%).",
        })

    if return_reasons:
        top_reason = return_reasons[0]
        insights.append({
            "tone": "watch" if top_reason["value"] else "neutral",
            "title": f"{top_reason['label'].replace('_', ' ').title()} leads returns",
            "detail": f"{top_reason['value']:,} return records cite this reason in the selected order period.",
        })

    if channels:
        top_channel = channels[0]
        insights.append({
            "tone": "neutral",
            "title": f"{top_channel['label'].title()} is the top channel",
            "detail": f"It contributed {top_channel['orders']:,} orders in the selected period.",
        })
    return insights[:4]


def get_data_range(connection) -> tuple[date, date]:
    # Anchor filters to the latest date in the files, which may be historical.
    row = connection.execute("SELECT MIN(ordered_at), MAX(ordered_at) FROM orders").fetchone()
    if not row or row[0] is None or row[1] is None:
        raise ValueError("The orders table has no dated rows")
    return row[0].date(), row[1].date()


def get_dashboard(
    days: int = 30,
    country: str = "All countries",
    channel: str = "All channels",
    order_limit: int = 10,
) -> dict[str, Any]:
    """Build all dashboard panels from one consistent country/channel/date filter."""
    connection = connect(read_only=True)
    try:
        first_date, end = get_data_range(connection)
        # Use the data's last order date instead of the machine's current date.
        start = max(first_date, end - timedelta(days=days - 1))
        where, parameters = _where(start, end, country, channel)
        summary = _period_summary(connection, start, end, country, channel)

        trend_query = f"""SELECT CAST(o.ordered_at AS DATE) AS date,
               SUM(CASE WHEN LOWER(o.status) <> 'cancelled'
                        THEN COALESCE(s.net_sales, 0) ELSE 0 END) AS sales,
               COUNT(*) AS orders
        FROM orders o LEFT JOIN order_sales_summary s ON s.order_id = o.order_id
        WHERE {where}
        GROUP BY CAST(o.ordered_at AS DATE) ORDER BY date"""
        trend_rows = _rows(connection, trend_query, parameters)
        trend_by_date = {row["date"]: row for row in trend_rows}
        # Include dates with no orders so the chart keeps a continuous time axis.
        revenue_trend = []
        for offset in range((end - start).days + 1):
            day = (start + timedelta(days=offset)).isoformat()
            entry = trend_by_date.get(day, {})
            revenue_trend.append({
                "date": day,
                "sales": round(float(entry.get("sales") or 0), 2),
                "orders": int(entry.get("orders") or 0),
            })

        order_status = _rows(
            connection,
            f"""SELECT LOWER(o.status) AS label, COUNT(*) AS value
                FROM orders o WHERE {where}
                GROUP BY LOWER(o.status) ORDER BY value DESC""",
            parameters,
        )
        for row in order_status:
            row["label"] = str(row["label"]).title()

        category_performance = _rows(
            connection,
            f"""SELECT c.category_name AS label,
                       SUM(GREATEST(il.quantity * il.unit_price - il.discount_amount - il.refund_amount, 0)) AS sales,
                       COUNT(DISTINCT o.order_id) AS orders,
                       SUM(il.return_events) AS returned_lines,
                       COUNT(*) AS order_lines,
                       SUM(il.quantity) AS units
                FROM order_item_analytics il
                JOIN orders o ON o.order_id = il.order_id
                JOIN products p ON p.product_id = il.product_id
                JOIN categories c ON c.category_id = p.category_id
                WHERE {where} AND LOWER(o.status) <> 'cancelled'
                GROUP BY c.category_name ORDER BY sales DESC""",
            parameters,
        )
        for row in category_performance:
            row["sales"] = round(float(row["sales"] or 0), 2)
            row["return_rate"] = round(row["returned_lines"] / row["order_lines"] * 100, 1) if row["order_lines"] else 0

        top_products = _rows(
            connection,
            f"""SELECT p.product_name AS name, c.category_name AS category,
                       SUM(GREATEST(il.quantity * il.unit_price - il.discount_amount - il.refund_amount, 0)) AS sales,
                       SUM(il.quantity) AS units, COUNT(DISTINCT o.order_id) AS orders,
                       SUM(il.return_events) AS returned_lines
                FROM order_item_analytics il
                JOIN orders o ON o.order_id = il.order_id
                JOIN products p ON p.product_id = il.product_id
                JOIN categories c ON c.category_id = p.category_id
                WHERE {where} AND LOWER(o.status) <> 'cancelled'
                GROUP BY p.product_name, c.category_name
                ORDER BY sales DESC LIMIT 5""",
            parameters,
        )
        for row in top_products:
            row["sales"] = round(float(row["sales"] or 0), 2)

        channel_mix = _rows(
            connection,
            f"""SELECT o.channel AS label,
                       COUNT(*) AS orders,
                       SUM(CASE WHEN LOWER(o.status) <> 'cancelled' THEN COALESCE(s.net_sales, 0) ELSE 0 END) AS sales
                FROM orders o LEFT JOIN order_sales_summary s ON s.order_id = o.order_id
                WHERE {where}
                GROUP BY o.channel ORDER BY sales DESC""",
            parameters,
        )
        for row in channel_mix:
            row["sales"] = round(float(row["sales"] or 0), 2)

        return_reasons = _rows(
            connection,
            f"""SELECT r.reason AS label, COUNT(*) AS value,
                       SUM(r.refund_amount) AS refunds
                FROM returns r
                JOIN order_items oi ON oi.order_item_id = r.order_item_id
                JOIN orders o ON o.order_id = oi.order_id
                WHERE {where}
                GROUP BY r.reason ORDER BY value DESC""",
            parameters,
        )
        for row in return_reasons:
            row["refunds"] = round(float(row["refunds"] or 0), 2)

        payment_failure_reasons = _rows(
            connection,
            f"""SELECT COALESCE(p.failure_reason, 'Unspecified') AS label,
                       COUNT(*) AS value
                FROM payments p JOIN orders o ON o.order_id = p.order_id
                WHERE {where} AND LOWER(p.status) = 'failed'
                GROUP BY COALESCE(p.failure_reason, 'Unspecified')
                ORDER BY value DESC LIMIT 5""",
            parameters,
        )

        customer_query = f"""SELECT COUNT(DISTINCT o.customer_id) AS active,
                   COUNT(DISTINCT CASE WHEN c.signup_date BETWEEN %s AND %s THEN c.customer_id END) AS new_customers,
                   COUNT(DISTINCT CASE WHEN EXISTS (
                       SELECT 1 FROM orders prior
                       WHERE prior.customer_id = o.customer_id AND prior.ordered_at < %s
                   ) THEN o.customer_id END) AS repeat_customers
            FROM orders o JOIN customers c ON c.customer_id = o.customer_id
            WHERE {where}"""
        customer_rows = _rows(connection, customer_query, (start, end, start, *parameters))
        customer_snapshot = customer_rows[0]
        # A repeat buyer has at least one order dated before this reporting window.
        customer_snapshot["repeat_rate"] = round(
            customer_snapshot["repeat_customers"] / customer_snapshot["active"] * 100,
            1,
        ) if customer_snapshot["active"] else 0

        loyalty_rows = _rows(
            connection,
            f"""SELECT COALESCE(c.loyalty_tier, 'Unassigned') AS label,
                       COUNT(DISTINCT o.customer_id) AS customers
                FROM orders o JOIN customers c ON c.customer_id = o.customer_id
                WHERE {where}
                GROUP BY COALESCE(c.loyalty_tier, 'Unassigned')
                ORDER BY customers DESC""",
            parameters,
        )

        recent_orders = _rows(
            connection,
            f"""SELECT o.order_id, CAST(o.ordered_at AS DATE) AS order_date,
                   CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                   o.shipping_country AS country, o.channel,
                   o.status,
                   CASE WHEN LOWER(o.status) <> 'cancelled' THEN COALESCE(s.net_sales, 0) ELSE 0 END AS sales,
                   CASE WHEN COALESCE(p.payment_attempts, 0) = 0 THEN 'No payment'
                        WHEN COALESCE(p.captured_attempts, 0) > 0 THEN 'Captured' ELSE 'Failed' END AS payment_status,
                   CASE WHEN o.shipped_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (o.shipped_at - o.ordered_at)) / 86400.0 END AS ship_days,
                   COALESCE(s.return_events, 0) AS return_events
            FROM orders o
            LEFT JOIN customers c ON c.customer_id = o.customer_id
            LEFT JOIN order_sales_summary s ON s.order_id = o.order_id
            LEFT JOIN payment_by_order p ON p.order_id = o.order_id
            WHERE {where}
            ORDER BY o.ordered_at DESC, o.order_id DESC LIMIT %s""",
            (*parameters, order_limit),
        )
        for row in recent_orders:
            row["sales"] = round(float(row["sales"] or 0), 2)
            row["ship_days"] = round(float(row["ship_days"]), 1) if row["ship_days"] is not None else None
            row["status"] = str(row["status"]).title()

        insights = _build_insights(summary, channel_mix, return_reasons)
        return {
            "range": {
                "days": days,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "first_data_date": first_date.isoformat(),
                "country": country,
                "channel": channel,
            },
            "summary": summary,
            "revenue_trend": revenue_trend,
            "order_status": order_status,
            "categories": category_performance[:7],
            "top_products": top_products,
            "channel_mix": channel_mix,
            "return_reasons": return_reasons,
            "payment_failure_reasons": payment_failure_reasons,
            "customer_snapshot": customer_snapshot,
            "loyalty_mix": loyalty_rows,
            "recent_orders": recent_orders,
            "insights": insights,
            "data_gaps": [
                "The source files do not include support tickets, so support KPIs are unavailable.",
                "The source files do not include a currency field; sales are shown in the source amount units.",
                "There are no promised-delivery timestamps, so on-time delivery cannot be calculated.",
            ],
        }
    finally:
        connection.close()
