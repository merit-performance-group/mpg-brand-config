// Run with: npm test
//
// No framework on purpose — this module has no dependencies and adding one for four
// assertions would be the larger cost.
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const build = require("./index.js");

let passed = 0;
function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brand-config-test-"));
  try {
    fn({
      root,
      write: obj => {
        fs.mkdirSync(path.join(root, "config"), { recursive: true });
        fs.writeFileSync(path.join(root, "config", "brand.json"),
          typeof obj === "string" ? obj : JSON.stringify(obj));
      }
    });
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.BRAND_CONFIG_PATH;
  }
}

test("no config file at all still produces a usable, client-neutral config", ({ root }) => {
  const b = build({ appRoot: root });
  assert.strictEqual(b.appName, "Example App");
  assert.strictEqual(b.colors.brandBlue, "#3A3A3A");
  assert.strictEqual(b.tagline, null);
  assert.strictEqual(b.decks.colors.railActive, null);
});

test("a partial config merges per key, leaving the rest at defaults", ({ root, write }) => {
  write({ appName: "Acme", colors: { brandBlue: "#123456" } });
  const b = build({ appRoot: root });
  assert.strictEqual(b.appName, "Acme");
  assert.strictEqual(b.colors.brandBlue, "#123456");
  assert.strictEqual(b.colors.navy, "#1A1A1A", "an unset colour must keep its default");
  assert.strictEqual(b.companyName, "Example Company");
});

test("the decks block merges the same way", ({ root, write }) => {
  write({ decks: { appName: "Acme Decks", colors: { canvas: "#0A0A0A" } } });
  const b = build({ appRoot: root });
  assert.strictEqual(b.decks.appName, "Acme Decks");
  assert.strictEqual(b.decks.colors.canvas, "#0A0A0A");
  assert.strictEqual(b.decks.colors.railActive, null, "an unset deck colour must stay null");
});

// The reason this module exists in its current form. A flag gates whether a purchased
// capability exists at all, so only a literal boolean true may enable one. Boolean() would
// pass every one of the falsey-looking strings below.
test("feature flags are strictly === true", ({ root, write }) => {
  for (const value of ["true", "yes", "false", "no", "0", 1, 0, -1, [], {}, null]) {
    write({ features: { recording: value } });
    assert.strictEqual(build({ appRoot: root }).features.recording, false,
      `features.recording should be false for ${JSON.stringify(value)}`);
  }
  write({ features: { recording: true } });
  assert.strictEqual(build({ appRoot: root }).features.recording, true);
});

test("BRAND_CONFIG_PATH overrides the location", ({ root }) => {
  const alt = path.join(root, "elsewhere.json");
  fs.writeFileSync(alt, JSON.stringify({ appName: "From Override" }));
  process.env.BRAND_CONFIG_PATH = alt;
  assert.strictEqual(build({ appRoot: root }).appName, "From Override");
});

test("malformed JSON warns and falls back rather than throwing", ({ root, write }) => {
  write("{ not json");
  const original = console.error;
  let warned = false;
  console.error = () => { warned = true; };
  try {
    assert.strictEqual(build({ appRoot: root }).appName, "Example App");
  } finally {
    console.error = original;
  }
  assert.ok(warned, "a malformed config should say so, not fail silently");
});

test("a missing appRoot is a loud error, not a wrong path", () => {
  assert.throws(() => build(), /appRoot is required/);
});

test("asset paths resolve under the app's own public/brand, not this module's", ({ root }) => {
  const b = build({ appRoot: root });
  assert.ok(b.logoPath.startsWith(path.join(root, "public", "brand")),
    `logoPath resolved outside appRoot: ${b.logoPath}`);
  assert.ok(!b.logoPath.includes("node_modules"),
    "logoPath must never resolve inside node_modules");
});


test("the deck type scale has a usable default, and an override replaces only what it names", ({ root, write }) => {
  // An instance that wants a bigger Title should not have to restate Heading, Body and
  // Caption to get it. Per-style merge, not wholesale replacement.
  const bare = build({ appRoot: root }).decks.textStyles;
  for (const name of ["title", "heading", "body", "caption"]) {
    assert.ok(bare[name], name + " has a default");
    assert.equal(typeof bare[name].size, "number");
    assert.equal(typeof bare[name].weight, "number");
    assert.equal(typeof bare[name].lh, "number");
    assert.equal(typeof bare[name].tone, "string");
  }

  write({ decks: { textStyles: { title: { size: 9 } } } });
  const tuned = build({ appRoot: root }).decks.textStyles;
  assert.strictEqual(tuned.title.size, 9, "the override lands");
  assert.strictEqual(tuned.title.weight, bare.title.weight, "and takes nothing else with it");
  assert.deepStrictEqual(tuned.body, bare.body, "other styles are untouched");
});

test("a text style names a ROLE, never a colour", ({ root }) => {
  // The whole point of the role vocabulary is that a deck restyled for another brand keeps
  // its meaning. A hex here would be the one value that did not move.
  const styles = build({ appRoot: root }).decks.textStyles;
  for (const [name, def] of Object.entries(styles)) {
    assert.ok(!/^#/.test(def.tone), name + " names a colour instead of a role: " + def.tone);
  }
});
console.log(`\n${passed} passed`);
