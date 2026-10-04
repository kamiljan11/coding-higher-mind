# Desktop → Mobile — adapting heavy components

The hard part of responsive design isn't text — it's the heavy desktop components. Don't shrink them; **transform them into a mobile equivalent.**

| Desktop | → Mobile |
|---|---|
| Mega-menu / nav bar | Hamburger + drawer, or bottom nav (3–5) + "More"; subcategories as accordion |
| Wide data table | Cards (row → labeled card) **or** horizontal scroll with a sticky first column |
| 3–4 columns | Stack to 1; order by priority (most important first) |
| Sidebar / filters | Bottom sheet or full-screen filter panel opened by a button |
| Hover dropdown / tooltip | Tap → accordion/sheet (no hover on touch); tooltip → tap-to-reveal |
| Large animated hero | Lighter image, shorter headline, CTA above the fold; heavy effects desktop-only |
| Big footer | Link columns as accordions; key contact info on top |
| Long multi-field form | One column, split into steps, progress on top, contextual keyboard |

## Wide table → cards (the most common problem)
Instead of squeezing 6 columns, make each row a card and turn column headers into labels next to values.
```css
@media (max-width: 600px){
  table, thead, tbody, tr, td{ display:block; }
  thead{ position:absolute; left:-9999px; }           /* hide the header row */
  tr{ border:1px solid #ddd; border-radius:12px; margin-bottom:12px; padding:8px; }
  td{ display:flex; justify-content:space-between; border:none; }
  td::before{ content:attr(data-label); color:#888; font-weight:600; }  /* label from data-label */
}
```
```html
<td data-label="Customer">Anna K.</td>   <!-- each cell carries its label -->
```

## Comparison tables specifically
When columns *must* sit side by side to compare: keep a horizontal scroll with `position:sticky` on the first column (row names stay, values scroll). Add a segmented control (see app-like-patterns "Toggles") to switch which columns are visible, or to switch monthly/yearly.

## Priority, not compression
The mistake is trying to keep everything desktop has. On mobile, decide what matters most and lead with it; demote or collapse the rest. A faithful 1:1 shrink of a desktop page is almost always worse than a re-prioritized mobile layout.
