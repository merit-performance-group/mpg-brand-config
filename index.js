// Per-instance branding — the one source of truth for anything client-identifying: colours,
// app name, company name, logo, icons. Reads config/brand.json, which is gitignored and
// per-instance, the same model as .env: it lives only on each server's own filesystem,
// independent of what git tracks. Falls back to generic, client-neutral defaults when that
// file does not exist, so a fresh clone with no instance configured yet still runs instead
// of crashing.
//
// Shared by every app in the platform. Before this module existed each app carried its own
// copy of the same loader; the copies drifted, and a value could be right in one and wrong
// in another with nothing to catch it.
//
// Within a single app it replaced three independent copies of the same handful of values —
// the stylesheet's root custom properties, the certificate email's own local brand object,
// and the certificate PDF generator's literal colours. This is the only place any of them
// are defined now, and no client-identifying value may be hardcoded anywhere else.
//
// USAGE. This is a factory, not a ready-made object, because a shared module cannot assume
// its own location is the application root — inside node_modules, __dirname is not the app.
// Each app keeps a three-line local shim so its own call sites do not change:
//
//     // brandConfig.js
//     module.exports = require("mpg-brand-config")({ appRoot: __dirname });
//
// and everything else continues to `require("./brandConfig")` and get a plain object.
"use strict";

const fs = require("fs");
const path = require("path");

