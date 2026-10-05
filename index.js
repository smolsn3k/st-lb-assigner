import * as ST from '../../../../script.js';
import * as WI from '../../../world-info.js';
import * as EXT from '../../../extensions.js';
const { extension_settings } = EXT;

const MODULE = 'multi_lorebook_assigner';
const MAX_SHOWN = 500;

const CHAR_SORTS = [
    ['newest', 'Newest first'],
    ['oldest', 'Oldest first'],
    ['az', 'A → Z'],
    ['za', 'Z → A'],
    ['recent', 'Recently chatted'],
    ['most', 'Most lorebooks'],
    ['selected', 'Selected first'],
];
const BOOK_SORTS = [
    ['newest', 'Newest first'],
    ['oldest', 'Oldest first'],
    ['az', 'A → Z'],
    ['za', 'Z → A'],
    ['most', 'Most bots'],
    ['selected', 'Selected first'],
];

const state = {
    chars: new Set(),  // selected bot keys (avatar filename without extension)
    books: new Set(),  // selected lorebook names (used for Additional lorebooks)
    charFilter: '',
    bookFilter: '',
    busy: false,
};
const shown = { chars: [], books: [] };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* ---------- data helpers ---------- */

function settings() {
    extension_settings[MODULE] ??= {};
    const s = extension_settings[MODULE];
    s.charSort ??= 'newest';
    s.bookSort ??= 'az';
    s.bgOpacity ??= 90;
    s.showAvatars ??= true;
    s.firstSeen ??= {};
    return s;
}

const charKey = (c) => c?.avatar?.replace(/\.[^/.]+$/, '');
const primaryOf = (c) => c?.data?.extensions?.world || '';

function charLore() {
    if (!Array.isArray(WI.world_info.charLore)) WI.world_info.charLore = [];
    return WI.world_info.charLore;
}
const findEntry = (key) => charLore().find((e) => e.name === key);

function getBookNames() {
    let names = Array.isArray(WI.world_names) ? [...WI.world_names] : [];
    if (!names.length) {
        names = $('#world_editor_select option')
            .map((_, o) => ($(o).val() === '' ? null : o.textContent.trim()))
            .get();
    }
    names = names.filter(Boolean);

    // SillyTavern doesn't expose lorebook dates, so "newest/oldest" is based on when
    // this extension first saw each lorebook.
    const s = settings();
    let changed = false;
    if (!s.baselined && names.length) {
        names.forEach((n) => { s.firstSeen[n] = 0; });
        s.baselined = true;
        changed = true;
    }
    if (s.baselined) {
        for (const n of names) {
            if (s.firstSeen[n] === undefined) { s.firstSeen[n] = Date.now(); changed = true; }
        }
    }
    if (changed) ST.saveSettingsDebounced();
    return names;
}

function sortItems(items, mode, selectedSet) {
    const arr = items.map((x, i) => ({ ...x, i }));
    const byIndex = (a, b) => a.i - b.i;
    const cmps = {
        az: (a, b) => collator.compare(a.label, b.label),
        za: (a, b) => collator.compare(b.label, a.label),
        newest: (a, b) => (b.date - a.date) || byIndex(a, b),
        oldest: (a, b) => (a.date - b.date) || byIndex(a, b),
        recent: (a, b) => (b.lastChat - a.lastChat) || collator.compare(a.label, b.label),
        most: (a, b) => (b.count - a.count) || collator.compare(a.label, b.label),
        selected: (a, b) => (selectedSet.has(b.key) - selectedSet.has(a.key)) || collator.compare(a.label, b.label),
    };
    return arr.sort(cmps[mode] ?? cmps.az);
}

function filterItems(items, q) {
    q = q.trim().toLowerCase();
    return q ? items.filter((x) => x.label.toLowerCase().includes(q)) : items;
}

/* ---------- Additional lorebooks ---------- */

function applyAdditional(mode) {
    if (!state.chars.size || (mode !== 'replace' && !state.books.size)) {
        toastr.warning(mode === 'replace' ? 'Select at least one bot.' : 'Select at least one bot and one lorebook.');
        return;
    }
    const lore = charLore();

    for (const key of state.chars) {
        let entry = findEntry(key);
        if (!entry) {
            if (mode === 'remove') continue;
            entry = { name: key, extraBooks: [] };
            lore.push(entry);
        }
        let set = new Set(entry.extraBooks ?? []);
        if (mode === 'add') state.books.forEach((b) => set.add(b));
        if (mode === 'remove') state.books.forEach((b) => set.delete(b));
        if (mode === 'replace') set = new Set(state.books);
        entry.extraBooks = [...set];
    }

    WI.world_info.charLore = lore.filter((e) => e.extraBooks?.length);
    ST.saveSettingsDebounced();
    toastr.success(`Additional (${mode}): ${state.chars.size} bot(s), ${state.books.size} lorebook(s).`);
    render();
}

