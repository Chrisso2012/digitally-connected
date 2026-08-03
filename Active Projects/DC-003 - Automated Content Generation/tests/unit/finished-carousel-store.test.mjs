import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFinishedCarouselStore } from "../../src/finished-carousel-store.mjs";
import {
  InvalidCarouselStoreAdapterError,
  InvalidFinishedCarouselError,
  InvalidCarouselIdentifierError,
  CarouselAlreadyExistsError,
  CarouselNotFoundError,
  CarouselIdentifierMismatchError,
  CorruptedCarouselError,
  CarouselPersistenceError,
} from "../../src/finished-carousel-store-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "finished-carousel.example.json");

function loadFreshCarousel(overrides = {}) {
  const carousel = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  return { ...carousel, ...overrides };
}

// A minimal, faithful in-memory Storage Adapter — exercises
// finished-carousel-store.mjs against the documented { name, write, read,
// list, exists } shape without touching the filesystem, exactly like
// execution-ledger.test.mjs's in-memory Ledger Store.
function createInMemoryAdapter() {
  const files = new Map();
  return {
    name: "in-memory-test-adapter",
    write(identifier, content) {
      files.set(identifier, content);
    },
    read(identifier) {
      if (!files.has(identifier)) {
        const err = new Error(`ENOENT: no such file, open '/fake/host/path/${identifier}.json'`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(identifier);
    },
    list() {
      return [...files.keys()];
    },
    exists(identifier) {
      return files.has(identifier);
    },
    // test-only helper, not part of the real adapter shape
    _raw: files,
  };
}

// --- adapter contract guard ---------------------------------------------

test("throws InvalidCarouselStoreAdapterError for an adapter missing required methods", () => {
  assert.throws(() => createFinishedCarouselStore({ adapter: {} }), InvalidCarouselStoreAdapterError);
  assert.throws(() => createFinishedCarouselStore({ adapter: { name: "x" } }), InvalidCarouselStoreAdapterError);
  assert.throws(() => createFinishedCarouselStore({ adapter: null }), InvalidCarouselStoreAdapterError);
});

// --- save() --------------------------------------------------------------

test("save() persists a valid carousel and returns an immutable copy", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  const stored = store.save(carousel);

  assert.equal(stored.carousel_id, carousel.carousel_id);
  assert.deepEqual(stored, carousel);
  assert.ok(Object.isFrozen(stored));
  assert.ok(Object.isFrozen(stored.approval));
  assert.throws(() => {
    stored.overall_status = "failed";
  }, TypeError);
});

test("save() does not mutate the supplied object", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  const before = JSON.stringify(carousel);
  store.save(carousel);
  assert.equal(JSON.stringify(carousel), before);
});

test("save() rejects a second save for the same carousel_id", () => {
  const adapter = createInMemoryAdapter();
  const store = createFinishedCarouselStore({ adapter });
  const carousel = loadFreshCarousel();
  store.save(carousel);
  assert.throws(() => store.save(carousel), CarouselAlreadyExistsError);
});

test("save() rejects a schema-invalid carousel", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const malformed = loadFreshCarousel();
  delete malformed.overall_status;
  assert.throws(() => store.save(malformed), InvalidFinishedCarouselError);
});

test("save() wraps an adapter write failure as CarouselPersistenceError without leaking the raw cause message", () => {
  const adapter = createInMemoryAdapter();
  adapter.write = () => {
    throw new Error("EACCES: permission denied, open '/very/secret/host/path/car_x.json'");
  };
  const store = createFinishedCarouselStore({ adapter });
  const carousel = loadFreshCarousel();

  assert.throws(() => store.save(carousel), (err) => {
    assert.ok(err instanceof CarouselPersistenceError);
    assert.doesNotMatch(err.message, /\/very\/secret\/host\/path/);
    assert.doesNotMatch(err.message, /permission denied/);
    return true;
  });
});

// --- get() -----------------------------------------------------------

