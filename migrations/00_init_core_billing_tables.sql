-- Migration: Initialize Core Billing Tables
-- Date: 2026-01-18
-- Description: Create core tables for billing system (Packages, Customers, Invoices, Payments, Expenses)
-- These are originally defined in billing.js but needed here for fresh installation via migrations

-- Table: packages
CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    speed TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    tax_rate DECIMAL(5,2) DEFAULT 11.00,
    description TEXT,
    pppoe_profile TEXT DEFAULT 'default',
    image_filename TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table: customers
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    whatsapp_lid TEXT UNIQUE,
    pppoe_username TEXT,
    email TEXT,
    address TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    package_id INTEGER,
    odp_id INTEGER,
    pppoe_profile TEXT,
    status TEXT DEFAULT 'active',
    auto_suspension BOOLEAN DEFAULT 1,
    billing_day INTEGER DEFAULT 15,
    join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Cable connection fields
    cable_type TEXT,
    cable_length INTEGER,
    port_number INTEGER,
    cable_status TEXT DEFAULT 'connected',
    cable_notes TEXT,
    FOREIGN KEY (package_id) REFERENCES packages (id)
);

-- Table: invoices
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    due_date DATE NOT NULL,
    status TEXT DEFAULT 'unpaid',
    payment_status TEXT DEFAULT 'pending',
    payment_date DATETIME,
    payment_method TEXT,
    payment_gateway TEXT,
    payment_token TEXT,
    payment_url TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers (id),
    FOREIGN KEY (package_id) REFERENCES packages (id)
);

-- Table: payments
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_method TEXT NOT NULL,
    reference_number TEXT,
    notes TEXT,
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
);

-- Table: payment_gateway_transactions
CREATE TABLE IF NOT EXISTS payment_gateway_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    gateway TEXT NOT NULL,
    order_id TEXT NOT NULL,
    payment_url TEXT,
    token TEXT,
    amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_type TEXT,
    fraud_status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
);

-- Table: expenses
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    expense_date DATE NOT NULL,
    payment_method TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_package ON customers(package_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
