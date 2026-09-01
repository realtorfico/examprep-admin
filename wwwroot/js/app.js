var appEl = document.getElementById('app');

// ---- Theme / font (localStorage-only here — no app-user token on the admin site) ---

function loadLocalPrefs() {
  return {
    theme: localStorage.getItem('examprep_admin_theme') || 'dark',
    fontScale: parseFloat(localStorage.getItem('examprep_admin_font') || '1'),
  };
}
function saveLocalPrefs(theme, fontScale) {
  localStorage.setItem('examprep_admin_theme', theme);
  localStorage.setItem('examprep_admin_font', String(fontScale));
}
// CSP (style-src 'self', no unsafe-inline) blocks inline styles set via JS too, not just
// style="..." attributes -- so --font-scale can't be set with style.setProperty(). fontScale is
// bounded [0.85, 1.4] in 0.05 steps (12 values, see font-up/down below), so a small fixed set of
// font-scale-NN classes (see admin.css) covers it instead.
function applyTheme(theme, fontScale) {
  var root = document.documentElement;
  if (theme && theme !== 'system') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  if (fontScale) {
    root.className = root.className.replace(/\bfont-scale-\d+\b/g, '').trim();
    root.classList.add('font-scale-' + Math.round(fontScale * 100));
  }
}

function renderTopControls() {
  var local = loadLocalPrefs();
  var nextTheme = local.theme === 'light' ? 'dark' : 'light';
  // Label shows what clicking WILL switch to, not the current theme.
  return '<div class="top-controls">' +
    '<div class="control-group"><button class="btn-secondary btn-sm" data-act="toggle-theme" data-next="' + nextTheme + '">' +
    (nextTheme === 'dark' ? '🌙 Dark' : '☀️ Light') + '</button></div>' +
    '<div class="control-group"><span class="muted font-label">Font:</span>' +
    '<div class="font-size-pill"><button data-act="font-down">A-</button><button data-act="font-up">A+</button></div></div>' +
    '</div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function renderTabs(active) {
  var tabs = [['tracks', 'Tracks'], ['categories', 'Categories'], ['blog', 'Blog'], ['settings', 'Settings'], ['points', 'Points'], ['codes', 'Codes'], ['promotions', 'Promotions'], ['refunds', 'Refund Claims'], ['questions', 'Question Bank'], ['testimonials', 'Testimonials'], ['stats', 'Stats'], ['stalled', 'Stalled Buyers'], ['visitors', 'Visitors'], ['alerts', 'Alerts']];
  return renderTopControls() + '<nav class="tabs">' + tabs.map(function (t) {
    return '<a href="#/' + t[0] + '"' + (active === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
  }).join('') + '</nav>';
}

// ---- Promotions -------------------------------------------------------
// Admin-managed list of promo banners shown on the public site's home and/or checkout pages.
// A promo with a code is a real discount applied server-side at checkout (see the Worker's
// quoteCheckout) -- one with no code is purely a marketing message. Reorder is up/down-arrow
// swap-with-neighbor rather than drag-and-drop, to keep this simple.

var promotionsCache = [];
var promotionFormState = null; // null (closed) | 'new' | the promotion object being edited

function promotionFormHtml() {
  if (!promotionFormState) return '';
  var editing = promotionFormState !== 'new';
  var p = editing ? promotionFormState : {};
  var discountValueDisplay = p.discount_type === 'flat_cents' ? (p.discount_value ? p.discount_value / 100 : '') : (p.discount_value || '');
  return '<form class="card promotion-form" data-act="save-promotion" data-id="' + (editing ? p.id : '') + '">' +
    '<h3>' + (editing ? 'Edit promotion' : 'Add promotion') + '</h3>' +
    '<label>Title<input type="text" name="title" required value="' + escapeHtml(p.title || '') + '"></label>' +
    '<label>Message<textarea name="body" required rows="2">' + escapeHtml(p.body || '') + '</textarea></label>' +
    '<label>Button label (optional)<input type="text" name="ctaLabel" value="' + escapeHtml(p.cta_label || '') + '"></label>' +
    '<label>Button link (optional)<input type="text" name="ctaUrl" placeholder="https://…" value="' + escapeHtml(p.cta_url || '') + '"></label>' +
    '<label>Where it shows<select name="placement">' +
    ['home', 'checkout', 'refer', 'both'].map(function (pl) {
      return '<option value="' + pl + '"' + (p.placement === pl ? ' selected' : '') + '>' +
        (pl === 'home' ? 'Home page only' : pl === 'checkout' ? 'Checkout page only' :
         pl === 'refer' ? 'Refer-a-friend page only' : 'Both (home + checkout)') + '</option>';
    }).join('') + '</select></label>' +
    '<p class="muted page-intro-text">Leave both the discount value and required email domain blank for a message-only ' +
    'promo with no real discount. Leave just the code blank but set a required email domain (e.g. .edu) to auto-apply ' +
    'the discount whenever a matching email is entered at checkout — no code for the buyer to type, since the domain ' +
    '(and verification, if enabled below) is the real gate anyway.</p>' +
    '<label>Promo code (optional — leave blank for a domain-gated discount to auto-apply with no code)' +
    '<input type="text" name="promoCode" placeholder="e.g. SAVE20" value="' + escapeHtml(p.promo_code || '') + '"></label>' +
    '<label>Discount type<select name="discountType">' +
    '<option value="percent"' + (p.discount_type !== 'flat_cents' ? ' selected' : '') + '>Percent off</option>' +
    '<option value="flat_cents"' + (p.discount_type === 'flat_cents' ? ' selected' : '') + '>Flat amount off ($)</option>' +
    '</select></label>' +
    '<label>Discount value (percent 1-100, or dollars if flat amount)<input type="number" name="discountValue" min="0" step="0.01" value="' + discountValueDisplay + '"></label>' +
    '<label>Require email domain (optional — e.g. .edu for a student discount)<input type="text" name="requiredEmailDomain" placeholder=".edu" value="' + escapeHtml(p.required_email_domain || '') + '"></label>' +
    '<label class="promotion-active-toggle"><input type="checkbox" name="requireEmailVerification"' + (p.require_email_verification ? ' checked' : '') + '> ' +
    'Require email verification (sends a one-time confirmation link before the discount applies — recommended with a domain restriction, since that alone only checks the typed string, not real ownership)</label>' +
    '<label class="promotion-active-toggle"><input type="checkbox" name="firstPurchaseOnly"' + (p.first_purchase_only ? ' checked' : '') + '> ' +
    'First-time buyers only (rejected at checkout if the email already has access from any prior purchase — requires an email to be entered)</label>' +
    '<p class="muted page-intro-text">A points multiplier is a completely different effect from the discount above — ' +
    'redeemed on the Refer-a-Friend page (not checkout), it multiplies future referral points on that person\'s account ' +
    'for a set number of days. There\'s no domain to check for something like "retired professional," so the promo code ' +
    'itself (plus optional email verification above) is the only real gate — keep it semi-private and hand it out directly ' +
    'rather than advertising it broadly, if that matters for this promo.</p>' +
    '<label>Points multiplier (optional — e.g. 2 to double referral points)<input type="number" name="pointsMultiplier" min="2" step="1" value="' + (p.points_multiplier || '') + '"></label>' +
    '<label>Multiplier lasts (days, once redeemed)<input type="number" name="pointsMultiplierDays" min="1" step="1" placeholder="30" value="' + (p.points_multiplier_days || '') + '"></label>' +
    '<label class="promotion-active-toggle"><input type="checkbox" name="active"' + (p.active ? ' checked' : '') + '> Active</label>' +
    '<div class="progress-reset-actions">' +
    '<button class="btn-primary" type="submit">Save</button>' +
    '<button class="btn-secondary" type="button" data-act="cancel-promotion-form">Cancel</button>' +
    '</div></form>';
}

function promotionRowHtml(p, index, total) {
  var discountLabel = p.discount_type === 'flat_cents' ? '$' + (p.discount_value / 100).toFixed(2) + ' off' : p.discount_value + '% off';
  var codeInfo;
  if (p.discount_value) {
    codeInfo = (p.promo_code ? '<span class="badge">' + escapeHtml(p.promo_code) + '</span> ' : '<span class="badge">No code — auto-applies</span> ') +
      discountLabel +
      (p.required_email_domain ? ' · requires ' + escapeHtml(p.required_email_domain) + ' email' : '') +
      (p.require_email_verification ? ' (verified)' : '') +
      (p.first_purchase_only ? ' · first-time buyers only' : '') +
      ' · ' + p.redeemed_count + ' redeemed';
  } else if (p.points_multiplier) {
    codeInfo = '<span class="badge">' + escapeHtml(p.promo_code || '—') + '</span> ' +
      p.points_multiplier + '× points for ' + (p.points_multiplier_days || 0) + ' days' +
      (p.require_email_verification ? ' (verified)' : '') +
      ' · ' + p.redeemed_count + ' redeemed';
  } else {
    codeInfo = '<span class="muted">Message only, no discount</span>';
  }
  return '<div class="card promotion-row">' +
    '<div class="promotion-row-top">' +
    '<strong>' + escapeHtml(p.title) + '</strong> ' +
    '<span class="badge' + (p.active ? ' active' : '') + '">' + (p.active ? 'Active' : 'Inactive') + '</span> ' +
    '<span class="muted">' + p.placement + '</span>' +
    '</div>' +
    '<p class="muted promotion-row-body">' + escapeHtml(p.body) + '</p>' +
    '<p class="promotion-row-code">' + codeInfo + '</p>' +
    '<div class="promotion-row-actions">' +
    '<button class="btn-secondary btn-sm" type="button" data-act="reorder-promotion" data-id="' + p.id + '" data-direction="up"' + (index === 0 ? ' disabled' : '') + '>▲</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="reorder-promotion" data-id="' + p.id + '" data-direction="down"' + (index === total - 1 ? ' disabled' : '') + '>▼</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="toggle-promotion-active" data-id="' + p.id + '" data-active="' + (p.active ? '0' : '1') + '">' + (p.active ? 'Deactivate' : 'Activate') + '</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="edit-promotion" data-id="' + p.id + '">Edit</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="delete-promotion" data-id="' + p.id + '">Delete</button>' +
    '</div></div>';
}

async function renderPromotions() {
  appEl.innerHTML = renderTabs('promotions') + '<p>Loading…</p>';
  var data = await apiFetch('/console/promotions');
  promotionsCache = data.promotions;
  drawPromotions();
}

function drawPromotions() {
  var rows = promotionsCache.map(function (p, i) { return promotionRowHtml(p, i, promotionsCache.length); }).join('');
  var empty = promotionsCache.length ? '' : '<p class="muted">No promotions yet.</p>';
  var addButton = promotionFormState ? '' : '<button class="btn-primary btn-sm" type="button" data-act="add-promotion">+ Add promotion</button>';
  appEl.innerHTML = renderTabs('promotions') +
    '<p class="muted page-intro-text">Shown on the public site\'s home page and/or checkout page. A promo with a ' +
    'code is a real discount applied at checkout; one with no code is just a marketing message.</p>' +
    '<div class="card"><div id="promotion-form-wrap">' + promotionFormHtml() + '</div>' + addButton + '</div>' +
    empty + rows;
}

// ---- Category content (category-first landing pages) ----------------------
// Copy for the public site's category landing pages (notary, driver, cdl, real_estate_salesperson,
// etc — one page per category, aggregating every state that offers it). slug is the primary key
// (also the site's URL segment), so save is always an upsert, unlike Promotions' separate
// create/update. Feature tiles / testimonials / FAQ are each edited as one line per item, using a
// "|"-separated shorthand instead of a repeatable-row widget, to keep this simple.

var categoriesCache = [];
var categoryFormState = null; // null (closed) | 'new' | the category object being edited

function pipeLinesToObjects(text, fields) {
  return String(text || '').split('\n').map(function (line) { return line.trim(); }).filter(Boolean).map(function (line) {
    var parts = line.split('|').map(function (p) { return p.trim(); });
    var obj = {};
    fields.forEach(function (f, i) { obj[f] = parts[i] || ''; });
    return obj;
  });
}
function objectsToPipeLines(arr, fields) {
  return (arr || []).map(function (obj) { return fields.map(function (f) { return obj[f] || ''; }).join(' | '); }).join('\n');
}

function categoryFormHtml() {
  if (!categoryFormState) return '';
  var editing = categoryFormState !== 'new';
  var c = editing ? categoryFormState : {};
  return '<form class="card promotion-form" data-act="save-category" data-slug="' + (editing ? escapeHtml(c.slug) : '') + '">' +
    '<h3>' + (editing ? 'Edit category' : 'Add category') + '</h3>' +
    '<label>Slug (URL segment, e.g. "notary", "real-estate-salesperson")<input type="text" name="slug" required' +
    (editing ? ' readonly' : '') + ' value="' + escapeHtml(c.slug || '') + '"></label>' +
    '<label>Label<input type="text" name="label" required value="' + escapeHtml(c.label || '') + '"></label>' +
    '<label>Hero headline<input type="text" name="heroHeadline" value="' + escapeHtml(c.hero_headline || '') + '"></label>' +
    '<label>Hero subhead<textarea name="heroSubhead" rows="2">' + escapeHtml(c.hero_subhead || '') + '</textarea></label>' +
    '<label>Feature tiles — one per line, "icon | title | body"<textarea name="featureTiles" rows="3" placeholder="📘 | Current handbooks | Updated weekly with official state revisions.">' +
    escapeHtml(objectsToPipeLines(c.featureTiles, ['icon', 'title', 'body'])) + '</textarea></label>' +
    '<label>Testimonials — one per line, "quote | author"<textarea name="testimonials" rows="3" placeholder="Passed on the first try! | Marcus K.">' +
    escapeHtml(objectsToPipeLines(c.testimonials, ['quote', 'author'])) + '</textarea></label>' +
    '<label>Compliance copy<textarea name="complianceCopy" rows="3">' + escapeHtml(c.compliance_copy || '') + '</textarea></label>' +
    '<label>FAQ — one per line, "question | answer"<textarea name="faq" rows="3" placeholder="How many questions are on the exam? | It varies by state...">' +
    escapeHtml(objectsToPipeLines(c.faq, ['question', 'answer'])) + '</textarea></label>' +
    '<label>SEO title<input type="text" name="seoTitle" value="' + escapeHtml(c.seo_title || '') + '"></label>' +
    '<label>SEO description<textarea name="seoDescription" rows="2">' + escapeHtml(c.seo_description || '') + '</textarea></label>' +
    '<label>SEO canonical URL<input type="text" name="seoCanonical" placeholder="https://passexamhq.com/notary" value="' + escapeHtml(c.seo_canonical || '') + '"></label>' +
    '<label class="promotion-active-toggle"><input type="checkbox" name="active"' + (c.active === undefined || c.active ? ' checked' : '') + '> Active</label>' +
    '<div class="progress-reset-actions">' +
    '<button class="btn-primary" type="submit">Save</button>' +
    '<button class="btn-secondary" type="button" data-act="cancel-category-form">Cancel</button>' +
    '</div></form>';
}

function categoryRowHtml(c) {
  return '<div class="card promotion-row">' +
    '<div class="promotion-row-top">' +
    '<strong>' + escapeHtml(c.label) + '</strong> ' +
    '<span class="badge' + (c.active ? ' active' : '') + '">' + (c.active ? 'Active' : 'Inactive') + '</span> ' +
    '<span class="muted">/' + escapeHtml(c.slug) + '</span>' +
    '</div>' +
    '<p class="muted promotion-row-body">' + escapeHtml(c.hero_headline || '(no hero headline set)') + '</p>' +
    '<div class="promotion-row-actions">' +
    '<button class="btn-secondary btn-sm" type="button" data-act="edit-category" data-slug="' + escapeHtml(c.slug) + '">Edit</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="delete-category" data-slug="' + escapeHtml(c.slug) + '">Delete</button>' +
    '</div></div>';
}

async function renderCategories() {
  appEl.innerHTML = renderTabs('categories') + '<p>Loading…</p>';
  var data = await apiFetch('/console/category-content');
  categoriesCache = data.categories;
  drawCategories();
}

function drawCategories() {
  var rows = categoriesCache.map(categoryRowHtml).join('');
  var empty = categoriesCache.length ? '' : '<p class="muted">No categories yet.</p>';
  var addButton = categoryFormState ? '' : '<button class="btn-primary btn-sm" type="button" data-act="add-category">+ Add category</button>';
  appEl.innerHTML = renderTabs('categories') +
    '<p class="muted page-intro-text">Copy shown on the public site\'s category landing pages (one page per category, e.g. Notary, ' +
    'CDL, Real Estate Salesperson — aggregating every state that offers it). Pass rate, track count, and topic breakdown are computed ' +
    'from the Tracks tab\'s data automatically and aren\'t edited here.</p>' +
    '<div class="card"><div id="category-form-wrap">' + categoryFormHtml() + '</div>' + addButton + '</div>' +
    empty + rows;
}

// ---- Blog (educational articles) -------------------------------------------
// Admin-authored articles, published straight to the live site's DB-backed /blog and
// /blog/:slug pages -- no code deploy needed to publish (see the API's schema.sql blog_posts
// comment). kind is the category slug (same list category_content uses), so each post cross-
// links to its category page on the site.

var blogCache = [];
var blogCategoriesCache = []; // fetched alongside blog posts, just for the kind <select> options
var blogFormState = null; // null (closed) | 'new' | the post object being edited

function blogFormHtml() {
  if (!blogFormState) return '';
  var editing = blogFormState !== 'new';
  var p = editing ? blogFormState : {};
  var kindOptions = blogCategoriesCache.map(function (c) {
    return '<option value="' + escapeHtml(c.slug) + '"' + (p.kind === c.slug ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>';
  }).join('');
  return '<form class="card promotion-form" data-act="save-blog" data-id="' + (editing ? p.id : '') + '">' +
    '<h3>' + (editing ? 'Edit article' : 'Add article') + '</h3>' +
    '<label>Slug (URL segment, e.g. "notary-exam-what-to-expect")<input type="text" name="slug" required value="' + escapeHtml(p.slug || '') + '"></label>' +
    '<label>Category<select name="kind" required>' + kindOptions + '</select></label>' +
    '<label>State (optional, 2-letter code — leave blank if not state-specific)<input type="text" name="stateCode" maxlength="2" placeholder="NY" value="' + escapeHtml(p.state_code || '') + '"></label>' +
    '<label>Title<input type="text" name="title" required value="' + escapeHtml(p.title || '') + '"></label>' +
    '<label>Excerpt (shown on the blog list page, and as a fallback SEO description)<textarea name="excerpt" required rows="2">' + escapeHtml(p.excerpt || '') + '</textarea></label>' +
    '<label>Body (HTML — paragraphs, headings, lists, links)<textarea name="bodyHtml" required rows="14">' + escapeHtml(p.body_html || '') + '</textarea></label>' +
    '<label>SEO title (optional — falls back to Title)<input type="text" name="seoTitle" value="' + escapeHtml(p.seo_title || '') + '"></label>' +
    '<label>SEO description (optional — falls back to Excerpt)<textarea name="seoDescription" rows="2">' + escapeHtml(p.seo_description || '') + '</textarea></label>' +
    '<label class="promotion-active-toggle"><input type="checkbox" name="published"' + (p.status === 'published' ? ' checked' : '') + '> Published (unchecked = draft, not visible on the site)</label>' +
    '<div class="progress-reset-actions">' +
    '<button class="btn-primary" type="submit">Save</button>' +
    '<button class="btn-secondary" type="button" data-act="cancel-blog-form">Cancel</button>' +
    '</div></form>';
}

function blogRowHtml(p) {
  return '<div class="card promotion-row">' +
    '<div class="promotion-row-top">' +
    '<strong>' + escapeHtml(p.title) + '</strong> ' +
    '<span class="badge' + (p.status === 'published' ? ' active' : '') + '">' + (p.status === 'published' ? 'Published' : 'Draft') + '</span> ' +
    '<span class="muted">/blog/' + escapeHtml(p.slug) + '</span>' +
    '</div>' +
    '<p class="muted promotion-row-body">' + escapeHtml(p.excerpt) + '</p>' +
    '<div class="promotion-row-actions">' +
    '<button class="btn-secondary btn-sm" type="button" data-act="edit-blog" data-id="' + escapeHtml(p.id) + '">Edit</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="delete-blog" data-id="' + escapeHtml(p.id) + '">Delete</button>' +
    '</div></div>';
}

async function renderBlog() {
  appEl.innerHTML = renderTabs('blog') + '<p>Loading…</p>';
  var results = await Promise.all([apiFetch('/console/blog'), apiFetch('/console/category-content')]);
  blogCache = results[0].posts;
  blogCategoriesCache = results[1].categories;
  drawBlog();
}

function drawBlog() {
  var rows = blogCache.map(blogRowHtml).join('');
  var empty = blogCache.length ? '' : '<p class="muted">No articles yet.</p>';
  var addButton = blogFormState ? '' : '<button class="btn-primary btn-sm" type="button" data-act="add-blog">+ Add article</button>';
  appEl.innerHTML = renderTabs('blog') +
    '<p class="muted page-intro-text">Educational articles for the public site\'s /blog. Publishing here goes live immediately -- no ' +
    'code deploy needed. New/edited articles get real SEO meta and a sitemap.xml entry on the next daily regen run (or run ' +
    '`node scripts/generate-seo-meta.js` in the site repo manually for an immediate update).</p>' +
    '<div class="card"><div id="blog-form-wrap">' + blogFormHtml() + '</div>' + addButton + '</div>' +
    empty + rows;
}

// ---- Codes ----------------------------------------------------------------

// 'YYYY-MM-DD' for an <input type="date">'s value, in LOCAL time (matching how the browser's own
// date picker and toLocaleDateString() both already display dates elsewhere on this page) --
// toISOString() would silently shift the displayed date near a UTC day boundary.
function isoDateFromUnix(ts) {
  var d = new Date(ts * 1000);
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

var CODES_COLUMNS = [['code', 'Code'], ['exam', 'Exam'], ['status', 'Status'], ['note', 'Note'], ['expires', 'Expires'],
  ['redeemed', 'Redeemed'], ['lastUsed', 'Last Used'], ['accuracy', 'Accuracy'], ['coverage', 'Coverage'], ['examCount', 'Mock Exams']];
var CODES_CELL_INDEX = { code: 0, exam: 1, status: 2, note: 3, expires: 4, redeemed: 5, lastUsed: 6, accuracy: 7, coverage: 8, examCount: 9 };

var codesSort = { key: 'lastUsed', dir: -1 }; // default: most recently used first

// Same DOM-node-reordering approach as applyPricingSortOrder() (see its comment) -- Note/Expires
// are live editable inputs, so a data-driven re-render would wipe any unsaved in-progress edit.
function applyCodesSortOrder() {
  if (!codesSort.key) return;
  var tbody = document.getElementById('codes-rows-body');
  if (!tbody) return;
  var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-code]'));
  var key = codesSort.key;
  rows.sort(function (a, b) {
    var av, bv;
    if (key === 'note') {
      av = a.querySelector('.code-note-input').value.toLowerCase(); bv = b.querySelector('.code-note-input').value.toLowerCase();
    } else if (key === 'expires') {
      // 'YYYY-MM-DD' or '' (no expiry) -- lexicographic works for ISO dates; empty sorts first ascending.
      av = a.querySelector('.code-expires-input').value; bv = b.querySelector('.code-expires-input').value;
    } else if (key === 'redeemed' || key === 'lastUsed') {
      // Cell shows a locale date string or "—" -- sort by the raw unix timestamp stashed as data-ts instead.
      av = Number(a.children[CODES_CELL_INDEX[key]].dataset.ts || 0);
      bv = Number(b.children[CODES_CELL_INDEX[key]].dataset.ts || 0);
    } else if (key === 'accuracy' || key === 'coverage' || key === 'examCount') {
      // "83%" / "0" / "—" -- parseFloat stops at the first non-numeric char; "—" (NaN) sorts lowest.
      av = parseFloat(a.children[CODES_CELL_INDEX[key]].textContent);
      bv = parseFloat(b.children[CODES_CELL_INDEX[key]].textContent);
      av = isNaN(av) ? -Infinity : av; bv = isNaN(bv) ? -Infinity : bv;
    } else {
      // code / exam / status -- plain text compare on whatever column this key maps to.
      var idx = CODES_CELL_INDEX[key];
      av = a.children[idx].textContent.toLowerCase(); bv = b.children[idx].textContent.toLowerCase();
    }
    if (av < bv) return -1 * codesSort.dir;
    if (av > bv) return 1 * codesSort.dir;
    return 0;
  });
  rows.forEach(function (row) { tbody.appendChild(row); });
}

var codesStatusFilter = ''; // '' = all; else 'unused' | 'redeemed' | 'revoked'
var codesExamFilter = ''; // '' = all; else an exam_type
var codesFilterQuery = ''; // free text over code + note; resets on every tab open, same as Pricing's search box

function renderCodesStatusFilterPills(codes) {
  var order = ['unused', 'redeemed', 'revoked'];
  var counts = {};
  codes.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
  var options = [['', 'All (' + codes.length + ')']].concat(order.filter(function (s) { return counts[s]; }).map(function (s) {
    return [s, s.charAt(0).toUpperCase() + s.slice(1) + ' (' + counts[s] + ')'];
  }));
  return '<div class="settings-filter-pill" role="group" aria-label="Filter by status">' +
    options.map(function (o) {
      var active = codesStatusFilter === o[0];
      return '<button type="button" class="' + (active ? 'active' : '') + '" data-act="filter-codes-status" data-status="' + o[0] + '"' +
        (active ? ' aria-current="true"' : '') + '>' + o[1] + '</button>';
    }).join('') + '</div>';
}

function renderCodesExamFilterHtml(codes) {
  var counts = {};
  codes.forEach(function (c) { counts[c.exam_type] = (counts[c.exam_type] || 0) + 1; });
  // Only exam types with at least one code -- a flat list of every track (300+) would swamp the
  // handful actually in use, same reasoning as the 0-count-hiding rule on the Tracks/Questions pills.
  var examTypes = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); });
  var options = '<option value="">All Exams (' + codes.length + ')</option>' + examTypes.map(function (et) {
    return '<option value="' + escapeHtml(et) + '"' + (codesExamFilter === et ? ' selected' : '') + '>' + escapeHtml(trackLabelFor(et)) + ' (' + counts[et] + ')</option>';
  }).join('');
  return '<label class="muted">Exam</label><select id="codes-exam-select">' + options + '</select>';
}

