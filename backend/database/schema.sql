-- DisasterGuard SQLite Database Schema
-- SIH 2026 Disaster Management Platform

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    identifier TEXT UNIQUE NOT NULL, -- Email for citizens; ID code (RT-2026-XXXX, CC-2026-XXXX) for teams/command
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('citizen', 'rescue', 'command')),
    name TEXT NOT NULL,
    department TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. RESCUE TEAMS
CREATE TABLE IF NOT EXISTS rescue_teams (
    id TEXT PRIMARY KEY, -- 'RT-2026-0001', etc.
    user_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE', 'ON_MISSION', 'STANDBY')),
    current_lat REAL,
    current_lng REAL,
    members INTEGER DEFAULT 4,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. SHELTERS
CREATE TABLE IF NOT EXISTS shelters (
    id TEXT PRIMARY KEY, -- 'SH-01', etc.
    name TEXT NOT NULL,
    address TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    total_beds INTEGER NOT NULL,
    available_beds INTEGER NOT NULL,
    medical_support TEXT DEFAULT 'Available',
    status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available', 'Limited', 'Full', 'Closed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. SOS REQUESTS
CREATE TABLE IF NOT EXISTS sos_requests (
    id TEXT PRIMARY KEY, -- 'SOS-2026-XXXX'
    citizen_id TEXT REFERENCES users(id),
    citizen_email TEXT NOT NULL,
    citizen_name TEXT NOT NULL,
    emergency_type TEXT NOT NULL,
    people_count INTEGER NOT NULL DEFAULT 1,
    medical BOOLEAN NOT NULL DEFAULT 0,
    description TEXT,
    location_name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('CRITICAL', 'HIGH', 'MODERATE', 'LOW')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ASSIGNED', 'DISPATCHED', 'ON_SCENE', 'RESCUED', 'COMPLETED', 'CANCELLED')),
    assigned_team_id TEXT REFERENCES rescue_teams(id),
    shelter_id TEXT REFERENCES shelters(id),
    rescued_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. SOS PERSON LEVEL ACCOUNTING
CREATE TABLE IF NOT EXISTS sos_person_records (
    id TEXT PRIMARY KEY,
    sos_id TEXT NOT NULL REFERENCES sos_requests(id) ON DELETE CASCADE,
    person_index INTEGER NOT NULL,
    condition TEXT NOT NULL DEFAULT 'Missing / Unaccounted' CHECK(condition IN ('Safe', 'Injured', 'Critical', 'Needs Medical Attention', 'Missing / Unaccounted')),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. MISSIONS
CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY, -- 'MIS-2026-XXXX'
    sos_id TEXT UNIQUE NOT NULL REFERENCES sos_requests(id),
    team_id TEXT NOT NULL REFERENCES rescue_teams(id),
    status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK(status IN ('ASSIGNED', 'DISPATCHED', 'ON_SCENE', 'RESCUED', 'COMPLETED', 'CANCELLED')),
    accepted_at DATETIME,
    dispatched_at DATETIME,
    on_scene_at DATETIME,
    rescued_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. INCIDENT REPORTS
CREATE TABLE IF NOT EXISTS incident_reports (
    id TEXT PRIMARY KEY, -- 'INC-2026-XXXX'
    citizen_id TEXT REFERENCES users(id),
    citizen_email TEXT,
    citizen_name TEXT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'Moderate' CHECK(severity IN ('Critical', 'High', 'Moderate', 'Low')),
    status TEXT NOT NULL DEFAULT 'REPORTED' CHECK(status IN ('REPORTED', 'OPEN', 'WORKING', 'RESOLVED')),
    description TEXT,
    location_name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. CITIZEN SUPPLY REQUESTS
CREATE TABLE IF NOT EXISTS supply_requests (
    id TEXT PRIMARY KEY, -- 'SR-2026-XXXX'
    citizen_id TEXT REFERENCES users(id),
    citizen_email TEXT NOT NULL,
    citizen_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('Food', 'Water', 'Medicine', 'Blankets', 'Food & Water')),
    details TEXT,
    people_count INTEGER DEFAULT 1,
    urgency TEXT DEFAULT 'Normal',
    location_name TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'OUT_FOR_DELIVERY', 'DELIVERED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. RESOURCES INVENTORY
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    available INTEGER NOT NULL,
    total INTEGER NOT NULL,
    unit TEXT NOT NULL
);

-- 10. RESOURCE REQUESTS FROM RESCUE TEAMS
CREATE TABLE IF NOT EXISTS resource_requests (
    id TEXT PRIMARY KEY, -- 'RES-2026-XXXX'
    team_id TEXT NOT NULL REFERENCES rescue_teams(id),
    resource_id TEXT NOT NULL REFERENCES resources(id),
    quantity INTEGER NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'APPROVED', 'DENIED', 'FULFILLED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. RISK PREDICTIONS
CREATE TABLE IF NOT EXISTS risk_predictions (
    id TEXT PRIMARY KEY,
    disaster_type TEXT NOT NULL,
    rainfall REAL NOT NULL,
    river REAL NOT NULL,
    soil REAL NOT NULL,
    drainage REAL NOT NULL,
    history REAL NOT NULL,
    score INTEGER NOT NULL,
    level TEXT NOT NULL,
    affected_estimate INTEGER,
    areas_json TEXT NOT NULL,
    published_by TEXT REFERENCES users(id),
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 12. EMERGENCY ALERTS (Official Command Centre Broadcasts)
CREATE TABLE IF NOT EXISTS emergency_alerts (
    id TEXT PRIMARY KEY, -- 'ALT-2026-XXXX'
    alert_type TEXT NOT NULL CHECK(alert_type IN ('FLOOD_WARNING', 'FLASH_FLOOD', 'HEAVY_RAINFALL', 'ROAD_CLOSURE', 'EVACUATION', 'SHELTER_UPDATE', 'GENERAL_EMERGENCY')),
    severity TEXT NOT NULL CHECK(severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    affected_areas TEXT NOT NULL,
    recommended_action TEXT NOT NULL,
    target_audience TEXT NOT NULL CHECK(target_audience IN ('CITIZENS', 'RESCUE_TEAMS', 'BOTH')),
    created_by TEXT NOT NULL REFERENCES users(id),
    is_active BOOLEAN NOT NULL DEFAULT 1,
    deactivated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_user_id TEXT REFERENCES users(id),
    target_role TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    icon TEXT DEFAULT '📢',
    is_read BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_requests(status);
CREATE INDEX IF NOT EXISTS idx_sos_citizen ON sos_requests(citizen_email);
CREATE INDEX IF NOT EXISTS idx_missions_team ON missions(team_id);
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON emergency_alerts(is_active);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incident_reports(status);
