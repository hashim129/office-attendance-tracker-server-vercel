import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Edit2,
  Trash2,
  Search,
  KeyRound,
  Shield,
  Phone,
  Mail,
  Building,
  ShieldCheck,
  Terminal,
  FileText,
  Home,
  ScanFace,
} from 'lucide-react';
import { Employee, Role, ShiftSchedule, AttendanceRecord } from '../../types';
import { Modal } from '../common/Modal';
import { Switch } from '../common/Switch';
import { adminSetPin } from '../../lib/pinAuth';
import { flushPendingCloudWrites } from '../../lib/storage';
import { FaceScanModal, FaceScanMode } from '../common/FaceScanModal';
import {
  downloadWindowsBatFile,
  generateEmployeeAutoStartBat,
  generatePortalLauncherBat,
} from '../../lib/autoStartScript';

interface EmployeesDirectoryTabProps {
  employees: Employee[];
  shifts: ShiftSchedule[];
  records?: AttendanceRecord[];
  onAddEmployee: (emp: Omit<Employee, 'id'>) => Employee | void;
  onUpdateEmployee: (emp: Employee) => void;
  onDeleteEmployee: (empId: string) => void;
  onOpenPrintModal?: (employee: Employee | null, filteredRecords: AttendanceRecord[]) => void;
  currentUserId: string;
  companyName?: string;
  allowAutoStartPunch?: boolean;
  faceEnrolledIds?: string[];
  onFaceChanged?: () => void;
}

