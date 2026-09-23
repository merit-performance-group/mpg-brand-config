# mpg-brand-config

Per-instance branding loader, shared by every app in the platform.

Each deployment is one client. Everything that identifies that client — colours, app name,
company name, logo, icons, allowed signup domains, which features they bought — lives in a
single `config/brand.json` on that server. That file is **gitignored and never committed**: it
exists only on the instance's own filesystem, the same model as `.env`. This module reads it
and fills in generic, client-neutral defaults for anything absent, so a fresh clone with no
instance configured still runs instead of crashing.

Before this module, each app carried its own copy of the same loader. The copies drifted, and
a value could be right in one app and wrong in another with nothing to catch it.

## Usage

This is a **factory**, not a ready-made object, because a shared module cannot assume its own
location is the application root — inside `node_modules`, `__dirname` is not the app.

Each app keeps a three-line local shim so none of its existing call sites change:

```js
// brandConfig.js
module.exports = require("mpg-brand-config")({ appRoot: __dirname });
```

Everything else continues to `require("./brandConfig")` and receive a plain object.

```js
const brand = require("./brandConfig");
brand.appName;              // "Example App" until configured
brand.colors.brandBlue;     // a neutral grey until configured
brand.features.recording;   // false unless literally true in brand.json
brand.decks.colors.canvas;  // null unless set
```

### Where it reads from

1. `process.env.BRAND_CONFIG_PATH`, if set — this is how a test points the real code path at a
   fixture instead of stubbing the loader out.
2. Otherwise `<appRoot>/config/brand.json`.

If one of your apps used a differently-named variable for this previously, alias it in that
app's own shim rather than here:

```js
if (process.env.OLD_NAME && !process.env.BRAND_CONFIG_PATH) {
  process.env.BRAND_CONFIG_PATH = process.env.OLD_NAME;
}
module.exports = require("mpg-brand-config")({ appRoot: __dirname });
```

The alias belongs there, not in this module, because the old name contains a client's name and
this repository must not.

## What goes in `brand.json`

Every key is optional. See `DEFAULTS` in `index.js` — each one carries the reasoning for its
default, which is the part worth reading.

| key | |
|---|---|
| `appName`, `companyName` | display names |
| `tagline`, `taglineHighlight`, `description` | marketing copy; `null` omits rather than inventing |
| `colors` | ten named tokens, merged per key over the defaults |
| `logoPath`, `logoWhitePath`, `icons` | absolute paths to files on that server, outside the checkout |
| `allowedSignupDomains` | empty means self-service signup is unreachable, which is the safe state |
| `features` | purchased capabilities; `false` means the routes 404, not just a hidden link |
| `restrictedAdminEmail` | exact-email gate on the most privileged screens; `null` denies everyone |
| `recorderUrl` | `null` omits the link rather than pointing it somewhere wrong |
| `roleTitles` | per-instance track list and tier labels |
| `decks` | presenter branding; see below |

## Two things to know before you change this

**Flags are strictly `=== true`.** Not `Boolean(...)`. `Boolean("false")` is `true`, so a flag
typed as a string in a hand-edited config would silently switch on a capability nobody bought.
Anything that is not a literal boolean `true` is false.

**Asset paths point outside the checkout.** A branded logo or icon must live somewhere a
`git pull` cannot wipe — conventionally `/var/lib/<service>/brand/`. If an instance points
`logoPath` at a file inside its own checkout, the next redeploy silently replaces it with the
repo's committed placeholder.

## The `decks` block

Presenter-specific branding. Absent means every value takes its fallback.

`logoAsset` is deliberately **not** `logoPath`/`logoWhitePath`. Those are absolute server
filesystem paths, which a tablet running offline cannot read; `logoAsset` is a path inside the
deck bundle.

`railActive` falls back to `colors.neutralIvory`, **not** `colors.aqua`. `neutralIvory` is the
page background of a light UI, so it is near-white by construction for every client, and
light-on-dark therefore holds whatever the brand is. `aqua` is only guaranteed to be whatever
that client put there — a monochrome brand may have no accent colour at all, in which case an
accent-derived highlight renders invisible on the dark rail.

That is an instance of a general rule worth applying to anything else derived here: **derive
from the token whose guarantee matches the surface the thing is drawn on, never from the
nearest-looking token.**

## Known divergence, unresolved

`roleTitles.tracks` entries are flat — `{ key, title }`. One app's previous local copy used
`{ key, standardTitle, adminTitle }` instead. The flat shape is canonical here.

This is safe to adopt today because no deployed `brand.json` anywhere writes a `roleTitles`
block in the nested shape — the apps that would have fall back to their own defaults. But the
loader passes any non-empty `tracks` array straight through with no shape check, so a config
hand-copied between apps in the old shape would yield `undefined` titles silently. Worth a
shape check here before that can happen.

## What must never be committed here

This repository is public. It contains a loader and its neutral defaults — nothing else.

- No client names, company names, domains or URLs.
- No real email addresses.
- No `brand.json` from any instance. It is gitignored; keep it that way.
- No incident write-ups, audit findings, or internal org structure in the comments. Explain
  *why* a rule exists without naming *who* it came from.

The whole point of the defaults being generic is that this repo never identifies a client. A
comment that names one defeats that just as thoroughly as a hardcoded value would.
