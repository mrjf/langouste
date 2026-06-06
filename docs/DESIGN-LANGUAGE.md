# Langouste Design Language

Langouste should feel like a precise language workbench: dense enough for repeated study, quiet enough for long sessions, and structured enough that every screen can be scanned quickly.

This redesign follows the Swiss reference at `swiss.ziki.boo`: grotesque type, grayscale-first color, opacity-based hierarchy, one accent, a disciplined grid, and minimal decoration.

## Principles

1. **Type carries the interface.** Typography, spacing, and alignment do most of the visual work. Borders are allowed; shadows and ornamental backgrounds are rare.
2. **Every state has a typed shape.** Components receive explicit props interfaces. API responses and route payloads should be named TypeScript contracts rather than `any`.
3. **One accent, many densities.** Swiss red is the only primary accent. Supporting states use semantic variables, not local one-off colors.
4. **Reduce decoration before adding affordance.** Use contrast, position, case, and rhythm before icons, badges, or colored panels.
5. **Components are small and honest.** Layout components own structure. UI primitives own control styling. Feature components own domain behavior.
6. **Mobile is a first layout, not a collapsed desktop.** The shell becomes a stacked workbench on small screens, with the conversation list still reachable.

## Visual System

### Typography

- Primary face: `IBM Plex Sans` when available, falling back to modern system sans.
- Mono face: `IBM Plex Mono` when available, falling back to local monospace.
- Letter spacing stays normal for body/UI text. Uppercase captions may use modest positive tracking.
- Text hierarchy uses size, weight, and opacity. Avoid swapping text to mid-gray hues for hierarchy.

### Color

- Background: warm stone.
- Text: near-black stone.
- Muted text: same text color with opacity.
- Accent: Swiss red.
- Success, warning, and error are semantic and restrained.

### Shape

- Default radius: `8px`.
- Small radius: `4px`.
- No large rounded cards for application surfaces.
- No decorative drop shadows in the main app chrome.

### Density

- App shell: fixed sidebar plus fluid main workspace on desktop.
- Repeated rows: compact, table-like, border-separated.
- Cards are reserved for repeated objects, dialogs, and framed tools.

## Component Rules

Components should declare their props with `interface Props` and keep data-specific types named near the data boundary.

Use this directory split as the system grows:

- `src/client/components/ui/`: buttons, badges, inputs, fields, tabs, tables.
- `src/client/components/layout/`: app shell, page headers, sections, grid wrappers.
- `src/client/components/features/`: chat, profile, review, dictionary, connections.

The current repo is not SvelteKit. It is Svelte 5 with Vite on the client and Hono on the server, so routing remains hash-based until a deliberate framework migration is chosen.