export const EmployeesDirectoryTab: React.FC<EmployeesDirectoryTabProps> = ({
  employees,
  shifts,
  records = [],
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  onOpenPrintModal,
  currentUserId,
  companyName = 'Office Attendance Tracker',
  allowAutoStartPunch = false,
  faceEnrolledIds = [],
  onFaceChanged,
}) => {
  const [faceModal, setFaceModal] = useState<{ mode: FaceScanMode; emp: Employee } | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [deletingEmp, setDeletingEmp] = useState<Employee | null>(null);

  const firstActiveShift = shifts.find((s) => s.isActive !== false) || shifts[0];

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    employeeCode: '',
    email: '',
    role: 'employee' as Role,
    pin: '',
    department: 'Engineering',
    designation: '',
    shiftId: firstActiveShift?.id || '',
    phone: '',
    hourlyRate: 35,
    isActive: true,
    allowWorkFromHome: false,
    salesAccess: false,
    customerPortalAccess: false,
    liveDashboardAccess: false,
    leaderboardAccess: false,
    payablesAccess: false,
    birthday: '',
  });

  const departments = Array.from(new Set(employees.map((e) => e.department))).sort();
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  const filteredEmployees = employees.filter((emp) => {
    if (selectedDept !== 'all' && emp.department !== selectedDept) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = emp.name.toLowerCase().includes(q);
      const matchCode = emp.employeeCode.toLowerCase().includes(q);
      const matchEmail = emp.email.toLowerCase().includes(q);
      const matchDesignation = emp.designation.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchEmail && !matchDesignation) return false;
    }
    return true;
  });

  const handleOpenAddModal = () => {
    // Generate next employee code
    const nextCodeNum = employees.length + 101;
    setFormData({
      name: '',
      employeeCode: `EMP-${nextCodeNum}`,
      email: '',
      role: 'employee',
      pin: Math.floor(1000 + Math.random() * 9000).toString(),
      department: 'Engineering',
      designation: '',
      shiftId: firstActiveShift?.id || '',
      phone: '+1 (555) 000-0000',
      hourlyRate: 38,
      isActive: true,
      allowWorkFromHome: false,
      salesAccess: false,
      customerPortalAccess: false,
      liveDashboardAccess: false,
      leaderboardAccess: false,
      payablesAccess: false,
      birthday: '',
    });
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (emp: Employee) => {
    setEditingEmp(emp);
    setFormData({
      name: emp.name,
      employeeCode: emp.employeeCode,
      email: emp.email,
      role: emp.role,
      pin: emp.pin, // cloud setup: empty = keep the current PIN
      department: emp.department,
      designation: emp.designation,
      shiftId: emp.shiftId,
      phone: emp.phone,
      hourlyRate: emp.hourlyRate,
      isActive: emp.isActive,
      allowWorkFromHome: Boolean(emp.allowWorkFromHome),
      salesAccess: Boolean(emp.salesAccess),
      customerPortalAccess: Boolean(emp.customerPortalAccess),
      liveDashboardAccess: Boolean(emp.liveDashboardAccess),
      leaderboardAccess: Boolean(emp.leaderboardAccess),
      payablesAccess: Boolean(emp.payablesAccess),
      birthday: emp.birthday || '',
    });
  };

  // Cloud setup: PINs live only on the server, so they are saved with a separate, checked request.
  const cloudPins = employees.some((e) => e.hasPin && !e.pin);

  const savePinOnServer = async (employeeId: string, pin: string) => {
    await flushPendingCloudWrites(); // make sure the employee row exists first
    const result = await adminSetPin(employeeId, pin);
    if (!result.ok) {
      alert(`The employee was saved, but the PIN was not: ${result.error}\nOpen the employee and set the PIN again.`);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.email.trim()) return;

    const created = onAddEmployee({
      ...formData,
      pin: cloudPins ? '' : formData.pin,
      joinedDate: new Date().toISOString().split('T')[0],
    });
    if (cloudPins && created && formData.pin.trim()) void savePinOnServer(created.id, formData.pin.trim());
    setIsAddModalOpen(false);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;

    onUpdateEmployee({
      ...editingEmp,
      ...formData,
      pin: cloudPins ? '' : formData.pin,
    });
    if (cloudPins && formData.pin.trim()) void savePinOnServer(editingEmp.id, formData.pin.trim());
    setEditingEmp(null);
  };

  const handleConfirmDelete = () => {
    if (!deletingEmp) return;
    if (deletingEmp.id === currentUserId) {
      alert('You cannot delete your own active administrator account.');
      return;
    }
    if (deletingEmp.role === 'admin' && !employees.some((e) => e.id !== deletingEmp.id && e.role === 'admin' && e.isActive !== false)) {
      alert('At least one active administrator must remain.');
      return;
    }
    onDeleteEmployee(deletingEmp.id);
    setDeletingEmp(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <span>Staff Directory & Employees</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage company personnel, shifts, roles, security PINs, and access permissions
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add New Employee</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[260px] flex-1 max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, code, email, designation..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Department:</span>
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="all">All Departments ({employees.length})</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Employees Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredEmployees.map((emp) => {
          const shift = shiftMap.get(emp.shiftId) || shifts[0];
          return (
            <div
              key={emp.id}
              className={`bg-white dark:bg-slate-900 rounded-xl p-5 border shadow-xs transition-all flex flex-col justify-between ${
                emp.isActive === false
                  ? 'border-rose-200 dark:border-rose-900/60 bg-slate-50 dark:bg-slate-900/60'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div>
                {/* Header: Name, Code & Role */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-sm">
                      {emp.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <span>{emp.name}</span>
                        {emp.isActive === false && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">Disabled</span>
                        )}
                      </h3>
                      <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {emp.employeeCode}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {emp.salesAccess && !['admin', 'accounts', 'ceo'].includes(emp.role) && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-950/70 dark:text-violet-300 border border-violet-200 dark:border-violet-900">Sales access</span>
                    )}
                    {emp.customerPortalAccess && emp.role !== 'admin' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border border-sky-200 dark:border-sky-900">Customer Portal</span>
                    )}
                    {emp.allowWorkFromHome && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/60 inline-flex items-center gap-1">
                        <Home className="w-2.5 h-2.5" />
                        <span>WFH Allowed</span>
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        emp.role === 'admin'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                          : emp.role === 'ceo'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-black'
                          : emp.role === 'accounts'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                      }`}
                    >
                      {emp.role === 'ceo' ? 'CEO' : emp.role === 'accounts' ? 'Accounts' : emp.role}
                    </span>
                  </div>
                </div>

                {/* Details */}
                <div className="mt-4 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-2">
                    <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {emp.designation} ({emp.department})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate text-slate-500">{emp.email}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-slate-500">{emp.phone}</span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                    <span className="text-slate-500">Shift:</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <span>{shift?.name || 'Standard'}</span>
                      {shift?.isNoRestriction && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                          24/7 No Restriction
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 block">
                        {emp.isActive === false ? 'Profile disabled' : 'Profile enabled'}
                      </span>
                      <span className="text-slate-500 text-[10px]">
                        {emp.id === currentUserId
                          ? 'You cannot disable your own profile'
                          : emp.isActive === false
                          ? 'Cannot sign in or punch'
                          : 'Can sign in and punch'}
                      </span>
                    </div>
                    <Switch
                      label={`${emp.isActive === false ? 'Enable' : 'Disable'} profile of ${emp.name}`}
                      checked={emp.isActive !== false}
                      disabled={emp.id === currentUserId}
                      onChange={(next) => {
                        if (!next && !window.confirm(`Disable ${emp.name}'s profile? They will be signed out and cannot sign in or punch until you enable it again.`)) return;
                        onUpdateEmployee({ ...emp, isActive: next });
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Portal PIN / Pass:</span>
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      {emp.pin || (emp.hasPin ? '•••• (hidden)' : 'not set')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFaceModal({ mode: 'enroll', emp })}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 dark:text-violet-300 dark:bg-violet-950/50 dark:hover:bg-violet-900/50 border border-violet-200 dark:border-violet-800 transition-colors cursor-pointer"
                  title={`Enroll or update the face used for face scan punch (${emp.name})`}
                >
                  <ScanFace className="w-3 h-3" />
                  <span>{faceEnrolledIds.includes(emp.id) ? 'Re-enroll face' : 'Enroll face'}</span>
                </button>
                {faceEnrolledIds.includes(emp.id) && (
                  <button
                    type="button"
                    onClick={() => setFaceModal({ mode: 'remove', emp })}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 dark:text-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                    title={`Remove the enrolled face of ${emp.name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Remove face</span>
                  </button>
                )}

                {onOpenPrintModal && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenPrintModal(
                        emp,
                        records.filter((r) => r.employeeId === emp.id)
                      )
                    }
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                    title={`Preview & download official PDF timesheet for ${emp.name}`}
                  >
                    <FileText className="w-3 h-3" />
                    <span>Timesheet PDF</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={async () => {
                    const appUrl =
                      typeof window !== 'undefined'
                        ? window.location.origin
                        : 'https://office-attendance-tracker-server-ve.vercel.app';
                    if (!allowAutoStartPunch) {
                      const { filename, content } = generatePortalLauncherBat({
                        appUrl,
                        companyName,
                        employeeCode: emp.employeeCode,
                        employeeName: emp.name,
                      });
                      downloadWindowsBatFile(filename, content);
                      return;
                    }
                    const { filename, content } = await generateEmployeeAutoStartBat({
                      employee: emp,
                      appUrl,
                      companyName,
                    });
                    downloadWindowsBatFile(filename, content);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                  title={
                    allowAutoStartPunch
                      ? 'Download Windows startup auto check-in .bat app for this employee'
                      : 'Download Windows startup launcher (.bat) pre-selected with this Employee ID for manual PIN & punch'
                  }
                >
                  <Terminal className="w-3 h-3" />
                  <span>Auto-Start .bat</span>
                </button>

                <button
                  onClick={() => handleOpenEditModal(emp)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>

                <button
                  onClick={() => setDeletingEmp(emp)}
                  disabled={emp.id === currentUserId}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    emp.id === currentUserId
                      ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                      : 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer'
                  }`}
                  title={emp.id === currentUserId ? 'Cannot delete logged in user' : 'Remove employee'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Employee Modal */}
      {(isAddModalOpen || editingEmp) && (
        <Modal
          isOpen={isAddModalOpen || !!editingEmp}
          onClose={() => {
            setIsAddModalOpen(false);
            setEditingEmp(null);
          }}
          title={editingEmp ? `Edit Staff Member: ${editingEmp.name}` : 'Add New Employee'}
          subtitle="Configure employee credentials, security PIN, and assigned office shift"
          maxWidth="lg"
        >
          <form onSubmit={editingEmp ? handleEditSubmit : handleAddSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Alex Henderson"
                  required
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Employee ID Code
                </label>
                <input
                  type="text"
                  value={formData.employeeCode}
                  onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value })}
                  placeholder="EMP-109"
                  required
                  className="w-full text-xs font-mono px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Work Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="name@office.local"
                  required
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {cloudPins && editingEmp ? 'New PIN / Password (leave empty to keep the current one)' : 'Portal Security PIN / Password (4+ chars)'}
                </label>
                <input
                  type="text"
                  value={formData.pin}
                  onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                  placeholder={cloudPins && editingEmp ? 'Unchanged' : '1234'}
                  minLength={cloudPins && editingEmp && !formData.pin ? undefined : 4}
                  maxLength={32}
                  required={!(cloudPins && editingEmp)}
                  className="w-full text-xs font-mono tracking-widest px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Department
                </label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  placeholder="Engineering"
                  required
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Designation / Role Title
                </label>
                <input
                  type="text"
                  value={formData.designation}
                  onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                  placeholder="Senior Software Engineer"
                  required
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  System Permission Role
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as Role })}
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value="employee">Employee (Personal Reports & Self Punch Only)</option>
                  <option value="accounts">Accounts Officer (Audit, Timesheets & Attendance Verification)</option>
                  <option value="ceo">Chief Executive Officer (CEO - Stats View & Direct Mentions Only)</option>
                  <option value="admin">Administrator (Full Office Management & Settings)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Assigned Shift
                </label>
                <select
                  value={formData.shiftId}
                  onChange={(e) => setFormData({ ...formData, shiftId: e.target.value })}
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  {shifts.map((s) => {
                    const isDisabled = s.isActive === false;
                    return (
                      <option
                        key={s.id}
                        value={s.id}
                        disabled={isDisabled && s.id !== formData.shiftId}
                      >
                        {s.name} ({s.startTime} – {s.endTime}){isDisabled ? ' [Disabled Shift]' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Contact Phone
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+1 (555) 123-4567"
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Hourly Wage Rate ($)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={formData.hourlyRate}
                  onChange={(e) => setFormData({ ...formData, hourlyRate: parseFloat(e.target.value) || 0 })}
                  className="w-full text-xs font-mono px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Work From Home (WFH - Bypass IP Lock) */}
            <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 transition-colors">
              <label className="flex items-start justify-between gap-3 cursor-pointer select-none">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Allow Work From Home (WFH)
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                      IP Lock Bypass
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    When enabled, this employee can punch attendance remotely from home or any network without Office IP restrictions.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(formData.allowWorkFromHome)}
                  onChange={(e) => setFormData({ ...formData, allowWorkFromHome: e.target.checked })}
                  className="w-4 h-4 mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </label>
            </div>

            {/* Customers access: only administrators and employees selected here can open the Customers section */}
            <div className="p-3.5 rounded-xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/60">
              <label className="flex items-start justify-between gap-3 cursor-pointer select-none">
                <div className="flex-1">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Can open the Sales section</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Off by default. When enabled, this employee can open Sales to generate sales coupons and see their own. Admin, CEO and Accounts always have Sales.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(formData.salesAccess)}
                  onChange={(e) => setFormData({ ...formData, salesAccess: e.target.checked })}
                  className="w-4 h-4 mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="p-3.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/60">
              <label className="flex items-start justify-between gap-3 cursor-pointer select-none">
                <div className="flex-1">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Can see the Customer Portal (Beta)</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Off by default. When enabled, this employee sees the Customer Portal link and the live portal queries. Admins always have it.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(formData.customerPortalAccess)}
                  onChange={(e) => setFormData({ ...formData, customerPortalAccess: e.target.checked })}
                  className="w-4 h-4 mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 space-y-3">
              <p className="text-xs font-bold text-slate-900 dark:text-slate-100">Extra access switches</p>
              {([
                ['liveDashboardAccess', 'Can open the Live Dashboard', 'Shows who is in, late, absent or on leave today. Admin and CEO always have it.'],
                ['leaderboardAccess', 'Can see the sales leaderboard and targets', 'Shows every salesperson\'s monthly totals (never cost or profit). Admin, CEO and Accounts always see it.'],
                ['payablesAccess', 'Can see the payables-due calendar', 'Shows unpaid vendor bills and their due dates. Admin, CEO and Accounts always see it.'],
              ] as const).map(([key, title, hint]) => (
                <label key={key} className="flex items-start justify-between gap-3 cursor-pointer select-none">
                  <div className="flex-1">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{title}</span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{hint} Off by default.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(formData[key])}
                    onChange={(e) => setFormData({ ...formData, [key]: e.target.checked })}
                    className="w-4 h-4 mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </label>
              ))}
              <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                Birthday (optional)
                <input
                  type="date"
                  value={formData.birthday}
                  onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-normal"
                />
                <span className="block mt-1 text-[11px] font-normal text-slate-500 dark:text-slate-400">Used only for the birthday card shown to the team on that day.</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false);
                  setEditingEmp(null);
                }}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-xs"
              >
                {editingEmp ? 'Save Employee Changes' : 'Create Staff Member'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deletingEmp && (
        <Modal
          isOpen={!!deletingEmp}
          onClose={() => setDeletingEmp(null)}
          title="Confirm Employee Removal"
          subtitle="Are you sure you want to remove this employee from the local server?"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              You are about to remove <strong>{deletingEmp.name}</strong> ({deletingEmp.employeeCode}). This will revoke their local login and kiosk PIN credentials.
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingEmp(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-xs"
              >
                Confirm Removal
              </button>
            </div>
          </div>
        </Modal>
      )}

      {faceModal && (
        <FaceScanModal
          isOpen
          mode={faceModal.mode}
          employeeId={faceModal.emp.id}
          employeeName={faceModal.emp.name}
          adminId={currentUserId}
          onClose={() => setFaceModal(null)}
          onSuccess={() => {
            setFaceModal(null);
            onFaceChanged?.();
          }}
        />
      )}
    </div>
  );
};
