import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Database, Download, CreditCard, MapPin, Menu, Moon, PackageCheck, RefreshCw, Search, ShoppingBag, Sparkles, Sun, Tag, Truck, Users, X, } from "lucide-react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, } from "recharts";
// The source has no currency code, so amounts stay in the source's numeric units.
const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactAmount = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const count = new Intl.NumberFormat("en-US");
const statusColors = {
    Delivered: "#3ca889",
    Shipped: "#69a9cc",
    Processing: "#f1b563",
    Cancelled: "#e47c76",
    Returned: "#9a83c8",
};
const navItems = [
    { label: "Overview", href: "#overview", icon: Activity },
    { label: "Products", href: "#products", icon: PackageCheck },
    { label: "Customers", href: "#customers", icon: Users },
    { label: "Payments", href: "#payments", icon: CreditCard },
    { label: "Returns", href: "#returns", icon: Truck },
    { label: "Orders", href: "#orders", icon: ShoppingBag },
];
function formatDate(value, options) {
    // Parse date-only values in local time to avoid shifting the displayed day.
    return new Intl.DateTimeFormat("en-US", options ?? { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00`));
}
function signed(value, suffix = "%") {
    // Keep positive deltas explicit so they scan consistently against negative deltas.
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}
function App() {
    const [days, setDays] = useState(30);
    const [orderLimit, setOrderLimit] = useState(10);
    const [country, setCountry] = useState("All countries");
    const [channel, setChannel] = useState("All channels");
    const [data, setData] = useState(null);
    const [filters, setFilters] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeSection, setActiveSection] = useState("Overview");
    const [detail, setDetail] = useState(null);
    const [theme, setTheme] = useState(() => localStorage.getItem("opsvista-theme") === "dark" ? "dark" : "light");
    const dashboardCache = useRef(new Map());
    useEffect(() => {
        // Remember the selected theme and apply it to the whole page.
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("opsvista-theme", theme);
    }, [theme]);
    useEffect(() => {
        // Keep the highlighted sidebar link aligned with the section near the top of the screen.
        const targets = navItems
            .map(({ href }) => document.getElementById(href.slice(1)))
            .filter(Boolean);
        let frame = 0;
        const updateActiveSection = () => {
            frame = 0;
            const marker = Math.min(180, Math.max(90, window.innerHeight * 0.2));
            const candidates = targets.filter((target) => {
                const bounds = target.getBoundingClientRect();
                return bounds.top <= marker && bounds.bottom >= marker;
            });
            const hashTarget = targets.find((target) => `#${target.id}` === window.location.hash);
            const currentTarget = candidates.includes(hashTarget) ? hashTarget : candidates[0];
            const nextSection = currentTarget?.id
                ? navItems.find(({ href }) => href === `#${currentTarget.id}`)?.label
                : window.scrollY < 70 ? "Overview" : null;

            if (nextSection)
                setActiveSection((current) => current === nextSection ? current : nextSection);
        };
        const scheduleUpdate = () => {
            if (!frame)
                frame = window.requestAnimationFrame(updateActiveSection);
        };

        window.addEventListener("scroll", scheduleUpdate, { passive: true });
        window.addEventListener("resize", scheduleUpdate);
        window.addEventListener("hashchange", scheduleUpdate);
        scheduleUpdate();
        return () => {
            window.removeEventListener("scroll", scheduleUpdate);
            window.removeEventListener("resize", scheduleUpdate);
            window.removeEventListener("hashchange", scheduleUpdate);
            if (frame)
                window.cancelAnimationFrame(frame);
        };
    }, []);
    useEffect(() => {
        // Load filter options and source row counts, then reload them on manual refresh.
        fetch("/api/filters")
            .then(async (response) => {
            if (!response.ok)
                throw new Error(`API returned ${response.status}`);
            return (await response.json());
        })
            .then(setFilters)
            .catch(() => undefined);
    }, [refreshKey]);
    useEffect(() => {
        // Reporting windows are anchored to the latest order date in the supplied data.
        const controller = new AbortController();
        const params = new URLSearchParams({ days: String(days), country, channel, order_limit: String(orderLimit) });
        const cacheKey = params.toString();
        const cachedData = dashboardCache.current.get(cacheKey);
        if (cachedData) {
            // Show a previous selection immediately while the API refreshes it.
            setData(cachedData);
            setLoading(false);
        }
        else {
            setLoading(true);
        }
        setError("");
        fetch(`/api/dashboard?${params}`, { signal: controller.signal })
            .then(async (response) => {
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail ?? `API returned ${response.status}`);
            }
            return (await response.json());
        })
            .then((payload) => {
            // Keep a small recent cache so switching between dashboard ranges feels instant.
            const cache = dashboardCache.current;
            cache.delete(cacheKey);
            cache.set(cacheKey, payload);
            if (cache.size > 24)
                cache.delete(cache.keys().next().value);
            setData(payload);
        })
            .catch((requestError) => {
            if (requestError.name !== "AbortError" && !cachedData) {
                setError(requestError.message.includes("fetch")
                    ? "Could not reach the API. Start the FastAPI service, then refresh."
                    : requestError.message);
            }
        })
            .finally(() => {
            if (!controller.signal.aborted)
                setLoading(false);
        });
        return () => controller.abort();
    }, [days, country, channel, orderLimit, refreshKey]);
    const visibleOrders = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized)
            return data?.recent_orders ?? [];
        return (data?.recent_orders ?? []).filter((order) => [String(order.order_id), order.customer_name, order.country, order.channel, order.status]
            .some((value) => value.toLowerCase().includes(normalized)));
    }, [data, query]);
    const chartData = useMemo(() => (data?.revenue_trend ?? []).map((item) => ({
        ...item,
        // Seven-day charts need only the day number; the full range remains above the chart.
        shortDate: days === 7 ? formatDate(item.date, { day: "numeric" }) : formatDate(item.date),
    })), [data, days]);
    const startLabel = data ? formatDate(data.range.start, { day: "numeric", month: "short", year: "numeric" }) : "—";
    const endLabel = data ? formatDate(data.range.end, { day: "numeric", month: "short", year: "numeric" }) : "—";
    const tableCount = filters ? Object.keys(filters.table_counts).length : null;
    const returnToOverview = () => setActiveSection("Overview");
    function exportOrders() {
        if (!data)
            return;
        // Export the recent rows visible after the selected size and search.
        const columns = ["Order", "Date", "Customer", "Country", "Channel", "Status", "Net sales (source units)", "Payment", "Ship days", "Return events"];
        const values = visibleOrders.map((order) => [
            order.order_id,
            order.order_date,
            order.customer_name,
            order.country,
            order.channel,
            order.status,
            order.sales,
            order.payment_status,
            order.ship_days ?? "",
            order.return_events,
        ]);
        const csv = [columns, ...values]
            .map((row) => row.map((value) => csvCell(value)).join(","))
            .join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `opsvista-orders-${data.range.start}-to-${data.range.end}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }
    function explainMetric(title, description) {
        setDetail({ type: "metric", title, description });
    }
    return (<div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><span>O</span><i /></div>
          <div className="brand-wordmark"><strong>opsvista</strong><span>OPERATIONS INTELLIGENCE</span></div>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMobileNavOpen(false)}><X size={18}/></button>
        </div>

        <div className="workspace-switcher">
          <span className="workspace-icon"><Database size={16}/></span>
          <span className="workspace-copy"><b>Garden retailer</b><small>Source data workspace</small></span>
        </div>

        <div className="nav-caption">DASHBOARD</div>
        <nav className="primary-nav" aria-label="Dashboard sections">
          {navItems.map(({ label, href, icon: Icon }) => (<a key={label} href={href} aria-current={activeSection === label ? "location" : undefined} onClick={() => { setMobileNavOpen(false); setActiveSection(label); }} className={`nav-link ${activeSection === label ? "active" : ""}`}>
              <Icon size={17} strokeWidth={activeSection === label ? 2.1 : 1.8}/><span>{label}</span>
            </a>))}
        </nav>

        <div className="sidebar-bottom">
          <div className="data-status-card">
            <div className="status-head"><span className="status-dot"/> SOURCE DATA <span className="status-live">LOCAL</span></div>
            <div className="status-message">{filters ? <><Check size={14}/> {tableCount} source tables</> : "Connecting to source tables"}</div>
            <div className="status-meta">{filters ? `${count.format(filters.table_counts.orders ?? 0)} orders loaded` : "Local data connection"}</div>
          </div>
          <div className="profile-row">
            <div className="avatar avatar-user">OV</div>
            <div className="profile-copy"><b>OpsVista</b><small>Analytics workspace</small></div>
          </div>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"/>}

      <main className="main-area">
        <header className="topbar">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <a href="#overview" onClick={returnToOverview}>OpsVista</a>
            <ChevronRight size={14} aria-hidden="true"/>
            <a href="#overview" aria-current="page" onClick={returnToOverview}>Overview</a>
          </nav>
          <div className="topbar-actions">
            <button className="icon-button theme-toggle" type="button" aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button>
            <label className="search-box"><Search size={15}/><input placeholder="Search recent orders…" aria-label="Search recent orders" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
            <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}><Menu size={20}/></button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading" id="overview">
            <div>
              <div className="eyebrow"><span className="live-pulse"/> OPERATIONS OVERVIEW <span className="eyebrow-divider">/</span> SOURCE DATA</div>
              <h1>Operations overview</h1>
              <p>Sales, fulfillment, customers, payments, and returns across the selected period.</p>
            </div>
            <div className="heading-actions">
              <button className="button button-secondary" onClick={exportOrders} disabled={!data}><Download size={15}/> Export visible orders</button>
              <button className="button button-primary" onClick={() => setRefreshKey((key) => key + 1)}><RefreshCw size={15}/> Refresh</button>
            </div>
          </section>

          <section className="filter-row" aria-label="Dashboard filters">
            <div className="period-control">
              <CalendarDays size={15}/>
              {[7, 30, 90].map((value) => <button key={value} className={days === value ? "selected" : ""} onClick={() => setDays(value)}>{value} days</button>)}
            </div>
            <span className="date-range">{startLabel} — {endLabel}</span>
            <span className="filter-divider"/>
            <FilterDropdown label="Country" value={country} options={filters?.countries ?? ["All countries"]} onChange={setCountry} icon={MapPin} searchable/>
            <FilterDropdown label="Channel" value={channel} options={filters?.channels ?? ["All channels"]} onChange={setChannel} icon={Tag}/>
            <div className="sync-indicator"><span className="status-dot"/> {loading ? "Refreshing" : data ? `Through ${formatDate(data.range.end)}` : "No data"}</div>
          </section>

          {error && <div className="error-banner"><CircleHelp size={18}/><div><b>Dashboard data is unavailable</b><span>{error}</span></div><button onClick={() => setRefreshKey((key) => key + 1)}>Try again</button></div>}

          <section className="metrics-grid" aria-label="Key performance indicators">
            <MetricCard
              title="Net sales"
              value={data ? amount.format(data.summary.net_sales) : "—"}
              description="Sales for non-cancelled orders after discounts and refunds. Amounts use source units because the files do not include a currency."
              onExplain={explainMetric}
              change={data?.summary.sales_change}
              footnote="after discounts & refunds · source units"
              icon={<Activity size={17}/>}
              tone="teal"
              loading={loading}
            />
            <MetricCard
              title="Orders"
              value={data ? count.format(data.summary.orders) : "—"}
              description="Count of orders placed during this period, including cancelled and returned orders."
              onExplain={explainMetric}
              change={data?.summary.orders_change}
              footnote="vs. previous period"
              icon={<ShoppingBag size={17}/>}
              tone="blue"
              loading={loading}
            />
            <MetricCard
              title="Payment success"
              value={data ? `${data.summary.payment_success_rate.toFixed(1)}%` : "—"}
              description="Captured payment attempts divided by all payment attempts for orders in this period. An order may have multiple attempts."
              onExplain={explainMetric}
              change={data?.summary.payment_success_change}
              suffix=" pp"
              footnote="percentage point change"
              icon={<CreditCard size={17}/>}
              tone="amber"
              loading={loading}
            />
            <MetricCard
              title="Returned orders"
              value={data ? `${data.summary.return_rate.toFixed(1)}%` : "—"}
              description="Percent of orders in this period that have at least one returned item. An order counts once even if multiple items were returned."
              onExplain={explainMetric}
              change={data?.summary.return_rate_change}
              suffix=" pp"
              goodWhenDown
              footnote={`${count.format(data?.summary.returned_orders ?? 0)} orders with a return`}
              icon={<PackageCheck size={17}/>}
              tone="rose"
              loading={loading}
            />
          </section>

          <section className="overview-grid">
            <article className="panel trend-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">SALES PERFORMANCE</div><h2>Net sales & order volume</h2><p>Daily merchandise sales after discounts and refunds</p></div>
                <button className="more-button" onClick={exportOrders} aria-label="Export visible orders"><Download size={13}/></button>
              </div>
              <div className="chart-legend"><span><i className="legend-dot revenue-dot"/> Net sales</span><span><i className="legend-line"/> Orders</span><span className="chart-total">{chartData.length ? `${chartData.length} days · source units` : "No data"}</span></div>
              <div className="trend-chart">
                {data && <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
                    <defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#27aa88" stopOpacity={0.21}/><stop offset="95%" stopColor="#27aa88" stopOpacity={0.01}/></linearGradient></defs>
                    <CartesianGrid vertical={false} stroke={theme === "dark" ? "#2c3b40" : "#edf0f2"} strokeDasharray="3 5"/>
                    <XAxis dataKey="shortDate" tickLine={false} axisLine={false} tick={{ fill: theme === "dark" ? "#a6b5b7" : "#778287", fontSize: 12 }} interval="preserveStartEnd" minTickGap={20} dy={10}/>
                    <YAxis yAxisId="sales" tickLine={false} axisLine={false} tick={{ fill: theme === "dark" ? "#a6b5b7" : "#778287", fontSize: 12 }} tickFormatter={(value) => compactAmount.format(value)} width={62}/>
                    <YAxis yAxisId="orders" orientation="right" hide domain={[0, "dataMax + 7"]}/>
                    <Tooltip content={<TrendTooltip />}/>
                    <Area yAxisId="sales" type="monotone" dataKey="sales" stroke="#27aa88" strokeWidth={2.5} fill="url(#revenueFill)" activeDot={{ r: 4, fill: "#fff", stroke: "#27aa88", strokeWidth: 2 }} isAnimationActive={false}/>
                    <Line yAxisId="orders" type="monotone" dataKey="orders" stroke="#83a9d7" strokeWidth={1.8} strokeDasharray="4 5" dot={false} activeDot={{ r: 3, fill: "#83a9d7" }} isAnimationActive={false}/>
                  </ComposedChart>
                </ResponsiveContainer>}
                {!data && <div className="chart-empty"><span className="empty-orbit"><Activity size={22}/></span><b>Waiting for the source tables</b><span>Start the API to load the selected period.</span></div>}
              </div>
            </article>

            <article className="panel status-panel">
              <div className="panel-heading compact-heading"><div><div className="panel-kicker">ORDER HEALTH</div><h2>Order status</h2><p>Order count by source status</p></div><ShoppingBag size={17} className="panel-heading-icon"/></div>
              <div className="status-chart-wrap">
                {data && data.order_status.length > 0 ? <>
                  <div className="status-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.order_status} dataKey="value" nameKey="label" innerRadius="72%" outerRadius="94%" paddingAngle={3} stroke="none" isAnimationActive={false}>{data.order_status.map((item) => <Cell key={item.label} fill={statusColors[item.label] ?? "#a1aab0"}/>)}</Pie><Tooltip content={<StatusTooltip />}/></PieChart></ResponsiveContainer><div className="donut-center"><strong>{count.format(data.summary.orders)}</strong><span>orders</span></div></div>
                  <div className="status-legend">{data.order_status.map((item) => <div key={item.label} className="status-legend-item"><span><i style={{ background: statusColors[item.label] ?? "#a1aab0" }}/>{item.label}</span><b>{count.format(item.value)} <small>{Math.round((item.value / Math.max(data.summary.orders, 1)) * 100)}%</small></b></div>)}</div>
                </> : <div className="empty-small">No order status rows for this filter</div>}
              </div>
              <div className="status-footer"><span><Truck size={15}/> Shipment timing</span><b className="text-good">{data?.summary.average_ship_days == null ? "No shipment dates" : `${data.summary.average_ship_days.toFixed(1)} days avg.`}</b></div>
            </article>
          </section>

          <section className="insights-section">
            <div className="section-title-row"><div><div className="panel-kicker">SIGNALS FROM THE SOURCE DATA</div><h2>Business insights</h2></div><a className="text-link" href="#orders">Review orders <ArrowRight size={14}/></a></div>
            <div className="insights-grid">
              {(data?.insights ?? []).slice(0, 4).map((insight, index) => <InsightCard key={`${insight.title}-${index}`} insight={insight}/>)}
              {!data && <div className="insight-skeleton"><span /><span /><span /></div>}
            </div>
          </section>

          <section className="lower-grid">
            <article className="panel category-panel" id="products">
              <div className="panel-heading"><div><div className="panel-kicker">PRODUCT MIX</div><h2>Category performance</h2><p>Net sales contribution by category · source units</p></div></div>
              <div className="category-chart">
                {data && data.categories.length > 0 ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data.categories} layout="vertical" margin={{ top: 4, right: 15, bottom: 0, left: 0 }} barSize={11}><CartesianGrid horizontal={false} stroke={theme === "dark" ? "#2c3b40" : "#edf0f2"}/><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: theme === "dark" ? "#a6b5b7" : "#778287", fontSize: 12 }} tickFormatter={(value) => compactAmount.format(value)}/><YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={{ fill: theme === "dark" ? "#c7d4d2" : "#606b71", fontSize: 12 }} width={100}/><Tooltip content={<CategoryTooltip />}/><Bar dataKey="sales" fill="#42b595" radius={[0, 5, 5, 0]} isAnimationActive={false}/></BarChart></ResponsiveContainer> : <div className="empty-small">No category sales for this filter</div>}
              </div>
              <div className="category-footer"><span><i className="legend-dot revenue-dot"/> Leading category</span><b>{data?.categories[0]?.label ?? "—"}</b></div>
            </article>

            <article className="panel products-panel" title="Top five products by net sales after discounts and refunds; each row includes category and units sold.">
              <div className="panel-heading"><div><div className="panel-kicker">BEST SELLERS</div><h2>Top products <PanelHelp onClick={() => explainMetric("Top products", "This list ranks the five products with the highest net merchandise sales in the selected period. Sales subtract discounts and refunds, and each product row also shows its category and units sold.")}/></h2><p>Ranked by net merchandise sales</p></div></div>
              <div className="product-list">
                {(data?.top_products ?? []).map((product, index) => <div className="product-row" key={`${product.name}-${index}`} title={`${product.name}: ${product.category}, ${count.format(product.units)} units, ${amount.format(product.sales)} source units net sales`}>
                  <div className={`product-rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</div>
                  <div className="product-name"><b>{product.name}</b><small>{product.category} · {count.format(product.units)} units</small></div>
                  <b className="product-sales">{amount.format(product.sales)}</b>
                </div>)}
                {!data && <div className="empty-small">Product sales will appear here</div>}
                {data && !data.top_products.length && <div className="empty-small">No product sales for this filter</div>}
              </div>
            </article>
          </section>

          <section className="operations-grid">
            <article className="panel customer-panel" id="customers" title="Shows active customers, repeat buyers, new signups, and loyalty tiers for the selected period.">
              <div className="panel-heading"><div><div className="panel-kicker">CUSTOMER ACTIVITY</div><h2>Customer snapshot <PanelHelp onClick={() => explainMetric("Customer snapshot", "Active customers are customers with orders in the selected period. Repeat buyers are active customers who placed at least one order before this period. New signups use the recorded signup date, and loyalty groups use each customer's saved tier.")}/></h2><p>Customers who ordered in this period</p></div><span className="customer-icon"><Users size={17}/></span></div>
              <div className="customer-total"><strong>{data ? count.format(data.customer_snapshot.active) : "—"}</strong><span>active customers</span></div>
              <div className="customer-breakdown"><div className="customer-bar"><i style={{ width: `${data?.customer_snapshot.repeat_rate ?? 0}%` }}/></div><div className="customer-breakdown-labels"><span>Repeat buyers <b>{data ? count.format(data.customer_snapshot.repeat_customers) : "—"}</b></span><span>{data ? `${data.customer_snapshot.repeat_rate.toFixed(1)}%` : "—"}</span></div></div>
              <div className="customer-stat-row"><span>New signups in period</span><b>{data ? count.format(data.customer_snapshot.new_customers) : "—"}</b></div>
              <div className="loyalty-list">{(data?.loyalty_mix ?? []).slice(0, 3).map((item) => <span key={item.label}>{item.label} <b>{count.format(item.customers)}</b></span>)}</div>
            </article>

            <article className="panel payment-panel" id="payments" title="Shows captured and failed payment attempts plus recorded failure reasons for the selected period.">
              <div className="panel-heading"><div><div className="panel-kicker">PAYMENT OUTCOMES</div><h2>Payment health <PanelHelp onClick={() => explainMetric("Payment health", "Payment success is captured payment attempts divided by all attempts for orders in the selected period. The card also lists failed attempts by recorded failure reason. One order can have more than one payment attempt.")}/></h2><p>Attempts recorded for selected orders</p></div><span className="customer-icon payment-icon"><CreditCard size={17}/></span></div>
              <div className="payment-rate"><strong>{data ? `${data.summary.payment_success_rate.toFixed(1)}%` : "—"}</strong><span>captured successfully</span></div>
              <div className="customer-breakdown"><div className="customer-bar payment-bar"><i style={{ width: `${data?.summary.payment_success_rate ?? 0}%` }}/></div><div className="customer-breakdown-labels"><span>Captured <b>{data ? count.format(data.summary.captured_attempts) : "—"}</b></span><span>Failed <b>{data ? count.format(data.summary.failed_payments) : "—"}</b></span></div></div>
              <div className="reason-list">{(data?.payment_failure_reasons ?? []).slice(0, 3).map((reason) => <div className="reason-row" key={reason.label}><span>{reason.label}</span><b>{count.format(reason.value)}</b></div>)}{data && !data.payment_failure_reasons.length && <div className="reason-empty">No failed payment attempts in this period</div>}</div>
            </article>

            <article className="panel return-panel" id="returns" title="Shows the returned-order rate, recorded return reasons, and refund amount for the selected period.">
              <div className="panel-heading"><div><div className="panel-kicker">RETURNS</div><h2>Return drivers <PanelHelp onClick={() => explainMetric("Return drivers", "Returned orders are orders with at least one returned item. The reason list counts the source return records for this period, and refund amount sums the recorded refund values in source units.")}/></h2><p>Reasons attached to returned line items</p></div><span className="customer-icon return-icon"><Truck size={17}/></span></div>
              <div className="return-summary"><strong>{data ? `${data.summary.return_rate.toFixed(1)}%` : "—"}</strong><span>orders with at least one return</span></div>
              <div className="reason-list">{(data?.return_reasons ?? []).slice(0, 4).map((reason) => <div className="reason-row" key={reason.label}><span>{reason.label.replaceAll("_", " ")}</span><b>{count.format(reason.value)}</b></div>)}{data && !data.return_reasons.length && <div className="reason-empty">No returns in this period</div>}</div>
              <div className="refund-summary"><span>Refund amount</span><b>{data ? amount.format(data.summary.refunds) : "—"} <small>source units</small></b></div>
            </article>

            <article className="panel channel-panel" title="Compares order counts and net sales for each sales channel in the selected period.">
              <div className="panel-heading"><div><div className="panel-kicker">SALES CHANNELS</div><h2>Channel mix <PanelHelp onClick={() => explainMetric("Channel mix", "Orders are grouped by their source channel. Each bar shows that channel's share of filtered orders. The amount below each bar is net sales for non-cancelled orders in source units.")}/></h2><p>Orders by origin channel</p></div><span className="customer-icon channel-icon"><Activity size={17}/></span></div>
              <div className="channel-list">{(data?.channel_mix ?? []).map((item, index) => {
            const share = data?.summary.orders ? item.orders / data.summary.orders * 100 : 0;
            return <div className="channel-item" key={item.label}><div className="channel-line"><span>{item.label}</span><b>{count.format(item.orders)}</b></div><div className="channel-track"><i className={`channel-fill channel-fill-${index + 1}`} style={{ width: `${share}%` }}/></div><small>{amount.format(item.sales)} source units</small></div>;
        })}{data && !data.channel_mix.length && <div className="empty-small">No channel orders for this filter</div>}</div>
            </article>
          </section>

          <section className="panel orders-panel" id="orders">
            <div className="panel-heading orders-heading"><div><div className="panel-kicker">ORDER ACTIVITY</div><h2>Recent orders</h2><p>Latest orders in this period · select a row for details</p></div><div className="order-table-actions"><label className="rows-control"><span>Show</span><span className="rows-select-wrap"><select aria-label="Number of recent orders to show" value={orderLimit} onChange={(event) => setOrderLimit(Number(event.target.value))}>{[10, 25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></span><span>rows</span></label><button className="button button-secondary table-action" onClick={exportOrders} disabled={!data}><Download size={14}/> Export rows</button></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>ORDER</th><th>CUSTOMER</th><th>COUNTRY</th><th>CHANNEL</th><th>STATUS</th><th>NET SALES</th><th>PAYMENT</th><th>SHIP TIME</th></tr></thead>
                <tbody>
                  {visibleOrders.map((order) => <tr className="order-row" key={order.order_id} title="Select this order to view its details" onClick={() => setDetail({ type: "order", order })}>
                    <td><button className="order-open-button" type="button" aria-label={`Open order ${order.order_id} details`} onClick={() => setDetail({ type: "order", order })}><b className="order-id">#{order.order_id}</b></button><small>{formatDate(order.order_date, { day: "2-digit", month: "short", year: "2-digit" })}</small></td>
                    <td><div className="customer-cell"><div className="avatar avatar-table">{order.customer_name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><span>{order.customer_name}</span></div></td>
                    <td><span className="region-cell"><MapPin size={12}/>{order.country}</span></td>
                    <td><span className="channel-chip">{order.channel}</span></td>
                    <td><StatusBadge status={order.status}/></td>
                    <td><b className="revenue-cell">{amount.format(order.sales)}</b></td>
                    <td><span className={`payment-state ${order.payment_status === "Captured" ? "captured" : order.payment_status === "Failed" ? "failed" : "no-payment"}`}><i />{order.payment_status}</span></td>
                    <td><span className={`delivery-cell ${order.ship_days == null ? "pending" : "delivered"}`}>{order.ship_days == null ? "Not shipped" : `${order.ship_days.toFixed(1)} days`}</span></td>
                  </tr>)}
                  {data && visibleOrders.length === 0 && <tr><td colSpan={8} className="no-results">No recent orders match “{query}”.</td></tr>}
                  {!data && <tr><td colSpan={8} className="no-results">Start the API to load orders from the source tables.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Showing <b>{visibleOrders.length}</b> orders · up to <b>{orderLimit}</b> recent rows loaded</span><span>Sales shown in source amount units</span></div>
          </section>

          {detail && <DetailDialog detail={detail} onClose={() => setDetail(null)}/>}

          <div className="coverage-note"><CircleHelp size={15}/><span>{data?.data_gaps.join(" ") ?? "Dashboard metrics use the supplied source tables."}</span></div>
          <footer className="page-footer"><span>OpsVista <b>·</b> Operations Intelligence Dashboard</span><span>SOURCE TABLES <i className="status-dot"/> {loading ? "LOADING" : data ? `${tableCount ?? "—"} CONNECTED` : "API OFFLINE"}</span></footer>
        </div>
      </main>
    </div>);
}
function csvCell(value) {
    // Escape CSV quotes and guard spreadsheet exports from formula-like text values.
    let text = String(value);
    if (/^[=+@\-]/.test(text))
        text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}
function FilterDropdown({ label, value, options, onChange, icon: Icon, searchable = false }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const dropdownRef = useRef(null);

    useEffect(() => {
        if (!open)
            return;
        // Close the menu when focus moves elsewhere or Escape is pressed.
        const closeOutside = (event) => {
            if (!dropdownRef.current?.contains(event.target))
                setOpen(false);
        };
        const closeOnEscape = (event) => {
            if (event.key === "Escape")
                setOpen(false);
        };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOutside);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [open]);

    const visibleOptions = options.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()));
    const menuId = `${label.toLowerCase()}-filter-options`;
    const pluralLabel = label === "Country" ? "countries" : `${label.toLowerCase()}s`;

    return (
        <div className={`filter-dropdown ${searchable ? "searchable" : ""} ${label === "Channel" ? "channel-control" : ""}`} ref={dropdownRef}>
            <button
                className="region-control filter-trigger"
                type="button"
                aria-label={`${label}: ${value}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => setOpen((current) => !current)}
            >
                <Icon size={15} aria-hidden="true"/>
                <span className="filter-label">{label}</span>
                <span className="filter-value">{value}</span>
                <ChevronDown size={13} className="select-chevron" aria-hidden="true"/>
            </button>
            {open && (
                <div className="filter-menu">
                    {searchable && (
                        <label className="filter-search">
                            <Search size={15} aria-hidden="true"/>
                            <input
                                autoFocus
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={`Search ${pluralLabel}`}
                                aria-label={`Search ${pluralLabel}`}
                            />
                        </label>
                    )}
                    <div className="filter-options" id={menuId} role="listbox" aria-label={label}>
                        {visibleOptions.map((option) => (
                            <button
                                key={option}
                                className="filter-option"
                                type="button"
                                role="option"
                                aria-selected={value === option}
                                onClick={() => {
                                    onChange(option);
                                    setQuery("");
                                    setOpen(false);
                                }}
                            >
                                <span>{option}</span>
                                {value === option && <Check size={15} aria-hidden="true"/>}
                            </button>
                        ))}
                        {visibleOptions.length === 0 && <p className="filter-empty">No matching {pluralLabel}.</p>}
                    </div>
                </div>
            )}
        </div>
    );
}

function PanelHelp({ onClick }) {
    return (
        <button
            className="panel-help-button"
            type="button"
            aria-label="Explain this dashboard panel"
            aria-haspopup="dialog"
            title="Click for an explanation"
            onClick={onClick}
        >
            <CircleHelp size={15}/>
        </button>
    );
}

function MetricCard({ title, value, description, onExplain, change, suffix = "%", goodWhenDown = false, footnote, icon, tone, loading }) {
    // Lower return rates are favorable; higher sales, order, and payment metrics are favorable.
    const positive = change === undefined ? null : goodWhenDown ? change <= 0 : change >= 0;
    const openWithKeyboard = (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onExplain(title, description);
        }
    };

    return (
        <article
            className="metric-card metric-card-interactive"
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-label={`${title}: ${value}. Click for an explanation.`}
            title={`Click for details: ${description}`}
            onClick={() => onExplain(title, description)}
            onKeyDown={openWithKeyboard}
        >
            <div className="metric-top">
                <span className="metric-title">{title}<CircleHelp size={14}/></span>
                <span className={`metric-icon ${tone}`}>{icon}</span>
            </div>
            <div className={`metric-value ${loading ? "loading-text" : ""}`}>{value}</div>
            <div className="metric-foot">
                <span className={`metric-change ${positive === null ? "plain" : positive ? "positive" : "negative"}`}>
                    {change === undefined ? <Activity size={12}/> : positive ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>}
                    {change === undefined ? "Source data" : signed(change, suffix)}
                </span>
                <span>{footnote}</span>
            </div>
        </article>
    );
}
function DetailDialog({ detail, onClose }) {
    useEffect(() => {
        const closeOnEscape = (event) => {
            if (event.key === "Escape")
                onClose();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [onClose]);

    const order = detail.type === "order" ? detail.order : null;
    const title = order ? `Order #${order.order_id}` : detail.title;

    return (
        <div className="detail-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
            <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
                <div className="detail-heading">
                    <div>
                        <div className="panel-kicker">{order ? "ORDER DETAILS" : "HOW TO READ THIS PANEL"}</div>
                        <h2 id="detail-title">{title}</h2>
                    </div>
                    <button className="detail-close" type="button" aria-label="Close details" title="Close details" onClick={onClose} autoFocus><X size={18}/>Close</button>
                </div>
                {order ? (
                    <dl className="detail-grid">
                        <div><dt>Customer</dt><dd>{order.customer_name}</dd></div>
                        <div><dt>Order date</dt><dd>{formatDate(order.order_date, { day: "numeric", month: "long", year: "numeric" })}</dd></div>
                        <div><dt>Country</dt><dd>{order.country}</dd></div>
                        <div><dt>Sales channel</dt><dd>{order.channel}</dd></div>
                        <div><dt>Order status</dt><dd><StatusBadge status={order.status}/></dd></div>
                        <div><dt>Payment status</dt><dd>{order.payment_status}</dd></div>
                        <div><dt>Net sales</dt><dd>{amount.format(order.sales)} source units</dd></div>
                        <div><dt>Shipping time</dt><dd>{order.ship_days == null ? "Not shipped" : `${order.ship_days.toFixed(1)} days`}</dd></div>
                        <div><dt>Return events</dt><dd>{count.format(order.return_events)}</dd></div>
                    </dl>
                ) : (
                    <p className="detail-description">{detail.description}</p>
                )}
                <p className="detail-hint">Press Escape or select Close to return to the dashboard.</p>
            </section>
        </div>
    );
}

function StatusBadge({ status }) {
    // Lowercase the source status only for the matching style class.
    return <span className={`status-badge ${status.toLowerCase()}`}><i />{status}</span>;
}
function InsightCard({ insight }) {
    const icon = insight.tone === "positive" ? <Check size={15}/> : insight.tone === "watch" ? <Clock3 size={15}/> : <Sparkles size={15}/>;
    return <article className={`insight-card ${insight.tone}`}><span className="insight-icon">{icon}</span><div><h3>{insight.title}</h3><p>{insight.detail}</p></div></article>;
}
function TrendTooltip({ active, payload }) {
    if (!active || !payload?.length)
        return null;
    const row = payload[0].payload;
    return <div className="chart-tooltip"><b>{formatDate(row.date, { weekday: "short", day: "numeric", month: "short" })}</b><span><i className="tooltip-dot revenue-dot"/> Net sales <strong>{amount.format(row.sales)} source units</strong></span><span><i className="tooltip-dot orders-dot"/> Orders <strong>{row.orders}</strong></span></div>;
}
function StatusTooltip({ active, payload }) {
    if (!active || !payload?.length)
        return null;
    return <div className="chart-tooltip"><b>{payload[0].payload.label}</b><span>Orders <strong>{count.format(payload[0].value)}</strong></span></div>;
}
function CategoryTooltip({ active, payload }) {
    if (!active || !payload?.length)
        return null;
    const row = payload[0].payload;
    return <div className="chart-tooltip"><b>{row.label}</b><span>Net sales <strong>{amount.format(row.sales)} source units</strong></span><span>Orders <strong>{count.format(row.orders)}</strong></span></div>;
}
export default App;
