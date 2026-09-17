// Admin -> Codes: Revoke must ask for confirmation first (owner request 2026-09-17). The button sits next to
// Save/Details on every row, one mis-click revoked a code immediately, and the console has no way to un-revoke.
//
// Runs the real `act === 'revoke-code'` branch of wwwroot/js/app.js's click handler (extracted from the source)
// with stubbed confirm/apiFetch/renderCodes, so it tests behavior, not just wording.
// Run with: node --test test/*.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'app.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function revokeBranch() {
  const marker = "if (act === 'revoke-code') {";
  const start = APP.indexOf(marker);
  assert.notEqual(start, -1, 'revoke-code handler found');
  let depth = 1, i = start + marker.length;
  for (; i < APP.length && depth; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}') depth--;
  }
  return new AsyncFunction('el', 'confirm', 'apiFetch', 'renderCodes', APP.slice(start + marker.length, i - 1));
}

function fakeRevokeButton(code, status) {
  const row = { getAttribute: (n) => ({ 'data-code': code, 'data-status': status }[n] || null) };
  return { getAttribute: (n) => (n === 'data-code' ? code : null), closest: (sel) => (sel === 'tr' ? row : null) };
}

async function clickRevoke({ code = 'ABCDE-12345', status = 'unused', answer }) {
  const calls = { confirm: [], api: [], render: 0 };
  await revokeBranch()(
    fakeRevokeButton(code, status),
    (msg) => { calls.confirm.push(msg); return answer; },
    async (url, opts) => { calls.api.push({ url, opts }); return {}; },
    () => { calls.render++; },
  );
  return calls;
}

test('cancelling the confirmation does not revoke anything', async () => {
  const calls = await clickRevoke({ answer: false });
  assert.equal(calls.confirm.length, 1, 'asked once');
  assert.deepEqual(calls.api, [], 'no revoke request sent');
  assert.equal(calls.render, 0);
});

test('confirming revokes that exact code and refreshes the list', async () => {
  const calls = await clickRevoke({ code: 'QWERT-67890', answer: true });
  assert.equal(calls.api.length, 1);
  assert.equal(calls.api[0].url, '/console/codes/revoke');
  assert.deepEqual(calls.api[0].opts.body, { code: 'QWERT-67890' });
  assert.equal(calls.render, 1);
});

test('the confirmation names the code and says it cannot be undone', async () => {
  const [msg] = (await clickRevoke({ code: 'ZXCVB-11111', answer: false })).confirm;
  assert.match(msg, /ZXCVB-11111/);
  assert.match(msg, /cannot be undone/i);
});

test('for a redeemed code, the confirmation warns the user will lose access', async () => {
  const [redeemed] = (await clickRevoke({ status: 'redeemed', answer: false })).confirm;
  assert.match(redeemed, /lose access/i);
  const [unused] = (await clickRevoke({ status: 'unused', answer: false })).confirm;
  assert.doesNotMatch(unused, /lose access/i, 'no false warning for an unused code');
});