test("get() retrieves a stored carousel, parsed, validated, and immutable", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  store.save(carousel);

  const found = store.get(carousel.carousel_id);
  assert.deepEqual(found, carousel);
  assert.ok(Object.isFrozen(found));
  assert.ok(Object.isFrozen(found.slides));
});

test("get() throws CarouselNotFoundError for an identifier with no stored record", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  assert.throws(() => store.get("car_doesnotexist"), CarouselNotFoundError);
});

test("get() throws CorruptedCarouselError for stored content that is not valid JSON", () => {
  const adapter = createInMemoryAdapter();
  adapter._raw.set("car_broken", "{ this is not json");
  const store = createFinishedCarouselStore({ adapter });
  assert.throws(() => store.get("car_broken"), CorruptedCarouselError);
});

test("get() throws CorruptedCarouselError for stored JSON that fails schema validation", () => {
  const adapter = createInMemoryAdapter();
  adapter._raw.set("car_invalid", JSON.stringify({ carousel_id: "car_invalid" }));
  const store = createFinishedCarouselStore({ adapter });
  assert.throws(() => store.get("car_invalid"), CorruptedCarouselError);
});

for (const badId of ["", "../car_evil", "car_ok/../../etc/passwd", "car_with slash/x", "car_bad\\path", "not_prefixed", "car_"]) {
  test(`get() throws InvalidCarouselIdentifierError for a malformed/path-traversal identifier: ${JSON.stringify(badId)}`, () => {
    const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
    assert.throws(() => store.get(badId), InvalidCarouselIdentifierError);
  });
}

// --- exists() --------------------------------------------------------

test("exists() reflects save() and is false for an unknown identifier", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  assert.equal(store.exists(carousel.carousel_id), false);
  store.save(carousel);
  assert.equal(store.exists(carousel.carousel_id), true);
  assert.equal(store.exists("car_neverexisted"), false);
});

test("exists() throws InvalidCarouselIdentifierError for a path-traversal identifier", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  assert.throws(() => store.exists("../../etc/passwd"), InvalidCarouselIdentifierError);
});

// --- list() ------------------------------------------------------------

test("list() returns an empty array for an empty store", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  assert.deepEqual(store.list(), []);
});

test("list() returns safe summaries with the documented fields", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  store.save(carousel);

  const summaries = store.list();
  assert.equal(summaries.length, 1);
  assert.deepEqual(Object.keys(summaries[0]).sort(), [
    "approved",
    "carousel_id",
    "execution_id",
    "generated_at",
    "overall_status",
    "published",
    "rejected",
    "slide_count",
    "topic_id",
  ]);
  assert.equal(summaries[0].carousel_id, carousel.carousel_id);
  assert.equal(summaries[0].execution_id, carousel.execution_metadata.execution_id);
  assert.equal(summaries[0].topic_id, carousel.topic_id);
  assert.equal(summaries[0].slide_count, carousel.metadata.total_slides);
  assert.equal(summaries[0].approved, false);
  assert.equal(summaries[0].rejected, false);
  assert.equal(summaries[0].published, false);
});

test("list() never exposes full platform internals (slides, execution_metadata) in a summary", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  store.save(loadFreshCarousel());
  const [summary] = store.list();
  assert.equal(summary.slides, undefined);
  assert.equal(summary.execution_metadata, undefined);
  assert.equal(summary.metadata, undefined);
});

test("list() orders summaries deterministically by carousel_id ascending, regardless of insertion/storage order", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  store.save(loadFreshCarousel({ carousel_id: "car_c3" }));
  store.save(loadFreshCarousel({ carousel_id: "car_a1" }));
  store.save(loadFreshCarousel({ carousel_id: "car_b2" }));

  const ids = store.list().map((s) => s.carousel_id);
  assert.deepEqual(ids, ["car_a1", "car_b2", "car_c3"]);
});