// Generic, client-neutral fallbacks — deliberately not any real client's values, so the repo
// itself never identifies a client even when no instance config has been written yet.
const DEFAULTS = {
  appName: "Example App",
  companyName: "Example Company",

  // Optional marketing tagline, a short brand phrase. null means omit the line entirely
  // rather than show a generic placeholder: an invented-sounding tagline is worse than none.
  tagline: null,

  // Optional substring of `tagline` to wrap in a <span class="brand-highlight"> pill, for
  // instances whose tagline is styled with one word emphasised. Only the FIRST match is
  // wrapped — see the page renderer's tagline builder. null, or a value not actually found in
  // the tagline, both mean "no highlight": the tagline still renders, just as plain text.
  taglineHighlight: null,

  // Web App Manifest "description", served by the app's own manifest route. Separate from
  // `tagline` on purpose: this is a full sentence naming the company and what the product
  // does, not a short marketing phrase. null omits the key, which the manifest spec allows,
  // rather than inventing a default.
  description: null,

  colors: {
    brandBlue: "#3A3A3A",
    neutralIvory: "#F2F2F0",
    navy: "#1A1A1A",
    aqua: "#3A3A3A",
    stone: "#B8B8B5",
    bg: "#F2F2F0",
    panel: "#FFFFFF",
    border: "#B8B8B5",
    text: "#1A1A1A",
    muted: "#767672"
  },

  // null means "use the committed default asset in the app's own public/brand/". That default
  // must be a mark that belongs to nobody. A default that is some client's real brandmark
  // means an unconfigured instance greets its users with another company's logo, and it looks
  // deliberate rather than broken, so nobody reports it. A client with a real logo overrides
  // these with an absolute path to a file on their own server, never committed.
  logoPath: null,
  logoWhitePath: null,

  // Favicon, PWA manifest and apple-touch icons — the same override pattern as the logo, and
  // the more important half of it: this is what lands on a user's phone home screen. Each null
  // means "use the committed default asset" (see ICON_DEFAULT_FILENAMES). They are generated
  // from the same neutral mark as the logo by the default-asset generator script, rather than
  // maintained as a separate set, because a separate set is one that can quietly drift back to
  // someone's real brandmark.
  icons: {
    faviconIco: null,
    favicon16: null,
    favicon32: null,
    favicon64: null,
    appleTouchIcon: null,
    icon192: null,
    icon512: null,
    iconMaskable512: null,
    logoMark: null
  },

  // Email domains allowed to self-register, enforced by the signup-request route. Empty by
  // default rather than a guessed placeholder domain: a fresh instance then has self-service
  // signup effectively unreachable until a real domain is configured, which is the safe state,
  // not a broken one.
  allowedSignupDomains: [],

  // Opt-in feature flags — whether a purchasable capability exists for this instance at all.
  // false means it does not exist: the nav link is hidden AND the routes themselves 404 via the
  // feature middleware, not a hidden link with the route still reachable by URL. Independent of
  // restrictedAdminEmail below: this decides whether the capability is on for the instance,
  // that decides who can reach it once it is.
  features: {
    integrations: false,
    recording: false
  },

  // The single address allowed through the exact-email gate in the auth middleware, on the most
  // privileged screens. Separate from `features` because the two answer different questions,
  // and both apply. null, the default, denies everyone — an unconfigured instance fails closed,
  // not open.
  restrictedAdminEmail: null,

  // Target for the "open the recording app" link on the recording-software page. null omits
  // the link entirely rather than pointing it at a wrong or dead URL.
  recorderUrl: null,

  // Per-instance display names and the audience/curriculum track list.
  //
  // `tracks` is flat: one title per track. An earlier design nested a standardTitle/adminTitle
  // pair inside each track, modelling a manager tier as a variant of a sales track; that was
  // wrong, because a manager track is its own independent track with its own curriculum, not a
  // seniority tier of another one.
  //
  // This list is also the single source of truth for the curriculum-track vocabulary — the
  // roles module derives the assignment-track list from tracks.map(t => t.key). Before that,
  // the identity labelling and the curriculum categorisation were two separately maintained
  // vocabularies that happened to overlap on some values and diverge on others. Unifying them
  // here is what lets a track's own nav tab, rendered by the nav module, show genuinely
  // different content rather than the same merged dashboard for everyone.
  //
  // Tracks are organisation, never a hard wall: nothing here restricts who may be enrolled in
  // what. A track is "which curriculum this person is primarily associated with", and an empty
  // track with no content authored yet is a normal state, not an error.
  //
  // `superAdminTitle` is global rather than per-track — there is one company-wide top tier.
  // `leadershipTabLabel` is the fixed label for the combined admin area, independent of any
  // individual's own stored title. A user's own dashboard tab shows the title stored on their
  // own record in the user store, which is decoupled from their role; tracks[].title only
  // supplies the default at account-creation time and the valid-values list the admin
  // user-management screen's pickers offer, and is never read per-request for an existing
  // user's own label.
  //
  // `additionalTitles` are titles that exist ONLY as a label — no curriculum path or cohort of
  // their own, unlike every tracks[] entry. Each is `{ title, afterTrackKey, track }`, two
  // deliberately separate anchors: `afterTrackKey` controls ordering in dropdowns and tab bars
  // (inserted immediately after that track's title), while `track` controls which curriculum it
  // points at when previewed. A label can therefore sort next to one track while sharing
  // another's content. Unlike a real track's title, one of these is never auto-suggested by the
  // user store's default-title-for-role helper. Both anchor on a track's stable `key`, never its `title` string, so
  // re-wording a title later cannot silently break ordering or routing.
  //
  // `gradingFraming` is per-track and optional. "manager" tells the grading module's AI prompt
  // to grade against internal process and leadership expectations rather than a customer-facing
  // script, and to drop rules that assume a customer is present. Anything else, including omitting it,
  // means the default customer-facing framing — the same reasoning as allowedSignupDomains
  // defaulting to unreachable rather than guessing.
  roleTitles: {
    tracks: [
      { key: "default", title: "Standard" }
    ],
    superAdminTitle: "Super Admin",
    leadershipTabLabel: "Leadership",
    additionalTitles: []
  },

  // Presenter-specific branding. Absent means every value takes its fallback, which is what an
  // instance with no presenter configured gets. See the presenter's own spec for why these are
  // separate tokens rather than reuses of the block above: the existing palette describes a
  // light document page, and the presenter has one large dark field in it.
  //
  // logoAsset is deliberately NOT logoPath/logoWhitePath. Those hold absolute server filesystem
  // paths, which a tablet running offline cannot read; this is a path inside the deck bundle.
  //
  // railActive falls back to colors.neutralIvory, NOT to colors.aqua. neutralIvory is the page
  // background of a light UI, so it is near-white by construction for every client, and
  // light-on-dark therefore holds for any palette. aqua is only guaranteed to be whatever that
  // client put there — a monochrome brand may have no accent colour at all, in which case an
  // accent-derived highlight renders invisible on the dark rail.
  decks: {
    appName: null,
    shortName: null,
    fontFamily: null,
    logoAsset: null,
    colors: {
      canvas: null,
      rail: null,
      railRule: null,
      railMuted: null,
      railActive: null
    }
  }
};

// Committed default filename for each icons.* key, inside the app's own public/brand/.
// Defined once so the fallback and the "committed default" half of the comment above cannot
// drift apart.
const ICON_DEFAULT_FILENAMES = {
  faviconIco: "favicon.ico",
  favicon16: "favicon-16.png",
  favicon32: "favicon-32.png",
  favicon64: "favicon-64.png",
  appleTouchIcon: "apple-touch-icon.png",
  icon192: "icon-192.png",
  icon512: "icon-512.png",
  iconMaskable512: "icon-maskable-512.png",
  logoMark: "logo-mark-only.svg"
};

