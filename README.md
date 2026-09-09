# BondStats — Global Central Bank Balance Sheet Database

Standalone GitHub Pages edition.

Repository name:
`bondstats-global-central-bank-balance-sheet-database`

Deploy: Settings → Pages → Deploy from branch → `main` / `(root)`.

Then run **Actions → Central Bank Balance Sheet Sync → Run workflow** once. After the first successful source sync, the database JSON is populated and the comparison chart becomes live.

The standalone UI links institution rows directly to primary source pages. The BondStats main-site patch adds six SEO routes with dedicated institution pages.

## V2 fix
The first version used absolute `/data/...` browser URLs. On a GitHub Pages project site this points at the account root instead of the repository, so a successful Action could still produce an empty-looking chart. V2 uses `./data/...` everywhere.

The updater now also returns a failed workflow status when every configured upstream source fails, rather than allowing a misleading green run with zero usable series.


## V3 — bug + source + interface correction

This version fixes three concrete issues:

1. **False empty-state overlay:** `.empty-state { display:flex }` overrode the browser's `[hidden]` rule, so "No observations loaded" remained visible on top of a successfully drawn chart. V3 adds `[hidden]{display:none!important}`.
2. **Bank of Japan source:** the BOJ API manual identifies `BS01` as the database name for **Bank of Japan Accounts**. The old updater incorrectly requested `db=BS`. V3 uses `BS01` and resolves a monthly Total Assets series from current metadata before downloading observations.
3. **Bank of England parser:** the official IADB export remains `RPWB75A`; V3 switches to columnar CSV and uses a more tolerant date/value parser.

The interface is also rebuilt around a **Balance Sheet Atlas** rather than generic dashboard cards:
- institution rail with on/off series controls
- Indexed Level / 12M Impulse analytical modes
- interactive chart readout
- endpoint labels
- global balance-sheet breadth
- 12M expansion/contraction + drawdown from selected-window peak
- primary-source ledger

No fallback/fabricated financial values are inserted.
