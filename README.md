# LinkPop 💜

A purple, sticker-covered web tool that turns a pile of download links into ready-to-run Google Colab cells.

- **Paste anything** — one link per line, several per line, or links glued together with no spaces (`…a.mkvhttps://…b.mkv`). A file name on the line above a link (e.g. `3. Movie.2024.mkv`) is used as that link's name.
- **Smart file names** — links *without* query parameters use `! wget --content-disposition "url"`. Links *with* query parameters (`?token=…`) are saved with `-O "Real.Name.mkv"` so the query string never ends up in the file name.
- **Movies come out alone** — every movie gets its own `! wget` cell (toggle "Movies alone").
- **Archives** — `.zip`, `.rar` and split `.zip.001/.002…` sets become Python download-and-extract cells; several of the same kind download concurrently.
- **Groups** — seasons with more than 3 episodes, archive sets and same-named files are grouped; stray episodes stay as plain links.
- **Toggles** — Commands, Movies alone, Parallel wget (xargs), Loose series plain, # Comments, Names, Dedupe, worker count, and three output modes (Together / By group / One by one).
- **Copy flow** — copy a single cell, "Copy next" through them in order, or copy everything. Input and settings are remembered in the browser.

## Tech

TanStack Start (React 19), Tailwind CSS 4, shadcn/ui switches, sonner toasts. All parsing and command generation happens client-side in `src/lib/commands.ts`.

## Run locally

```bash
pnpm install
pnpm dev
```

Tests: `pnpm test`.
