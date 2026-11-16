import { getSessionToken } from '../lib/storage';

export type FollowupKind = 'meeting' | 'corporate' | 'internal';
export type FollowupStatus = 'pending' | 'completed' | 'not_completed' | 'rescheduled';
export type MeetingStatus = 'scheduled' | 'pending_approval' | 'rejected' | 'cancelled' | 'completed';

export interface CrmCustomer {
  id: string;
  customerName: string;
  companyName: string;
  destinations: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmHistoryEntry {
  at: string;
  by: string;
  outcome: string;
  remarks: string;
  dueAt: string | null;
}

export interface CrmFollowup {
  id: string;
  customerId: string;
  kind: FollowupKind;
  assignedTo: string;
  remarks: string;
  dueAt: string | null;
  status: FollowupStatus;
  outcomeRemarks: string;
  history: CrmHistoryEntry[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CrmMeeting {
  id: string;
  title: string;
  customerId: string | null;
  externalName: string;
  attendeeIds: string[];
  startAt: string;
  endAt: string;
  location: string;
  notes: string;
  status: MeetingStatus;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmBadges {
  tasksOpen: number;
  tasksNew: number;
  meetingsNew: number;
  meetingsPending: number;
}

export interface CrmUnread {
  id: string;
  category: 'followup' | 'meeting';
  refId: string;
  message: string;
  createdAt: string;
}

export interface CrmData {
  customers: CrmCustomer[];
  followups: CrmFollowup[];
  meetings: CrmMeeting[];
  unread: CrmUnread[];
  badges: CrmBadges;
}

export const EMPTY_BADGES: CrmBadges = { tasksOpen: 0, tasksNew: 0, meetingsNew: 0, meetingsPending: 0 };

export class CrmError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Calls the CRM server. The server decides what the signed-in person may see or do. */
export async function crmCall<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const sessionToken = getSessionToken();
  if (!sessionToken) throw new CrmError('Please sign out and sign in again to use the CRM.', 'SESSION_REQUIRED');
  let res: Response;
  try {
    res = await fetch('/api/crm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sessionToken, ...payload }),
    });
  } catch {
    throw new CrmError('No internet connection. Please try again.', 'OFFLINE');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok || !data || data.ok === false) {
    throw new CrmError((data && (data.error || data.message)) || 'The CRM could not complete that request.', data?.code);
  }
  return data as T;
}
