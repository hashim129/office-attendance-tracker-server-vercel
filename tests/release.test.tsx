import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { withNotesLog, mergeSupabaseAttendanceRecord } from '../api/_supabase.js';
import { notificationTarget } from '../src/crm/notificationTarget';
import { EmployeeAvatar, GAME_CHARACTERS, GAME_PETS } from '../src/components/common/EmployeeIdentity';
import { getPunchNotes } from '../src/lib/punchNotes';
import { updateVendorPosting } from '../api/_vendorLines.js';
import crmHandler from '../api/crm.js';
import universeHandler from '../api/universe.js';
import { issueSession } from '../api/_session.js';

test('optional clock-in remark is retained with its action, without duplicate retry', () => {
  const initial = { employeeId: 'fixture', timeIn: '09:00', notes: 'Client visit', actorAction: 'time_in', recordUpdatedAt: '2026-11-25T04:00:00Z' };
  const first = withNotesLog(null, initial, initial, 'employee');
  assert.equal(first.notesLog.length, 1);
  assert.equal(first.notesLog[0].kind, 'punch_in');
  assert.equal(withNotesLog(first, initial, first, 'employee').notesLog.length, 1);
  const empty = withNotesLog(null, { ...initial, notes: '' }, initial, 'employee');
  assert.equal(empty.notesLog.length, 0);
});

test('additional remark preserves legacy history and does not change punch times', () => {
  const old = { employeeId: 'fixture', timeIn: '09:00', timeOut: '17:00', notes: 'Legacy note', recordUpdatedAt: '2026-11-25T04:00:00Z' };
  const incoming = { ...old, timeIn: '10:00', timeOut: '', notes: 'New note', actorAction: 'update_note', recordUpdatedAt: '2026-11-25T12:00:00Z' };
  const merged = mergeSupabaseAttendanceRecord(old, incoming, { actorRole: 'employee' });
  assert.equal(merged.timeIn, old.timeIn);
  assert.equal(merged.timeOut, old.timeOut);
  assert.deepEqual(getPunchNotes(merged).map((entry) => entry.text), ['Legacy note', 'New note']);
});

test('notification categories route to their actual record sections', () => {
  assert.equal(notificationTarget.invoice, 'crm-invoices');
  assert.equal(notificationTarget.followup, 'crm-tasks');
  assert.equal(notificationTarget.meeting, 'crm-meetings');
  assert.equal(notificationTarget.reminder, 'clock');
  assert.equal(Object.keys(notificationTarget).length, 8);
});

test('all character and pet choices render vector art, not emoji placeholders', () => {
  for (const character of GAME_CHARACTERS) for (const pet of GAME_PETS) {
    const html = renderToStaticMarkup(<EmployeeAvatar name="Fixture" characterId={character.id} petId={pet.id} />);
    assert.equal((html.match(/<svg/g) || []).length, pet.id === 'none' ? 1 : 2);
  }
});

test('posting and unposting one vendor preserves every other financial line', () => {
  const lines = [{ name: 'Vendor A', amount: 100 }, { name: 'Vendor B', amount: 200 }];
  const posted = updateVendorPosting(lines, 'legacy-1', true, 'accounts', '2026-11-25', () => 'fixture-id');
  assert.deepEqual(posted[0], lines[0]);
  assert.equal(posted[1].posted, true);
  assert.equal(posted[1].amount, 200);
  assert.equal(posted[1].postedBy, 'accounts');
  assert.equal(updateVendorPosting(posted, 'fixture-id', false, 'accounts', '2026-11-25', () => 'unused')[1].posted, false);
  assert.equal(updateVendorPosting(lines, 'missing', true, 'accounts', '', () => 'unused'), null);
});

test('fixture server enforces posting role and independent Beta gate', async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, secret: process.env.SESSION_SECRET };
  process.env.SUPABASE_URL = 'https://fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  process.env.SESSION_SECRET = 'fixture-only';
  let role = 'employee';
  let beta = false;
  let writes = 0;
  const row = { id: 'inv-fixture', kind: 'customer', status: 'unpaid', updated_at: '2026-11-25', vendors: [{ name: 'A', amount: 100 }, { name: 'B', amount: 200 }] };
  globalThis.fetch = (async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'fixture.invalid');
    if (url.pathname.endsWith('/employees')) return Response.json([{ id: 'emp-fixture', role, name: 'Fixture', is_active: true }]);
    if (url.pathname.endsWith('/settings')) return Response.json([{ data: { employeeUniverseBetaEnabled: beta } }]);
    if (url.pathname.endsWith('/crm_invoices')) {
      if (options?.method === 'PATCH') { writes++; return Response.json([{ ...row, ...JSON.parse(String(options.body)) }]); }
      return Response.json([row]);
    }
    if (url.pathname.endsWith('/employee_universe_messages')) return Response.json([]);
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  }) as typeof fetch;
  const invoke = async (handler: Function, req: object) => {
    let status = 0, data: any;
    const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(value: any) { data = value; return this; } };
    await handler(req, res);
    return { status, data };
  };
  try {
    const sessionToken = issueSession('emp-fixture');
    const req = { method: 'POST', body: { action: 'invoice_vendor_line_posted', id: row.id, vendorId: 'legacy-1', revision: row.updated_at, posted: true, sessionToken } };
    assert.equal((await invoke(crmHandler, req)).status, 403);
    assert.equal(writes, 0);
    role = 'accounts';
    const posted = await invoke(crmHandler, req);
    assert.equal(posted.status, 200);
    assert.equal(posted.data.invoice.vendors[1].posted, true);
    assert.equal(writes, 1);
    const universeReq = { method: 'GET', headers: { 'x-session-token': sessionToken } };
    assert.equal((await invoke(universeHandler, universeReq)).status, 403);
    beta = true;
    assert.deepEqual((await invoke(universeHandler, universeReq)).data.messages, []);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [k, v] of Object.entries({ SUPABASE_URL: oldEnv.url, SUPABASE_SERVICE_ROLE_KEY: oldEnv.key, SESSION_SECRET: oldEnv.secret })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
