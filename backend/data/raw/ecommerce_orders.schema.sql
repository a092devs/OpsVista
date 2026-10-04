-- OpsVista source model for the supplied garden retailer exports.
-- The Parquet files were converted to CSV without changing their source fields.

CREATE TABLE categories (
  category_id INTEGER NOT NULL,
  category_name VARCHAR NOT NULL,
  parent_category_id INTEGER,
  PRIMARY KEY (category_id)
);

CREATE TABLE customers (
  customer_id INTEGER NOT NULL,
  first_name VARCHAR NOT NULL,
  last_name VARCHAR NOT NULL,
  email VARCHAR NOT NULL,
  city VARCHAR NOT NULL,
  country VARCHAR NOT NULL,
  signup_date DATE NOT NULL,
  loyalty_tier VARCHAR,
  marketing_opt_in BOOLEAN NOT NULL,
  PRIMARY KEY (customer_id)
);

CREATE TABLE products (
  product_id INTEGER NOT NULL,
  sku VARCHAR NOT NULL,
  product_name VARCHAR NOT NULL,
  category_id INTEGER NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL,
  discontinued_at DATE,
  PRIMARY KEY (product_id),
  FOREIGN KEY (category_id) REFERENCES categories (category_id)
);

CREATE TABLE orders (
  order_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  ordered_at TIMESTAMP NOT NULL,
  shipped_at TIMESTAMP,
  status VARCHAR NOT NULL,
  channel VARCHAR NOT NULL,
  shipping_country VARCHAR NOT NULL,
  coupon_code VARCHAR,
  PRIMARY KEY (order_id),
  FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
);

CREATE TABLE order_items (
  order_item_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount_amount DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (order_item_id),
  FOREIGN KEY (order_id) REFERENCES orders (order_id),
  FOREIGN KEY (product_id) REFERENCES products (product_id)
);

CREATE TABLE payments (
  payment_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  method VARCHAR NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  paid_at TIMESTAMP NOT NULL,
  status VARCHAR NOT NULL,
  failure_reason VARCHAR,
  PRIMARY KEY (payment_id),
  FOREIGN KEY (order_id) REFERENCES orders (order_id)
);

CREATE TABLE returns (
  return_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  returned_at TIMESTAMP NOT NULL,
  reason VARCHAR NOT NULL,
  refund_amount DECIMAL(12,2) NOT NULL,
  restocked BOOLEAN NOT NULL,
  PRIMARY KEY (return_id),
  FOREIGN KEY (order_item_id) REFERENCES order_items (order_item_id)
);

COPY categories FROM 'categories.csv' (HEADER, DELIMITER ',');
COPY customers FROM 'customers.csv' (HEADER, DELIMITER ',');
COPY products FROM 'products.csv' (HEADER, DELIMITER ',');
COPY orders FROM 'orders.csv' (HEADER, DELIMITER ',');
COPY order_items FROM 'order_items.csv' (HEADER, DELIMITER ',');
COPY payments FROM 'payments.csv' (HEADER, DELIMITER ',');
COPY returns FROM 'returns.csv' (HEADER, DELIMITER ',');
