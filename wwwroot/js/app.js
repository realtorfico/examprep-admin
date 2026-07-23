var appEl = document.getElementById('app');

function renderTabs(active) {
  var tabs = [['codes', 'Codes'], ['questions', 'Questions'], ['stats', 'Stats']];
  return '<nav class="tabs">' + tabs.map(function (t) {
    return '<a href="#/' + t[0] + '"' + (active === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
  }).join('') + '</nav>';
}

// ---- Codes ----------------------------------------------------------------

async function renderCodes() {
  appEl.innerHTML = renderTabs('codes') + '<p>Loading…</p>';
  var data = await apiFetch('/console/codes');
  var rows = data.codes.map(function (c) {
    return '<tr><td>' + c.code + '</td><td>' + c.exam_type + '</td>' +
      '<td><span class="badge ' + c.status + '">' + c.status + '</span></td>' +
      '<td>' + (c.expires_at ? new Date(c.expires_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (c.redeemed_at ? new Date(c.redeemed_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (c.status !== 'revoked' ? '<button class="btn" data-act="revoke-code" data-code="' + c.code + '">Revoke</button>' : '') + '</td></tr>';
  }).join('');

  appEl.innerHTML = renderTabs('codes') +
    '<div class="card">' +
    '<form data-act="generate-code" class="generate-form">' +
    '<select name="examType"><option value="notary">Notary</option></select>' +
    '<input type="text" name="note" placeholder="note (optional)">' +
    '<input type="number" name="expiresInDays" placeholder="expires in days (optional)" class="expires-input">' +
    '<button class="btn btn-primary" type="submit">Generate code</button>' +
    '</form></div>' +
    '<table><thead><tr><th>Code</th><th>Exam</th><th>Status</th><th>Expires</th><th>Redeemed</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

// ---- Questions --------------------------------------------------------

async function renderQuestions() {
  appEl.innerHTML = renderTabs('questions') + '<p>Loading…</p>';
  var data = await apiFetch('/console/questions?examType=notary');
  var rows = data.questions.map(function (q) {
    return '<tr><td>' + q.topic + '</td><td>' + q.question.slice(0, 80) + '</td>' +
      '<td>' + q.weight + '</td><td><span class="badge">' + (q.source || '—') + '</span></td>' +
      '<td><button class="btn" data-act="delete-question" data-id="' + q.id + '">Delete</button></td></tr>';
  }).join('');

  appEl.innerHTML = renderTabs('questions') +
    '<div class="card"><button class="btn btn-primary" data-act="import-questions">Import JSON…</button> ' +
    '<input type="file" id="import-file" class="hidden-file-input" accept="application/json"></div>' +
    '<table><thead><tr><th>Topic</th><th>Question</th><th>Weight</th><th>Source</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

// ---- Stats --------------------------------------------------------------

async function renderStats() {
  appEl.innerHTML = renderTabs('stats') + '<p>Loading…</p>';
  var s = await apiFetch('/console/stats');
  var codeRows = s.codes.map(function (c) {
    return '<tr><td>' + c.exam_type + '</td><td>' + c.status + '</td><td>' + c.n + '</td></tr>';
  }).join('');
  var accRows = s.accuracyByTopic.map(function (a) {
    var pct = a.attempts ? Math.round((100 * a.correct) / a.attempts) : 0;
    return '<tr><td>' + a.exam_type + '</td><td>' + a.topic + '</td><td>' + pct + '%</td><td>' + a.attempts + '</td></tr>';
  }).join('');

  appEl.innerHTML = renderTabs('stats') +
    '<div class="card"><strong>' + s.totalUsers + '</strong> total users</div>' +
    '<h3>Codes by status</h3><table><thead><tr><th>Exam</th><th>Status</th><th>Count</th></tr></thead><tbody>' + codeRows + '</tbody></table>' +
    '<h3>Accuracy by topic</h3><table><thead><tr><th>Exam</th><th>Topic</th><th>% correct</th><th>Attempts</th></tr></thead><tbody>' + accRows + '</tbody></table>';
}

// ---- Routing + delegated events --------------------------------------

function route() {
  var view = (location.hash || '#/codes').replace('#/', '');
  if (view === 'codes') renderCodes();
  else if (view === 'questions') renderQuestions();
  else if (view === 'stats') renderStats();
  else renderCodes();
}
window.addEventListener('hashchange', route);

appEl.addEventListener('submit', async function (e) {
  var act = e.target.getAttribute && e.target.getAttribute('data-act');
  if (act === 'generate-code') {
    e.preventDefault();
    var f = e.target;
    await apiFetch('/console/codes/generate', {
      method: 'POST',
      body: {
        examType: f.examType.value,
        note: f.note.value || undefined,
        expiresInDays: f.expiresInDays.value ? Number(f.expiresInDays.value) : undefined,
      },
    });
    renderCodes();
  }
});

appEl.addEventListener('click', async function (e) {
  var el = e.target.closest && e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act');
  if (act === 'revoke-code') {
    await apiFetch('/console/codes/revoke', { method: 'POST', body: { code: el.getAttribute('data-code') } });
    renderCodes();
  } else if (act === 'delete-question') {
    await apiFetch('/console/questions/delete', { method: 'POST', body: { id: el.getAttribute('data-id') } });
    renderQuestions();
  } else if (act === 'import-questions') {
    document.getElementById('import-file').click();
  }
});

document.addEventListener('change', async function (e) {
  if (e.target.id === 'import-file' && e.target.files[0]) {
    var text = await e.target.files[0].text();
    var questions = JSON.parse(text);
    var result = await apiFetch('/console/questions/import', { method: 'POST', body: { questions: questions } });
    alert('Imported ' + result.imported + ' questions.');
    renderQuestions();
  }
});

route();
