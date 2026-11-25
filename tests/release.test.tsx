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
import universeHandler, { canSeeUniverseMessage } from '../api/universe.js';
import { issueSession } from '../api/_session.js';
import { canEditFinancialRecord } from '../src/lib/financePermissions.js';
import { CHARACTER_IDS, HUMAN_CHARACTERS } from '../src/lib/universeCharacters.js';

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

test('54 new avatars are unique, accepted by the shared catalog, and distinct in appearance', () => {
  assert.equal(HUMAN_CHARACTERS.length, 54);
  assert.equal(CHARACTER_IDS.size, 66);
  assert.equal(new Set(HUMAN_CHARACTERS.map((x) => renderToStaticMarkup(<EmployeeAvatar characterId={x.id} />))).size, 54);
});

test('Accounts and Admin have matching record-edit rights, without broadening employee access', () => {
  for (const kind of ['invoice','receipt','purchase']) for (const status of ['paid','unpaid','cancelled']) {
    assert.equal(canEditFinancialRecord('accounts','accounts-user','owner',kind,status), true);
    assert.equal(canEditFinancialRecord('admin','admin-user','owner',kind,status), true);
    assert.equal(canEditFinancialRecord('employee','other','owner',kind,status), false);
  }
  assert.equal(canEditFinancialRecord('employee','owner','owner','invoice','paid'), false);
  assert.equal(canEditFinancialRecord('employee','owner','owner','invoice','unpaid'), true);
});

