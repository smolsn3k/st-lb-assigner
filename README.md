# Multi Lorebook Assigner

A small SillyTavern extension for assigning lorebooks to many bots at once. It handles both the **primary lorebook** and the **additional lorebooks** of each bot.

Version 1.3.1

## Install

1. Copy the `multi-lorebook-assigner` folder into your SillyTavern extensions folder:
   - Recent versions: `data/<your-user>/extensions/` (usually `data/default-user/extensions/`)
   - Older versions: `public/scripts/extensions/third-party/`
2. Restart SillyTavern and hard-refresh the page (Ctrl+F5).
3. Open the **Extensions** tab (the stacked-blocks icon). You'll find a **Multi Lorebook Assigner** drawer with an **Open Lorebook Assigner** button.

## Usage

Click **Open Lorebook Assigner** to open the window. Bots are on the left and lorebooks on the right. On phones, a **Bots / Lorebooks** tab bar switches between the two lists.

### Additional lorebooks

1. Tick the bots you want to change.
2. Tick the lorebooks to use.
3. Press one of:
   - **Add**: adds the ticked lorebooks to each selected bot's additional lorebooks.
   - **Remove**: removes the ticked lorebooks from them.
   - **Replace**: replaces each selected bot's additional lorebooks with the ticked ones. With no lorebooks ticked, it clears them.

### Primary lorebook

1. Tick the bots you want to change.
2. Choose a lorebook in the **Primary** dropdown in the footer.
3. Press **Set primary**, or **Clear primary** to remove it.

### Typical setup

Select the bots, pick the primary and press **Set primary**, then tick the additional lorebooks and press **Replace**.

## Features

- Search bars for both bots and lorebooks.
- Sorting:
  - Bots: Newest, Oldest, A → Z, Z → A, Recently chatted, Most lorebooks, Selected first.
  - Lorebooks: Newest, Oldest, A → Z, Z → A, Most bots, Selected first.
- **Select shown** and **Clear** buttons for quick bulk selection of the filtered list.
- **Show avatars** checkbox to turn bot avatars in the list on or off.
- **Opacity** slider in the window header to adjust how translucent the window background is.
- Each bot row shows its current primary and additional lorebooks. Each lorebook row shows how many bots use it as primary or additional.
- The window fits phone screens and closes with the X, Esc, or a click outside it.

Sort choices, the avatar toggle and the opacity level are remembered between sessions.

## How it works

- **Additional lorebooks** use SillyTavern's own "Additional lorebooks" (character lore) setting, which is stored in your SillyTavern settings and keyed by the bot's avatar filename. If you rename or re-import a bot, its additional lorebooks won't follow it.
- **The primary lorebook** is stored inside each character card. Setting it rewrites that card on the server, one bot at a time, so large batches take a moment.
- If you change the primary on the bot whose panel is currently open, the panel's dropdown is updated. If it looks stale, click to another bot and back.

## Limitations

- SillyTavern doesn't expose lorebook creation dates. For lorebooks, "Newest/Oldest" means when this extension first saw the lorebook. Lorebooks that already existed on first run share one baseline and keep their normal order; lorebooks created afterwards count as newer. Bot dates are real.
- The lists show the first 500 matches. Use search to narrow big libraries.
- The primary lorebook shown in bot rows comes from the bot data loaded in the page, so it may show blank for a bot that isn't fully loaded. Setting it still works.

## Troubleshooting

- **Nothing appears in the Extensions tab:** check that the folder sits directly inside the extensions folder (not nested one level deeper) and that `manifest.json` is in it. Then hard-refresh.
- **An error toast appears or something doesn't work:** open the browser console (F12) and look for lines starting with `[MLA]` or red errors.
- **Layout looks wrong on a phone:** hard-refresh to clear the cached stylesheet.

## Files

- `manifest.json`: extension metadata
- `index.js`: logic and UI
- `style.css`: styling, including the mobile layout
- `README.md`: this file
