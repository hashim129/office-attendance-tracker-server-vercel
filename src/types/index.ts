export type Role = 'admin' | 'employee' | 'accounts' | 'ceo';

export interface CeoComment {
  id: string;
  employeeId: string;
  employeeName: string;
  fromName: string;
  fromRole: Role;
  message: string;
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO
  isRead?: boolean;
}

export type AttendanceStatus = 'present' | 'late' | 'half_day' | 'on_leave' | 'absent';

export type BreakType = 'lunch' | 'coffee' | 'short_break';

export interface BreakRecord {
  id: string;
  start: string; // HH:mm:ss or ISO
  end?: string;   // HH:mm:ss or ISO
  type: BreakType;
  durationMinutes?: number;
}

export interface VerificationInfo {
  verified: boolean;
  verifiedAt?: string;
  verifiedByName?: string;
  verifiedById?: string;
  note?: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  day: string;  // Monday, Tuesday, etc.
  timeIn: string; // HH:mm:ss
  timeOut?: string; // HH:mm:ss
  breaks: BreakRecord[];
  totalWorkedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
  notes?: string;
  /** Every punch-in / punch-out / extra remark, kept permanently (the `notes` field only shows the latest) */
  notesLog?: { id: string; at: string; kind: 'punch_in' | 'punch_out' | 'note' | 'admin_note' | 'system'; by: string; text: string }[];
  isManuallyAdjusted?: boolean;
  adjustmentNote?: string;
  adjustedBy?: string;
  clientIp?: string;
  deviceId?: string;
  deviceName?: string;
  isDeviceMismatch?: boolean;
  deviceMismatchReason?: string;
  isAutoPunchedOut?: boolean;
  autoPunchOutReason?: 'midnight' | 'shift_end_2h' | 'inactivity_2h';
  /** When the employee last confirmed "I'm still working" (ISO) */
  workConfirmedAt?: string;
  /** The time the system actually punched out (HH:mm:ss) — the counted punch-out is earlier when time was unverified */
  autoOutAt?: string;
  /** Minutes between the last verified moment and the system punch-out; never counted as worked time or overtime */
  unverifiedMinutes?: number;
  /** Where a phone punch was made (only when location checks are on) */
  punchLocations?: { in?: PunchLocation; out?: PunchLocation };
  connectionStatus?: 'online' | 'no_internet';
  lastHeartbeatAt?: string;
  lastActivityAt?: string;
  disconnectedAt?: string;
  heartbeatSource?: 'web-client' | 'windows-agent' | 'kiosk';
  heartbeatDeviceId?: string;
  heartbeatIntervalMs?: number;
  monitoringPaused?: boolean;
  clearTimeOut?: boolean;
  adminVerification?: VerificationInfo;
  accountsVerification?: VerificationInfo;
  recordUpdatedAt?: string;
  lastEditedByRole?: Role;
  actorAction?: 'time_in' | 'time_out' | 'start_break' | 'end_break' | 'update_note' | 'verify' | 'admin_edit' | 'auto_close';
  adminOverrideAt?: string;
  adminKeepOpen?: boolean;
  /** 'wfh' = punched in away from the office network (counted separately). Missing = office. */
  workMode?: 'office' | 'wfh';
  wfhReason?: string;
}

export interface ShiftSchedule {
  id: string;
  name: string;
  startTime: string; // "09:00"
  endTime: string;   // "17:00"
  workDays: number[]; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 0=Sun
  graceMinutes: number; // e.g. 15 mins
  expectedHours: number; // e.g. 8
  color: string;
  isActive?: boolean; // When false, shift cannot be assigned or selected
  isNoRestriction?: boolean; // When true, no shift timing or late arrival restrictions apply
}

export interface DeviceChangeRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  requestedDeviceId: string;
  requestedDeviceName: string;
  previousDeviceId?: string;
  previousDeviceName?: string;
  requestedAt: string; // ISO
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface DeviceHistoryEntry {
  id: string;
  action: 'bound' | 'changed' | 'reset';
  deviceId?: string;
  deviceName?: string;
  changedBy: string; // "Admin Approval", "Admin Reset", etc.
  changedAt: string; // ISO
  reason?: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  role: Role;
  pin: string; // Only present on the old local server. In the cloud setup this is always '' (the server keeps a scrambled copy).
  hasPin?: boolean; // A PIN is set (cloud setup)
  pinLength?: number; // Length of the PIN (cloud setup), lets the kiosk know when to check
  department: string;
  designation: string;
  shiftId: string;
  phone: string;
  hourlyRate: number;
  isActive: boolean;
  joinedDate: string;
  avatarSeed?: string;
  crmCustomerAccess?: boolean; // (no longer used: every employee has Customers, see own + shared)
  customerPortalAccess?: boolean; // Admin-selected: may see the Customer Portal (Beta) link and its live queries
  salesAccess?: boolean; // Admin-selected: may open the Sales section
  liveDashboardAccess?: boolean; // Admin-selected: may open the Live Dashboard
  teamPresenceAccess?: boolean; // Admin-selected: may view Team Presence; hidden for employees by default
  mediaTeam?: boolean; // Admin-selected: member of the Media Team (Posting Calendar)
  leaderboardAccess?: boolean; // Admin-selected: may see the sales leaderboard
  payablesAccess?: boolean; // Admin-selected: may see the payables-due calendar
  salesTeam?: '' | 'B2C' | 'B2B'; // Sales team the employee belongs to (set by an administrator)
  salesTeamHead?: boolean; // Heads of the B2C / B2B team also see the customers of their whole team
  birthday?: string; // YYYY-MM-DD, optional (used for birthday cards)
  avatarAppearance?: Record<string,string>;
  gameCharacterId?: string; // Employee Universe Beta avatar selection
  gamePetId?: string; // Employee Universe Beta optional companion
  isSuperAdmin?: boolean;
  featureAccess?: Record<string, boolean>;
  allowWorkFromHome?: boolean; // When true, attendance punch in/out has NO IP restriction
  faceEnrollRequired?: boolean; // Admin: this person must set up their face right after signing in, before using the app
  locationCheck?: boolean; // Admin: check this person's phone location when punching in / out
  registeredDeviceId?: string; // Persistent device UUID bound to this employee
  registeredDeviceName?: string; // e.g. "Ahmed's Samsung Galaxy A54 (Android)"
  registeredAt?: string;
  deviceBoundApprovedBy?: string;
  deviceBoundApprovedAt?: string;
  pendingDeviceRequest?: DeviceChangeRequest;
  deviceChangeHistory?: DeviceHistoryEntry[];
  recordUpdatedAt?: string;
  lastEditedByRole?: Role;
}

