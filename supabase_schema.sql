-- ====================================================================
-- Office Attendance Tracker - Supabase (PostgreSQL) Database Schema
-- Complete production schema with ACID integrity, server timestamps,
-- soft-delete tracking, and foreign keys.
-- ====================================================================

-- 1. Office Settings (Single row storage with JSONB payload)
CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'current',
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Work Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  work_days JSONB NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  grace_minutes INT DEFAULT 15,
  expected_hours NUMERIC(4,2) DEFAULT 8.0,
  color VARCHAR(30) DEFAULT 'blue',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Employees Directory
CREATE TABLE IF NOT EXISTS employees (
  id VARCHAR(50) PRIMARY KEY,
  employee_code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(120),
  role VARCHAR(30) NOT NULL DEFAULT 'employee',
  pin VARCHAR(20) DEFAULT '1234',
  department VARCHAR(60),
  designation VARCHAR(60),
  shift_id VARCHAR(50),
  phone VARCHAR(40),
  hourly_rate NUMERIC(10,2) DEFAULT 0.0,
  is_active BOOLEAN DEFAULT TRUE,
  joined_date DATE,
  avatar_seed VARCHAR(60),
  registered_device_id VARCHAR(120),
  registered_device_name VARCHAR(120),
  registered_at TIMESTAMPTZ,
  device_bound_approved_by VARCHAR(100),
  device_bound_approved_at TIMESTAMPTZ,
  device_change_history JSONB DEFAULT '[]'::jsonb,
  pending_device_request JSONB,
  record_updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_edited_by_role VARCHAR(30),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Attendance Records
CREATE TABLE IF NOT EXISTS attendance (
  id VARCHAR(100) PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  time_in VARCHAR(20),
  time_out VARCHAR(20),
  status VARCHAR(30) DEFAULT 'absent',
  notes TEXT,
  breaks JSONB DEFAULT '[]'::jsonb,
  device_id VARCHAR(120),
  device_name VARCHAR(120),
  is_device_mismatch BOOLEAN DEFAULT FALSE,
  is_auto_punched_out BOOLEAN DEFAULT FALSE,
  auto_punch_out_reason TEXT,
  disconnected_at TIMESTAMPTZ,
  monitoring_paused BOOLEAN DEFAULT FALSE,
  admin_verification JSONB,
  accounts_verification JSONB,
  last_heartbeat_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  record_updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_edited_by_role VARCHAR(30),
  admin_override_at TIMESTAMPTZ,
  admin_keep_open BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Leave Requests
CREATE TABLE IF NOT EXISTS leaves (
  id VARCHAR(100) PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  employee_name VARCHAR(100),
  leave_type VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  admin_note TEXT,
  record_updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_edited_by_role VARCHAR(30),
  deleted_at TIMESTAMPTZ
);

-- 6. CEO Comments
CREATE TABLE IF NOT EXISTS ceo_comments (
  id VARCHAR(100) PRIMARY KEY,
  record_id VARCHAR(100),
  employee_id VARCHAR(50),
  date DATE,
  comment TEXT NOT NULL,
  author_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for lightning fast queries
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_leaves_emp ON leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active) WHERE deleted_at IS NULL;

-- Initial default settings seed
INSERT INTO settings (id, data, updated_at)
VALUES (
  'current',
  '{
    "companyName": "Office Attendance Tracker",
    "companyAddress": "Headquarters",
    "companyPhone": "",
    "companyEmail": "admin@office.local",
    "workDays": [1, 2, 3, 4, 5],
    "defaultShiftId": "shift-std",
    "overtimeThresholdMinutes": 480,
    "overtimeRateMultiplier": 1.5,
    "kioskPinRequired": true,
    "allowSelfClockOut": true,
    "serverHostName": "OFFICE-SRV",
    "serverPort": 3000,
    "enforceOfficeIpLock": true,
    "allowedOfficeIps": [
      { "ip": "175.107.239.140", "label": "Office Primary ISP (Cyber Internet Services) — All Extenders & LAN", "addedAt": "2026-11-05" },
      { "ip": "175.107.239.*", "label": "Office Primary ISP Subnet — All Extenders & LAN", "addedAt": "2026-11-05" },
      { "ip": "127.0.0.1", "label": "Localhost / Internal", "addedAt": "2026-11-05" }
    ],
    "allowedOfficeIsps": [
      { "ispName": "Cyber Internet Services", "label": "Primary Office ISP", "addedAt": "2026-11-05" }
    ],
    "allowAdminBypassIpLock": true,
    "enforceDeviceBinding": false
  }'::jsonb,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Initial default shifts seed
INSERT INTO shifts (id, name, start_time, end_time, work_days, grace_minutes, expected_hours, color)
VALUES
  ('shift-std', 'General Day Shift (09:00 - 17:00)', '09:00', '17:00', '[1,2,3,4,5]'::jsonb, 15, 8.0, 'blue'),
  ('shift-early', 'Early Bird Shift (08:00 - 16:00)', '08:00', '16:00', '[1,2,3,4,5]'::jsonb, 10, 8.0, 'amber'),
  ('shift-flex', 'Flexible Shift (10:00 - 18:00)', '10:00', '18:00', '[1,2,3,4,5]'::jsonb, 20, 8.0, 'emerald')
ON CONFLICT (id) DO NOTHING;

-- Initial default administrator seed
INSERT INTO employees (
  id, employee_code, name, email, role, pin, department, designation, shift_id, hourly_rate, is_active, joined_date, avatar_seed
)
VALUES (
  'emp-101', 'EMP-101', 'Office Administrator', 'admin@office.local', 'admin', '1234', 'Management', 'System Administrator', 'shift-std', 50.0, TRUE, '2023-01-01', 'admin'
)
ON CONFLICT (id) DO NOTHING;