/* ---------- Primary lorebook ---------- */

// writeExtensionField lives in different modules depending on the SillyTavern version,
// so look for it in several places and fall back to calling the API directly.
async function writePrimary(idx, name) {
    const ctx = globalThis.SillyTavern?.getContext?.() ?? {};
    const fn = EXT.writeExtensionField ?? ST.writeExtensionField ?? ctx.writeExtensionField;
    if (typeof fn === 'function') {
        await fn(idx, 'world', name);
        return;
    }
    const getHeaders = ST.getRequestHeaders ?? ctx.getRequestHeaders;
    if (typeof getHeaders !== 'function') throw new Error('No way to build request headers');
    const res = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ avatar: ST.characters[idx].avatar, data: { extensions: { world: name } } }),
    });
    if (!res.ok) throw new Error(`merge-attributes failed: ${res.status}`);
}

async function applyPrimary(name) {
    if (state.busy) return;
    if (!state.chars.size) { toastr.warning('Select at least one bot.'); return; }
    state.busy = true;
    let ok = 0, fail = 0;
    try {
        for (const key of state.chars) {
            const idx = ST.characters.findIndex((c) => charKey(c) === key);
            if (idx < 0) { fail++; continue; }
            try {
                await writePrimary(idx, name);
                const c = ST.characters[idx];
                c.data ??= {};
                c.data.extensions ??= {};
                c.data.extensions.world = name;
                // keep the character panel in sync if this bot is currently open
                if (String(ST.this_chid) === String(idx)) $('#character_world').val(name);
                ok++;
            } catch (err) {
                console.error('[MLA] failed to set primary for', key, err);
                fail++;
            }
        }
    } finally {
        state.busy = false;
    }
    const what = name ? `Primary set to "${name}"` : 'Primary cleared';
    if (fail) toastr.warning(`${what} on ${ok} bot(s); ${fail} failed (see console).`);
    else toastr.success(`${what} on ${ok} bot(s).`);
    render();
}

/* ---------- rendering ---------- */

function avatarUrl(file) {
    if (typeof ST.getThumbnailUrl === 'function') return ST.getThumbnailUrl('avatar', file);
    return `/thumbnail?type=avatar&file=${encodeURIComponent(file)}`;
}

function makeRow(checked, label, subs, onToggle, avatarFile = null) {
    const row = $('<label class="mla-row"></label>');
    const cb = $('<input type="checkbox">').prop('checked', checked).on('change', function () {
        onToggle(this.checked);
        updateCounts();
    });
    const text = $('<div></div>').append($('<div></div>').text(label));
    subs.filter(Boolean).forEach((t) => text.append($('<div class="mla-sub"></div>').text(t)));
    row.append(cb);
    if (avatarFile) row.append($('<img class="mla-avatar" loading="lazy" alt="">').attr('src', avatarUrl(avatarFile)));
    return row.append(text);
}

function renderChars() {
    const s = settings();
    let items = (ST.characters ?? [])
        .map((c) => {
            const key = charKey(c);
            const extra = findEntry(key)?.extraBooks ?? [];
            const primary = primaryOf(c);
            return {
                key, label: c.name ?? key, primary, extra, avatar: c.avatar,
                date: Number(c.date_added) || 0,
                lastChat: Number(c.date_last_chat) || 0,
                count: extra.length + (primary ? 1 : 0),
            };
        })
        .filter((c) => c.key);
    items = sortItems(filterItems(items, state.charFilter), s.charSort, state.chars);
    shown.chars = items;

    const box = $('#mla_char_list').empty();
    items.slice(0, MAX_SHOWN).forEach((c) => {
        box.append(makeRow(
            state.chars.has(c.key), c.label,
            [c.primary ? `Primary: ${c.primary}` : '', c.extra.length ? `Additional: ${c.extra.join(', ')}` : ''],
            (on) => { on ? state.chars.add(c.key) : state.chars.delete(c.key); },
            s.showAvatars ? c.avatar : null,
        ));
    });
    if (items.length > MAX_SHOWN) box.append(`<div class="mla-note">Showing first ${MAX_SHOWN} of ${items.length}. Use search to narrow.</div>`);
    if (!items.length) box.append('<div class="mla-note">No bots found.</div>');
}

