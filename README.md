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
