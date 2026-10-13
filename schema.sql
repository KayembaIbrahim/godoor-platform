CREATE TABLE businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    lat REAL,
    lng REAL,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE bookings (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    service_type TEXT NOT NULL,
    booking_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL,
    total_amount REAL,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY (business_id) REFERENCES businesses(id)
);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER,
    mime_type TEXT,
    created_at TEXT,
    updated_at TEXT
);