function renderBooks() {
    const s = settings();
    const asPrimary = {}, asExtra = {};
    (ST.characters ?? []).forEach((c) => { const p = primaryOf(c); if (p) asPrimary[p] = (asPrimary[p] ?? 0) + 1; });
    charLore().forEach((e) => (e.extraBooks ?? []).forEach((b) => { asExtra[b] = (asExtra[b] ?? 0) + 1; }));

    let items = getBookNames().map((n) => ({
        key: n, label: n, date: s.firstSeen[n] ?? 0,
        p: asPrimary[n] ?? 0, a: asExtra[n] ?? 0,
        count: (asPrimary[n] ?? 0) + (asExtra[n] ?? 0),
    }));
    items = sortItems(filterItems(items, state.bookFilter), s.bookSort, state.books);
    shown.books = items;

    const box = $('#mla_book_list').empty();
    items.slice(0, MAX_SHOWN).forEach((b) => {
        const usage = [b.p ? `primary for ${b.p}` : '', b.a ? `additional for ${b.a}` : ''].filter(Boolean).join(' · ');
        box.append(makeRow(state.books.has(b.key), b.label, [usage], (on) => {
            on ? state.books.add(b.key) : state.books.delete(b.key);
        }));
    });
    if (items.length > MAX_SHOWN) box.append(`<div class="mla-note">Showing first ${MAX_SHOWN} of ${items.length}. Use search to narrow.</div>`);
    if (!items.length) box.append('<div class="mla-note">No lorebooks found.</div>');
}

function renderPrimarySelect() {
    const sel = $('#mla_primary_select');
    const current = sel.val();
    sel.empty().append('<option value="">— choose lorebook —</option>');
    getBookNames().sort((a, b) => collator.compare(a, b)).forEach((n) => {
        sel.append($('<option></option>').val(n).text(n));
    });
    if (current) sel.val(current);
}

function updateCounts() {
    $('#mla_char_count').text(`${state.chars.size} selected`);
    $('#mla_book_count').text(`${state.books.size} selected`);
    $('#mla_tab_chars').text(`Bots (${state.chars.size})`);
    $('#mla_tab_books').text(`Lorebooks (${state.books.size})`);
}

function render() {
    renderChars();
    renderBooks();
    renderPrimarySelect();
    updateCounts();
}

/* ---------- UI ---------- */

