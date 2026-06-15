# Wowhead-adjacent look & feel (reference only)

**Purpose:** Capture visual patterns observed from **Internet Archive** snapshots of wowhead.com + archived `wow.zamimg.com` stylesheets, for **original** Fanime UI (quest log / tooltips). This is **not** a license to copy Wowhead artwork, logos, or CSS wholesale—use as **inspiration** and ship **your own** assets and code.

## Sources scraped / downloaded

| Artifact | Wayback URL (working snapshot) |
|----------|--------------------------------|
| Homepage HTML | `https://web.archive.org/web/20200215105934/https://www.wowhead.com/` |
| Archived `basic.css` | `https://web.archive.org/web/20200215105934cs_/https://wow.zamimg.com/css/basic.css?3ddc9d9721` |
| Archived `global.css` (first line: body rules) | `https://web.archive.org/web/20200215105934cs_/https://wow.zamimg.com/css/global.css?3ddc9d9721` |
| Example quest page HTML | `https://web.archive.org/web/20200215105934/https://www.wowhead.com/quest=26396/...` (see `archive_quest.html` in this folder) |

Local copies (for offline diff): `archive_wowhead_home.html`, `archive_basic.css`, `archive_global.css`, `archive_quest.html`.

## Global chrome (page frame)

From **`global.css`** (minified start of file):

- **`body`:** `background: #000`; **text** `#bbb`; **font** `'Open Sans', Arial, Helvetica, sans-serif`; **size** `14px` (16px on small screens).
- Overall vibe: **near-black canvas**, **muted gray body copy**, **high-contrast accents** for links and rarity.

## Tooltip / panel density (from `basic.css`)

- Tooltip table cells: **`font-family: Verdana, "Open Sans", Arial...`** at **12px**, **line-height ~17px**, **white** text on **textured dark** background (image URL in their CSS—not reproduced here).
- **Link / highlight gold:** `#ffd100` (classes `.q`, quest titles).
- **Stat / diff colors** (examples): green `#5df644`, orange `#ff8040`.

## Item-quality palette (`.q0` … `.q6` — iconic Wo-style tiers)

Extracted hex values from archived **`basic.css`** (used for link coloring on items and headings):

| Token | Typical use | Hex (archived) |
|-------|----------------|-----------------|
| `q0` | Poor | `#9d9d9d` |
| `q1` | Common / white | `#fff` |
| `q2` | Uncommon | `#1eff00` |
| `q3` | Rare | `#0070dd` |
| `q4` | Epic | `#a335ee` |
| `q5` | Legendary | `#ff8000` |
| `q6` | Artifact / heirloom tone | `#e5cc80` |

Use **analogous** colors for Fanime if you want distance from Blizzard/Wowhead UI trademarks.

## Quest page layout patterns (from archived quest HTML)

- **Container:** `.main-contents` inside `.page-content` / `.layout` (wide column + optional rails).
- **Title:** `<h1 class="heading-size-1">` — large quest name.
- **Summary block:** objective text immediately under title; optional **icon list** for provided items.
- **Right / top “Quick Facts”:** `.infobox` → `.infobox-inner-table` with `.infobox-heading` row (**`<th>`** section titles like “Quick Facts”, “Series”).
- **Body sections:** `<h2 class="heading-size-3">` for **Description**, **Progress**, **Completion**, **Rewards** — stacked narrative blocks.
- **Links:** gold/yellow emphasis on primary actions; rarity-colored item names (`.q1`, `.q2`, …).

## Fanime mapping (quest list product)

| Wowhead pattern | Fanime use |
|-----------------|------------|
| Dark page + gray prose | Quest page background + readable body |
| Gold quest title | Tier header / primary quest name |
| `q2`–`q5` greens → oranges | Optional alignment with Uncommon / Rare / Epic **or** neutral palette |
| Infobox “Quick Facts” | Sidebar: tier, reward bag, “return to quest giver” |
| Section headings | Per-quest blocks: objective, proof, notes |

## Deliverable in repo

- **`fanime/style/sample_quest_log.html`** + **`sample_quest_log.css`** — standalone **original** mockup implementing the patterns above (no Wowhead images or pasted CSS).