function updateCodesRowVisibility() {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#codes-rows-body tr[data-code]'));
  var q = codesFilterQuery.trim().toLowerCase();
  rows.forEach(function (row) {
    var matchesStatus = !codesStatusFilter || row.dataset.status === codesStatusFilter;
    var matchesExam = !codesExamFilter || row.dataset.exam === codesExamFilter;
    var matchesText = !q ||
      row.children[CODES_CELL_INDEX.code].textContent.toLowerCase().indexOf(q) !== -1 ||
      row.querySelector('.code-note-input').value.toLowerCase().indexOf(q) !== -1;
    row.style.display = (matchesStatus && matchesExam && matchesText) ? '' : 'none';
  });
}

async function renderCodes() {
  appEl.innerHTML = renderTabs('codes') + '<p>Loading…</p>';
  // Accuracy/Coverage/Mock Exams are read-only, computed the same way the Stats page's own "User
  // progress" section already does (reuses groupQuizProgressByUser(), no new backend logic) --
  // /console/quiz-progress only has rows for users with at least one progress row (see its own SQL
  // comment), so a redeemed-but-never-quizzed code correctly has no entry and shows "—" below.
  var results = await Promise.all([apiFetch('/console/codes'), apiFetch('/console/quiz-progress'), apiFetch('/console/exam-attempts')]);
  var data = results[0];
  var progressGroups = groupQuizProgressByUser(results[1].items || []);
  var progressByCode = {};
  progressGroups.forEach(function (u) {
    if (!u.code) return;
    progressByCode[u.code] = {
      accuracyPct: u.total ? Math.round((100 * u.correct) / u.total) : null,
      coveragePct: u.topicTotal ? Math.round((100 * u.seen) / u.topicTotal) : null,
    };
  });
  var examCountByCode = {};
  (results[2].items || []).forEach(function (a) {
    if (!a.code) return;
    examCountByCode[a.code] = (examCountByCode[a.code] || 0) + 1;
  });

  var recentCutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  var rows = data.codes.map(function (c) {
    var expiresIso = c.expires_at ? isoDateFromUnix(c.expires_at) : '';
    var progress = progressByCode[c.code];
    var accuracyCell = progress && progress.accuracyPct != null ? progress.accuracyPct + '%' : '—';
    var coverageCell = progress && progress.coveragePct != null ? progress.coveragePct + '%' : '—';
    var examCountCell = examCountByCode[c.code] || 0;
    var recentClass = c.last_used_at && c.last_used_at >= recentCutoff ? ' code-row-recent' : '';
    return '<tr data-code="' + escapeHtml(c.code) + '" data-status="' + escapeHtml(c.status) + '" data-exam="' + escapeHtml(c.exam_type) + '" class="' + recentClass.trim() + '"><td>' + c.code + '</td><td>' + c.exam_type + '</td>' +
      '<td><span class="badge ' + c.status + '">' + c.status + '</span></td>' +
      '<td><input type="text" class="code-note-input" data-original="' + escapeHtml(c.note || '') + '" value="' + escapeHtml(c.note || '') + '"></td>' +
      '<td><input type="date" class="code-expires-input" data-original="' + expiresIso + '" value="' + expiresIso + '"></td>' +
      '<td data-ts="' + (c.redeemed_at || 0) + '">' + (c.redeemed_at ? new Date(c.redeemed_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td class="settings-readonly-cell" data-ts="' + (c.last_used_at || 0) + '">' + (c.last_used_at ? new Date(c.last_used_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td class="settings-readonly-cell">' + accuracyCell + '</td>' +
      '<td class="settings-readonly-cell">' + coverageCell + '</td>' +
      '<td class="settings-readonly-cell">' + examCountCell + '</td>' +
      '<td><button class="btn-secondary btn-sm" data-act="save-code" data-code="' + escapeHtml(c.code) + '">Save</button> ' +
      (c.status === 'redeemed' ? '<button class="btn-secondary btn-sm" data-act="open-code-detail" data-code="' + escapeHtml(c.code) + '">Details</button> ' : '') +
      (c.status !== 'revoked' ? '<button class="btn" data-act="revoke-code" data-code="' + c.code + '">Revoke</button>' : '') + '</td></tr>';
  }).join('');

  appEl.innerHTML = renderTabs('codes') +
    '<div class="card">' +
    '<form data-act="generate-code" class="generate-form">' +
    '<select name="examType">' + EXAM_TYPES.filter(function (t) { return t[0] !== 'mlo'; }).map(function (t) {
      return '<option value="' + t[0] + '">' + t[1] + '</option>';
    }).join('') + '</select>' +
    '<input type="text" name="note" placeholder="note (optional)">' +
    '<input type="number" name="expiresInDays" placeholder="expires in days (optional)" class="expires-input">' +
    '<button class="btn-primary" type="submit">Generate code</button>' +
    '</form></div>' +
    '<div class="questions-toolbar">' +
    '<span id="codes-status-filter-wrap">' + renderCodesStatusFilterPills(data.codes) + '</span>' +
    '<span id="codes-exam-filter-wrap">' + renderCodesExamFilterHtml(data.codes) + '</span>' +
    '<input type="search" class="questions-search-input" id="codes-search-input" placeholder="Search code or note…">' +
    '</div>' +
    '<table><thead id="codes-table-head">' + sortableHeaderRow(CODES_COLUMNS, codesSort, 'sort-codes').replace('</tr>', '<th></th></tr>') + '</thead>' +
    '<tbody id="codes-rows-body">' + rows + '</tbody></table>';
  codesFilterQuery = '';
  applyCodesSortOrder();
  updateCodesRowVisibility();
}

// ---- Codes tab: per-code usage drilldown -------------------------------
// Modal rather than an inline expansion row -- see the .code-detail-backdrop CSS comment for why.

var codeDetailCache = {}; // code -> already-fetched /console/codes/detail response

function formatDateTime(ts) { return ts ? new Date(ts * 1000).toLocaleString() : '—'; }
function formatDate(ts) { return ts ? new Date(ts * 1000).toLocaleDateString() : '—'; }
function formatDurationSec(sec) {
  if (!sec && sec !== 0) return '—';
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + 'm ' + s + 's';
}
function daysBetween(a, b) { return a && b ? Math.max(0, Math.round((b - a) / 86400)) : null; }

function codeDetailStat(label, value) {
  return '<div class="code-detail-stat"><span class="stat-label">' + label + '</span><span class="stat-value">' + value + '</span></div>';
}

function codeDetailExamAttemptsHtml(attempts) {
  if (!attempts.length) return '<p class="muted">No mock exams submitted yet.</p>';
  var rows = attempts.map(function (a, i) {
    return '<tr><td>' + (i + 1) + '</td><td>' + formatDateTime(a.submittedAt) + '</td><td class="muted">' + a.mode + '</td>' +
      '<td>' + formatDurationSec(a.durationSec) + '</td>' +
      '<td class="' + (a.passed ? 'exam-review-correct' : 'exam-review-incorrect') + '">' + a.correct + '/' + a.total + ' (' + a.percent + '%)</td>' +
      '<td><span class="badge ' + (a.passed ? 'redeemed' : 'revoked') + '">' + (a.passed ? 'Passed' : 'Not passed') + '</span></td></tr>';
  }).join('');
  var deltaHtml = '';
  if (attempts.length > 1) {
    var first = attempts[0], last = attempts[attempts.length - 1];
    var delta = Math.round((last.percent - first.percent) * 10) / 10;
    var deltaCls = delta > 0 ? 'code-detail-delta-up' : delta < 0 ? 'code-detail-delta-down' : 'muted';
    var arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
    deltaHtml = '<p>First attempt <strong>' + first.percent + '%</strong> → latest attempt <strong>' + last.percent + '%</strong> ' +
      '(<span class="' + deltaCls + '">' + arrow + ' ' + Math.abs(delta) + ' pts</span>)</p>';
  }
  return deltaHtml + '<table class="admin-user-table"><thead><tr><th>#</th><th>Submitted</th><th>Mode</th><th>Duration</th><th>Score</th><th>Result</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

function codeDetailTopicsHtml(topics) {
  if (!topics.length) return '<p class="muted">No questions in this track yet.</p>';
  var rows = topics.slice().sort(function (a, b) { return b.total - a.total; }).map(function (t) {
    var pct = topicPctOf(t), coverage = topicCoverageOf(t);
    return '<tr class="' + accuracyRowClass(pct) + '"><td>' + t.topic + '</td><td>' + pct + '%</td>' +
      '<td><span class="' + coverageClass(coverage) + '">' + coverage + '%</span></td><td>' + t.total + '</td></tr>';
  }).join('');
  return '<table class="admin-user-table"><thead><tr><th>Topic</th><th>Accuracy</th><th>Coverage</th><th>Attempts</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function codeDetailSnapshotsHtml(snapshots) {
  if (!snapshots.length) {
    return '<p class="muted">No daily trend data yet — a background job records one snapshot per active day, ' +
      'so this fills in over time starting from today.</p>';
  }
  var rows = snapshots.map(function (s) {
    return '<tr><td>' + s.date + '</td><td>' + (s.accuracyPct != null ? s.accuracyPct + '%' : '—') + '</td>' +
      '<td>' + (s.coveragePct != null ? s.coveragePct + '%' : '—') + '</td><td>' + s.totalSeen + '</td></tr>';
  }).join('');
  return '<table class="admin-user-table"><thead><tr><th>Date</th><th>Accuracy</th><th>Coverage</th><th>Questions seen</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function codeDetailResourcesHtml(resources) {
  if (!resources.length) return '<p class="muted">No study resources opened yet.</p>';
  var rows = resources.map(function (r) {
    var extent = (r.resource_type === 'audio' || r.resource_type === 'video') ? r.percent + '%' : (r.percent >= 100 ? 'Viewed' : '—');
    return '<tr><td>' + r.resource_file + '</td><td class="muted">' + r.resource_type + '</td><td>' + extent + '</td>' +
      '<td>' + r.times_opened + '</td><td class="muted">' + formatDate(r.last_opened_at) + '</td></tr>';
  }).join('');
  return '<table class="admin-user-table resource-consumption-table"><thead><tr><th>Resource</th><th>Type</th><th>Progress</th><th>Opens</th><th>Last opened</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function codeDetailModalHtml(code, detail) {
  if (!detail.user) {
    return '<div class="code-detail-modal-header"><h3>' + escapeHtml(code) + '</h3><button class="btn-secondary btn-sm" data-act="close-code-detail">Close</button></div>' +
      '<p class="muted">This code hasn\'t been redeemed to an account yet, so there\'s no usage to show.</p>';
  }
  var activeSpanDays = daysBetween(detail.code.redeemed_at, detail.user.last_seen_at);
  var firstActivitySpanDays = daysBetween(detail.activity.firstActivityAt, detail.activity.lastActivityAt);
  return '<div class="code-detail-modal-header"><h3>' + escapeHtml(code) + ' <span class="muted">— ' + trackLabelFor(detail.code.exam_type) + '</span></h3>' +
    '<button class="btn-secondary btn-sm" data-act="close-code-detail">Close</button></div>' +

    '<div class="code-detail-section"><h4>Timeline</h4><div class="code-detail-stat-grid">' +
    codeDetailStat('Redeemed', formatDate(detail.code.redeemed_at)) +
    codeDetailStat('Last active', formatDate(detail.user.last_seen_at)) +
    codeDetailStat('Active span', activeSpanDays != null ? activeSpanDays + ' days' : '—') +
    codeDetailStat('First quiz activity', formatDate(detail.activity.firstActivityAt)) +
    codeDetailStat('Last quiz activity', formatDate(detail.activity.lastActivityAt)) +
    codeDetailStat('Quiz activity span', firstActivitySpanDays != null ? firstActivitySpanDays + ' days' : '—') +
    '</div></div>' +

    '<div class="code-detail-section"><h4>Current standing</h4><div class="code-detail-stat-grid">' +
    codeDetailStat('Accuracy', detail.current.accuracyPct != null ? detail.current.accuracyPct + '%' : '—') +
    codeDetailStat('Coverage', detail.current.coveragePct != null ? detail.current.coveragePct + '%' : '—') +
    codeDetailStat('Questions seen', detail.current.seen + ' / ' + detail.current.topicTotal) +
    codeDetailStat('Total attempts', detail.current.total) +
    '</div></div>' +

    '<div class="code-detail-section"><h4>Mock exam attempts (chronological)</h4>' + codeDetailExamAttemptsHtml(detail.examAttempts) + '</div>' +
    '<div class="code-detail-section"><h4>Coverage &amp; accuracy by topic</h4>' + codeDetailTopicsHtml(detail.current.topics) + '</div>' +
    '<div class="code-detail-section"><h4>Daily trend</h4>' + codeDetailSnapshotsHtml(detail.snapshots) + '</div>' +
    '<div class="code-detail-section"><h4>Study resources</h4>' + codeDetailResourcesHtml(detail.resources) + '</div>';
}

async function openCodeDetail(code) {
  var backdrop = document.createElement('div');
  backdrop.className = 'code-detail-backdrop';
  backdrop.id = 'code-detail-backdrop';
  backdrop.innerHTML = '<div class="code-detail-modal"><p class="muted">Loading…</p></div>';
  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop || e.target.closest('[data-act="close-code-detail"]')) closeCodeDetail();
  });
  document.body.appendChild(backdrop);

  try {
    var detail = codeDetailCache[code];
    if (!detail) {
      detail = await apiFetch('/console/codes/detail?code=' + encodeURIComponent(code));
      codeDetailCache[code] = detail;
    }
    var modalEl = backdrop.querySelector('.code-detail-modal');
    if (modalEl) modalEl.innerHTML = codeDetailModalHtml(code, detail);
  } catch (err) {
    var el = backdrop.querySelector('.code-detail-modal');
    if (el) el.innerHTML = '<p class="muted">Could not load usage details for this code.</p>';
  }
}

function closeCodeDetail() {
  var backdrop = document.getElementById('code-detail-backdrop');
  if (backdrop) backdrop.remove();
}

document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeCodeDetail(); closeVisitorDetail(); } });

// ---- Questions --------------------------------------------------------

// 3rd/4th entries (stateCode, examKind) mirror HUB_EXAMS on the public site 1:1 -- lets the
// Settings > Course pricing table offer the same state/type filters as the public track hub.
// examType/kind/state/label/active fields are the single source of truth in track_registry,
// fetched once at boot (see loadTrackRegistry()) instead of hardcoded here -- this drifted out of
// sync with the site's own copy once already (the Real Estate Kind-clubbing bug), which is why
// this migration exists. EXAM_TYPES keeps the exact same [examType, label, stateCode, examKind]
// tuple shape every existing consumer already expects, just populated from the fetch. label is
// track_registry's short_name -- admin intentionally does NOT keep its own separate, longer label
// text; the adjacent Kind/State columns already disambiguate same-state sibling tracks (e.g. a
// state's Real Estate Salesperson vs Real Estate Broker row) in every table that renders this.
var EXAM_TYPES = [];
var TRACK_REGISTRY_FULL = {};

var trackRegistryPromise = null;
function loadTrackRegistry() {
  if (!trackRegistryPromise) {
    trackRegistryPromise = apiFetch('/console/track-registry').then(function (res) {
      var tracks = (res && res.tracks) || [];
      TRACK_REGISTRY_FULL = {};
      tracks.forEach(function (t) { TRACK_REGISTRY_FULL[t.examType] = t; });
      EXAM_TYPES = tracks.map(function (t) { return [t.examType, t.shortName, t.stateCode, t.examKind]; });
    });
  }
  return trackRegistryPromise;
}
var STATE_LABELS = {
  CA: 'California', TX: 'Texas', FL: 'Florida', NY: 'New York', IL: 'Illinois', PA: 'Pennsylvania', OH: 'Ohio', GA: 'Georgia', NC: 'North Carolina', VA: 'Virginia', MI: 'Michigan', WA: 'Washington',
  AK: 'Alaska', AL: 'Alabama', AR: 'Arkansas', AZ: 'Arizona', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', HI: 'Hawaii', IA: 'Iowa', ID: 'Idaho', IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland', ME: 'Maine', MN: 'Minnesota', MO: 'Missouri', MS: 'Mississippi', MT: 'Montana', ND: 'North Dakota', NE: 'Nebraska', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada', OK: 'Oklahoma', OR: 'Oregon', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', UT: 'Utah', VT: 'Vermont',
  WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming',
  US: 'National',
};
// Filter hierarchy is kind -> state -> topic: kind and state are pills over EXAM_TYPES (mutually
// scoped counts, same pattern as the Settings > Course pricing table's filter pills below), and
// resolve to a *set* of exam_types -- one when narrowed all the way to a single track, more than
// one otherwise (e.g. kind=Notary with no state picked = every *_notary track at once). Topic only
// applies once that set is exactly one track, since different states' tracks don't share a topic
// taxonomy -- see resolvedQuestionsExamTypes()/loadQuestionsTopics() below.
var currentQuestionsExamType = null; // an explicit single-track pick from the track list; null = scope is whatever the kind/state pills resolve to
var currentQuestionsTopic = null; // null = "All" -- only sent to the server when scope is a single track
var questionsKindFilter = ''; // '' = All kinds
var questionsStateFilter = ''; // '' = All states
var questionsTrackQuery = ''; // free-text filter over the track list itself (track name, not question content)
var questionsSearchQuery = ''; // free-text search over question content, resolved server-side
var questionsSourceFilter = ''; // '' = All sources
var questionsSourceOp = 'eq'; // 'eq' = is, 'ne' = is not
var questionsSourcesCache = null; // [{source, count}] for the current resolved scope
var QUESTIONS_PAGE_SIZE = 50;
var questionsPage = 0; // 0-indexed
var questionsPageRows = [];
var questionsTotal = 0;
var questionsTopicsCache = null; // [{topic, count}] when scope is one track; null when scope spans more than one (no topic tabs shown)
var questionsSearchDebounceTimer = null;