test('private chat is visible exclusively to sender and tagged employees, even for administrators', () => {
  const publicRow = { sender_id: 'sender', mention_ids: [] };
  const privateRow = { sender_id: 'sender', mention_ids: ['recipient','second'] };
  assert.equal(canSeeUniverseMessage(publicRow,'other'), true);
  for (const id of ['sender','recipient','second']) assert.equal(canSeeUniverseMessage(privateRow,id), true);
  for (const id of ['other','admin']) assert.equal(canSeeUniverseMessage(privateRow,id), false);
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
  let sentTable = '';
  let employeeProfilePatch: Record<string, unknown> | null = null;
  let purchase = { id: 'pur-fixture', updated_at: '2026-11-25', data: { id: 'pur-fixture', purchaseNo: 'PUR-000001', createdBy: 'emp-fixture', status: 'unpaid', totalPayable: 250, items: [{ name: 'Vendor', amount: 250 }] } };
  const row = { id: 'inv-fixture', kind: 'customer', status: 'unpaid', updated_at: '2026-11-25', vendors: [{ name: 'A', amount: 100 }, { name: 'B', amount: 200 }] };
  globalThis.fetch = (async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'fixture.invalid');
    if (url.pathname.endsWith('/employees')) {
      if (options?.method === 'PATCH') { employeeProfilePatch = JSON.parse(String(options.body)); return new Response(null, {status:204}); }
      return Response.json([{ id: url.searchParams.get('id')?.startsWith('in.') ? 'recipient' : 'emp-fixture', role, name: 'Fixture', email:'fixture@example.test', phone:'', department:'Ops', designation:'Staff', is_active: true }]);
    }
    if (url.pathname.endsWith('/settings')) return Response.json([{ data: { employeeUniverseBetaEnabled: beta } }]);
    if (url.pathname.endsWith('/employee_universe_presence')) {
      if (options?.method === 'POST') {
        assert.equal(JSON.parse(String(options.body)).employee_id, 'emp-fixture');
        return new Response(null, {status: 204});
      }
      assert.match(url.searchParams.get('last_seen') || '', /^gte\./);
      return Response.json([{employee_id:'emp-fixture'}]);
    }
    if (url.pathname.endsWith('/crm_invoices')) {
      if (options?.method === 'PATCH') { writes++; return Response.json([{ ...row, ...JSON.parse(String(options.body)) }]); }
      return Response.json([row]);
    }
    if (url.pathname.endsWith('/crm_company')) {
      if (options?.method === 'PATCH') { assert.equal(url.searchParams.get('updated_at'), `eq.${purchase.updated_at}`); purchase = { ...purchase, ...JSON.parse(String(options.body)) }; writes++; }
      return Response.json([purchase]);
    }
    if (url.pathname.endsWith('/employee_universe_messages') || url.pathname.endsWith('/employee_universe_private_messages')) {
      if (options?.method === 'POST') { sentTable = url.pathname.split('/').pop()!; return Response.json([{ id: 'sent', ...JSON.parse(String(options.body)) }]); }
      if (url.searchParams.has('sender_id') && url.searchParams.has('created_at')) return Response.json([]);
    }
    if (url.pathname.endsWith('/employee_universe_private_messages')) return Response.json([]);
    if (url.pathname.endsWith('/employee_universe_messages')) return Response.json([
      { id: 'public', sender_id: 'emp-fixture', body: 'Public', mention_ids: [], created_at: '2026-11-25T04:00:00Z' },
      { id: 'mine', sender_id: 'someone', body: 'Private to me', mention_ids: ['emp-fixture'], created_at: '2026-11-25T04:01:00Z' },
      { id: 'hidden', sender_id: 'someone', body: 'Not for me', mention_ids: ['other'], created_at: '2026-11-25T04:02:00Z' },
    ]);
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
    const postPurchase = (posted: boolean) => invoke(crmHandler, { method: 'POST', body: { action: 'purchase_posted', id: purchase.id, posted, sessionToken } });
    role = 'employee';
    assert.equal((await postPurchase(true)).status, 403);
    role = 'accounts';
    const postedPurchase = await postPurchase(true);
    assert.equal(postedPurchase.status, 200);
    assert.equal(postedPurchase.data.purchase.posted, true);
    assert.equal(postedPurchase.data.purchase.postedBy, 'emp-fixture');
    assert.equal(postedPurchase.data.purchase.status, 'unpaid');
    assert.equal(postedPurchase.data.purchase.totalPayable, 250);
    assert.equal((await postPurchase(false)).data.purchase.posted, false);
    const universeReq = { method: 'GET', headers: { 'x-session-token': sessionToken } };
    assert.equal((await invoke(universeHandler, universeReq)).status, 403);
    const pulse = {...universeReq,method:'POST',body:{action:'presence',employee_id:'another-user'}};
    assert.equal((await invoke(universeHandler,pulse)).status,403);
    beta = true;
    assert.equal((await invoke(universeHandler,pulse)).status,200);
    const roster = {...universeReq,query:{view:'presence'}};
    assert.equal((await invoke(universeHandler,roster)).status,403);
    role='admin';
    assert.deepEqual((await invoke(universeHandler,roster)).data.online,['emp-fixture']);
    role='accounts';
    const profile = await invoke(universeHandler,{method:'POST',headers:universeReq.headers,body:{action:'profile',characterId:'human-12',petId:'cat',profile:{name:'Updated Fixture',email:'updated@example.test',phone:'123',department:'Sales',designation:'Consultant',role:'admin',hourlyRate:999}}});
    assert.equal(profile.status,200);
    const savedProfile = employeeProfilePatch as Record<string, unknown> | null;
    assert.equal(savedProfile?.game_character_id,'human-12');
    assert.equal(savedProfile?.game_pet_id,'cat');
    assert.equal(savedProfile?.name,'Updated Fixture');
    assert.equal(savedProfile?.role,undefined);
    assert.equal(savedProfile?.hourly_rate,undefined);
    const messages = (await invoke(universeHandler, universeReq)).data.messages;
    assert.deepEqual(messages.map((m: { id: string }) => m.id), ['public','mine']);
    assert.equal(messages[1].private, true);
    const send = (mentionIds: string[]) => invoke(universeHandler, { method: 'POST', headers: universeReq.headers, body: { action:'message', message:'Fixture only', mentionIds } });
    assert.equal((await send(['recipient'])).status, 201);
    assert.equal(sentTable, 'employee_universe_private_messages');
    assert.equal((await send([])).status, 201);
    assert.equal(sentTable, 'employee_universe_messages');
    assert.equal((await send(['invalid'])).status, 400);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [k, v] of Object.entries({ SUPABASE_URL: oldEnv.url, SUPABASE_SERVICE_ROLE_KEY: oldEnv.key, SESSION_SECRET: oldEnv.secret })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
