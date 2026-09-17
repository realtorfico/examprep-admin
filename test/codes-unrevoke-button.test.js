// Admin -> Codes: revoked codes get an "Un-revoke" button (owner request 2026-09-17), backed by the API's
// POST /console/codes/unrevoke (examprep-api test/codes-unrevoke.test.js covers what it restores).
//
// Runs the real row-button helper and the real `act === 'unrevoke-code'` click branch extracted from
// wwwroot/js/app.js, with stubbed confirm/alert/apiFetch/renderCodes.
// Run with: node --test test/*.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'app.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Source text between the `{` that ends `marker` and its matching `}`.
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
// Extracted per test (not at load time), so a missing helper/branch fails each test on its own assertion.
const buttonHtml = (c) => new Function('c', 'escapeHtml', blockAfter('function codeRevokeButtonHtml(c) {'))(c, escapeHtml);
const unrevokeBranch = (...args) =>
  new AsyncFunction('el', 'confirm', 'alert', 'apiFetch', 'renderCodes', blockAfter("} else if (act === 'unrevoke-code') {"))(...args);

test('a revoked code row shows Un-revoke (and no Revoke)', () => {
  const html = buttonHtml({ code: 'ABCDE-12345', status: 'revoked' });
  assert.match(html, /data-act="unrevoke-code"/);
  assert.match(html, /data-code="ABCDE-12345"/);
  assert.match(html, />Un-revoke</);
  assert.doesNotMatch(html, /data-act="revoke-code"/);
});

test('unused and redeemed code rows show Revoke (and no Un-revoke)', () => {
  for (const status of ['unused', 'redeemed']) {
    const html = buttonHtml({ code: 'ABCDE-12345', status });
    assert.match(html, /data-act="revoke-code"/, status);
    assert.doesNotMatch(html, /unrevoke-code/, status);
  }
});

test('the Codes table rows use the helper for their revoke/un-revoke button', () => {
  assert.match(APP, />Details<\/button> ' : ''\) \+\s*codeRevokeButtonHtml\(c\) \+ '<\/td>'/);
});

function fakeButton(code) {
  return { getAttribute: (n) => (n === 'data-code' ? code : null) };
}
async function clickUnrevoke({ code = 'ABCDE-12345', answer, apiResult }) {
  const calls = { confirm: [], alert: [], api: [], render: 0 };
  await unrevokeBranch(
    fakeButton(code),
    (msg) => { calls.confirm.push(msg); return answer; },
    (msg) => { calls.alert.push(msg); },
    async (url, opts) => { calls.api.push({ url, opts }); if (apiResult instanceof Error) throw apiResult; return apiResult || { ok: true, status: 'redeemed' }; },
    () => { calls.render++; },
  );
  return calls;
}

test('cancelling the un-revoke confirmation does nothing', async () => {
  const calls = await clickUnrevoke({ answer: false });
  assert.equal(calls.confirm.length, 1);
  assert.deepEqual(calls.api, []);
  assert.equal(calls.render, 0);
});

test('the confirmation names the code and says access comes back', async () => {
  const [msg] = (await clickUnrevoke({ code: 'QWERT-67890', answer: false })).confirm;
  assert.match(msg, /QWERT-67890/);
  assert.match(msg, /access/i);
});

test('confirming un-revokes that exact code and refreshes the list', async () => {
  const calls = await clickUnrevoke({ code: 'QWERT-67890', answer: true });
  assert.equal(calls.api.length, 1);
  assert.equal(calls.api[0].url, '/console/codes/unrevoke');
  assert.equal(calls.api[0].opts.method, 'POST');
  assert.deepEqual(calls.api[0].opts.body, { code: 'QWERT-67890' });
  assert.equal(calls.render, 1);
  assert.deepEqual(calls.alert, []);
});

test('a refunded code: explains it stays revoked, no refresh', async () => {
  const err = Object.assign(new Error('code_refunded'), { status: 409, data: { error: 'code_refunded' } });
  const calls = await clickUnrevoke({ answer: true, apiResult: err });
  assert.equal(calls.alert.length, 1);
  assert.match(calls.alert[0], /refund/i);
  assert.equal(calls.render, 0);
});

test('any other failure is reported, not swallowed', async () => {
  const err = Object.assign(new Error('not_revoked'), { status: 409, data: { error: 'not_revoked' } });
  const calls = await clickUnrevoke({ answer: true, apiResult: err });
  assert.equal(calls.alert.length, 1);
  assert.match(calls.alert[0], /not_revoked/);
});