function questionsTrackMatchesFilters(t, kindFilter, stateFilter) {
  return (!kindFilter || t[3] === kindFilter) && (!stateFilter || t[2] === stateFilter);
}

function resolvedQuestionsExamTypes() {
  if (currentQuestionsExamType) return [currentQuestionsExamType];
  return EXAM_TYPES.filter(function (t) { return questionsTrackMatchesFilters(t, questionsKindFilter, questionsStateFilter); })
    .map(function (t) { return t[0]; });
}

// "All kinds + all states" resolves to every track at once -- across 90+ tracks and growing, that's
// an unbounded COUNT(*) on every keystroke/page turn even with the list itself paginated, and not a
// real admin workflow (nobody needs to browse the *entire* bank unfiltered). Pick a kind and/or a
// state -- picking just one (e.g. kind=Notary, no state = every *_notary track) is still fine and
// stays index-assisted via exam_type IN (...).
function questionsScopeTooUnbounded() {
  return !currentQuestionsExamType && !questionsKindFilter && !questionsStateFilter;
}

function renderQuestionsKindFilterPills() {
  var kinds = [];
  EXAM_TYPES.forEach(function (t) { if (kinds.indexOf(t[3]) === -1) kinds.push(t[3]); });
  kinds.sort(function (a, b) { return a.localeCompare(b); });
  var allCount = EXAM_TYPES.filter(function (t) { return questionsTrackMatchesFilters(t, '', questionsStateFilter); }).length;
  var options = [['', 'All Kinds (' + allCount + ')']].concat(kinds.map(function (k) {
    var count = EXAM_TYPES.filter(function (t) { return questionsTrackMatchesFilters(t, k, questionsStateFilter); }).length;
    return [k, k + ' (' + count + ')', count];
    // A kind with 0 tracks under the current state filter (e.g. a state with no Notary track) is
    // hidden below -- except the currently-active selection, kept visible so it stays deselectable
    // even if the OTHER pill you just clicked made this combo come up empty.
  })).filter(function (o) { return o[0] === '' || o[2] > 0 || o[0] === questionsKindFilter; });
  return '<div class="settings-filter-pill" role="group" aria-label="Filter by exam kind">' +
    options.map(function (o) {
      var active = questionsKindFilter === o[0];
      return '<button type="button" class="' + (active ? 'active' : '') + '" data-act="filter-questions-kind" data-kind="' + escapeHtml(o[0]) + '"' +
        (active ? ' aria-current="true"' : '') + '>' + escapeHtml(o[1]) + '</button>';
    }).join('') + '</div>';
}

function renderQuestionsStateFilterPills() {
  var codes = [];
  EXAM_TYPES.forEach(function (t) { if (codes.indexOf(t[2]) === -1) codes.push(t[2]); });
  codes.sort(function (a, b) { return (STATE_LABELS[a] || a).localeCompare(STATE_LABELS[b] || b); });
  var allCount = EXAM_TYPES.filter(function (t) { return questionsTrackMatchesFilters(t, questionsKindFilter, ''); }).length;
  var options = [['', 'All States (' + allCount + ')']].concat(codes.map(function (c) {
    var count = EXAM_TYPES.filter(function (t) { return questionsTrackMatchesFilters(t, questionsKindFilter, c); }).length;
    return [c, (STATE_LABELS[c] || c) + ' (' + count + ')', count];
    // Same 0-count hiding as the kind pills above (e.g. a kind picked that this state doesn't
    // offer) -- the active selection stays visible even at 0 so it's still deselectable.
  })).filter(function (o) { return o[0] === '' || o[2] > 0 || o[0] === questionsStateFilter; });
  return '<div class="settings-filter-pill" role="group" aria-label="Filter by state">' +
    options.map(function (o) {
      var active = questionsStateFilter === o[0];
      return '<button type="button" class="' + (active ? 'active' : '') + '" data-act="filter-questions-state" data-state="' + escapeHtml(o[0]) + '"' +
        (active ? ' aria-current="true"' : '') + '>' + escapeHtml(o[1]) + '</button>';
    }).join('') + '</div>';
}

// The track list under the pills lets you drill down to one specific track (for its topic tabs)
// even while broadly browsing a kind/state combo that spans several -- it's just EXAM_TYPES
// filtered by the same kind/state pills plus this box's own free-text match on track name.
function renderQuestionsTrackList() {
  var q = questionsTrackQuery.trim().toLowerCase();
  var matches = EXAM_TYPES.filter(function (t) {
    return questionsTrackMatchesFilters(t, questionsKindFilter, questionsStateFilter) && (!q || t[1].toLowerCase().indexOf(q) !== -1);
  });
  if (!matches.length) return '<p class="muted">No tracks match this filter.</p>';
  return '<nav class="tabs sub-tabs track-picker-tabs">' + matches.map(function (t) {
    return '<a href="#" data-act="select-exam-tab" data-exam="' + t[0] + '"' +
      (t[0] === currentQuestionsExamType ? ' aria-current="page"' : '') + '>' + escapeHtml(t[1]) + '</a>';
  }).join('') + '</nav>';
}

function renderQuestionsTrackPicker() {
  return '<div class="card questions-track-picker">' +
    '<div class="settings-filter-pills-row" id="questions-kind-filter-wrap">' + renderQuestionsKindFilterPills() + '</div>' +
    '<div class="settings-filter-pills-row" id="questions-state-filter-wrap">' + renderQuestionsStateFilterPills() + '</div>' +
    '<input type="search" class="settings-filter-input" id="questions-track-search" placeholder="Filter tracks by name…" value="' + escapeHtml(questionsTrackQuery) + '">' +
    '<div id="questions-track-list">' + renderQuestionsTrackList() + '</div>' +
    '</div>';
}

function trackLabelFor(examType) {
  var t = EXAM_TYPES.filter(function (e) { return e[0] === examType; })[0];
  return t ? t[1] : examType;
}

function questionsScopeLabel(resolvedTypes) {
  if (!resolvedTypes.length) return 'No tracks match this filter';
  if (resolvedTypes.length === 1) return trackLabelFor(resolvedTypes[0]);
  var kindLabel = questionsKindFilter || 'All kinds';
  var stateLabel = questionsStateFilter ? (STATE_LABELS[questionsStateFilter] || questionsStateFilter) : 'all states';
  return kindLabel + ' — ' + stateLabel + ' (' + resolvedTypes.length + ' tracks)';
}

function renderQuestionsTopicSubTabs() {
  if (!questionsTopicsCache) return ''; // scope spans more than one track -- topic isn't a meaningful cross-track filter
  var total = questionsTopicsCache.reduce(function (sum, t) { return sum + t.count; }, 0);
  var tabs = [{ topic: null, count: total }].concat(questionsTopicsCache);
  return '<nav class="tabs sub-tabs topic-sub-tabs">' + tabs.map(function (t) {
    return '<a href="#" data-act="select-topic-tab" data-topic="' + (t.topic === null ? '' : escapeHtml(t.topic)) + '"' +
      (t.topic === currentQuestionsTopic ? ' aria-current="page"' : '') + '>' +
      (t.topic === null ? 'All' : escapeHtml(t.topic)) + ' (' + t.count + ')</a>';
  }).join('') + '</nav>';
}

function questionsPaginationHtml() {
  var start = questionsTotal === 0 ? 0 : questionsPage * QUESTIONS_PAGE_SIZE + 1;
  var end = Math.min(questionsTotal, (questionsPage + 1) * QUESTIONS_PAGE_SIZE);
  return '<div class="questions-pagination">' +
    '<span class="muted">' + (questionsTotal ? ('Showing ' + start + '–' + end + ' of ' + questionsTotal) : 'No matching questions') + '</span>' +
    '<div class="questions-pagination-buttons">' +
    '<button class="btn-secondary btn-sm" type="button" data-act="questions-prev-page"' + (questionsPage > 0 ? '' : ' disabled') + '>◂ Prev</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="questions-next-page"' + (end < questionsTotal ? '' : ' disabled') + '>Next ▸</button>' +
    '</div></div>';
}

