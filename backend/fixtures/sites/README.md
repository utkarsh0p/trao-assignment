# Fixture sites

Four company sites, served by `npm run fixtures` on `http://localhost:8099`. They exist so the
crawler can be tested against real pages, real relative links and a real robots.txt without
touching the open internet.

One origin serves all of them, so `/robots.txt` at the root is the robots.txt every site shares —
the same way a real host works.

| Path | What it tests |
|---|---|
| `/acme/` | The easy case. A `/careers/` page linked from the nav, and a `how-we-hire` page under it that states the process plainly. |
| `/northwind/` | Hiring information at a path nothing could guess: `/handbook/joining-northwind.html`, reachable only by following the handbook link and then a link inside it. There is no `/careers` on this site. |
| `/borealis/` | No hiring page a crawler may read. The only interview material is `/borealis/internal/interview-loop.html`, which `robots.txt` disallows. A correct kit says no hiring process could be found — and never fetches that page. |
| `/gone/` | Nothing is served here. The URL 404s, which is the unreachable-company path. |

`/northwind/` is the one that matters most: it is the reason page paths cannot be hard-coded.