export type LeaveType = 'annual' | 'sick' | 'casual' | 'unpaid' | 'remote_work';

export type LeaveStatus = 'pending' | 'rejected' | 'approved';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  appliedAt: string; // ISO
  reviewedBy?: string;
  reviewNote?: string;
  recordUpdatedAt?: string;
  lastEditedByRole?: Role;
}

export interface OfficeSettings {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  workDays: number[];
  defaultShiftId: string;
  overtimeThresholdMinutes: number; // default 480 mins (8h)
  overtimeRateMultiplier: number; // 1.5x
  kioskPinRequired: boolean;
  allowSelfClockOut: boolean;
  serverHostName: string;
  serverPort: number;
  enforceOfficeIpLock?: boolean;
  allowedOfficeIps?: { ip: string; label: string; addedAt: string }[];
  allowedOfficeIsps?: { ispName: string; label: string; addedAt: string }[];
  allowAdminBypassIpLock?: boolean;
  faceScanPunchEnabled?: boolean; // High security: punches need a live face scan (off by default)
  blockScreenshots?: boolean;
  phoneApprovalForAdmins?: boolean; // default on: Admin/CEO/Accounts approve computer sign-ins in the phone app
  staffSignInOfficeOnly?: boolean; // employees sign in on computers only from the office network // Phone app: no screenshots / screen recording on invoices, sales, receipts, purchases, payment tree
  faceEnrollRequired?: boolean; // Everyone must enroll their own face (through their own login) before punching
  locationCheckEnabled?: boolean; // Phone punches (app or mobile browser) record the location, for everyone
  officeLat?: number; // Office pin for the location check (optional)
  officeLng?: number;
  officeRadiusM?: number; // How far from the office pin a phone punch may be (metres)
  faceScanAllowUnenrolled?: boolean; // Staff without an enrolled face may still punch (default true)
  enforceDeviceBinding?: boolean; // Anti-proxy punching: 1 device per employee
  allowAdminBypassDeviceBinding?: boolean;
  allowKioskPunchWithoutDevice?: boolean;
  allowAutoStartPunch?: boolean; // Allows Windows .bat startup auto check-in
  enableDisconnectStatusTracking?: boolean; // Show "No Internet (In)" when active device loses internet
  autoPunchOutOnInactiveHours?: number; // Auto punch out after N hours of device inactivity (default 2, 0=off)
  disconnectThresholdMinutes?: number; // Minutes without heartbeat before marking "No Internet" (default 3)
  customerPortalBetaEnabled?: boolean; // Beta toggle for public /customers portal & invoice Visa tracking (default false)
  redesignedUiBetaEnabled?: boolean; // Admin-approved, reversible redesigned workspace rollout (default false)
  headerBetaEnabled?: boolean; // Independent administrator-controlled top header redesign (default false)
  employeeUniverseBetaEnabled?: boolean; // Optional avatar + team chat experience (default false)
  settingsUpdatedAt?: string;
}

export type AppMode = 'desktop' | 'kiosk';

export type ActiveDesktopTab =
  | 'clock'
  | 'employee-profile'
  | 'my-attendance'
  | 'team-attendance'
  | 'insights'
  | 'employees'
  | 'shifts'
  | 'leaves'
  | 'reports'
  | 'settings'
  | 'crm-customers'
  | 'crm-tasks'
  | 'crm-meetings'
  | 'crm-inventory'
  | 'crm-sales'
  | 'crm-purchases'
  | 'crm-invoices'
  | 'crm-receipts'
  | 'crm-portal'
  | 'crm-notifications'
  | 'crm-payment-tree'
  | 'crm-media'
  | 'crm-profit'
  | 'live-dashboard'
  | 'superadmin';

export interface PunchLocation { lat: number; lng: number; acc?: number; dist?: number; at?: string; outside?: boolean }