// Renders into #questions-results only -- the search box and Import button live in a stable shell
// outside this wrapper (see renderQuestions() below) specifically so this can redraw on every
// keystroke's (debounced) search, every pagination click, and every topic-tab click without ever
// destroying and recreating the search <input> itself, which would drop its focus/cursor each time.
function drawQuestionsResults() {
  var el = document.getElementById('questions-results');
  if (!el) return;
  if (questionsScopeTooUnbounded()) {
    el.innerHTML = '<p class="muted">Pick a kind and/or a state above to browse questions — the full bank is too large to browse unfiltered.</p>';
    return;
  }
  var resolvedTypes = resolvedQuestionsExamTypes();
  var showExamColumn = resolvedTypes.length > 1;
  var rows = questionsPageRows.map(function (q) {
    return '<tr><td>' + escapeHtml(q.topic) + '</td>' +
      (showExamColumn ? '<td class="muted">' + escapeHtml(trackLabelFor(q.exam_type)) + '</td>' : '') +
      '<td>' + escapeHtml(q.question.slice(0, 80)) + '</td>' +
      '<td>' + q.weight + '</td><td><span class="badge">' + escapeHtml(q.source || '—') + '</span></td>' +
      '<td><button class="btn" data-act="delete-question" data-id="' + q.id + '">Delete</button></td></tr>';
  }).join('');
  var empty = questionsPageRows.length ? '' : '<p class="muted">No questions match this filter.</p>';
  var headerCells = '<th>Topic</th>' + (showExamColumn ? '<th>Exam</th>' : '') + '<th>Question</th><th>Weight</th><th>Source</th><th></th>';

  el.innerHTML = '<p class="questions-current-track">Viewing: <strong>' + escapeHtml(questionsScopeLabel(resolvedTypes)) + '</strong></p>' +
    renderQuestionsTopicSubTabs() +
    empty +
    (questionsPageRows.length ? '<table><thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + '</tbody></table>' : '') +
    questionsPaginationHtml();
}

async function loadQuestionsTopics(resolvedTypes) {
  if (resolvedTypes.length !== 1) { questionsTopicsCache = null; return; }
  var data = await apiFetch('/console/questions/topics?examType=' + encodeURIComponent(resolvedTypes[0]));
  questionsTopicsCache = data.topics;
}

async function loadQuestionsPage() {
  if (questionsScopeTooUnbounded()) { questionsPageRows = []; questionsTotal = 0; return; }
  var resolvedTypes = resolvedQuestionsExamTypes();
  if (!resolvedTypes.length) { questionsPageRows = []; questionsTotal = 0; return; }
  var params = 'examType=' + encodeURIComponent(resolvedTypes.join(',')) +
    '&limit=' + QUESTIONS_PAGE_SIZE + '&offset=' + (questionsPage * QUESTIONS_PAGE_SIZE);
  if (currentQuestionsTopic && resolvedTypes.length === 1) params += '&topic=' + encodeURIComponent(currentQuestionsTopic);
  if (questionsSearchQuery.trim()) params += '&q=' + encodeURIComponent(questionsSearchQuery.trim());
  if (questionsSourceFilter) {
    params += '&source=' + encodeURIComponent(questionsSourceFilter);
    if (questionsSourceOp === 'ne') params += '&sourceOp=ne';
  }
  var data = await apiFetch('/console/questions?' + params);
  questionsPageRows = data.questions;
  questionsTotal = data.total;
}

async function loadQuestionsSources(resolvedTypes) {
  // Same unbounded-scope guard as the results table itself (questionsScopeTooUnbounded) -- an
  // all-kinds/all-states scope would otherwise GROUP BY source across every track in the bank.
  if (!resolvedTypes.length || questionsScopeTooUnbounded()) { questionsSourcesCache = null; return; }
  var data = await apiFetch('/console/questions/sources?examType=' + encodeURIComponent(resolvedTypes.join(',')));
  questionsSourcesCache = data.sources;
}

function renderQuestionsSourceFilterHtml() {
  if (!questionsSourcesCache || !questionsSourcesCache.length) return '';
  var opToggle = '<button type="button" class="btn-secondary btn-sm" data-act="toggle-questions-source-op" title="Toggle is / is not">' +
    (questionsSourceOp === 'ne' ? 'is not' : 'is') + '</button>';
  var options = ['<option value="">All Sources</option>'].concat(questionsSourcesCache.map(function (s) {
    return '<option value="' + escapeHtml(s.source || '') + '"' + (questionsSourceFilter === s.source ? ' selected' : '') + '>' +
      escapeHtml(s.source || '(none)') + ' (' + s.count + ')</option>';
  })).join('');
  return '<label class="muted">Source</label>' + opToggle + '<select id="questions-source-select">' + options + '</select>';
}

// Full reset for whenever the resolved track *set* changes (a track pick, or a kind/state pill) --
// topic/search/source/page no longer mean what they meant for the old scope, so they're cleared too
// (including the visible search box, updated directly rather than via a redraw -- see drawQuestionsResults()).
async function refreshQuestionsScope() {
  currentQuestionsTopic = null;
  questionsSearchQuery = '';
  questionsSourceFilter = '';
  questionsSourceOp = 'eq';
  questionsPage = 0;
  var searchInputEl = document.getElementById('questions-search-input');
  if (searchInputEl) searchInputEl.value = '';
  var resolvedTypes = resolvedQuestionsExamTypes();
  await Promise.all([loadQuestionsTopics(resolvedTypes), loadQuestionsSources(resolvedTypes), loadQuestionsPage()]);
  var sourceWrapEl = document.getElementById('questions-source-filter-wrap');
  if (sourceWrapEl) sourceWrapEl.innerHTML = renderQuestionsSourceFilterHtml();
  drawQuestionsResults();
}

// Reloads just the page for the *unchanged* scope -- topic tab clicks, search, and pagination all
// keep whatever track set and topic counts are already loaded, no need to refetch either.
async function refreshQuestionsPage() {
  await loadQuestionsPage();
  drawQuestionsResults();
}

// Like refreshQuestionsPage(), but also re-pulls topic counts -- a delete/import can add or zero
// out a topic within the current scope, unlike a topic-tab click, search, or page turn.
async function refreshQuestionsAfterMutation() {
  await Promise.all([loadQuestionsTopics(resolvedQuestionsExamTypes()), loadQuestionsPage()]);
  drawQuestionsResults();
}

async function renderQuestions() {
  appEl.innerHTML = renderTabs('questions') + renderQuestionsTrackPicker() +
    '<div class="card questions-toolbar">' +
    '<input type="search" class="settings-filter-input questions-search-input" id="questions-search-input" placeholder="Search question text…">' +
    '<span id="questions-source-filter-wrap">' + renderQuestionsSourceFilterHtml() + '</span>' +
    '<button class="btn-primary btn-sm" data-act="import-questions">Import JSON…</button> ' +
    '<input type="file" id="import-file" class="hidden-file-input" accept="application/json">' +
    '</div>' +
    '<div id="questions-results"><p class="muted">Loading…</p></div>';
  await refreshQuestionsScope();
}

// ---- Stats --------------------------------------------------------------

// Attempts arrive flat (most-recent-first) from /console/exam-attempts -- grouped here by
// userId so each user's full attempt history nests under one summary row, instead of every
// attempt from every user interleaved in one long table.
function groupExamAttemptsByUser(items) {
  var byUser = {}, order = [];
  items.forEach(function (a) {
    if (!byUser[a.userId]) {
      byUser[a.userId] = { userId: a.userId, code: a.code, buyerEmail: a.buyerEmail, examType: a.examType, attempts: [] };
      order.push(a.userId);
    }
    byUser[a.userId].attempts.push(a);
  });
  return order.map(function (id) { return byUser[id]; });
}

function renderExamUserGroup(u) {
  var best = Math.max.apply(null, u.attempts.map(function (a) { return a.percent; }));
  var passedCount = u.attempts.filter(function (a) { return a.passed; }).length;
  var who = u.buyerEmail || u.code || 'Unknown user';
  var whoSub = u.buyerEmail && u.code ? ' <span class="muted">(' + u.code + ')</span>' : '';

  var attemptsHtml = u.attempts.map(function (a) {
    var scoreCls = a.passed ? 'exam-review-correct' : 'exam-review-incorrect';
    return '<details class="exam-attempt-detail" data-attempt-id="' + a.attemptId + '">' +
      '<summary>' + new Date(a.submittedAt * 1000).toLocaleString() + ' — <span class="' + scoreCls + '">' + a.correct + ' / ' + a.total + '</span>' +
      ' (' + a.percent + '%) <span class="badge ' + (a.passed ? 'redeemed' : 'revoked') + '">' +
      (a.passed ? 'Passed' : 'Not passed') + '</span></summary>' +
      '<div class="exam-attempt-review" id="exam-attempt-review-' + a.attemptId + '"><p class="muted">Loading…</p></div>' +
      '</details>';
  }).join('');

  return '<details class="card admin-user-group">' +
    '<summary><strong>' + who + '</strong>' + whoSub + ' — ' + u.examType + ' — ' + u.attempts.length +
    ' attempt' + (u.attempts.length === 1 ? '' : 's') + ', best ' + best + '%, ' + passedCount + ' passed</summary>' +
    '<div class="admin-user-items">' + attemptsHtml + '</div>' +
    '</details>';
}

// Resource-progress rows are already the leaf-level detail (no further drill-down needed like
// exam attempts have), so each grouped user just lists its resources directly -- no nested
// <details>/lazy-fetch for this one.
function groupResourceProgressByUser(items) {
  var byUser = {}, order = [];
  items.forEach(function (r) {
    if (!byUser[r.user_id]) {
      byUser[r.user_id] = { userId: r.user_id, code: r.code, buyerEmail: r.buyer_email, examType: r.exam_type, items: [] };
      order.push(r.user_id);
    }
    byUser[r.user_id].items.push(r);
  });
  return order.map(function (id) { return byUser[id]; });
}

function renderResourceUserGroup(u) {
  var who = u.buyerEmail || u.code || 'Unknown user';
  var whoSub = u.buyerEmail && u.code ? ' <span class="muted">(' + u.code + ')</span>' : '';

  var rows = u.items.map(function (r) {
    var extent = (r.resource_type === 'audio' || r.resource_type === 'video') ? r.percent + '%' : (r.percent >= 100 ? 'Viewed' : '—');
    return '<tr>' +
      '<td>' + r.resource_file + '</td>' +
      '<td class="muted">' + r.resource_type + '</td>' +
      '<td>' + extent + '</td>' +
      '<td>' + r.times_opened + '</td>' +
      '<td class="muted">' + new Date(r.last_opened_at * 1000).toLocaleDateString() + '</td>' +
      '</tr>';
  }).join('');

  return '<details class="card admin-user-group">' +
    '<summary><strong>' + who + '</strong>' + whoSub + ' — ' + u.examType + ' — ' + u.items.length +
    ' resource' + (u.items.length === 1 ? '' : 's') + '</summary>' +
    '<table class="admin-user-table resource-consumption-table"><thead><tr><th>Resource</th><th>Type</th><th>Progress</th><th>Views</th><th>Last viewed</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '</details>';
}

// Quiz-progress rows arrive as one row per (user, topic) -- grouped here into one card per user,
// each holding its own per-topic accuracy table, mirroring the student's own Progress tab.
// Users are ranked by total questions answered, most active first.
//
// NOTE: this "total/correct" is the same "last attempt wins" combined figure the student's own
// Progress tab shows -- the underlying progress table doesn't record whether a question's current
// status came from quiz mode or a mock exam (a question answered in both only reflects whichever
// happened most recently, see index.js's progressUpsertStmt comment). So it is NOT quiz-only, and
// can't be exactly decomposed into quiz-vs-exam portions. The one exact, unambiguous number we can
// add is the mock-exam side, pulled straight from exam_attempts (see attachExamTotals below).
function groupQuizProgressByUser(items) {
  var byUser = {}, order = [];
  items.forEach(function (r) {
    if (!byUser[r.user_id]) {
      byUser[r.user_id] = {
        userId: r.user_id, code: r.code, buyerEmail: r.buyer_email, examType: r.exam_type, topics: [],
        total: 0, correct: 0, examTotal: 0, examCorrect: 0, seen: 0, topicTotal: 0,
      };
      order.push(r.user_id);
    }
    var u = byUser[r.user_id];
    u.topics.push({ topic: r.topic, total: r.total, correct: r.correct, seen: r.seen, topicTotal: r.topicTotal });
    u.total += r.total;
    u.correct += r.correct;
    u.seen += r.seen;
    u.topicTotal += r.topicTotal;
  });
  var grouped = order.map(function (id) { return byUser[id]; });
  grouped.sort(function (a, b) { return b.total - a.total; });
  return grouped;
}

// Sums each user's submitted mock-exam attempts (correct/total) onto their progress group --
// exam_attempts is per-attempt and mode-unambiguous, unlike the merged progress table above.
function attachExamTotals(groups, examAttemptItems) {
  var byUser = {};
  examAttemptItems.forEach(function (a) {
    if (!byUser[a.userId]) byUser[a.userId] = { correct: 0, total: 0 };
    byUser[a.userId].correct += a.correct;
    byUser[a.userId].total += a.total;
  });
  groups.forEach(function (u) {
    var e = byUser[u.userId];
    u.examCorrect = e ? e.correct : 0;
    u.examTotal = e ? e.total : 0;
  });
  return groups;
}

function topicPctOf(t) { return t.total ? Math.round((100 * t.correct) / t.total) : 0; }
function topicCoverageOf(t) { return t.topicTotal ? Math.round((100 * t.seen) / t.topicTotal) : 0; }
var accuracyPassPct = 70; // overwritten from /console/quiz-progress with the admin-configured value
var coveragePassPct = 50; // overwritten from /console/quiz-progress with the admin-configured value
function accuracyRowClass(pct) { return pct < accuracyPassPct ? 'progress-row-low' : 'progress-row-good'; }
function coverageClass(pct) { return pct < coveragePassPct ? 'progress-row-low' : 'progress-row-good'; }

var QUIZ_PROGRESS_TOPIC_COLUMNS = [['topic', 'Topic'], ['pct', 'Accuracy'], ['coverage', 'Coverage'], ['total', 'Questions']];
var quizProgressGroupsCache = []; // userId -> group, so a per-user sort click can redraw without refetching
var quizProgressTopicSort = {}; // userId -> { key, dir }, independent sort state per user's table

function quizProgressTableHtml(u) {
  var sort = quizProgressTopicSort[u.userId] || (quizProgressTopicSort[u.userId] = { key: 'topic', dir: 1 });
  var rows = u.topics.slice().sort(function (a, b) {
    var av = sort.key === 'topic' ? a.topic.toLowerCase() : sort.key === 'pct' ? topicPctOf(a) : sort.key === 'coverage' ? topicCoverageOf(a) : a.total;
    var bv = sort.key === 'topic' ? b.topic.toLowerCase() : sort.key === 'pct' ? topicPctOf(b) : sort.key === 'coverage' ? topicCoverageOf(b) : b.total;
    if (av < bv) return -1 * sort.dir;
    if (av > bv) return 1 * sort.dir;
    return 0;
  }).map(function (t) {
    var pct = topicPctOf(t);
    var coverage = topicCoverageOf(t);
    // Coverage is its own cell-level color, independent of the row's accuracy-based color -- a
    // topic can be low-accuracy but well-covered, or vice versa, two separate signals.
    return '<tr class="' + accuracyRowClass(pct) + '"><td>' + t.topic + '</td><td>' + pct + '%</td>' +
      '<td><span class="' + coverageClass(coverage) + '">' + coverage + '%</span></td><td>' + t.total + '</td></tr>';
  }).join('');
  var headerCells = QUIZ_PROGRESS_TOPIC_COLUMNS.map(function (c) {
    var indicator = sort.key === c[0] ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-act="sort-quiz-progress-topics" data-user-id="' + u.userId + '" data-key="' + c[0] + '">' + c[1] + indicator + '</th>';
  }).join('');
  return '<table class="admin-user-table"><thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderQuizProgressUserGroup(u) {
  var pct = u.total ? Math.round((100 * u.correct) / u.total) : 0;
  var coverage = u.topicTotal ? Math.round((100 * u.seen) / u.topicTotal) : 0;
  var examPct = u.examTotal ? Math.round((100 * u.examCorrect) / u.examTotal) : 0;
  var examLine = u.examTotal
    ? 'Mock exam: ' + u.examCorrect + '/' + u.examTotal + ' (' + examPct + '%)'
    : 'Mock exam: no attempts yet';

  return '<details class="card admin-user-group">' +
    '<summary><strong>' + (u.code || 'Unknown code') + '</strong> - ' + u.examType + ' - (' +
    '<span class="' + accuracyRowClass(pct) + '">' + pct + '% Accuracy</span>, ' +
    '<span class="' + coverageClass(coverage) + '">' + coverage + '% Coverage</span>)</summary>' +
    '<p class="muted admin-user-subline">' + examLine + '</p>' +
    '<div id="quiz-progress-table-' + u.userId + '">' + quizProgressTableHtml(u) + '</div>' +
    '</details>';
}

// Leaderboard -- top 3 by accuracy, top 3 by coverage, per track, built entirely from the same
// quizProgressGroupsCache the "User progress" section above already has (no separate fetch needed,
// unlike the public site which needs its own /leaderboard endpoint to avoid exposing every user's
// data to a student's browser). Only users who've answered at least leaderboardMinQuestions
// qualify. Descending-only sort, no ascending direction.
var leaderboardMinQuestions = 20; // overwritten from /console/quiz-progress
var leaderboardSortKeyByTrack = {}; // examType -> 'accuracy' | 'coverage'

function groupLeaderboardByTrack(groups) {
  var byTrack = {}, order = [];
  groups.forEach(function (u) {
    if (u.total < leaderboardMinQuestions) return;
    if (!byTrack[u.examType]) { byTrack[u.examType] = []; order.push(u.examType); }
    byTrack[u.examType].push({
      userId: u.userId, who: u.buyerEmail || u.code || 'Unknown user',
      total: u.total, accuracy: u.total ? Math.round((100 * u.correct) / u.total) : 0,
      coverage: u.topicTotal ? Math.round((100 * u.seen) / u.topicTotal) : 0,
    });
  });
  return order.map(function (examType) {
    var users = byTrack[examType];
    var topByAccuracy = users.slice().sort(function (a, b) { return b.accuracy - a.accuracy; }).slice(0, 3);
    var topByCoverage = users.slice().sort(function (a, b) { return b.coverage - a.coverage; }).slice(0, 3);
    var seenIds = {};
    var combined = topByAccuracy.concat(topByCoverage).filter(function (u) {
      if (seenIds[u.userId]) return false;
      seenIds[u.userId] = true;
      return true;
    });
    return { examType: examType, users: combined };
  });
}

function leaderboardTrackTableHtml(track) {
  var key = leaderboardSortKeyByTrack[track.examType] || (leaderboardSortKeyByTrack[track.examType] = 'accuracy');
  if (!track.users.length) return '<p class="muted">No one on this track has answered at least ' + leaderboardMinQuestions + ' questions yet.</p>';
  var rows = track.users.slice().sort(function (a, b) { return b[key] - a[key]; }).slice(0, 3).map(function (u) {
    return '<tr><td>' + u.who + '</td><td>' + u.accuracy + '%</td><td>' + u.coverage + '%</td><td>' + u.total + '</td></tr>';
  }).join('');
  var arrow = function (k) { return key === k ? ' ▼' : ''; };
  return '<table class="admin-user-table"><thead><tr>' +
    '<th>User</th>' +
    '<th data-act="sort-leaderboard" data-track="' + track.examType + '" data-key="accuracy">Accuracy' + arrow('accuracy') + '</th>' +
    '<th data-act="sort-leaderboard" data-track="' + track.examType + '" data-key="coverage">Coverage' + arrow('coverage') + '</th>' +
    '<th>Questions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

var examAttemptDetailCache = {}; // attemptId -> already-fetched review, avoids refetching on re-toggle

async function loadExamAttemptReview(attemptId) {
  var reviewEl = document.getElementById('exam-attempt-review-' + attemptId);
  if (!reviewEl) return;
  if (examAttemptDetailCache[attemptId]) { reviewEl.innerHTML = examAttemptDetailCache[attemptId]; return; }
  try {
    var detail = await apiFetch('/console/exam-attempts/detail?attemptId=' + encodeURIComponent(attemptId));
    var html = detail.review.map(function (r, i) {
      return '<div class="exam-review-row">' +
        '<div><strong>Q' + (i + 1) + '.</strong> ' + r.topic + ' — ' + r.question + '</div>' +
        '<div class="muted">Your answer: ' + (r.yourChoice ? r.yourChoice + '. ' + r.choices[r.yourChoice] : '(not answered)') + '</div>' +
        (r.correct ? '' : '<div class="muted">Correct answer: ' + r.correctChoice + '. ' + r.choices[r.correctChoice] + '</div>') +
        '<div class="' + (r.correct ? 'exam-review-correct' : 'exam-review-incorrect') + '">' + (r.correct ? 'Correct' : 'Incorrect') + '</div>' +
        '</div>';
    }).join('');
    examAttemptDetailCache[attemptId] = html;
    reviewEl.innerHTML = html;
  } catch (err) {
    reviewEl.innerHTML = '<p class="muted">Could not load this attempt.</p>';
  }
}

// Capture phase: the native "toggle" event on <details> doesn't bubble in every browser, but
// capturing always reaches the target on the way down regardless, so this still fires reliably.
appEl.addEventListener('toggle', function (e) {
  var el = e.target;
  if (!el.classList || !el.classList.contains('exam-attempt-detail') || !el.open) return;
  loadExamAttemptReview(el.getAttribute('data-attempt-id'));
}, true);

// Grouped per-track (exam_type) rather than one flat table with an "Exam" column repeating the
// same value on every row -- accuracy/coverage should always read within one track's context, and
// once DRE/MLO have real content a flat list would only get more confusing to scan. Each track is
// its own collapsible group (closed by default, like the User progress cards below it), with
// independent sort/show-all state, mirroring the per-user topic tables' own pattern.
var ACCURACY_NUMERIC_KEYS = new Set(['pct', 'attempts']);
var ACCURACY_TRACK_COLUMNS = [['topic', 'Topic'], ['pct', '% correct'], ['attempts', 'Attempts']];
var statsAccuracyCache = [];
var accuracySortByTrack = {}; // examType -> { key, dir }
var accuracyExpandedByTrack = {}; // examType -> bool (show-all topics within that track)
var ACCURACY_COLLAPSED_COUNT = 8;

function groupAccuracyByTrack(rows) {
  var byTrack = {}, order = [];
  rows.forEach(function (r) {
    if (!byTrack[r.exam_type]) { byTrack[r.exam_type] = []; order.push(r.exam_type); }
    byTrack[r.exam_type].push(r);
  });
  return order.map(function (examType) { return { examType: examType, topics: byTrack[examType] }; });
}

function accuracyTrackTableHtml(track) {
  var sort = accuracySortByTrack[track.examType] || (accuracySortByTrack[track.examType] = { key: 'topic', dir: 1 });
  var sorted = sortTableRows(track.topics, sort, ACCURACY_NUMERIC_KEYS);
  var expanded = accuracyExpandedByTrack[track.examType];
  var truncated = !expanded && sorted.length > ACCURACY_COLLAPSED_COUNT;
  var visible = truncated ? sorted.slice(0, ACCURACY_COLLAPSED_COUNT) : sorted;
  var body = visible.map(function (a) {
    return '<tr class="' + accuracyRowClass(a.pct) + '"><td>' + a.topic + '</td><td>' + a.pct + '%</td><td>' + a.attempts + '</td></tr>';
  }).join('');
  var headerRow = '<tr>' + ACCURACY_TRACK_COLUMNS.map(function (c) {
    var indicator = sort.key === c[0] ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-act="sort-accuracy" data-track="' + track.examType + '" data-key="' + c[0] + '">' + c[1] + indicator + '</th>';
  }).join('') + '</tr>';
  var toggleHtml = sorted.length > ACCURACY_COLLAPSED_COUNT
    ? '<button class="btn-secondary btn-sm" type="button" data-act="toggle-accuracy-topics" data-track="' + track.examType + '">' +
      (truncated ? 'Show all ' + sorted.length + ' ▾' : 'Show fewer ▴') + '</button>'
    : '';
  return '<table><thead>' + headerRow + '</thead><tbody>' + body + '</tbody></table>' + toggleHtml;
}

function drawAccuracyTable() {
  var container = document.getElementById('accuracy-table-container');
  if (!container) return;
  var tracks = groupAccuracyByTrack(statsAccuracyCache);
  container.innerHTML = tracks.map(function (track) {
    return '<details class="card admin-user-group">' +
      '<summary><strong>' + track.examType + '</strong> — ' + track.topics.length + ' topic' + (track.topics.length === 1 ? '' : 's') + '</summary>' +
      '<div id="accuracy-track-table-' + track.examType + '">' + accuracyTrackTableHtml(track) + '</div>' +
      '</details>';
  }).join('');
}

async function renderStats() {
  appEl.innerHTML = renderTabs('stats') + '<p>Loading…</p>';
  var results = await Promise.all([
    apiFetch('/console/stats'), apiFetch('/console/resource-progress'), apiFetch('/console/exam-attempts'), apiFetch('/console/quiz-progress'),
    apiFetch('/console/funnel').catch(function () { return { stages: [] }; }),
    apiFetch('/console/waitlist').catch(function () { return { items: [] }; }),
  ]);
  var s = results[0], resourceProgress = results[1], examAttempts = results[2], quizProgress = results[3], funnel = results[4], waitlist = results[5];
  if (typeof quizProgress.accuracyPassPct === 'number') accuracyPassPct = quizProgress.accuracyPassPct;
  if (typeof quizProgress.coveragePassPct === 'number') coveragePassPct = quizProgress.coveragePassPct;
  if (typeof quizProgress.leaderboardMinQuestions === 'number') leaderboardMinQuestions = quizProgress.leaderboardMinQuestions;
  var codeRows = s.codes.map(function (c) {
    return '<tr><td>' + c.exam_type + '</td><td>' + c.status + '</td><td>' + c.n + '</td></tr>';
  }).join('');
  statsAccuracyCache = s.accuracyByTopic.map(function (a) {
    return { exam_type: a.exam_type, topic: a.topic, attempts: a.attempts, pct: a.attempts ? Math.round((100 * a.correct) / a.attempts) : 0 };
  });
  var resourceUsersHtml = groupResourceProgressByUser(resourceProgress.items).map(renderResourceUserGroup).join('');
  var resourceEmpty = resourceProgress.items.length ? '' : '<p class="muted">No resource activity yet.</p>';
  var examUsersHtml = groupExamAttemptsByUser(examAttempts.items).map(renderExamUserGroup).join('');
  var examEmpty = examAttempts.items.length ? '' : '<p class="muted">No mock exams taken yet.</p>';
  quizProgressGroupsCache = attachExamTotals(groupQuizProgressByUser(quizProgress.items), examAttempts.items);
  var quizUsersHtml = quizProgressGroupsCache.map(renderQuizProgressUserGroup).join('');
  var quizEmpty = quizProgress.items.length ? '' : '<p class="muted">No quiz activity yet.</p>';
  var leaderboardTracksHtml = groupLeaderboardByTrack(quizProgressGroupsCache).map(function (track) {
    return '<details class="card admin-user-group">' +
      '<summary><strong>' + track.examType + '</strong></summary>' +
      '<div id="leaderboard-table-' + track.examType + '">' + leaderboardTrackTableHtml(track) + '</div>' +
      '</details>';
  }).join('');
  var leaderboardEmpty = quizProgressGroupsCache.length ? '' : '<p class="muted">No quiz activity yet.</p>';

  var funnelStages = funnel.stages || [];
  var funnelHtml = funnelStages.length
    ? '<div class="card"><h3>Marketing Funnel (all-time)</h3>' +
      '<p class="muted page-intro-text">Independent stage totals, not a strict single path -- a visitor can skip straight to purchase without completing a sample quiz first.</p>' +
      '<div class="code-detail-stat-grid">' + funnelStages.map(function (st) {
        return codeDetailStat(st.label, st.count);
      }).join('') + '</div></div>'
    : '';

  var waitlistItems = (waitlist.items || []).slice(0, 30); // already sorted by count desc server-side
  var waitlistHtml = waitlistItems.length
    ? '<div class="card"><h3>Track Waitlist (demand for not-yet-live states)</h3>' +
      '<p class="muted page-intro-text">From the "notify me" prompt on category pages. Check before/when building a new state.</p>' +
      '<table><thead><tr><th>Kind</th><th>State</th><th>Signups</th><th>Last signup</th></tr></thead><tbody>' +
      waitlistItems.map(function (w) {
        return '<tr><td>' + escapeHtml(w.kind) + '</td><td>' + escapeHtml(w.state_code) + '</td><td>' + w.count + '</td>' +
          '<td>' + new Date(w.last_signup_at * 1000).toLocaleDateString() + '</td></tr>';
      }).join('') + '</tbody></table></div>'
    : '';

  appEl.innerHTML = renderTabs('stats') +
    '<div class="card"><strong>' + s.totalUsers + '</strong> total users</div>' +
    funnelHtml +
    waitlistHtml +
    '<div class="stats-grid">' +
    '<div class="stats-column"><h3>Codes by status</h3><table><thead><tr><th>Exam</th><th>Status</th><th>Count</th></tr></thead><tbody>' + codeRows + '</tbody></table></div>' +
    '<div class="stats-column"><h3>Accuracy by topic</h3><div id="accuracy-table-container"></div></div>' +
    '</div>' +
    '<div class="stats-grid">' +
    '<div class="stats-column"><h3>User progress</h3>' +
    '<p class="muted page-intro-text">Per-user accuracy by topic (quiz + mock exam combined, same as each user\'s own Progress tab), plus their mock-exam-only total.</p>' +
    quizEmpty + quizUsersHtml + '</div>' +
    '<div class="stats-column"><h3>Mock exam attempts</h3>' +
    '<p class="muted page-intro-text">Grouped by user, most recently active first. Expand a user to see each attempt; ' +
    'expand an attempt for the full question-by-question review. Capped at the 1000 most recent attempts.</p>' +
    examEmpty + examUsersHtml + '</div>' +
    '</div>' +
    '<div class="stats-column"><h3>Leaderboard</h3>' +
    '<p class="muted page-intro-text">Top 3 by accuracy and by coverage, per track, among users who\'ve answered at least ' +
    leaderboardMinQuestions + ' questions.</p>' +
    leaderboardEmpty + leaderboardTracksHtml + '</div>' +
    '<div class="stats-column"><h3>Resource consumption</h3>' + resourceEmpty + resourceUsersHtml + '</div>';
  drawAccuracyTable();
}

// ---- Settings (course pricing) --------------------------------------------
// Grouped-save editing: every input carries data-original (the loaded value), and each group
// (a data-group container) has exactly one Save button that stays disabled until something in
// that group differs from its original — see updateSettingsDirtyState()/markSettingsGroupSaved() below.
// Course pricing and Point rules render as compact tables (not one card per row) since the
// track list keeps growing (18 and counting) and a stacked-card layout doesn't scale.

function settingsSaveButton(act, group, label) {
  return '<button class="btn-primary btn-sm" data-act="' + act + '" data-group="' + group + '" disabled>' + label + '</button>';
}

// Show all / show fewer on the pricing table, mirroring the Stats tab's per-track accuracy
// table pattern (ACCURACY_COLLAPSED_COUNT). Rows stay in the DOM always -- only display is
// toggled -- so an in-progress (unsaved) edit in a collapsed row survives expanding/collapsing,
// unlike a re-render that would reset inputs back to their loaded values.
// State/type pill filters mirror the public site's track hub (renderHubStateFilterPills /
// renderHubKindFilterPills) -- same combine-by-AND behavior, same "fresh filter starts collapsed
// again" reasoning. Unlike the hub, this also layers a free-text filter on top; all three combine,
// and Show-all/collapse applies to whatever the combined filter currently matches (so "Show all N"
// always means N *matching* tracks, not the full 22).
var PRICING_COLLAPSED_COUNT = 7;
var pricingRowsExpanded = false;
var pricingFilterQuery = '';
var pricingKindFilter = ''; // '' = All types; otherwise an EXAM_TYPES examKind (e.g. 'Driver')
var PRICING_COLUMNS = [['track', 'Track'], ['price', 'Price (USD)'], ['active', 'Active'], ['kind', 'Category'], ['state', 'State'], ['examReq', 'Exam Req?'],
  ['questions', 'Questions'], ['examQs', 'Exam Qs'], ['bankPct', '% of Bank'], ['duration', 'Duration'], ['passScore', 'Pass Score'], ['minCorrect', 'Min Correct']];
var PRICING_CELL_INDEX = { track: 0, price: 1, active: 2, kind: 3, state: 4, examReq: 5, questions: 6, examQs: 7, bankPct: 8, duration: 9, passScore: 10, minCorrect: 11 };

var pricingSort = { key: '', dir: 1 }; // key: '' = unsorted (original EXAM_TYPES order)

// Sorts by moving the existing <tr> DOM nodes (appendChild on an already-attached node relocates
// it rather than cloning) instead of regenerating the tbody from data -- a data-driven re-render
// would reset every price input back to its loaded value, wiping any in-progress unsaved edit.
// Price sorts by the input's current (possibly unsaved) value, same "what's on screen" reasoning.
function applyPricingSortOrder() {
  if (!pricingSort.key) return;
  var tbody = document.getElementById('pricing-rows-body');
  if (!tbody) return;
  var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-row-key]'));
  var key = pricingSort.key;
  rows.sort(function (a, b) {
    var av, bv;
    if (key === 'price') {
      av = parseFloat(a.querySelector('.price-input').value); bv = parseFloat(b.querySelector('.price-input').value);
      av = isNaN(av) ? -Infinity : av; bv = isNaN(bv) ? -Infinity : bv;
    } else if (key === 'active') {
      av = a.querySelector('.track-active-input').checked ? 1 : 0;
      bv = b.querySelector('.track-active-input').checked ? 1 : 0;
    } else if (key === 'questions' || key === 'examQs' || key === 'passScore' || key === 'bankPct' || key === 'minCorrect') {
      // Plain numbers ("311"), a trailing "%" ("70%"), or "—" when there's no bank yet to divide
      // by (bankPct) -- parseFloat stops at the first non-numeric char, and NaN (the "—" case)
      // sorts as the lowest value rather than corrupting the whole sort.
      av = parseFloat(a.children[PRICING_CELL_INDEX[key]].textContent);
      bv = parseFloat(b.children[PRICING_CELL_INDEX[key]].textContent);
      av = isNaN(av) ? -Infinity : av; bv = isNaN(bv) ? -Infinity : bv;
    } else if (key === 'duration') {
      // "60 min" / "Untimed" aren't directly comparable text -- sort by the raw seconds instead,
      // stashed on the cell as data-seconds when the row was built.
      av = Number(a.children[PRICING_CELL_INDEX.duration].dataset.seconds);
      bv = Number(b.children[PRICING_CELL_INDEX.duration].dataset.seconds);
    } else {
      // track / state / kind -- plain text compare on whatever column this key maps to.
      var idx = PRICING_CELL_INDEX[key];
      av = a.children[idx].textContent.toLowerCase(); bv = b.children[idx].textContent.toLowerCase();
    }
    if (av < bv) return -1 * pricingSort.dir;
    if (av > bv) return 1 * pricingSort.dir;
    return 0;
  });
  rows.forEach(function (row) { tbody.appendChild(row); });
}

function renderPricingKindFilterPills() {
  var kinds = [];
  EXAM_TYPES.forEach(function (t) { if (kinds.indexOf(t[3]) === -1) kinds.push(t[3]); });
  kinds.sort(function (a, b) { return a.localeCompare(b); });
  // No state filter on this tab (removed -- the free-text search below already covers narrowing by
  // state, since every track label includes its state name, e.g. "California Real Estate Broker"),
  // so kind-pill counts are just a flat count per kind, no cross-filtering to combine with.
  var options = [['', 'All Types (' + EXAM_TYPES.length + ')']].concat(kinds.map(function (k) {
    var count = EXAM_TYPES.filter(function (t) { return t[3] === k; }).length;
    return [k, k + ' (' + count + ')'];
  }));
  return '<div class="settings-filter-pill" role="group" aria-label="Filter by exam type">' +
    options.map(function (o) {
      var active = pricingKindFilter === o[0];
      return '<button type="button" class="' + (active ? 'active' : '') + '" data-act="filter-pricing-kind" data-kind="' + o[0] + '"' +
        (active ? ' aria-current="true"' : '') + '>' + o[1] + '</button>';
    }).join('') + '</div>';
}

function updatePricingRowVisibility() {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#pricing-rows-body tr[data-row-key]'));
  var q = pricingFilterQuery.trim().toLowerCase();
  var matchCount = 0, shown = 0;
  rows.forEach(function (row) {
    var matchesText = !q || row.children[PRICING_CELL_INDEX.track].textContent.toLowerCase().indexOf(q) !== -1;
    var matchesCategory = !pricingKindFilter || row.dataset.kind === pricingKindFilter;
    var matches = matchesText && matchesCategory;
    if (matches) matchCount++;
    var visible = matches && (pricingRowsExpanded || shown < PRICING_COLLAPSED_COUNT);
    row.style.display = visible ? '' : 'none';
    if (visible) shown++;
  });
  var toggleBtn = document.getElementById('pricing-show-all-toggle');
  if (!toggleBtn) return;
  if (matchCount <= PRICING_COLLAPSED_COUNT) {
    toggleBtn.style.display = 'none';
  } else {
    toggleBtn.style.display = '';
    toggleBtn.textContent = pricingRowsExpanded ? 'Show fewer ▴' : 'Show all ' + matchCount + ' ▾';
  }
}

// Tracks page: course pricing table, moved off Settings onto its own full-width page (2026-08-17)
// -- the track list (22+ and counting) reads much better with the full viewport than squeezed into
// one of two settings-page columns.
async function renderTracks() {
  appEl.innerHTML = renderTabs('tracks') + '<p>Loading…</p>';
  var results = await Promise.all([
    apiFetch('/console/pricing'),
    apiFetch('/console/questions/counts'),
  ]);
  var pricingData = results[0], questionCountsData = results[1];

  var byExam = {};
  pricingData.pricing.forEach(function (p) { byExam[p.exam_type] = p; });
  var questionCountByExam = {};
  questionCountsData.counts.forEach(function (c) { questionCountByExam[c.exam_type] = c.count; });
  function examDurationLabel(durationSec) {
    return durationSec ? Math.round(durationSec / 60) + ' min' : 'Untimed';
  }
  // active/isExamRequired/mechanics all come straight from TRACK_REGISTRY_FULL (fetched once at
  // boot, see loadTrackRegistry()) -- track_registry.active is the real column now, not a
  // separate app_settings override layered on top of a hardcoded code default.
  var pricingRows = EXAM_TYPES.map(function (t) {
    var examType = t[0], label = t[1], stateCode = t[2], examKind = t[3];
    var registryRow = TRACK_REGISTRY_FULL[examType] || {};
    var p = byExam[examType];
    var dollars = p ? (p.price_cents / 100).toFixed(2) : '';
    var trackActive = registryRow.active !== false;
    var trackActiveOriginal = trackActive ? 'true' : 'false';
    var questionCount = questionCountByExam[examType] || 0;
    var examConfig = {
      questionCount: registryRow.questionCount != null ? registryRow.questionCount : 45,
      durationSec: registryRow.durationSec != null ? registryRow.durationSec : 3600,
      passPercent: registryRow.passPercent != null ? registryRow.passPercent : 70,
      minCorrect: registryRow.minCorrect != null ? registryRow.minCorrect : 32,
    };
    var bankPct = questionCount > 0 ? (examConfig.questionCount / questionCount * 100) : null;
    var bankPctLabel = bankPct !== null ? bankPct.toFixed(1) + '%' : '—';
    var examRequired = registryRow.isExamRequired !== false;
    // Bold red is reserved for the actual risk case: a thin practice bank (>25% of the pool drawn
    // per sitting) AND a real, state-required exam -- a low-stakes/no-exam-required track with the
    // same thin-bank ratio isn't worth flagging the same way. Low-ratio tracks keep the existing
    // green "healthy bank" indicator regardless of exam-required status.
    var bankPctRowClass = bankPct === null ? '' : (bankPct > 25 && examRequired ? 'settings-bankpct-high' : (bankPct <= 25 ? 'settings-bankpct-low' : ''));
    // Exam Qs/Duration/Pass Score/Min Correct are populated for EVERY track, including ones with
    // "Exam Req? No" -- those numbers aren't fake or a data error, they're the self-set benchmark
    // for this site's own practice mock-exam feature (which we still offer even when the real state
    // has no graded exam to require), same thing the public site's own per-track disclaimer already
    // discloses ("a self-directed study benchmark we set for practice purposes only..."). Without
    // that context here too, a real Pass Score/Min Correct sitting right next to "No" reads as
    // contradictory -- italicized + a tooltip carries the same disclosure into this table.
    var practiceOnlyAttrs = examRequired ? '' : ' class="muted settings-readonly-cell settings-practice-only" title="No real state exam exists for this track -- these are this site\'s own self-set practice mock-exam benchmark, not a state requirement."';
    var mockExamCellAttrs = examRequired ? ' class="muted settings-readonly-cell"' : practiceOnlyAttrs;
    return '<tr class="' + bankPctRowClass + '" data-row-key="' + examType + '" data-state="' + stateCode + '" data-kind="' + examKind + '"><td>' + label + '</td>' +
      '<td>' +
      '<input type="number" step="0.01" min="0" class="price-input" data-exam="' + examType + '" data-original="' + dollars + '" value="' + dollars + '" placeholder="0.00">' +
      '</td><td><label class="rule-active-label"><input type="checkbox" class="track-active-input" data-exam="' + examType + '" data-original="' + trackActiveOriginal + '"' +
      (trackActive ? ' checked' : '') + '></label></td>' +
      '<td class="muted">' + examKind + '</td>' +
      '<td class="muted">' + (STATE_LABELS[stateCode] || stateCode) + '</td>' +
      '<td class="muted settings-readonly-cell">' + (examRequired ? 'Yes' : 'No') + '</td>' +
      '<td class="muted settings-readonly-cell">' + questionCount + '</td>' +
      '<td' + mockExamCellAttrs + '>' + examConfig.questionCount + '</td>' +
      '<td class="muted settings-readonly-cell">' + bankPctLabel + '</td>' +
      '<td' + mockExamCellAttrs + ' data-seconds="' + examConfig.durationSec + '">' + examDurationLabel(examConfig.durationSec) + '</td>' +
      '<td' + mockExamCellAttrs + '>' + examConfig.passPercent + '%</td>' +
      '<td' + mockExamCellAttrs + '>' + (examConfig.minCorrect != null ? examConfig.minCorrect : '—') + '</td></tr>';
  }).join('');

  appEl.innerHTML = renderTabs('tracks') +
    '<section class="card settings-edit-group" data-group="pricing">' +
    '<div class="settings-edit-toolbar">' +
    '<div><h3>Course pricing</h3><p class="muted page-intro-text">Price shown to buyers on the public site\'s self-serve purchase flow, in USD. ' +
    'For a track marked "Exam Req? No," Exam Qs/Duration/Pass Score/Min Correct (shown italicized below) describe this site\'s own self-set practice mock-exam benchmark, not a real state requirement -- the real state has no graded exam for that track.</p></div>' +
    settingsSaveButton('save-pricing-changes', 'pricing', 'Save changes') +
    '</div>' +
    '<div class="settings-filter-pills-row" id="pricing-kind-filter-wrap">' + renderPricingKindFilterPills() + '</div>' +
    '<input type="search" class="settings-filter-input" placeholder="Filter tracks (e.g. by state)…">' +
    '<div class="settings-table-scroll"><table class="settings-edit-table"><thead id="pricing-table-head">' + sortableHeaderRow(PRICING_COLUMNS, pricingSort, 'sort-pricing') + '</thead>' +
    '<tbody id="pricing-rows-body">' + pricingRows + '</tbody></table></div>' +
    '<button class="btn-secondary btn-sm settings-table-toggle" type="button" id="pricing-show-all-toggle" data-act="toggle-pricing-rows">Show all</button>' +
    '</section>';
  pricingFilterQuery = '';
  applyPricingSortOrder();
  updatePricingRowVisibility();
}

function parseCsvSetting(settingsResp, key) {
  var row = settingsResp.settings.filter(function (s) { return s.key === key; })[0];
  return (row ? row.value : '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

async function renderSettings() {
  appEl.innerHTML = renderTabs('settings') + '<p>Loading…</p>';
  var results = await Promise.all([
    apiFetch('/console/point-rules'),
    apiFetch('/console/settings'),
  ]);
  var pointRulesData = results[0], settingsData = results[1];

  var bySetting = {};
  settingsData.settings.forEach(function (s) { bySetting[s.key] = s.value; });

  var pointRuleRows = pointRulesData.pointRules.map(function (r) {
    var activeOriginal = r.active ? 'true' : 'false';
    return '<tr data-row-key="' + r.task_key + '"><td>' + r.label + '</td><td>' +
      '<input type="number" min="0" class="rule-points-input" data-task="' + r.task_key + '" data-original="' + r.points + '" value="' + r.points + '" placeholder="points">' +
      '</td><td><label class="rule-active-label"><input type="checkbox" class="rule-active-input" data-task="' + r.task_key + '" data-original="' + activeOriginal + '"' +
      (r.active ? ' checked' : '') + '> Active</label></td></tr>';
  }).join('');
  var minChargeCents = parseInt(bySetting.min_paypal_charge_cents, 10);
  var minChargeDollars = Number.isFinite(minChargeCents) ? (minChargeCents / 100).toFixed(2) : '1.00';
  var visitorExcludedIps = (bySetting.visitor_excluded_ips || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var accuracyPassPct = parseInt(bySetting.progress_accuracy_pass_pct, 10);
  var accuracyPassPctVal = Number.isFinite(accuracyPassPct) ? accuracyPassPct : 80;
  var coveragePassPct = parseInt(bySetting.progress_coverage_pass_pct, 10);
  var coveragePassPctVal = Number.isFinite(coveragePassPct) ? coveragePassPct : 50;
  var refundFailurePct = parseInt(bySetting.refund_failure_percent, 10);
  var refundFailurePctVal = Number.isFinite(refundFailurePct) ? refundFailurePct : 50;

  appEl.innerHTML = renderTabs('settings') +
    '<div class="settings-grid">' +

    '<section class="card settings-edit-group" data-group="point-rules">' +
    '<div class="settings-edit-toolbar">' +
    '<div><h3>Point rules</h3><p class="muted page-intro-text">How many points each referral task awards (1 point = 1 cent, so these read ' +
    'directly as cents toward a free course). Uncheck Active to stop awarding it without losing history.</p></div>' +
    settingsSaveButton('save-point-rules-changes', 'point-rules', 'Save changes') +
    '</div>' +
    '<div class="settings-table-scroll"><table class="settings-edit-table"><thead><tr><th>Task</th><th>Points</th><th>Active</th></tr></thead>' +
    '<tbody>' + pointRuleRows + '</tbody></table></div>' +
    '</section>' +
    '<section class="card settings-edit-group" data-group="min-charge">' +
    '<h3>Points discount floor</h3>' +
    '<p class="muted page-intro-text">A points discount can never leave less than this payable through the card/wallet processor ' +
    '(points fully covering a course still redeem free with zero cash, no charge involved, so this doesn\'t affect that).</p>' +
    '<div class="settings-inline-field">' +
    '<input type="number" step="0.01" min="0" class="min-charge-input" data-original="' + minChargeDollars + '" value="' + minChargeDollars + '" placeholder="1.00">' +
    settingsSaveButton('save-min-charge', 'min-charge', 'Save') +
    '</div></section>' +
    '<section class="card settings-edit-group" data-group="visitor-exclusions">' +
    '<h3>Visitor exclusions</h3>' +
    '<p class="muted page-intro-text">IP addresses excluded from the Visitors tab entirely (e.g. your own office/home IP) -- ' +
    'excluded traffic is never even recorded, and this also retroactively hides anything already logged from that IP. IP-based ' +
    'exclusion breaks if your IP changes (new wifi, mobile data, VPN) -- for an exclusion that survives that, visit the public site ' +
    'with <code>?pxq_exclude=1</code> added to the URL once (e.g. <code>https://yoursite.com/?pxq_exclude=1</code>) -- that browser ' +
    'stops sending any visit data permanently, no IP list needed. Visit again with <code>?pxq_exclude=0</code> to re-enable.</p>' +
    '<div class="settings-inline-field">' +
    '<input type="text" id="new-visitor-exclusion-input" placeholder="e.g. 203.0.113.42">' +
    '<button class="btn-secondary btn-sm" type="button" data-act="add-visitor-exclusion">+ Add</button>' +
    '</div>' +
    (visitorExcludedIps.length
      ? '<ul class="visitor-exclusion-list">' + visitorExcludedIps.map(function (ip) {
          return '<li>' + escapeHtml(ip) + ' <button class="btn-secondary btn-sm" type="button" data-act="remove-visitor-exclusion" data-ip="' + escapeHtml(ip) + '">Remove</button></li>';
        }).join('') + '</ul>'
      : '<p class="muted">No exclusions yet.</p>') +
    '</section>' +
    '<section class="card settings-edit-group" data-group="progress-colors">' +
    '<h3>Progress tab colors</h3>' +
    '<p class="muted page-intro-text">Thresholds (%) for when the student\'s headline Accuracy and Coverage numbers on the ' +
    'Progress tab show green (at/above) vs. red (below).</p>' +
    '<div class="settings-inline-field"><label class="price-row-label">Accuracy turns green at/above</label>' +
    '<input type="number" step="1" min="0" max="100" class="accuracy-pass-pct-input" data-original="' + accuracyPassPctVal + '" value="' + accuracyPassPctVal + '" placeholder="80"></div>' +
    '<div class="settings-inline-field"><label class="price-row-label">Coverage turns green at/above</label>' +
    '<input type="number" step="1" min="0" max="100" class="coverage-pass-pct-input" data-original="' + coveragePassPctVal + '" value="' + coveragePassPctVal + '" placeholder="50">' +
    settingsSaveButton('save-progress-colors', 'progress-colors', 'Save') +
    '</div></section>' +
    '<section class="card settings-edit-group" data-group="refund-pct">' +
    '<h3>Refund guarantee</h3>' +
    '<p class="muted page-intro-text">Percent of the purchase price refunded on an approved exam-failure refund claim. ' +
    'Shown live on the public site\'s footer, checkout, and refund-request pages.</p>' +
    '<div class="settings-inline-field">' +
    '<input type="number" step="1" min="0" max="100" class="refund-failure-pct-input" data-original="' + refundFailurePctVal + '" value="' + refundFailurePctVal + '" placeholder="50">' +
    settingsSaveButton('save-refund-failure-pct', 'refund-pct', 'Save') +
    '</div></section>' +

    '</div>';
}

// Recomputes dirty state (row highlight + Save button enabled/count) for whichever settings
// group contains changedEl. Runs on every input/change inside a settings-edit-group.
function updateSettingsDirtyState(changedEl) {
  var container = changedEl.closest('[data-group]');
  if (!container) return;
  var group = container.getAttribute('data-group');
  var dirtyCount = 0;
  // A row (e.g. a pricing row) can hold more than one data-original input (price + Active
  // checkbox) -- collect dirty rows in a set and set the class once per row afterward, rather
  // than toggling per-input, so the 2nd input's clean state doesn't overwrite the 1st's dirty one.
  var dirtyRows = new Set();
  container.querySelectorAll('[data-original]').forEach(function (inp) {
    var current = inp.type === 'checkbox' ? String(inp.checked) : inp.value;
    var isDirty = current !== inp.dataset.original;
    if (isDirty) {
      dirtyCount++;
      var row = inp.closest('tr[data-row-key]');
      if (row) dirtyRows.add(row);
    }
  });
  container.querySelectorAll('tr[data-row-key]').forEach(function (row) {
    row.classList.toggle('row-dirty', dirtyRows.has(row));
  });
  var btn = container.querySelector('button[data-group="' + group + '"]');
  if (!btn) return;
  if (!btn.dataset.baseLabel) btn.dataset.baseLabel = btn.textContent;
  btn.disabled = dirtyCount === 0;
  btn.textContent = dirtyCount > 1 ? btn.dataset.baseLabel + ' (' + dirtyCount + ')' : btn.dataset.baseLabel;
}

function filterPricingRows(query) {
  pricingFilterQuery = query;
  pricingRowsExpanded = false; // fresh filter, start collapsed again rather than carry over stale expand state
  updatePricingRowVisibility();
}

// Marks a just-saved group's inputs as the new baseline and shows a brief inline confirmation,
// instead of the old pattern of re-fetching and re-rendering the whole Settings page on every save.
function markSettingsGroupSaved(btn) {
  // NOT btn.closest('[data-group]') -- the button itself carries data-group, so that would
  // resolve to the button instead of its container and find no sibling inputs to reset.
  var container = btn.closest('.settings-edit-group');
  container.querySelectorAll('[data-original]').forEach(function (inp) {
    inp.dataset.original = inp.type === 'checkbox' ? String(inp.checked) : inp.value;
    var row = inp.closest('tr[data-row-key]');
    if (row) row.classList.remove('row-dirty');
  });
  btn.disabled = true;
  btn.textContent = btn.dataset.baseLabel;
  var flash = document.createElement('span');
  flash.className = 'settings-saved-flash';
  flash.textContent = 'Saved ✓';
  btn.insertAdjacentElement('afterend', flash);
  requestAnimationFrame(function () { flash.classList.add('visible'); });
  setTimeout(function () {
    flash.classList.remove('visible');
    setTimeout(function () { flash.remove(); }, 300);
  }, 1600);
}

// ---- Points (accounts, manual adjustments, referral log) ------------------

var pointsAccountsCache = [];
var pointsReferralsCache = [];
var accountsSort = { key: 'points', dir: -1 }; // matches the old default: highest points first
var referralsSort = { key: 'created_at', dir: -1 }; // matches the old default: newest first
var statusBadgeClass = { invited: 'unused', verified: '', converted: 'redeemed' };

var ACCOUNTS_NUMERIC_KEYS = new Set(['points', 'referrals_sent', 'referrals_verified', 'referrals_converted', 'created_at']);
var ACCOUNTS_COLUMNS = [
  ['email', 'Email'], ['name', 'Name'], ['points', 'Points'], ['referrals_sent', 'Sent'],
  ['referrals_verified', 'Verified'], ['referrals_converted', 'Converted'], ['created_at', 'Joined'],
];
var REFERRALS_NUMERIC_KEYS = new Set(['created_at', 'verified_at', 'converted_at']);
var REFERRALS_COLUMNS = [
  ['referrer_email', 'Referrer'], ['referrer_name', 'Referrer Name'], ['referred_name', 'Referred Name'],
  ['referred_email', 'Referred Email'], ['status', 'Status'], ['created_at', 'Created'],
  ['verified_at', 'Verified'], ['converted_at', 'Converted'],
];

function sortTableRows(rows, sortState, numericKeys) {
  var sorted = rows.slice();
  var key = sortState.key, dir = sortState.dir;
  sorted.sort(function (a, b) {
    var av = a[key], bv = b[key];
    if (numericKeys.has(key)) {
      av = av == null ? -Infinity : av;
      bv = bv == null ? -Infinity : bv;
      return (av - bv) * dir;
    }
    av = (av == null ? '' : String(av)).toLowerCase();
    bv = (bv == null ? '' : String(bv)).toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return sorted;
}

function sortableHeaderRow(columns, sortState, act) {
  return '<tr>' + columns.map(function (c) {
    var indicator = sortState.key === c[0] ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-act="' + act + '" data-key="' + c[0] + '">' + c[1] + indicator + '</th>';
  }).join('') + '</tr>';
}

function drawAccountsTable() {
  var container = document.getElementById('accounts-table-container');
  if (!container) return;
  var rows = sortTableRows(pointsAccountsCache, accountsSort, ACCOUNTS_NUMERIC_KEYS);
  var body = rows.map(function (a) {
    return '<tr><td>' + a.email + '</td><td>' + (a.name || '—') + '</td><td>' + a.points + '</td>' +
      '<td>' + a.referrals_sent + '</td><td>' + a.referrals_verified + '</td><td>' + a.referrals_converted + '</td>' +
      '<td>' + new Date(a.created_at * 1000).toLocaleDateString() + '</td></tr>';
  }).join('');
  container.innerHTML = '<table><thead>' + sortableHeaderRow(ACCOUNTS_COLUMNS, accountsSort, 'sort-accounts') +
    '</thead><tbody>' + body + '</tbody></table>';
}

function drawReferralsTable() {
  var container = document.getElementById('referrals-table-container');
  if (!container) return;
  var rows = sortTableRows(pointsReferralsCache, referralsSort, REFERRALS_NUMERIC_KEYS);
  var body = rows.map(function (r) {
    return '<tr><td>' + r.referrer_email + '</td><td>' + (r.referrer_name || '—') + '</td><td>' + (r.referred_name || '—') + '</td><td>' + r.referred_email + '</td>' +
      '<td><span class="badge ' + (statusBadgeClass[r.status] || '') + '">' + r.status + '</span></td>' +
      '<td>' + new Date(r.created_at * 1000).toLocaleDateString() + '</td>' +
      '<td>' + (r.verified_at ? new Date(r.verified_at * 1000).toLocaleDateString() : '—') + '</td>' +
      '<td>' + (r.converted_at ? new Date(r.converted_at * 1000).toLocaleDateString() : '—') + '</td></tr>';
  }).join('');
  container.innerHTML = '<table><thead>' + sortableHeaderRow(REFERRALS_COLUMNS, referralsSort, 'sort-referrals') +
    '</thead><tbody>' + body + '</tbody></table>';
}

async function renderPoints() {
  appEl.innerHTML = renderTabs('points') + '<p>Loading…</p>';
  var results = await Promise.all([
    apiFetch('/console/accounts'),
    apiFetch('/console/referrals'),
  ]);
  pointsAccountsCache = results[0].accounts;
  pointsReferralsCache = results[1].referrals;

  var accountsEmpty = pointsAccountsCache.length ? '' : '<p class="muted">No referral accounts yet.</p>';
  var referralsEmpty = pointsReferralsCache.length ? '' : '<p class="muted">No referrals yet.</p>';

  appEl.innerHTML = renderTabs('points') +
    '<div class="card">' +
    '<form data-act="adjust-points" class="generate-form">' +
    '<input type="email" name="accountEmail" placeholder="account email" required>' +
    '<input type="number" name="delta" placeholder="+/- points" required>' +
    '<input type="text" name="reason" placeholder="reason" required>' +
    '<button class="btn-primary" type="submit">Adjust</button>' +
    '</form></div>' +
    '<h3>Accounts</h3>' + accountsEmpty +
    '<div id="accounts-table-container"></div>' +
    '<h3>Referral log</h3>' + referralsEmpty +
    '<div id="referrals-table-container"></div>';
  drawAccountsTable();
  drawReferralsTable();
}

// ---- Refund claims ----------------------------------------------------

async function renderRefunds() {
  appEl.innerHTML = renderTabs('refunds') + '<p>Loading…</p>';
  var data = await apiFetch('/console/refund-claims');
  var claimTypeLabel = { unconditional_7day: '7-Day', exam_failure_50pct: 'Exam Failure 50%' };
  var statusBadgeClass = { pending: '', approved: '', denied: 'revoked', refunded: 'redeemed' };
  var processorLabel = function (note) {
    if (!note) return '—';
    if (note.indexOf('stripe:') === 0) return 'Stripe';
    if (note.indexOf('paypal:') === 0) return 'PayPal';
    if (note.indexOf('points:') === 0) return 'Points (no charge)';
    return note;
  };
  var rows = data.claims.map(function (c) {
    var details = [];
    if (c.exam_date) details.push('Exam: ' + c.exam_date);
    if (c.confirmation_note) details.push('Conf: ' + c.confirmation_note);
    if (c.notes) details.push(c.notes);
    var actions;
    if (c.status === 'pending') {
      actions =
        '<input type="text" class="refund-admin-notes-input" data-claim-id="' + c.id + '" placeholder="admin notes (optional)">' +
        '<button class="btn btn-approve" data-act="review-refund-claim" data-claim-id="' + c.id + '" data-status="approved">Approve</button>' +
        '<button class="btn btn-deny" data-act="review-refund-claim" data-claim-id="' + c.id + '" data-status="denied">Deny</button>';
    } else if (c.status === 'approved') {
      actions =
        '<input type="text" class="refund-admin-notes-input" data-claim-id="' + c.id + '" placeholder="admin notes (optional)">' +
        '<button class="btn btn-primary" data-act="review-refund-claim" data-claim-id="' + c.id + '" data-status="refunded">Mark Refunded</button>';
    } else {
      actions = c.reviewed_by ? ('Reviewed by ' + c.reviewed_by) : '—';
    }
    return '<tr><td>' + c.code + '</td><td>' + c.email + '</td><td>' + (claimTypeLabel[c.claim_type] || c.claim_type) + '</td>' +
      '<td>$' + (c.refund_cents / 100).toFixed(2) + '</td>' +
      '<td>' + processorLabel(c.code_note) + '</td>' +
      '<td><span class="badge ' + (statusBadgeClass[c.status] || '') + '">' + c.status + '</span></td>' +
      '<td>' + (details.join('<br>') || '—') + '</td>' +
      '<td>' + new Date(c.created_at * 1000).toLocaleDateString() + '</td>' +
      '<td class="refund-actions-cell">' + actions + '</td></tr>';
  }).join('');
  var empty = data.claims.length ? '' : '<p class="muted">No refund claims yet.</p>';

  appEl.innerHTML = renderTabs('refunds') +
    '<p class="muted page-intro-text">Approve or deny each claim after review, then process the actual refund with the ' +
    'processor shown below and mark it Refunded here. Marking a 7-Day claim Refunded automatically revokes the code.</p>' +
    empty +
    (data.claims.length
      ? '<table><thead><tr><th>Code</th><th>Email</th><th>Type</th><th>Amount</th><th>Processor</th><th>Status</th><th>Details</th><th>Created</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>'
      : '');
}

// ---- Stalled buyers (re-engagement) ------------------------------------
// Admin-triggered, one at a time -- no automation/cron here on purpose, so a bad threshold or a
// bug can't blast emails unsupervised. See handleConsoleStalledBuyerRemind in the Worker.

var stalledBuyersDays = 7;
var stalledBuyersCache = [];
var stalledBuyerSendingIds = {}; // userId -> true while a send is in-flight, disables that row's button

async function loadStalledBuyers() {
  var container = document.getElementById('stalled-buyers-table-container');
  if (container) container.innerHTML = '<p class="muted">Loading…</p>';
  var data = await apiFetch('/console/stalled-buyers?days=' + encodeURIComponent(stalledBuyersDays));
  stalledBuyersCache = data.items;
  drawStalledBuyersTable();
}

function drawStalledBuyersTable() {
  var container = document.getElementById('stalled-buyers-table-container');
  if (!container) return;
  var rows = stalledBuyersCache.map(function (u) {
    var lastSeen = new Date(u.last_seen_at * 1000).toLocaleDateString();
    var lastReminded = u.last_reminder_sent_at ? new Date(u.last_reminder_sent_at * 1000).toLocaleDateString() : '—';
    var sending = stalledBuyerSendingIds[u.user_id];
    var actionCell = !u.buyer_email
      ? '<span class="muted">No email on file</span>'
      : '<button class="btn-secondary btn-sm" type="button" data-act="send-stalled-reminder" data-user-id="' + u.user_id + '"' +
        (sending ? ' disabled' : '') + '>' + (sending ? 'Sending…' : 'Send reminder') + '</button>';
    return '<tr><td>' + (u.buyer_email || '—') + '</td><td>' + u.code + '</td><td class="muted">' + u.exam_type + '</td>' +
      '<td>' + lastSeen + '</td><td class="muted">' + lastReminded + '</td><td>' + actionCell + '</td></tr>';
  }).join('');
  var empty = stalledBuyersCache.length ? '' : '<p class="muted">No stalled buyers at this threshold.</p>';
  container.innerHTML = empty + (stalledBuyersCache.length
    ? '<table><thead><tr><th>Email</th><th>Code</th><th>Exam</th><th>Last active</th><th>Last reminded</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>'
    : '');
}

async function renderStalledBuyers() {
  appEl.innerHTML = renderTabs('stalled') +
    '<p class="muted page-intro-text">Buyers who redeemed a code but haven\'t been active in a while. Sending is manual, ' +
    'per user, one click at a time -- nothing here goes out automatically.</p>' +
    '<div class="card generate-form">' +
    '<label class="muted">Inactive for at least</label>' +
    '<input type="number" id="stalled-days-input" class="stalled-days-input" value="' + stalledBuyersDays + '" min="1">' +
    '<span class="muted">days</span>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="refresh-stalled-buyers">Refresh</button>' +
    '</div>' +
    '<div id="stalled-buyers-table-container"><p class="muted">Loading…</p></div>';
  await loadStalledBuyers();
}

// ---- Visitors (site_visits, populated by the public site's tracking beacon) -----------

var visitorsCache = [];
var visitorsSort = { key: 'last_seen_at', dir: -1 }; // newest activity first by default
// Default view: last 7 days, at least 1 minute on site -- cuts out same-day bounce/bot noise so
// the table opens on something worth looking at rather than every hit ever recorded.
var VISITORS_DEFAULT_FILTERS = { preset: '7d', country: '', countryOp: 'eq', region: '', regionOp: 'eq', minDurationMin: '1', maxDurationMin: '' };
var visitorsFilters = Object.assign({}, VISITORS_DEFAULT_FILTERS);
var visitorsFacets = { countries: [], regions: [] };
var visitorsFacetsLoaded = false;
var VISITORS_NUMERIC_KEYS = new Set(['page_count', 'duration_sec', 'first_seen_at', 'last_seen_at', 'is_bot']);
// Visitor ID, Session ID, Latitude, Longitude, and the 3 UTM columns moved into the per-row
// Details modal (2026-08-31) -- same "less-critical columns behind a Details button" pattern as
// the Codes table -- to keep this already-wide table's default view scannable. Still present in
// visitorDetailModalHtml() below, not dropped.
var VISITORS_COLUMNS = [
  ['last_seen_at', 'Last Seen'], ['first_seen_at', 'First Seen'], ['duration_sec', 'Time on Site'],
  ['ip_address', 'IP Address'], ['country', 'Country'], ['region', 'Region'], ['city', 'City'], ['timezone', 'Timezone'],
  ['device_type', 'Device'], ['browser', 'Browser'], ['os', 'OS'], ['is_bot', 'Bot?'],
  ['referrer', 'Referrer'],
  ['landing_path', 'Landing Page'], ['page_count', 'Pages Viewed'],
];

var VISITORS_DATE_PRESETS = [['all', 'All Time'], ['7d', 'Last 7 Days'], ['30d', 'Last 30 Days'], ['custom', 'Custom Range']];

function visitorsFilterBarHtml() {
  var presetPills = VISITORS_DATE_PRESETS.map(function (p) {
    var active = visitorsFilters.preset === p[0];
    return '<button type="button" class="' + (active ? 'active' : '') + '" data-act="visitors-date-preset" data-preset="' + p[0] + '">' + p[1] + '</button>';
  }).join('');
  var customRangeHtml = visitorsFilters.preset === 'custom'
    ? '<input type="date" id="visitors-from-input" value="' + (visitorsFilters.fromDate || '') + '"> to ' +
      '<input type="date" id="visitors-to-input" value="' + (visitorsFilters.toDate || '') + '">'
    : '';
  var countryOptions = ['<option value="">All Countries</option>'].concat(visitorsFacets.countries.map(function (c) {
    return '<option value="' + escapeHtml(c) + '"' + (visitorsFilters.country === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
  })).join('');
  var regionOptions = ['<option value="">All Regions</option>'].concat(visitorsFacets.regions.map(function (r) {
    return '<option value="' + escapeHtml(r) + '"' + (visitorsFilters.region === r ? ' selected' : '') + '>' + escapeHtml(r) + '</option>';
  })).join('');
  var countryOpToggle = '<button type="button" class="btn-secondary btn-sm" data-act="toggle-visitors-country-op" title="Toggle is / is not">' +
    (visitorsFilters.countryOp === 'ne' ? 'is not' : 'is') + '</button>';
  var regionOpToggle = '<button type="button" class="btn-secondary btn-sm" data-act="toggle-visitors-region-op" title="Toggle is / is not">' +
    (visitorsFilters.regionOp === 'ne' ? 'is not' : 'is') + '</button>';
  return '<div class="settings-filter-pill" role="group" aria-label="Filter by date range">' + presetPills + '</div>' +
    '<div class="questions-toolbar">' +
    customRangeHtml +
    '<label class="muted">Country</label>' + countryOpToggle +
    '<select id="visitors-country-select">' + countryOptions + '</select>' +
    '<label class="muted">Region</label>' + regionOpToggle +
    '<select id="visitors-region-select">' + regionOptions + '</select>' +
    '<label class="muted">Duration (min):</label>' +
    '<input type="number" id="visitors-min-duration-input" placeholder="Min" min="0" style="width:4.5rem" value="' + escapeHtml(visitorsFilters.minDurationMin) + '">' +
    '<span class="muted">–</span>' +
    '<input type="number" id="visitors-max-duration-input" placeholder="Max" min="0" style="width:4.5rem" value="' + escapeHtml(visitorsFilters.maxDurationMin) + '">' +
    '<button class="btn-secondary btn-sm" type="button" data-act="apply-visitors-filters">Apply</button>' +
    '<button class="btn-secondary btn-sm" type="button" data-act="reset-visitors-filters">Reset</button>' +
    '</div>';
}

function visitorsDateRangeForPreset(preset) {
  var nowSec = Math.floor(Date.now() / 1000);
  if (preset === '7d') return { from: nowSec - 7 * 86400, to: nowSec };
  if (preset === '30d') return { from: nowSec - 30 * 86400, to: nowSec };
  return { from: null, to: null };
}

// Reads the filter bar's live input values (not just visitorsFilters state, since typed-but-not-yet-
// applied duration/date values need to be picked up at Apply-click time) and builds the query string.
function visitorsQueryString() {
  var params = [];
  if (visitorsFilters.preset === 'custom') {
    var fromInput = document.getElementById('visitors-from-input');
    var toInput = document.getElementById('visitors-to-input');
    visitorsFilters.fromDate = fromInput ? fromInput.value : '';
    visitorsFilters.toDate = toInput ? toInput.value : '';
    if (visitorsFilters.fromDate) params.push('from=' + Math.floor(new Date(visitorsFilters.fromDate + 'T00:00:00').getTime() / 1000));
    if (visitorsFilters.toDate) params.push('to=' + Math.floor(new Date(visitorsFilters.toDate + 'T23:59:59').getTime() / 1000));
  } else {
    var range = visitorsDateRangeForPreset(visitorsFilters.preset);
    if (range.from) params.push('from=' + range.from);
    if (range.to) params.push('to=' + range.to);
  }
  var countrySelect = document.getElementById('visitors-country-select');
  var regionSelect = document.getElementById('visitors-region-select');
  var minInput = document.getElementById('visitors-min-duration-input');
  var maxInput = document.getElementById('visitors-max-duration-input');
  visitorsFilters.country = countrySelect ? countrySelect.value : '';
  visitorsFilters.region = regionSelect ? regionSelect.value : '';
  visitorsFilters.minDurationMin = minInput ? minInput.value : '';
  visitorsFilters.maxDurationMin = maxInput ? maxInput.value : '';
  if (visitorsFilters.country) {
    params.push('country=' + encodeURIComponent(visitorsFilters.country));
    if (visitorsFilters.countryOp === 'ne') params.push('countryOp=ne');
  }
  if (visitorsFilters.region) {
    params.push('region=' + encodeURIComponent(visitorsFilters.region));
    if (visitorsFilters.regionOp === 'ne') params.push('regionOp=ne');
  }
  if (visitorsFilters.minDurationMin) params.push('minDurationSec=' + (parseInt(visitorsFilters.minDurationMin, 10) * 60));
  if (visitorsFilters.maxDurationMin) params.push('maxDurationSec=' + (parseInt(visitorsFilters.maxDurationMin, 10) * 60));
  return params.length ? ('?' + params.join('&')) : '';
}

async function loadVisitors() {
  var container = document.getElementById('visitors-table-container');
  if (container) container.innerHTML = '<p class="muted">Loading…</p>';
  var data = await apiFetch('/console/visitors' + visitorsQueryString());
  visitorsCache = data.items || [];
  drawVisitorsTable();
}

function formatDuration(sec) {
  if (sec == null) return '—';
  var m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? (m + 'm ' + s + 's') : (s + 's');
}
function fmtDate(ts) { return ts ? new Date(ts * 1000).toLocaleString() : '—'; }

function drawVisitorsTable() {
  var container = document.getElementById('visitors-table-container');
  if (!container) return;
  if (!visitorsCache.length) { container.innerHTML = '<p class="muted">No visitors recorded yet.</p>'; return; }
  var rows = sortTableRows(visitorsCache, visitorsSort, VISITORS_NUMERIC_KEYS);
  var body = rows.map(function (v) {
    var pages;
    try { pages = JSON.parse(v.pages_json || '[]'); } catch (e) { pages = []; }
    return '<tr' + (v.is_bot ? ' class="visitor-row-bot"' : '') + '>' +
      '<td><button class="btn-secondary btn-sm" data-act="open-visitor-detail" data-session-id="' + escapeHtml(v.session_id || '') + '">Details</button></td>' +
      '<td>' + fmtDate(v.last_seen_at) + '</td><td>' + fmtDate(v.first_seen_at) + '</td>' +
      '<td>' + formatDuration(v.duration_sec) + '</td>' +
      '<td>' + escapeHtml(v.ip_address || '—') + '</td>' +
      '<td>' + escapeHtml(v.country || '—') + '</td><td>' + escapeHtml(v.region || '—') + '</td>' +
      '<td>' + escapeHtml(v.city || '—') + '</td><td>' + escapeHtml(v.timezone || '—') + '</td>' +
      '<td>' + escapeHtml(v.device_type || '—') + '</td><td>' + escapeHtml(v.browser || '—') + '</td>' +
      '<td>' + escapeHtml(v.os || '—') + '</td><td>' + (v.is_bot ? 'Yes' : 'No') + '</td>' +
      '<td class="visitor-referrer-cell" title="' + escapeHtml(v.referrer || '') + '">' + (v.referrer ? escapeHtml(v.referrer) : 'Direct') + '</td>' +
      '<td>' + escapeHtml(v.landing_path || '—') + '</td>' +
      '<td title="' + escapeHtml(pages.join(' → ')) + '">' + v.page_count + '</td>' +
      '</tr>';
  }).join('');
  container.innerHTML = '<div class="settings-table-scroll"><table><thead id="visitors-table-head">' +
    sortableHeaderRow(VISITORS_COLUMNS, visitorsSort, 'sort-visitors').replace('<tr>', '<tr><th></th>') + '</thead><tbody>' + body + '</tbody></table></div>';
}

// Visitor detail modal -- same overlay pattern as the Codes table's per-code drilldown
// (openCodeDetail/closeCodeDetail, .code-detail-* CSS), reused here rather than duplicated since
// it's purely structural/presentational, not code-specific. No fetch needed: every field shown
// here is already in visitorsCache from the initial /console/visitors load.
function visitorDetailModalHtml(v) {
  var pages;
  try { pages = JSON.parse(v.pages_json || '[]'); } catch (e) { pages = []; }
  var mapLink = (v.latitude != null && v.longitude != null)
    ? '<a href="https://www.google.com/maps?q=' + v.latitude + ',' + v.longitude + '" target="_blank" rel="noopener">' +
      v.latitude + ', ' + v.longitude + ' ↗</a>'
    : '—';
  return '<div class="code-detail-modal-header"><h3>Visitor Detail</h3>' +
    '<button class="btn-secondary btn-sm" data-act="close-visitor-detail">Close</button></div>' +

    '<div class="code-detail-section"><h4>Identity</h4><div class="code-detail-stat-grid">' +
    codeDetailStat('Visitor ID', escapeHtml(v.visitor_id || '—')) +
    codeDetailStat('Session ID', escapeHtml(v.session_id || '—')) +
    codeDetailStat('IP Address', escapeHtml(v.ip_address || '—')) +
    codeDetailStat('Bot?', v.is_bot ? 'Yes' : 'No') +
    '</div></div>' +

    '<div class="code-detail-section"><h4>Location</h4><div class="code-detail-stat-grid">' +
    codeDetailStat('Country', escapeHtml(v.country || '—')) +
    codeDetailStat('Region', escapeHtml(v.region || '—')) +
    codeDetailStat('City', escapeHtml(v.city || '—')) +
    codeDetailStat('Timezone', escapeHtml(v.timezone || '—')) +
    codeDetailStat('Coordinates', mapLink) +
    '</div></div>' +

    '<div class="code-detail-section"><h4>Campaign & Acquisition</h4><div class="code-detail-stat-grid">' +
    codeDetailStat('UTM Source', escapeHtml(v.utm_source || '—')) +
    codeDetailStat('UTM Medium', escapeHtml(v.utm_medium || '—')) +
    codeDetailStat('UTM Campaign', escapeHtml(v.utm_campaign || '—')) +
    '</div>' +
    '<p class="muted" style="margin-top:0.6rem"><strong>Referrer:</strong> ' + (v.referrer ? escapeHtml(v.referrer) : 'Direct') + '</p>' +
    '<p class="muted"><strong>Landing page:</strong> ' + escapeHtml(v.landing_path || '—') + '</p>' +
    '</div>' +

    '<div class="code-detail-section"><h4>Session</h4><div class="code-detail-stat-grid">' +
    codeDetailStat('First seen', fmtDate(v.first_seen_at)) +
    codeDetailStat('Last seen', fmtDate(v.last_seen_at)) +
    codeDetailStat('Time on site', formatDuration(v.duration_sec)) +
    codeDetailStat('Pages viewed', v.page_count) +
    '</div></div>' +

    '<div class="code-detail-section"><h4>Page journey</h4>' +
    (pages.length
      ? '<ol style="margin:0;padding-left:1.25rem;font-size:0.85rem;line-height:1.6">' +
        pages.map(function (p) { return '<li>' + escapeHtml(p) + '</li>'; }).join('') + '</ol>'
      : '<p class="muted">No page-view history recorded for this session.</p>') +
    '</div>';
}

function openVisitorDetail(sessionId) {
  var v = visitorsCache.filter(function (x) { return x.session_id === sessionId; })[0];
  if (!v) return;
  var backdrop = document.createElement('div');
  backdrop.className = 'code-detail-backdrop';
  backdrop.id = 'visitor-detail-backdrop';
  backdrop.innerHTML = '<div class="code-detail-modal">' + visitorDetailModalHtml(v) + '</div>';
  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop || e.target.closest('[data-act="close-visitor-detail"]')) closeVisitorDetail();
  });
  document.body.appendChild(backdrop);
}

function closeVisitorDetail() {
  var backdrop = document.getElementById('visitor-detail-backdrop');
  if (backdrop) backdrop.remove();
}

async function renderVisitors() {
  appEl.innerHTML = renderTabs('visitors') +
    '<p class="muted page-intro-text">Every recorded browser session on the public site, newest activity first. Click any column ' +
    'header to sort. Hover a truncated cell (Referrer, Pages Viewed) for the full value, or click Details for the full picture ' +
    '(visitor/session IDs, coordinates, UTM source/medium/campaign, and the full page-view journey). Add IPs to the exclusion ' +
    'list in Settings to keep your own traffic out of this table.</p>' +
    '<div id="visitors-filter-wrap">' + visitorsFilterBarHtml() + '</div>' +
    '<div id="visitors-table-container"><p class="muted">Loading…</p></div>';
  if (!visitorsFacetsLoaded) {
    try { visitorsFacets = await apiFetch('/console/visitors/facets'); } catch (e) { /* best-effort -- dropdowns just stay empty */ }
    visitorsFacetsLoaded = true;
    document.getElementById('visitors-filter-wrap').innerHTML = visitorsFilterBarHtml();
  }
  await loadVisitors();
}

// ---- Alerts (admin_alert_rules) ---------------------------------------

var alertRulesCache = [];
var alertTriggersCache = [];

function alertTriggerLabel(key) {
  var t = alertTriggersCache.filter(function (t) { return t.key === key; })[0];
  return t ? t.label : key;
}

function drawAlertsTable() {
  var container = document.getElementById('alerts-table-container');
  if (!container) return;
  if (!alertRulesCache.length) { container.innerHTML = '<p class="muted">No alert rules configured yet -- add one below.</p>'; return; }
  var body = alertRulesCache.map(function (r) {
    return '<tr data-rule-id="' + r.id + '">' +
      '<td>' + escapeHtml(alertTriggerLabel(r.trigger_key)) + '</td>' +
      '<td><input type="email" class="alert-rule-email-input" data-id="' + r.id + '" value="' + escapeHtml(r.recipient_email) + '"></td>' +
      '<td><label class="rule-active-label"><input type="checkbox" class="alert-rule-active-input" data-id="' + r.id + '"' +
      (r.active ? ' checked' : '') + '> Active</label></td>' +
      '<td><button class="btn-secondary btn-sm" type="button" data-act="save-alert-rule" data-id="' + r.id + '">Save</button> ' +
      '<button class="btn-secondary btn-sm" type="button" data-act="delete-alert-rule" data-id="' + r.id + '">Delete</button></td>' +
      '</tr>';
  }).join('');
  container.innerHTML = '<table><thead><tr><th>Trigger</th><th>Recipient Email</th><th>Active</th><th></th></tr></thead>' +
    '<tbody>' + body + '</tbody></table>';
}

async function renderAlerts() {
  appEl.innerHTML = renderTabs('alerts') +
    '<p class="muted page-intro-text">Who gets emailed when something happens -- a purchase, a refund claim, a stalled site health ' +
    'check, and so on. Add as many recipients per trigger as you want; uncheck Active to pause one without deleting it.</p>' +
    '<div id="alerts-table-container"><p class="muted">Loading…</p></div>' +
    '<div class="card generate-form">' +
    '<label class="muted">Trigger</label>' +
    '<select id="new-alert-trigger-select"></select>' +
    '<label class="muted">Recipient email</label>' +
    '<input type="email" id="new-alert-email-input" placeholder="you@example.com">' +
    '<button class="btn-primary btn-sm" type="button" data-act="add-alert-rule">+ Add alert rule</button>' +
    '</div>';
  var data = await apiFetch('/console/alert-rules');
  alertRulesCache = data.rules || [];
  alertTriggersCache = data.triggers || [];
  var select = document.getElementById('new-alert-trigger-select');
  if (select) select.innerHTML = alertTriggersCache.map(function (t) { return '<option value="' + t.key + '">' + t.label + '</option>'; }).join('');
  drawAlertsTable();
}

// ---- Testimonial submissions (moderation queue) ------------------------
// Approving does NOT auto-publish into category_content.testimonials -- that JSON is keyed by a
// hand-curated category slug this admin's own Categories tab already edits directly (pipe-delimited
// "quote | author" lines). Instead each approved row here shows a "Copy line" button that copies
// that exact format to the clipboard, so pasting it into the right category's existing textarea is
// one step, not a retype. See the API's testimonial_submissions schema comment for the full reasoning.

var testimonialsCache = [];
var testimonialsStatusFilter = 'pending'; // '' = all; else 'pending' | 'approved' | 'rejected'

function testimonialsFilterPillsHtml() {
  var order = ['pending', 'approved', 'rejected'];
  var counts = {};
  testimonialsCache.forEach(function (t) { counts[t.status] = (counts[t.status] || 0) + 1; });
  var options = [['', 'All (' + testimonialsCache.length + ')']].concat(order.map(function (s) {
    return [s, s.charAt(0).toUpperCase() + s.slice(1) + ' (' + (counts[s] || 0) + ')'];
  }));
  return '<div class="settings-filter-pill" role="group" aria-label="Filter by status">' +
    options.map(function (o) {
      var active = testimonialsStatusFilter === o[0];
      return '<button type="button" class="' + (active ? 'active' : '') + '" data-act="filter-testimonials-status" data-status="' + o[0] + '"' +
        (active ? ' aria-current="true"' : '') + '>' + o[1] + '</button>';
    }).join('') + '</div>';
}

function drawTestimonialsTable() {
  var container = document.getElementById('testimonials-table-container');
  if (!container) return;
  var rows = testimonialsCache.filter(function (t) { return !testimonialsStatusFilter || t.status === testimonialsStatusFilter; });
  if (!rows.length) { container.innerHTML = '<p class="muted">No testimonials in this filter.</p>'; return; }
  var body = rows.map(function (t) {
    var trackLabel = escapeHtml(t.kind || t.exam_type) + (t.stateCode ? ' (' + escapeHtml(t.stateCode) + ')' : '');
    var actions = t.status === 'pending'
      ? '<button class="btn-secondary btn-sm" data-act="moderate-testimonial" data-id="' + t.id + '" data-status="approved">Approve</button> ' +
        '<button class="btn-secondary btn-sm" data-act="moderate-testimonial" data-id="' + t.id + '" data-status="rejected">Reject</button>'
      : '<span class="badge ' + (t.status === 'approved' ? 'active' : 'revoked') + '">' + t.status + '</span>' +
        (t.status === 'approved' ? ' <button class="btn-secondary btn-sm" data-act="copy-testimonial-line" data-quote="' + escapeHtml(t.quote) + '" data-author="' + escapeHtml(t.author) + '">Copy line</button>' : '');
    return '<tr><td>' + escapeHtml(t.author) + '</td><td>' + trackLabel + '</td>' +
      '<td class="visitor-referrer-cell" title="' + escapeHtml(t.quote) + '">' + escapeHtml(t.quote) + '</td>' +
      '<td>' + (t.email ? escapeHtml(t.email) : '—') + '</td>' +
      '<td>' + new Date(t.created_at * 1000).toLocaleDateString() + '</td>' +
      '<td>' + actions + '</td></tr>';
  }).join('');
  container.innerHTML = '<div class="settings-table-scroll"><table><thead><tr><th>Author</th><th>Track</th><th>Quote</th><th>Email</th><th>Submitted</th><th></th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}

async function renderTestimonials() {
  appEl.innerHTML = renderTabs('testimonials') +
    '<p class="muted page-intro-text">Real-student testimonial submissions from the site\'s #/feedback form. Approving one does NOT publish it automatically -- ' +
    'use "Copy line" to grab the exact "quote | author" format and paste it into the right category\'s Testimonials field on the Categories tab.</p>' +
    '<div id="testimonials-filter-wrap">' + testimonialsFilterPillsHtml() + '</div>' +
    '<div id="testimonials-table-container"><p class="muted">Loading…</p></div>';
  var data = await apiFetch('/console/testimonials');
  testimonialsCache = data.items || [];
  document.getElementById('testimonials-filter-wrap').innerHTML = testimonialsFilterPillsHtml();
  drawTestimonialsTable();
}

// ---- Routing + delegated events --------------------------------------

function route() {
  var view = (location.hash || '#/codes').replace('#/', '');
  if (view === 'codes') renderCodes();
  else if (view === 'tracks') renderTracks();
  else if (view === 'categories') renderCategories();
  else if (view === 'blog') renderBlog();
  else if (view === 'questions') renderQuestions();
  else if (view === 'stats') renderStats();
  else if (view === 'points') renderPoints();
  else if (view === 'settings') renderSettings();
  else if (view === 'refunds') renderRefunds();
  else if (view === 'stalled') renderStalledBuyers();
  else if (view === 'promotions') renderPromotions();
  else if (view === 'visitors') renderVisitors();
  else if (view === 'testimonials') renderTestimonials();
  else if (view === 'alerts') renderAlerts();
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
  } else if (act === 'adjust-points') {
    e.preventDefault();
    var af = e.target;
    var delta = Number(af.delta.value);
    if (!delta || isNaN(delta)) { alert('Enter a non-zero points amount (positive or negative).'); return; }
    try {
      await apiFetch('/console/accounts/adjust-points', {
        method: 'POST',
        body: { email: af.accountEmail.value.trim(), delta: delta, reason: af.reason.value.trim() },
      });
      renderPoints();
    } catch (err) {
      alert(err.data && err.data.error === 'account_not_found'
        ? 'No account found for that email — they may not have referred anyone yet.'
        : 'Could not adjust points. Try again.');
    }
  } else if (act === 'save-promotion') {
    e.preventDefault();
    var pf = e.target;
    var promoCode = pf.promoCode.value.trim();
    var discountType = pf.discountType.value;
    var rawDiscountValue = parseFloat(pf.discountValue.value);
    var body = {
      title: pf.title.value.trim(),
      body: pf.body.value.trim(),
      ctaLabel: pf.ctaLabel.value.trim() || undefined,
      ctaUrl: pf.ctaUrl.value.trim() || undefined,
      placement: pf.placement.value,
      promoCode: promoCode || undefined,
      discountType: discountType,
      // Flat amounts are entered in dollars for admin convenience -- stored in cents like every
      // other price in this app. No longer gated on a code being present -- a discount can now
      // auto-apply from a matching email alone (see requiredEmailDomain).
      discountValue: rawDiscountValue > 0 ? (discountType === 'flat_cents' ? Math.round(rawDiscountValue * 100) : Math.round(rawDiscountValue)) : undefined,
      requiredEmailDomain: pf.requiredEmailDomain.value.trim() || undefined,
      requireEmailVerification: pf.requireEmailVerification.checked,
      firstPurchaseOnly: pf.firstPurchaseOnly.checked,
      pointsMultiplier: pf.pointsMultiplier.value ? parseInt(pf.pointsMultiplier.value, 10) : undefined,
      pointsMultiplierDays: pf.pointsMultiplierDays.value ? parseInt(pf.pointsMultiplierDays.value, 10) : undefined,
      active: pf.active.checked,
    };
    var id = pf.getAttribute('data-id');
    try {
      await apiFetch(id ? '/console/promotions/update' : '/console/promotions/create', {
        method: 'POST', body: id ? Object.assign({ id: id }, body) : body,
      });
    } catch (err) {
      alert('Could not save this promotion. If this just started happening after a deploy, the ' +
        'database may be missing a required column — check with the developer. (' +
        ((err.data && err.data.error) || err.message || 'unknown error') + ')');
      return;
    }
    promotionFormState = null;
    renderPromotions();
  } else if (act === 'save-category') {
    e.preventDefault();
    var cf = e.target;
    var body = {
      slug: cf.slug.value.trim(),
      label: cf.label.value.trim(),
      heroHeadline: cf.heroHeadline.value.trim() || undefined,
      heroSubhead: cf.heroSubhead.value.trim() || undefined,
      featureTiles: pipeLinesToObjects(cf.featureTiles.value, ['icon', 'title', 'body']),
      testimonials: pipeLinesToObjects(cf.testimonials.value, ['quote', 'author']),
      complianceCopy: cf.complianceCopy.value.trim() || undefined,
      faq: pipeLinesToObjects(cf.faq.value, ['question', 'answer']),
      seoTitle: cf.seoTitle.value.trim() || undefined,
      seoDescription: cf.seoDescription.value.trim() || undefined,
      seoCanonical: cf.seoCanonical.value.trim() || undefined,
      active: cf.active.checked,
    };
    try {
      await apiFetch('/console/category-content/upsert', { method: 'POST', body: body });
    } catch (err) {
      alert('Could not save this category. (' + ((err.data && err.data.error) || err.message || 'unknown error') + ')');
      return;
    }
    categoryFormState = null;
    renderCategories();
  } else if (act === 'save-blog') {
    e.preventDefault();
    var bf = e.target;
    var body = {
      id: bf.getAttribute('data-id') || undefined,
      slug: bf.slug.value.trim(),
      kind: bf.kind.value,
      stateCode: bf.stateCode.value.trim().toUpperCase() || undefined,
      title: bf.title.value.trim(),
      excerpt: bf.excerpt.value.trim(),
      bodyHtml: bf.bodyHtml.value,
      seoTitle: bf.seoTitle.value.trim() || undefined,
      seoDescription: bf.seoDescription.value.trim() || undefined,
      status: bf.published.checked ? 'published' : 'draft',
    };
    try {
      await apiFetch('/console/blog/upsert', { method: 'POST', body: body });
    } catch (err) {
      alert('Could not save this article. (' + ((err.data && err.data.error) || err.message || 'unknown error') + ')');
      return;
    }
    blogFormState = null;
    renderBlog();
  }
});

appEl.addEventListener('click', async function (e) {
  var el = e.target.closest && e.target.closest('[data-act]');
  if (!el) return;
  // Sub-tab links are real <a href="#"> (for the pill styling), but are handled entirely here --
  // without this, the browser's own navigation to "#" clears location.hash and the global router
  // falls back to the Codes tab, undoing the tab switch this handler just made.
  if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
  var act = el.getAttribute('data-act');
  if (act === 'revoke-code') {
    await apiFetch('/console/codes/revoke', { method: 'POST', body: { code: el.getAttribute('data-code') } });
    renderCodes();
  } else if (act === 'open-code-detail') {
    openCodeDetail(el.getAttribute('data-code'));
  } else if (act === 'open-visitor-detail') {
    openVisitorDetail(el.getAttribute('data-session-id'));
  } else if (act === 'save-code') {
    var codeRow = el.closest('tr');
    var noteInput = codeRow.querySelector('.code-note-input');
    var expiresInput = codeRow.querySelector('.code-expires-input');
    var noteVal = noteInput.value.trim();
    // Local midnight for the picked date (matching isoDateFromUnix()'s own local-time reasoning),
    // not UTC midnight -- avoids the expiry silently landing on the wrong calendar day depending on
    // the admin's timezone.
    var expiresAtVal = expiresInput.value ? Math.floor(new Date(expiresInput.value + 'T00:00:00').getTime() / 1000) : null;
    await apiFetch('/console/codes/update', { method: 'POST', body: { code: el.getAttribute('data-code'), note: noteVal || null, expiresAt: expiresAtVal } });
    noteInput.setAttribute('data-original', noteVal);
    expiresInput.setAttribute('data-original', expiresInput.value);
    el.textContent = 'Saved!';
    setTimeout(function () { el.textContent = 'Save'; }, 1500);
  } else if (act === 'add-promotion') {
    promotionFormState = 'new';
    drawPromotions();
  } else if (act === 'edit-promotion') {
    var editId = el.getAttribute('data-id');
    promotionFormState = promotionsCache.filter(function (p) { return p.id === editId; })[0] || 'new';
    drawPromotions();
  } else if (act === 'cancel-promotion-form') {
    promotionFormState = null;
    drawPromotions();
  } else if (act === 'delete-promotion') {
    await apiFetch('/console/promotions/delete', { method: 'POST', body: { id: el.getAttribute('data-id') } });
    renderPromotions();
  } else if (act === 'toggle-promotion-active') {
    await apiFetch('/console/promotions/toggle', {
      method: 'POST', body: { id: el.getAttribute('data-id'), active: el.getAttribute('data-active') === '1' },
    });
    renderPromotions();
  } else if (act === 'reorder-promotion') {
    await apiFetch('/console/promotions/reorder', {
      method: 'POST', body: { id: el.getAttribute('data-id'), direction: el.getAttribute('data-direction') },
    });
    renderPromotions();
  } else if (act === 'add-category') {
    categoryFormState = 'new';
    drawCategories();
  } else if (act === 'edit-category') {
    var editSlug = el.getAttribute('data-slug');
    categoryFormState = categoriesCache.filter(function (c) { return c.slug === editSlug; })[0] || 'new';
    drawCategories();
  } else if (act === 'cancel-category-form') {
    categoryFormState = null;
    drawCategories();
  } else if (act === 'delete-category') {
    if (!confirm('Delete this category\'s landing page copy? This cannot be undone.')) return;
    await apiFetch('/console/category-content/delete', { method: 'POST', body: { slug: el.getAttribute('data-slug') } });
    renderCategories();
  } else if (act === 'add-blog') {
    blogFormState = 'new';
    drawBlog();
  } else if (act === 'edit-blog') {
    var editBlogId = el.getAttribute('data-id');
    blogFormState = blogCache.filter(function (p) { return p.id === editBlogId; })[0] || 'new';
    drawBlog();
  } else if (act === 'cancel-blog-form') {
    blogFormState = null;
    drawBlog();
  } else if (act === 'delete-blog') {
    if (!confirm('Delete this article? This cannot be undone.')) return;
    await apiFetch('/console/blog/delete', { method: 'POST', body: { id: el.getAttribute('data-id') } });
    renderBlog();
  } else if (act === 'review-refund-claim') {
    var claimId = el.getAttribute('data-claim-id');
    var reviewStatus = el.getAttribute('data-status');
    var notesInput = document.querySelector('.refund-admin-notes-input[data-claim-id="' + claimId + '"]');
    await apiFetch('/console/refund-claims/review', {
      method: 'POST',
      body: { claimId: claimId, status: reviewStatus, adminNotes: notesInput ? notesInput.value.trim() || undefined : undefined },
    });
    renderRefunds();
  } else if (act === 'delete-question') {
    await apiFetch('/console/questions/delete', { method: 'POST', body: { id: el.getAttribute('data-id') } });
    await refreshQuestionsAfterMutation();
  } else if (act === 'import-questions') {
    document.getElementById('import-file').click();
  } else if (act === 'select-exam-tab') {
    currentQuestionsExamType = el.getAttribute('data-exam');
    await refreshQuestionsScope();
    var trackListEl = document.getElementById('questions-track-list');
    if (trackListEl) trackListEl.innerHTML = renderQuestionsTrackList(); // just the active-track highlight
  } else if (act === 'select-topic-tab') {
    currentQuestionsTopic = el.getAttribute('data-topic') || null;
    questionsPage = 0;
    await refreshQuestionsPage();
  } else if (act === 'filter-questions-kind') {
    var newQuestionsKind = el.getAttribute('data-kind');
    if (newQuestionsKind === questionsKindFilter) return;
    questionsKindFilter = newQuestionsKind;
    currentQuestionsExamType = null; // changing the pills drops any specific track pick
    document.getElementById('questions-kind-filter-wrap').innerHTML = renderQuestionsKindFilterPills();
    document.getElementById('questions-state-filter-wrap').innerHTML = renderQuestionsStateFilterPills(); // its counts depend on the kind filter too
    document.getElementById('questions-track-list').innerHTML = renderQuestionsTrackList();
    await refreshQuestionsScope();
  } else if (act === 'filter-questions-state') {
    var newQuestionsState = el.getAttribute('data-state');
    if (newQuestionsState === questionsStateFilter) return;
    questionsStateFilter = newQuestionsState;
    currentQuestionsExamType = null;
    document.getElementById('questions-state-filter-wrap').innerHTML = renderQuestionsStateFilterPills();
    document.getElementById('questions-kind-filter-wrap').innerHTML = renderQuestionsKindFilterPills(); // its counts depend on the state filter too
    document.getElementById('questions-track-list').innerHTML = renderQuestionsTrackList();
    await refreshQuestionsScope();
  } else if (act === 'questions-prev-page') {
    if (questionsPage > 0) { questionsPage--; await refreshQuestionsPage(); }
  } else if (act === 'questions-next-page') {
    if ((questionsPage + 1) * QUESTIONS_PAGE_SIZE < questionsTotal) { questionsPage++; await refreshQuestionsPage(); }
  } else if (act === 'refresh-stalled-buyers') {
    var daysInput = document.getElementById('stalled-days-input');
    var daysVal = daysInput ? parseInt(daysInput.value, 10) : NaN;
    stalledBuyersDays = Number.isFinite(daysVal) && daysVal > 0 ? daysVal : stalledBuyersDays;
    await loadStalledBuyers();
  } else if (act === 'send-stalled-reminder') {
    var remindUserId = el.getAttribute('data-user-id');
    stalledBuyerSendingIds[remindUserId] = true;
    drawStalledBuyersTable();
    try {
      await apiFetch('/console/stalled-buyers/remind', { method: 'POST', body: { userId: remindUserId } });
      delete stalledBuyerSendingIds[remindUserId];
      await loadStalledBuyers(); // refreshes "Last reminded" and re-applies the threshold filter
    } catch (err) {
      delete stalledBuyerSendingIds[remindUserId];
      drawStalledBuyersTable();
      alert('Could not send reminder: ' + (err.data && err.data.error ? err.data.error : 'unknown error'));
    }
  } else if (act === 'toggle-pricing-rows') {
    pricingRowsExpanded = !pricingRowsExpanded;
    updatePricingRowVisibility();
  } else if (act === 'filter-pricing-kind') {
    var newPricingKindFilter = el.getAttribute('data-kind');
    if (newPricingKindFilter === pricingKindFilter) return;
    pricingKindFilter = newPricingKindFilter;
    pricingRowsExpanded = false;
    document.getElementById('pricing-kind-filter-wrap').innerHTML = renderPricingKindFilterPills();
    updatePricingRowVisibility();
  } else if (act === 'sort-pricing') {
    var pricingSortKey = el.getAttribute('data-key');
    if (pricingSort.key === pricingSortKey) pricingSort.dir *= -1;
    else { pricingSort.key = pricingSortKey; pricingSort.dir = 1; }
    applyPricingSortOrder();
    document.getElementById('pricing-table-head').innerHTML = sortableHeaderRow(PRICING_COLUMNS, pricingSort, 'sort-pricing');
    updatePricingRowVisibility(); // collapse cutoff depends on row order, which just changed
  } else if (act === 'sort-codes') {
    var codesSortKey = el.getAttribute('data-key');
    if (codesSort.key === codesSortKey) codesSort.dir *= -1;
    else { codesSort.key = codesSortKey; codesSort.dir = 1; }
    applyCodesSortOrder();
    document.getElementById('codes-table-head').innerHTML = sortableHeaderRow(CODES_COLUMNS, codesSort, 'sort-codes').replace('</tr>', '<th></th></tr>');
    updateCodesRowVisibility(); // re-render replaced the header only, but filter state is on rows -- cheap to just reapply
  } else if (act === 'filter-codes-status') {
    codesStatusFilter = el.getAttribute('data-status');
    document.getElementById('codes-status-filter-wrap').innerHTML = renderCodesStatusFilterPills(
      Array.prototype.slice.call(document.querySelectorAll('#codes-rows-body tr[data-code]')).map(function (row) { return { status: row.dataset.status }; })
    );
    updateCodesRowVisibility();
  } else if (act === 'filter-testimonials-status') {
    testimonialsStatusFilter = el.getAttribute('data-status');
    document.getElementById('testimonials-filter-wrap').innerHTML = testimonialsFilterPillsHtml();
    drawTestimonialsTable();
  } else if (act === 'moderate-testimonial') {
    await apiFetch('/console/testimonials/moderate', {
      method: 'POST', body: { id: el.getAttribute('data-id'), status: el.getAttribute('data-status') },
    });
    renderTestimonials();
  } else if (act === 'copy-testimonial-line') {
    var line = el.getAttribute('data-quote') + ' | ' + el.getAttribute('data-author');
    if (navigator.clipboard) navigator.clipboard.writeText(line).catch(function () {});
    var originalLabel = el.textContent;
    el.textContent = 'Copied!';
    setTimeout(function () { el.textContent = originalLabel; }, 1500);
  } else if (act === 'save-pricing-changes') {
    var dirtyPriceRows = Array.prototype.slice.call(document.querySelectorAll('.price-input')).filter(function (inp) {
      return inp.value !== inp.dataset.original;
    });
    for (var i = 0; i < dirtyPriceRows.length; i++) {
      var priceInput = dirtyPriceRows[i];
      var dollars = parseFloat(priceInput.value);
      if (isNaN(dollars) || dollars < 0) { alert('Enter a valid price for every changed track.'); return; }
    }
    var dirtyActiveRows = Array.prototype.slice.call(document.querySelectorAll('.track-active-input')).filter(function (inp) {
      return String(inp.checked) !== inp.dataset.original;
    });
    await Promise.all(
      dirtyPriceRows.map(function (inp) {
        return apiFetch('/console/pricing', { method: 'POST', body: { examType: inp.dataset.exam, priceCents: Math.round(parseFloat(inp.value) * 100) } });
      }).concat(dirtyActiveRows.map(function (inp) {
        return apiFetch('/console/track-registry/active', { method: 'POST', body: { examType: inp.dataset.exam, active: inp.checked } }).then(function () {
          // Keep the in-memory registry in sync so a re-render (e.g. re-sorting, switching tabs
          // and back) without a full page reload still reflects the just-saved value.
          if (TRACK_REGISTRY_FULL[inp.dataset.exam]) TRACK_REGISTRY_FULL[inp.dataset.exam].active = inp.checked;
        });
      }))
    );
    markSettingsGroupSaved(el);
  } else if (act === 'save-point-rules-changes') {
    var dirtyRuleRows = Array.prototype.slice.call(document.querySelectorAll('tr[data-row-key]')).filter(function (row) {
      var pointsInput = row.querySelector('.rule-points-input');
      if (!pointsInput) return false; // scopes to point-rule rows, excluding pricing rows
      var activeInput = row.querySelector('.rule-active-input');
      return pointsInput.value !== pointsInput.dataset.original || String(activeInput.checked) !== activeInput.dataset.original;
    });
    for (var j = 0; j < dirtyRuleRows.length; j++) {
      var pointsVal = parseInt(dirtyRuleRows[j].querySelector('.rule-points-input').value, 10);
      if (isNaN(pointsVal) || pointsVal < 0) { alert('Enter a valid points value for every changed rule.'); return; }
    }
    await Promise.all(dirtyRuleRows.map(function (row) {
      var pointsInput = row.querySelector('.rule-points-input');
      var activeInput = row.querySelector('.rule-active-input');
      return apiFetch('/console/point-rules', {
        method: 'POST',
        body: { taskKey: pointsInput.dataset.task, label: row.children[0].textContent, points: parseInt(pointsInput.value, 10), active: activeInput.checked },
      });
    }));
    markSettingsGroupSaved(el);
  } else if (act === 'save-min-charge') {
    var minChargeInput = document.querySelector('.min-charge-input');
    var minChargeDollarsVal = parseFloat(minChargeInput.value);
    if (isNaN(minChargeDollarsVal) || minChargeDollarsVal < 0) { alert('Enter a valid amount.'); return; }
    await apiFetch('/console/settings', {
      method: 'POST',
      body: { key: 'min_paypal_charge_cents', value: String(Math.round(minChargeDollarsVal * 100)) },
    });
    markSettingsGroupSaved(el);
  } else if (act === 'add-visitor-exclusion') {
    var newExclusionInput = document.getElementById('new-visitor-exclusion-input');
    var newIp = newExclusionInput.value.trim();
    if (!newIp) { alert('Enter an IP address.'); return; }
    var currentSettings = await apiFetch('/console/settings');
    var list = parseCsvSetting(currentSettings, 'visitor_excluded_ips');
    if (list.indexOf(newIp) === -1) list.push(newIp);
    await apiFetch('/console/settings', { method: 'POST', body: { key: 'visitor_excluded_ips', value: list.join(',') } });
    renderSettings();
  } else if (act === 'remove-visitor-exclusion') {
    var removeIp = el.getAttribute('data-ip');
    var currentSettings2 = await apiFetch('/console/settings');
    var list2 = parseCsvSetting(currentSettings2, 'visitor_excluded_ips').filter(function (ip) { return ip !== removeIp; });
    await apiFetch('/console/settings', { method: 'POST', body: { key: 'visitor_excluded_ips', value: list2.join(',') } });
    renderSettings();
  } else if (act === 'save-progress-colors') {
    var accuracyPassPctInput = document.querySelector('.accuracy-pass-pct-input');
    var coveragePassPctInput = document.querySelector('.coverage-pass-pct-input');
    var accuracyPassPctVal = parseInt(accuracyPassPctInput.value, 10);
    var coveragePassPctVal = parseInt(coveragePassPctInput.value, 10);
    if (!Number.isFinite(accuracyPassPctVal) || accuracyPassPctVal < 0 || accuracyPassPctVal > 100 ||
      !Number.isFinite(coveragePassPctVal) || coveragePassPctVal < 0 || coveragePassPctVal > 100) {
      alert('Enter a value between 0 and 100 for both.'); return;
    }
    var colorSaves = [];
    if (accuracyPassPctInput.value !== accuracyPassPctInput.dataset.original) {
      colorSaves.push(apiFetch('/console/settings', { method: 'POST', body: { key: 'progress_accuracy_pass_pct', value: String(accuracyPassPctVal) } }));
    }
    if (coveragePassPctInput.value !== coveragePassPctInput.dataset.original) {
      colorSaves.push(apiFetch('/console/settings', { method: 'POST', body: { key: 'progress_coverage_pass_pct', value: String(coveragePassPctVal) } }));
    }
    await Promise.all(colorSaves);
    markSettingsGroupSaved(el);
  } else if (act === 'save-refund-failure-pct') {
    var refundFailurePctInput = document.querySelector('.refund-failure-pct-input');
    var refundFailurePctVal = parseInt(refundFailurePctInput.value, 10);
    if (!Number.isFinite(refundFailurePctVal) || refundFailurePctVal < 0 || refundFailurePctVal > 100) { alert('Enter a value between 0 and 100.'); return; }
    await apiFetch('/console/settings', {
      method: 'POST',
      body: { key: 'refund_failure_percent', value: String(refundFailurePctVal) },
    });
    markSettingsGroupSaved(el);
  } else if (act === 'sort-visitors') {
    var visitorsSortKey = el.getAttribute('data-key');
    if (visitorsSort.key === visitorsSortKey) visitorsSort.dir *= -1;
    else { visitorsSort.key = visitorsSortKey; visitorsSort.dir = 1; }
    drawVisitorsTable();
  } else if (act === 'visitors-date-preset') {
    var newPreset = el.getAttribute('data-preset');
    if (newPreset === visitorsFilters.preset) return;
    visitorsFilters.preset = newPreset;
    document.getElementById('visitors-filter-wrap').innerHTML = visitorsFilterBarHtml();
    if (visitorsFilters.preset !== 'custom') await loadVisitors(); // custom needs the date inputs filled in first
  } else if (act === 'apply-visitors-filters') {
    await loadVisitors();
  } else if (act === 'toggle-visitors-country-op') {
    visitorsFilters.countryOp = visitorsFilters.countryOp === 'ne' ? 'eq' : 'ne';
    document.getElementById('visitors-filter-wrap').innerHTML = visitorsFilterBarHtml();
  } else if (act === 'toggle-visitors-region-op') {
    visitorsFilters.regionOp = visitorsFilters.regionOp === 'ne' ? 'eq' : 'ne';
    document.getElementById('visitors-filter-wrap').innerHTML = visitorsFilterBarHtml();
  } else if (act === 'toggle-questions-source-op') {
    questionsSourceOp = questionsSourceOp === 'ne' ? 'eq' : 'ne';
    var sourceWrapEl2 = document.getElementById('questions-source-filter-wrap');
    if (sourceWrapEl2) sourceWrapEl2.innerHTML = renderQuestionsSourceFilterHtml();
    if (questionsSourceFilter) { questionsPage = 0; await refreshQuestionsPage(); }
  } else if (act === 'reset-visitors-filters') {
    visitorsFilters = Object.assign({}, VISITORS_DEFAULT_FILTERS);
    document.getElementById('visitors-filter-wrap').innerHTML = visitorsFilterBarHtml();
    await loadVisitors();
  } else if (act === 'add-alert-rule') {
    var newTriggerSelect = document.getElementById('new-alert-trigger-select');
    var newEmailInput = document.getElementById('new-alert-email-input');
    var newEmailVal = newEmailInput.value.trim();
    if (!newEmailVal) { alert('Enter a recipient email.'); return; }
    await apiFetch('/console/alert-rules/create', {
      method: 'POST',
      body: { triggerKey: newTriggerSelect.value, recipientEmail: newEmailVal },
    });
    renderAlerts();
  } else if (act === 'save-alert-rule') {
    var saveRuleId = el.getAttribute('data-id');
    var row = el.closest('tr');
    var emailInput = row.querySelector('.alert-rule-email-input');
    var activeInput = row.querySelector('.alert-rule-active-input');
    var emailVal = emailInput.value.trim();
    if (!emailVal) { alert('Enter a recipient email.'); return; }
    await apiFetch('/console/alert-rules/update', {
      method: 'POST',
      body: { id: saveRuleId, recipientEmail: emailVal, active: activeInput.checked },
    });
    renderAlerts();
  } else if (act === 'delete-alert-rule') {
    var deleteRuleId = el.getAttribute('data-id');
    if (!confirm('Delete this alert rule?')) return;
    await apiFetch('/console/alert-rules/delete', { method: 'POST', body: { id: deleteRuleId } });
    renderAlerts();
  } else if (act === 'sort-accounts') {
    var accountsSortKey = el.getAttribute('data-key');
    if (accountsSort.key === accountsSortKey) accountsSort.dir *= -1;
    else { accountsSort.key = accountsSortKey; accountsSort.dir = 1; }
    drawAccountsTable();
  } else if (act === 'sort-referrals') {
    var referralsSortKey = el.getAttribute('data-key');
    if (referralsSort.key === referralsSortKey) referralsSort.dir *= -1;
    else { referralsSort.key = referralsSortKey; referralsSort.dir = 1; }
    drawReferralsTable();
  } else if (act === 'sort-accuracy') {
    var accTrack = el.getAttribute('data-track');
    var accuracySortKey = el.getAttribute('data-key');
    var accSort = accuracySortByTrack[accTrack] || (accuracySortByTrack[accTrack] = { key: 'topic', dir: 1 });
    if (accSort.key === accuracySortKey) accSort.dir *= -1;
    else { accSort.key = accuracySortKey; accSort.dir = 1; }
    var accGroup = groupAccuracyByTrack(statsAccuracyCache).filter(function (t) { return t.examType === accTrack; })[0];
    var accContainer = document.getElementById('accuracy-track-table-' + accTrack);
    if (accContainer && accGroup) accContainer.innerHTML = accuracyTrackTableHtml(accGroup);
  } else if (act === 'toggle-accuracy-topics') {
    var toggleTrack = el.getAttribute('data-track');
    accuracyExpandedByTrack[toggleTrack] = !accuracyExpandedByTrack[toggleTrack];
    var toggleGroup = groupAccuracyByTrack(statsAccuracyCache).filter(function (t) { return t.examType === toggleTrack; })[0];
    var toggleContainer = document.getElementById('accuracy-track-table-' + toggleTrack);
    if (toggleContainer && toggleGroup) toggleContainer.innerHTML = accuracyTrackTableHtml(toggleGroup);
  } else if (act === 'sort-quiz-progress-topics') {
    var qpUserId = el.getAttribute('data-user-id');
    var qpKey = el.getAttribute('data-key');
    var qpSort = quizProgressTopicSort[qpUserId] || (quizProgressTopicSort[qpUserId] = { key: 'topic', dir: 1 });
    if (qpSort.key === qpKey) qpSort.dir *= -1;
    else { qpSort.key = qpKey; qpSort.dir = 1; }
    var qpContainer = document.getElementById('quiz-progress-table-' + qpUserId);
    var qpGroup = quizProgressGroupsCache.filter(function (g) { return g.userId === qpUserId; })[0];
    if (qpContainer && qpGroup) qpContainer.innerHTML = quizProgressTableHtml(qpGroup);
  } else if (act === 'sort-leaderboard') {
    var lbTrack = el.getAttribute('data-track');
    leaderboardSortKeyByTrack[lbTrack] = el.getAttribute('data-key');
    var lbContainer = document.getElementById('leaderboard-table-' + lbTrack);
    var lbGroup = groupLeaderboardByTrack(quizProgressGroupsCache).filter(function (t) { return t.examType === lbTrack; })[0];
    if (lbContainer && lbGroup) lbContainer.innerHTML = leaderboardTrackTableHtml(lbGroup);
  } else if (act === 'toggle-theme') {
    var nextTheme = el.getAttribute('data-next');
    var local = loadLocalPrefs();
    saveLocalPrefs(nextTheme, local.fontScale);
    applyTheme(nextTheme, local.fontScale);
    route();
  } else if (act === 'font-up' || act === 'font-down') {
    var l = loadLocalPrefs();
    var next = Math.max(0.85, Math.min(1.4, l.fontScale + (act === 'font-up' ? 0.05 : -0.05)));
    saveLocalPrefs(l.theme, next);
    applyTheme(l.theme, next);
  }
});

appEl.addEventListener('input', function (e) {
  // Both branches below update a narrower DOM slice than a full drawQuestionsResults()/renderQuestions()
  // would -- typing into a search box that then gets destroyed and recreated on every keystroke's
  // (debounced) redraw would keep dropping focus. See renderQuestionsTrackPicker()/drawQuestionsResults().
  if (e.target.id === 'questions-track-search') {
    questionsTrackQuery = e.target.value;
    var trackListEl = document.getElementById('questions-track-list');
    if (trackListEl) trackListEl.innerHTML = renderQuestionsTrackList();
    return;
  }
  if (e.target.id === 'questions-search-input') {
    questionsSearchQuery = e.target.value;
    clearTimeout(questionsSearchDebounceTimer);
    questionsSearchDebounceTimer = setTimeout(function () { questionsPage = 0; refreshQuestionsPage(); }, 300);
    return;
  }
  if (e.target.id === 'codes-search-input') { codesFilterQuery = e.target.value; updateCodesRowVisibility(); return; }
  if (e.target.classList.contains('settings-filter-input')) { filterPricingRows(e.target.value); return; }
  if (e.target.hasAttribute('data-original')) updateSettingsDirtyState(e.target);
});
appEl.addEventListener('change', function (e) {
  if (e.target.hasAttribute('data-original')) updateSettingsDirtyState(e.target);
  if (e.target.id === 'questions-source-select') {
    questionsSourceFilter = e.target.value;
    questionsPage = 0;
    refreshQuestionsPage();
  }
  if (e.target.id === 'codes-exam-select') {
    codesExamFilter = e.target.value;
    updateCodesRowVisibility();
  }
});

document.addEventListener('change', async function (e) {
  if (e.target.id === 'import-file' && e.target.files[0]) {
    var text = await e.target.files[0].text();
    var questions = JSON.parse(text);
    var result = await apiFetch('/console/questions/import', { method: 'POST', body: { questions: questions } });
    alert('Imported ' + result.imported + ' questions.');
    await refreshQuestionsAfterMutation();
  }
});

(function boot() {
  var local = loadLocalPrefs();
  applyTheme(local.theme, local.fontScale);
  // Must have EXAM_TYPES/TRACK_REGISTRY_FULL populated before the first route() call -- every tab
  // (Tracks, Questions, Pricing, Codes, etc.) reads EXAM_TYPES synchronously while rendering, and
  // it starts empty (see loadTrackRegistry()). Resolves near-instantly in the common case.
  loadTrackRegistry().then(route);
})();
