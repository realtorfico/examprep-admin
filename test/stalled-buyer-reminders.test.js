// Admin -> Stalled Buyers: reminder confirmation and history (owner request 2026-09-19). Clicking "Send
// reminder" used to change only a grey date in the row -- no confirmation, no time, and each send overwrote
// the last. Now a successful send says who it went to and when, and the "Last reminded" cell shows the
// latest send (time, manual or automatic, how many in all) and expands to every send. Backed by the API's
// reminder_log (examprep-api test/stalled-buyer-reminders.test.js).
//
// Runs the real helpers, table drawer and `act === 'send-stalled-reminder'` click branch extracted from
// wwwroot/js/app.js, with stubbed apiFetch/alert/document.
// Run with: node --test test/*.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'app.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function blockAfter(marker) {
  const start = APP.indexOf(marker);
  assert.notEqual(start, -1, `found: ${marker}`);
  let depth = 1, i = start + marker.length;
  for (; i < APP.length && depth; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}') depth--;
  }
  return APP.slice(start + marker.length, i - 1);
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Extracted per test (not at load time), so a missing helper fails each test on its own assertion.
const fmt = (t) => new Function('t', blockAfter('function formatReminderTime(t) {'))(t);
const cellHtml = (u) => new Function('u', 'escapeHtml', 'formatReminderTime', blockAfter('function stalledReminderCellHtml(u) {'))(u, escapeHtml, fmt);

const T1 = Math.floor(Date.parse('2026-09-12T13:00:04Z') / 1000);
const T2 = Math.floor(Date.parse('2026-09-19T02:01:53Z') / 1000);
const buyer = (extra) => ({
  user_id: 'u-a', buyer_email: 'a@example.com', code: 'CODE-A', exam_type: 'il_cdl', last_seen_at: T1 - 86400,
  history: [], reminder_count: 0, last_reminder_source: null, ...extra,
});

test('reminder times show the time of day, not just the date', () => {
  assert.match(fmt(T2), /\d:\d\d/);
  assert.match(fmt(T2), /2026/);
});

test('the Last reminded cell shows the latest send, its source and the total, and lists every send', () => {
  const html = cellHtml(buyer({
    history: [{ sent_at: T2, source: 'manual', email: 'a@example.com' }, { sent_at: T1, source: 'auto', email: 'a@example.com' }],
    reminder_count: 2, last_reminder_source: 'manual',
  }));
  const summary = html.match(/<summary>(.*?)<\/summary>/)[1];
  assert.ok(summary.includes(fmt(T2)), 'summary has the latest send time');
  assert.match(summary, /Manual/);
  assert.match(summary, /2 sent/);
  const items = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, 2);
  assert.ok(items[0].includes(fmt(T2)) && /Manual/.test(items[0]) && items[0].includes('a@example.com'));
  assert.ok(items[1].includes(fmt(T1)) && /Automatic/.test(items[1]));
});

test('a buyer never reminded shows a dash, and history emails are escaped', () => {
  assert.doesNotMatch(cellHtml(buyer()), /<details/);
  const html = cellHtml(buyer({ history: [{ sent_at: T2, source: 'manual', email: '<x>@example.com' }], reminder_count: 1 }));
  assert.doesNotMatch(html, /<x>/);
});

function drawTable(state) {
  const container = { innerHTML: '' };
  new Function('document', 'stalledBuyersCache', 'stalledBuyerSendingIds', 'stalledBuyersNotice', 'escapeHtml', 'stalledReminderCellHtml',
    blockAfter('function drawStalledBuyersTable() {'))(
    { getElementById: (id) => (id === 'stalled-buyers-table-container' ? container : null) },
    state.cache, state.sending || {}, state.notice || '', escapeHtml, cellHtml);
  return container.innerHTML;
}

test('the table shows the sent confirmation above it and the history in each row', () => {
  const html = drawTable({
    cache: [buyer({ history: [{ sent_at: T2, source: 'manual', email: 'a@example.com' }], reminder_count: 1, last_reminder_source: 'manual' })],
    notice: 'Reminder sent to a@example.com on ' + fmt(T2) + '.',
  });
  assert.ok(html.indexOf('Reminder sent to a@example.com') !== -1, 'confirmation shown');
  assert.ok(html.indexOf('Reminder sent to') < html.indexOf('<table'), 'confirmation sits above the table');
  assert.match(html, /<details class="reminder-history">/);
  assert.match(html, /1 sent/);
});

test('buyer email, code and exam are escaped in the row', () => {
  const html = drawTable({ cache: [buyer({ buyer_email: '<b>@example.com', code: '<c>', exam_type: '<e>' })] });
  assert.doesNotMatch(html, /<b>|<c>|<e>/);
});

async function clickSend({ apiResult }) {
  const calls = { api: [], alert: [], load: 0, draw: 0 };
  const state = { ids: {}, notice: 'an older confirmation' };
  const branch = new AsyncFunction('el', 'apiFetch', 'alert', 'loadStalledBuyers', 'drawStalledBuyersTable', 'formatReminderTime', 'state',
    'var stalledBuyerSendingIds = state.ids; var stalledBuyersNotice = state.notice;\n' +
    blockAfter("} else if (act === 'send-stalled-reminder') {") +
    '\nstate.notice = stalledBuyersNotice;');
  await branch(
    { getAttribute: (n) => (n === 'data-user-id' ? 'u-a' : null) },
    async (url, opts) => { calls.api.push({ url, opts }); if (apiResult instanceof Error) throw apiResult; return apiResult; },
    (msg) => { calls.alert.push(msg); },
    async () => { calls.load++; },
    () => { calls.draw++; },
    fmt,
    state,
  );
  return { calls, state };
}

test('a successful send confirms who it went to and when, then reloads the list', async () => {
  const { calls, state } = await clickSend({ apiResult: { ok: true, email: 'a@example.com', sentAt: T2 } });
  assert.equal(calls.api.length, 1);
  assert.equal(calls.api[0].url, '/console/stalled-buyers/remind');
  assert.deepEqual(calls.api[0].opts.body, { userId: 'u-a' });
  assert.equal(state.notice, 'Reminder sent to a@example.com on ' + fmt(T2) + '.');
  assert.equal(calls.load, 1);
  assert.deepEqual(calls.alert, []);
  assert.deepEqual(state.ids, {}, 'button re-enabled');
});

test('a failed send is reported, clears the old confirmation, and does not claim anything was sent', async () => {
  const err = Object.assign(new Error('send_failed'), { status: 502, data: { error: 'send_failed' } });
  const { calls, state } = await clickSend({ apiResult: err });
  assert.equal(calls.alert.length, 1);
  assert.match(calls.alert[0], /send_failed/);
  assert.equal(state.notice, '');
  assert.equal(calls.load, 0);
  assert.deepEqual(state.ids, {});
});
