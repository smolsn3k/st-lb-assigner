import { characters, saveSettingsDebounced } from '../../../../script.js';
import { world_info, world_names } from '../../../world-info.js';

const MAX_SHOWN = 200;
const state = {
    chars: new Set(),   // selected character keys (avatar filename w/o extension)
    books: new Set(),   // selected lorebook names
    charFilter: '',
    bookFilter: '',
};

const charKey = (c) => c?.avatar?.replace(/\.[^/.]+$/, '');

function getBookNames() {
    let names = Array.isArray(world_names) ? [...world_names] : [];
    if (!names.length) {
        names = $('#world_editor_select option')
            .map((_, o) => ($(o).val() === '' ? null : o.textContent.trim()))
            .get();
    }
    return names.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function charLore() {
    if (!Array.isArray(world_info.charLore)) world_info.charLore = [];
    return world_info.charLore;
}

const findEntry = (key) => charLore().find((e) => e.name === key);

function applyAssignment(mode) {
    if (!state.chars.size || (mode !== 'replace' && !state.books.size)) {
        toastr.warning('Select at least one bot' + (mode === 'replace' ? '.' : ' and one lorebook.'));
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

    // drop empty entries
    world_info.charLore = lore.filter((e) => e.extraBooks?.length);

    saveSettingsDebounced();
    toastr.success(`${mode[0].toUpperCase() + mode.slice(1)}: ${state.chars.size} bot(s), ${state.books.size} lorebook(s).`);
    render();
}

function makeRow(checked, label, sub, onToggle) {
    const row = $('<label class="mla-row"></label>');
    const cb = $('<input type="checkbox">').prop('checked', checked).on('change', function () { onToggle(this.checked); updateCounts(); });
    const text = $('<div></div>');
    text.append($('<div></div>').text(label));
    if (sub) text.append($('<div class="mla-sub"></div>').text(sub));
    return row.append(cb, text);
}

function filtered(list, q) {
    q = q.trim().toLowerCase();
    return q ? list.filter((x) => x.label.toLowerCase().includes(q)) : list;
}

function renderChars() {
    const all = (characters ?? []).map((c) => ({ key: charKey(c), label: c.name ?? charKey(c) })).filter((c) => c.key);
    const shown = filtered(all, state.charFilter);
    const box = $('#mla_char_list').empty();
    shown.slice(0, MAX_SHOWN).forEach((c) => {
        const extra = findEntry(c.key)?.extraBooks ?? [];
        box.append(makeRow(state.chars.has(c.key), c.label, extra.length ? '+ ' + extra.join(', ') : '', (on) => {
            on ? state.chars.add(c.key) : state.chars.delete(c.key);
        }));
    });
    if (shown.length > MAX_SHOWN) box.append(`<div class="mla-note">Showing first ${MAX_SHOWN} of ${shown.length}. Use search to narrow.</div>`);
    if (!shown.length) box.append('<div class="mla-note">No bots found.</div>');
    return shown;
}

function renderBooks() {
    const all = getBookNames().map((n) => ({ key: n, label: n }));
    const shown = filtered(all, state.bookFilter);
    const box = $('#mla_book_list').empty();
    shown.slice(0, MAX_SHOWN).forEach((b) => {
        box.append(makeRow(state.books.has(b.key), b.label, '', (on) => {
            on ? state.books.add(b.key) : state.books.delete(b.key);
        }));
    });
    if (!shown.length) box.append('<div class="mla-note">No lorebooks found.</div>');
    return shown;
}

function updateCounts() {
    $('#mla_char_count').text(`${state.chars.size} selected`);
    $('#mla_book_count').text(`${state.books.size} selected`);
}

let lastShown = { chars: [], books: [] };
function render() {
    lastShown.chars = renderChars();
    lastShown.books = renderBooks();
    updateCounts();
}

function buildUI() {
    const html = `
    <div class="mla-settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Multi Lorebook Assigner</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <small>Pick bots on the left, lorebooks on the right, then apply. Uses each bot's "Additional lorebooks" (character lore) slot, so it works alongside the bot's primary lorebook.</small>
          <div class="mla-grid">
            <div class="mla-col">
              <h4>Bots <span id="mla_char_count" class="mla-count"></span></h4>
              <input id="mla_char_search" class="text_pole" type="search" placeholder="Search bots...">
              <div class="mla-tools">
                <div id="mla_char_all" class="menu_button">Select shown</div>
                <div id="mla_char_none" class="menu_button">Clear</div>
              </div>
              <div id="mla_char_list" class="mla-list"></div>
            </div>
            <div class="mla-col">
              <h4>Lorebooks <span id="mla_book_count" class="mla-count"></span></h4>
              <input id="mla_book_search" class="text_pole" type="search" placeholder="Search lorebooks...">
              <div class="mla-tools">
                <div id="mla_book_all" class="menu_button">Select shown</div>
                <div id="mla_book_none" class="menu_button">Clear</div>
              </div>
              <div id="mla_book_list" class="mla-list"></div>
            </div>
          </div>
          <div class="mla-actions">
            <div id="mla_add" class="menu_button">Add</div>
            <div id="mla_remove" class="menu_button">Remove</div>
            <div id="mla_replace" class="menu_button" title="Replace each selected bot's additional lorebooks with the selected ones (none selected = clear)">Replace</div>
            <div id="mla_refresh" class="menu_button fa-solid fa-rotate" title="Refresh lists"></div>
          </div>
        </div>
      </div>
    </div>`;
    $('#extensions_settings2').append(html);

    $('#mla_char_search').on('input', function () { state.charFilter = this.value; renderChars(); });
    $('#mla_book_search').on('input', function () { state.bookFilter = this.value; renderBooks(); });
    $('#mla_char_all').on('click', () => { lastShown.chars.forEach((c) => state.chars.add(c.key)); render(); });
    $('#mla_char_none').on('click', () => { state.chars.clear(); render(); });
    $('#mla_book_all').on('click', () => { lastShown.books.forEach((b) => state.books.add(b.key)); render(); });
    $('#mla_book_none').on('click', () => { state.books.clear(); render(); });
    $('#mla_add').on('click', () => applyAssignment('add'));
    $('#mla_remove').on('click', () => applyAssignment('remove'));
    $('#mla_replace').on('click', () => applyAssignment('replace'));
    $('#mla_refresh').on('click', render);
    $('.mla-settings .inline-drawer-toggle').on('click', () => setTimeout(render, 50));
}

jQuery(() => {
    buildUI();
    render();
});