function resolveConfigPath(appRoot) {
  // BRAND_CONFIG_PATH overrides the location. That is how a test points the real code path at
  // a fixture instead of stubbing the loader out.
  //
  // One app previously used a differently-named variable for this. That legacy name is aliased
  // in that app's own local shim rather than here, because the old name contains a client's
  // name and this module must not. The shim does, before requiring this:
  //     if (process.env.OLD_NAME && !process.env.BRAND_CONFIG_PATH)
  //       process.env.BRAND_CONFIG_PATH = process.env.OLD_NAME;
  return process.env.BRAND_CONFIG_PATH
      || path.join(appRoot, "config", "brand.json");
}

function loadRawConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`brandConfig: ${configPath} exists but failed to parse (${err.message}) — using client-neutral defaults instead.`);
    }
    return {};
  }
}

function buildBrandConfig({ appRoot } = {}) {
  if (!appRoot) throw new Error("mpg-brand-config: appRoot is required, e.g. ({ appRoot: __dirname })");
  const brandDir = path.join(appRoot, "public", "brand");
  const raw = loadRawConfig(resolveConfigPath(appRoot));
  const rawIcons = raw.icons || {};

  const icons = {};
  for (const key of Object.keys(ICON_DEFAULT_FILENAMES)) {
    icons[key] = rawIcons[key] || path.join(brandDir, ICON_DEFAULT_FILENAMES[key]);
  }

  return {
    appName: raw.appName || DEFAULTS.appName,
    companyName: raw.companyName || DEFAULTS.companyName,
    tagline: raw.tagline || DEFAULTS.tagline,
    taglineHighlight: raw.taglineHighlight || DEFAULTS.taglineHighlight,
    description: raw.description || DEFAULTS.description,
    colors: {
      ...DEFAULTS.colors,
      ...(raw.colors || {})
    },
    logoPath: raw.logoPath || path.join(brandDir, "logo.svg"),
    logoWhitePath: raw.logoWhitePath || path.join(brandDir, "logo-white.svg"),
    icons,
    allowedSignupDomains: Array.isArray(raw.allowedSignupDomains) ? raw.allowedSignupDomains : DEFAULTS.allowedSignupDomains,
    // Strict === true, so anything other than a literal boolean true — a missing key, null,
    // 0, or a stray string — comes out false, never accidentally truthy. That is the entire
    // point of a flag that gates whether a capability exists for an instance.
    //
    // This was Boolean(...) before, which does NOT do what that sentence says: Boolean("no")
    // and Boolean("false") are both true, so a flag typed as a string in a hand-edited
    // brand.json would silently enable a capability nobody bought. No deployed config relies
    // on the loose behaviour — every live instance stores real booleans here — so tightening
    // it changes nothing in practice and closes the hole.
    features: {
      integrations: raw.features?.integrations === true,
      recording: raw.features?.recording === true
    },
    restrictedAdminEmail: raw.restrictedAdminEmail || DEFAULTS.restrictedAdminEmail,
    recorderUrl: raw.recorderUrl || DEFAULTS.recorderUrl,
    roleTitles: {
      tracks: (raw.roleTitles && Array.isArray(raw.roleTitles.tracks) && raw.roleTitles.tracks.length > 0)
        ? raw.roleTitles.tracks
        : DEFAULTS.roleTitles.tracks,
      superAdminTitle: (raw.roleTitles && raw.roleTitles.superAdminTitle) || DEFAULTS.roleTitles.superAdminTitle,
      leadershipTabLabel: (raw.roleTitles && raw.roleTitles.leadershipTabLabel) || DEFAULTS.roleTitles.leadershipTabLabel,
      additionalTitles: (raw.roleTitles && Array.isArray(raw.roleTitles.additionalTitles))
        ? raw.roleTitles.additionalTitles
        : DEFAULTS.roleTitles.additionalTitles
    },
    decks: {
      appName: raw.decks?.appName || DEFAULTS.decks.appName,
      shortName: raw.decks?.shortName || DEFAULTS.decks.shortName,
      fontFamily: raw.decks?.fontFamily || DEFAULTS.decks.fontFamily,
      logoAsset: raw.decks?.logoAsset || DEFAULTS.decks.logoAsset,
      colors: {
        ...DEFAULTS.decks.colors,
        ...(raw.decks?.colors || {})
      }
    }
  };
}

module.exports = buildBrandConfig;
module.exports.DEFAULTS = DEFAULTS;
module.exports.ICON_DEFAULT_FILENAMES = ICON_DEFAULT_FILENAMES;