test("list() throws CorruptedCarouselError naming the specific identifier that is corrupted", () => {
  const adapter = createInMemoryAdapter();
  adapter._raw.set("car_ok", JSON.stringify(loadFreshCarousel({ carousel_id: "car_ok" })));
  adapter._raw.set("car_broken", "not json at all");
  const store = createFinishedCarouselStore({ adapter });

  assert.throws(() => store.list(), (err) => {
    assert.ok(err instanceof CorruptedCarouselError);
    assert.equal(err.identifier, "car_broken");
    return true;
  });
});

test("list() returns a deep-frozen array", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  store.save(loadFreshCarousel());
  const summaries = store.list();
  assert.ok(Object.isFrozen(summaries));
  assert.ok(Object.isFrozen(summaries[0]));
});

// --- replace() ---------------------------------------------------------

test("replace() supports persisting a DC-003-I014 approval transition", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  store.save(carousel);

  const approved = {
    ...carousel,
    approval: { ...carousel.approval, approved: true, approved_by: "chris", approved_at: "2026-08-04T00:00:00.000Z" },
  };
  const replaced = store.replace({ identifier: carousel.carousel_id, finishedCarousel: approved });

  assert.equal(replaced.approval.approved, true);
  assert.deepEqual(store.get(carousel.carousel_id).approval, approved.approval);
});

test("replace() does not mutate the supplied object and returns an immutable copy", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  store.save(carousel);

  const approved = { ...carousel, approval: { ...carousel.approval, approved: true, approved_by: "chris" } };
  const before = JSON.stringify(approved);
  const replaced = store.replace({ identifier: carousel.carousel_id, finishedCarousel: approved });

  assert.equal(JSON.stringify(approved), before);
  assert.ok(Object.isFrozen(replaced));
});

test("replace() throws CarouselNotFoundError when no existing record exists", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  assert.throws(() => store.replace({ identifier: carousel.carousel_id, finishedCarousel: carousel }), CarouselNotFoundError);
});

test("replace() throws CarouselIdentifierMismatchError when the target identifier and the object's own carousel_id disagree", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carouselA = loadFreshCarousel({ carousel_id: "car_aaaa1111" });
  const carouselB = loadFreshCarousel({ carousel_id: "car_bbbb2222" });
  store.save(carouselA);

  assert.throws(
    () => store.replace({ identifier: "car_aaaa1111", finishedCarousel: carouselB }),
    CarouselIdentifierMismatchError
  );
});

test("replace() throws InvalidFinishedCarouselError for a schema-invalid replacement object", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  store.save(carousel);

  const malformed = { ...carousel };
  delete malformed.overall_status;
  assert.throws(() => store.replace({ identifier: carousel.carousel_id, finishedCarousel: malformed }), InvalidFinishedCarouselError);
});

test("replace() throws InvalidCarouselIdentifierError for a path-traversal target identifier", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  assert.throws(
    () => store.replace({ identifier: "../../etc/passwd", finishedCarousel: carousel }),
    InvalidCarouselIdentifierError
  );
});

test("replace() never implements approval logic itself — it persists whatever approval block it's given, including an invalid-looking one that is still schema-valid", () => {
  const store = createFinishedCarouselStore({ adapter: createInMemoryAdapter() });
  const carousel = loadFreshCarousel();
  store.save(carousel);

  // A state DC-003-I014's own approveCarousel()/rejectCarousel() would
  // never itself produce (both approved AND rejected) — but it's still
  // schema-valid, and this store's job is to persist it, not judge it.
  const bothFlags = {
    ...carousel,
    approval: { ...carousel.approval, approved: true, approved_by: "chris", approved_at: "2026-08-04T00:00:00.000Z", rejected: true, rejection_reason: "no" },
  };
  const replaced = store.replace({ identifier: carousel.carousel_id, finishedCarousel: bothFlags });
  assert.equal(replaced.approval.approved, true);
  assert.equal(replaced.approval.rejected, true);
});
