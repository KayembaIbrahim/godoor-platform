# QA tools

Browser-driven checks for the things that are hard to eyeball: where a map
marker is actually drawn, how wide the gap between two header controls really
is, and whether React threw a hydration error on the way in.

They all drive the **live** site with Playwright, so they measure what a real
user gets rather than what the source implies.

```bash
node tools/qa/<script>.cjs          # from the repo root
```

## The two that matter

### `marker_test.cjs` — the marker cascade test

A self-contained page (no network, no token) that reproduces the exact CSS
Mapbox relies on and then measures where each marker is drawn:

* **OLD** — the marker element carries `animation: marker-bounce … both` and
  `position: relative`.
* **NEW** — the marker element is inert and every transform lives on an inner
  wrapper.

The old marker lands at **(0, 0)** — the map's top-left corner — because the
animation outranks the inline transform Mapbox writes, and the permanent
`fill-mode: both` keeps it that way forever. The new one lands exactly on its
coordinate.

This is the regression test for the "the pins are not in the right place"
bug. If someone puts a transform back on the marker element, this fails.

### `verify_live_map.cjs` — live end-to-end marker check

Signs in, opens a real order's tracking page, then compares each marker's
drawn rectangle against the point Mapbox says its coordinate is. A marker is
`ANCHORED` when the two agree within a pixel or so; the script prints the
offset for each one.

## The rest

| Script | What it does |
|---|---|
| `check_hydration*.cjs` | Loads pages and reports any React error (#418 = hydration mismatch) |
| `measure_headers.cjs` | Measures the real pixel gaps between header controls at several widths |
| `measure_signedin.cjs` | Same, but with a signed-in session |
| `verify_header.cjs` | Prints the header's control geometry and the gaps between them |
| `verify_home.cjs` | Checks the welcome background layer and reports hydration errors |
| `check_welcome_bg.cjs` | Confirms the published artwork layer is present and positioned |
| `diff_*.cjs` | Diffs the server HTML against the hydrated DOM to locate a mismatch |
| `test_signin*.cjs`, `signin_diag.cjs` | Exercise the sign-in flow |
| `final_check.cjs`, `final_verify.cjs` | Combined pass over header + map markers |

## Note on credentials

The scripts that sign in use a **test customer** account. Replace the
credentials in the script with a throwaway account before running them
against production.
