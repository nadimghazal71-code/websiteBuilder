# Wireframe source

Low-fidelity wireframes for the three Sitely deployables, authored as Design Components and
laid out on one canvas. The analysis that goes with them is in
[`docs/wireframe-analysis.md`](../docs/wireframe-analysis.md).

Published canvas: <https://claude.ai/code/artifact/8c6bce75-e7c0-46ef-ac40-39862ba3ab9d>

## Layout

```
parts/base.css          the shared wireframe kit — paper/ink tokens, placeholder
                        primitives, controls, app chrome, callout styles
parts/<Name>.body.html  one artboard's markup (everything inside <x-dc>)
build.mjs               wraps each body with the shared stylesheet -> <Name>.dc.html
<Name>.dc.html          generated; these are the files the canvas is seeded from
canvas.json             positions, pages and the launch view
```

Edit `parts/`, never the generated `.dc.html` files.

```bash
node design/build.mjs
```

## Artboards

| Page | Artboards |
|---|---|
| System map | `SystemMap` |
| Owner editor | `Main` (content step), `EditorTemplate`, `EditorPalette`, `EditorPublish`, `OwnerDashboard` |
| Admin console | `AdminMetrics`, `AdminNewBusiness`, `AdminLeads`, `AdminRegistry` |
| Tenant sites | `SiteServiceLed` (LTR), `SiteMenuLed` (Arabic RTL), `SiteStates` |

## Conventions

- **Paper and ink**, one warm accent (`--accent`) for interactive elements, one flag colour
  (`--flag`) for constraints the kickoff says not to break.
- Red callouts quote a rule and cite its section; amber callouts are supporting rationale.
- Dashed crossed boxes are images; grey bars are body copy not yet written.
- Sample business names and figures are illustrative. Anything that would be a real-world fact
  (phone numbers, gateway terms) is masked or bracketed.