const optionsHtml = (list, current) =>
    list.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${l}</option>`).join('');

function applyOpacity(v) {
    $('.mla-window')[0]?.style.setProperty('--mla-bg', `${v}%`);
    $('#mla_opacity_val').text(`${v}%`);
}

function setTab(name) {
    $('.mla-window').toggleClass('show-books', name === 'books');
    $('#mla_tab_chars').toggleClass('active', name !== 'books');
    $('#mla_tab_books').toggleClass('active', name === 'books');
}

function openWindow() {
    $('#mla_overlay').addClass('open');
    render();
    $('#mla_char_search').trigger('focus');
}
function closeWindow() {
    $('#mla_overlay').removeClass('open');
}

function buildUI() {
    const s = settings();

    // 1) Button in the Extensions tab
    $('#extensions_settings2').append(`
    <div class="mla-settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Multi Lorebook Assigner</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div class="mla-open-wrap">
            <small>Assign primary and additional lorebooks to multiple bots at once.</small>
            <div id="mla_open" class="menu_button"><i class="fa-solid fa-book"></i>&nbsp;Open Lorebook Assigner</div>
          </div>
        </div>
      </div>
    </div>`);

    // 2) The separate window
    $('body').append(`
    <div id="mla_overlay" class="mla-overlay">
      <div class="mla-window" role="dialog" aria-modal="true">
        <div class="mla-header">
          <b>Multi Lorebook Assigner</b>
          <div class="mla-opacity" title="Window background opacity">
            <span>Opacity</span>
            <input id="mla_opacity" type="range" min="10" max="100" step="5" value="${s.bgOpacity}">
            <span id="mla_opacity_val" class="mla-opacity-val"></span>
          </div>
          <div id="mla_close" class="menu_button fa-solid fa-xmark" title="Close"></div>
        </div>
        <div class="mla-tabs">
          <div id="mla_tab_chars" class="menu_button mla-tab active">Bots</div>
          <div id="mla_tab_books" class="menu_button mla-tab">Lorebooks</div>
        </div>
        <div class="mla-body">
          <div class="mla-col">
            <h4>Bots <span id="mla_char_count" class="mla-count"></span></h4>
            <div class="mla-controls">
              <input id="mla_char_search" class="text_pole" type="search" placeholder="Search bots...">
              <select id="mla_char_sort" class="text_pole">${optionsHtml(CHAR_SORTS, s.charSort)}</select>
            </div>
            <div class="mla-tools">
              <div id="mla_char_all" class="menu_button">Select shown</div>
              <div id="mla_char_none" class="menu_button">Clear</div>
              <label class="checkbox_label"><input id="mla_show_avatars" type="checkbox" ${s.showAvatars ? 'checked' : ''}><span>Show avatars</span></label>
            </div>
            <div id="mla_char_list" class="mla-list"></div>
          </div>
          <div class="mla-col">
            <h4>Lorebooks <span id="mla_book_count" class="mla-count"></span></h4>
            <div class="mla-controls">
              <input id="mla_book_search" class="text_pole" type="search" placeholder="Search lorebooks...">
              <select id="mla_book_sort" class="text_pole" title="Newest/Oldest = when this extension first saw the lorebook (SillyTavern doesn't expose lorebook dates)">${optionsHtml(BOOK_SORTS, s.bookSort)}</select>
            </div>
            <div class="mla-tools">
              <div id="mla_book_all" class="menu_button">Select shown</div>
              <div id="mla_book_none" class="menu_button">Clear</div>
            </div>
            <div id="mla_book_list" class="mla-list"></div>
          </div>
        </div>
        <div class="mla-footer">
          <div class="mla-group">
            <span class="mla-group-label">Additional (uses checked lorebooks):</span>
            <div id="mla_add" class="menu_button">Add</div>
            <div id="mla_remove" class="menu_button">Remove</div>
            <div id="mla_replace" class="menu_button" title="Replace each selected bot's additional lorebooks with the checked ones (none checked = clear)">Replace</div>
          </div>
          <div class="mla-group">
            <span class="mla-group-label">Primary:</span>
            <select id="mla_primary_select" class="text_pole"></select>
            <div id="mla_primary_set" class="menu_button">Set primary</div>
            <div id="mla_primary_clear" class="menu_button">Clear primary</div>
          </div>
          <div id="mla_refresh" class="menu_button fa-solid fa-rotate" title="Refresh lists"></div>
        </div>
      </div>
    </div>`);

    applyOpacity(s.bgOpacity);

    // wiring
    $('#mla_open').on('click', openWindow);
    $('#mla_tab_chars').on('click', () => setTab('chars'));
    $('#mla_tab_books').on('click', () => setTab('books'));
    $('#mla_close').on('click', closeWindow);
    $('#mla_overlay').on('mousedown', (e) => { if (e.target.id === 'mla_overlay') closeWindow(); });
    $(document).on('keydown', (e) => { if (e.key === 'Escape' && $('#mla_overlay').hasClass('open')) closeWindow(); });

    $('#mla_opacity').on('input', function () {
        const v = Number(this.value);
        settings().bgOpacity = v;
        applyOpacity(v);
        ST.saveSettingsDebounced();
    });

    $('#mla_char_search').on('input', function () { state.charFilter = this.value; renderChars(); });
    $('#mla_book_search').on('input', function () { state.bookFilter = this.value; renderBooks(); });
    $('#mla_char_sort').on('change', function () { settings().charSort = this.value; ST.saveSettingsDebounced(); renderChars(); });
    $('#mla_book_sort').on('change', function () { settings().bookSort = this.value; ST.saveSettingsDebounced(); renderBooks(); });

    $('#mla_show_avatars').on('change', function () {
        settings().showAvatars = this.checked;
        ST.saveSettingsDebounced();
        renderChars();
    });
    $('#mla_char_all').on('click', () => { shown.chars.forEach((c) => state.chars.add(c.key)); renderChars(); updateCounts(); });
    $('#mla_char_none').on('click', () => { state.chars.clear(); renderChars(); updateCounts(); });
    $('#mla_book_all').on('click', () => { shown.books.forEach((b) => state.books.add(b.key)); renderBooks(); updateCounts(); });
    $('#mla_book_none').on('click', () => { state.books.clear(); renderBooks(); updateCounts(); });

    $('#mla_add').on('click', () => applyAdditional('add'));
    $('#mla_remove').on('click', () => applyAdditional('remove'));
    $('#mla_replace').on('click', () => applyAdditional('replace'));

    $('#mla_primary_set').on('click', () => {
        const name = String($('#mla_primary_select').val() ?? '');
        if (!name) { toastr.warning('Choose a lorebook for the primary slot first.'); return; }
        applyPrimary(name);
    });
    $('#mla_primary_clear').on('click', () => applyPrimary(''));
    $('#mla_refresh').on('click', render);
}

jQuery(() => {
    buildUI();
});
