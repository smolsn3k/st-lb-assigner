import { characters, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { world_info, world_names } from '../../../world-info.js';

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
    books: new Set(),  // selected lorebook names
    charFilter: '',
    bookFilter: '',
};
const shown = { chars: [], books: [] }; // full filtered lists, used by "Select shown"
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* ---------- data helpers ---------- */

function settings() {
    extension_settings[MODULE] ??= {};
    const s = extension_settings[MODULE];
    s.charSort ??= 'newest';
    s.bookSort ??= 'az';
    s.firstSeen ??= {};
    return s;
}

const charKey = (c) => c?.avatar?.replace(/\.[^/.]+$/, '');

function charLore() {
    if (!Array.isArray(world_info.charLore)) world_info.charLore = [];
    return world_info.charLore;
}
const findEntry = (key) => charLore().find((e) => e.name === key);

function getBookNames() {
    let names = Array.isArray(world_names) ? [...world_names] : [];
    if (!names.length) {
        names = $('#world_editor_select option')
            .map((_, o) => ($(o).val() === '' ? null : o.textContent.trim()))
            .get();
    }
    names = names.filter(Boolean);

    // SillyTavern doesn't expose lorebook dates, so "newest/oldest" is based on when
    // this extension first saw each lorebook. Lorebooks that already existed on first
    // run share the same baseline (kept in the server's order).
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
    if (changed) saveSettingsDebounced();
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

/* ---------- assignment ---------- */

function applyAssignment(mode) {
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

    world_info.charLore = lore.filter((e) => e.extraBooks?.length); // drop empty entries
    saveSettingsDebounced();
    toastr.success(`${mode[0].toUpperCase() + mode.slice(1)}: ${state.chars.size} bot(s), ${state.books.size} lorebook(s).`);
    render();
}

/* ---------- rendering ---------- */

function makeRow(checked, label, sub, onToggle) {
    const row = $('<label class="mla-row"></label>');
    const cb = $('<input type="checkbox">').prop('checked', checked).on('change', function () {
        onToggle(this.checked);
        updateCounts();
    });
    const text = $('<div></div>').append($('<div></div>').text(label));
    if (sub) text.append($('<div class="mla-sub"></div>').text(sub));
    return row.append(cb, text);
}

function renderChars() {
    const s = settings();
    let items = (characters ?? [])
        .map((c) => {
            const key = charKey(c);
            const extra = findEntry(key)?.extraBooks ?? [];
            return { key, label: c.name ?? key, date: Number(c.date_added) || 0, lastChat: Number(c.date_last_chat) || 0, count: extra.length, extra };
        })
        .filter((c) => c.key);
    items = sortItems(filterItems(items, state.charFilter), s.charSort, state.chars);
    shown.chars = items;

    const box = $('#mla_char_list').empty();
    items.slice(0, MAX_SHOWN).forEach((c) => {
        box.append(makeRow(state.chars.has(c.key), c.label, c.extra.length ? '+ ' + c.extra.join(', ') : '', (on) => {
            on ? state.chars.add(c.key) : state.chars.delete(c.key);
        }));
    });
    if (items.length > MAX_SHOWN) box.append(`<div class="mla-note">Showing first ${MAX_SHOWN} of ${items.length}. Use search to narrow.</div>`);
    if (!items.length) box.append('<div class="mla-note">No bots found.</div>');
}

function renderBooks() {
    const s = settings();
    const usage = {};
    charLore().forEach((e) => (e.extraBooks ?? []).forEach((b) => { usage[b] = (usage[b] ?? 0) + 1; }));

    let items = getBookNames().map((n, i) => ({ key: n, label: n, date: s.firstSeen[n] ?? 0, count: usage[n] ?? 0 }));
    items = sortItems(filterItems(items, state.bookFilter), s.bookSort, state.books);
    shown.books = items;

    const box = $('#mla_book_list').empty();
    items.slice(0, MAX_SHOWN).forEach((b) => {
        box.append(makeRow(state.books.has(b.key), b.label, b.count ? `used by ${b.count} bot(s)` : '', (on) => {
            on ? state.books.add(b.key) : state.books.delete(b.key);
        }));
    });
    if (items.length > MAX_SHOWN) box.append(`<div class="mla-note">Showing first ${MAX_SHOWN} of ${items.length}. Use search to narrow.</div>`);
    if (!items.length) box.append('<div class="mla-note">No lorebooks found.</div>');
}

function updateCounts() {
    $('#mla_char_count').text(`${state.chars.size} selected`);
    $('#mla_book_count').text(`${state.books.size} selected`);
}

function render() {
    renderChars();
    renderBooks();
    updateCounts();
}

/* ---------- UI ---------- */

const optionsHtml = (list, current) =>
    list.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${l}</option>`).join('');

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
            <small>Assign multiple lorebooks to multiple bots at once.</small>
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
          <div id="mla_close" class="menu_button fa-solid fa-xmark" title="Close"></div>
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
          <div id="mla_add" class="menu_button">Add</div>
          <div id="mla_remove" class="menu_button">Remove</div>
          <div id="mla_replace" class="menu_button" title="Replace each selected bot's additional lorebooks with the selected ones (none selected = clear)">Replace</div>
          <div id="mla_refresh" class="menu_button fa-solid fa-rotate" title="Refresh lists"></div>
          <span class="mla-hint">Works on each bot's "Additional lorebooks". The primary lorebook is untouched.</span>
        </div>
      </div>
    </div>`);

    // wiring
    $('#mla_open').on('click', openWindow);
    $('#mla_close').on('click', closeWindow);
    $('#mla_overlay').on('mousedown', (e) => { if (e.target.id === 'mla_overlay') closeWindow(); });
    $(document).on('keydown', (e) => { if (e.key === 'Escape' && $('#mla_overlay').hasClass('open')) closeWindow(); });

    $('#mla_char_search').on('input', function () { state.charFilter = this.value; renderChars(); });
    $('#mla_book_search').on('input', function () { state.bookFilter = this.value; renderBooks(); });
    $('#mla_char_sort').on('change', function () { settings().charSort = this.value; saveSettingsDebounced(); renderChars(); });
    $('#mla_book_sort').on('change', function () { settings().bookSort = this.value; saveSettingsDebounced(); renderBooks(); });

    $('#mla_char_all').on('click', () => { shown.chars.forEach((c) => state.chars.add(c.key)); renderChars(); updateCounts(); });
    $('#mla_char_none').on('click', () => { state.chars.clear(); renderChars(); updateCounts(); });
    $('#mla_book_all').on('click', () => { shown.books.forEach((b) => state.books.add(b.key)); renderBooks(); updateCounts(); });
    $('#mla_book_none').on('click', () => { state.books.clear(); renderBooks(); updateCounts(); });

    $('#mla_add').on('click', () => applyAssignment('add'));
    $('#mla_remove').on('click', () => applyAssignment('remove'));
    $('#mla_replace').on('click', () => applyAssignment('replace'));
    $('#mla_refresh').on('click', render);
}

jQuery(() => {
    buildUI();
});
