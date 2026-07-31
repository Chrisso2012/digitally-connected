# DC-003 — Automated Content Generation

Project foundation for the AI content factory: one approved topic in, a six-slide
Templated carousel out. This repository currently contains **only** the
foundation established by DC-003-I001 — configuration, the template registry,
and JSON schemas with a validator. No generation, mapping, rendering, or
workflow logic exists yet.

## Authoritative documents

This repository implements the following approved specifications. They are
the source of truth for *why* things are shaped the way they are — this
README describes what's actually in the repo, not the reasoning behind it.

- **DC-003-T001 — AI Content Factory Architecture** (approved) — system
  components, data flow, API interaction sequence, error handling.
- **DC-003-T002 — Data & Metadata Specification** (approved) — the five core
  objects (Topic Package, Carousel Content Object, Templated Payload Object,
  Finished Carousel Object, Execution Log), versioning strategy, naming
  conventions, storage strategy.

## Repository structure

```
dc-003-content-factory/
├── config/
│   ├── env.example        # required environment variables, no secrets
│   ├── templates.json      # template registry — IDs, names, layer definitions
│   ├── constants.json       # shared enums and fixed values
│   └── versions.json         # schema/design-system/prompt version identifiers
├── schemas/
│   ├── topic-package.schema.json
│   ├── carousel-content.schema.json
│   ├── templated-payload.schema.json
│   ├── finished-carousel.schema.json
│   └── execution-log.schema.json
├── tests/
│   ├── fixtures/            # one realistic example JSON per schema
│   └── validation/
│       └── validate.mjs      # schema validator — no business logic
├── prompts/                  # empty — reserved for DC-003-I002+
├── workflows/                 # empty — reserved for the n8n export
├── package.json
├── .gitignore
└── README.md
```

`prompts/` and `workflows/` are created empty (via `.gitkeep`) because the
architecture in DC-003-T001 names them as the homes for the LLM prompt and
the exported n8n workflow — both explicitly out of scope for this task.

## Configuration

Four files, one concern each:

| File | Concern | Contains secrets? |
|---|---|---|
| `config/env.example` | LLM and Templated credentials, runtime settings | No — copy to `.env` and fill in real values; `.env` is gitignored |
| `config/templates.json` | The template registry — see below | No |
| `config/constants.json` | Shared enums and fixed values (slide types, statuses, ID prefixes) used by both schemas and future code | No |
| `config/versions.json` | Current schema/design-system/prompt version identifiers, per DC-003-T002 §6 | No |

### Deviation from DC-003-T001, with reason

DC-003-T001 originally proposed the six Templated template IDs as environment
variables. Implementing the template registry (DC-003-T002 deliverable 3)
made it clear they belong in version-controlled `config/templates.json`
instead: template IDs are not secrets, and keeping them in git means a
template swap is a reviewable diff rather than an untracked deployment
change — and it lets `template_version` travel with `template_id` in one
place, matching the versioning strategy in DC-003-T002 §6. `env.example`
notes this explicitly so the discrepancy with T001 isn't silently invisible.

### Open item from DC-003-T002, now resolved

DC-003-T002 §3 flagged the Infographic template's `step_1..4_icon` layers as
unconfirmed. Re-checked against the live template during this task: they are
static `shape` layers, not `image_url` layers. `config/templates.json`
reflects this — no LLM or mapper ever needs to supply icon content.

## Template registry

`config/templates.json` is the single source of truth for the six DC-002
templates: `template_id`, display `name`, slide position, background,
dimensions, render format, a manually-maintained `template_version` label,
and — per slide — every layer split into `variable` (written by a future
Payload Mapper from a Carousel Content Object) and `fixed` (brand-owned,
never touched). This is the DC-002 "template IDs + variable mappings" asset
carried forward as reviewable config, exactly as DC-003-T001 §7 intended.

## Schemas

Five [JSON Schema](https://json-schema.org/) (2020-12) documents in
`schemas/`, one per object defined in DC-003-T002. Each schema is standards-
compliant so a full validator (e.g. Ajv) can consume it unchanged later. Two
simplifications were made deliberately, to avoid the complexity DC-003-T002's
constraints explicitly warned against:

- **Carousel Content Object** — each slide's `content` field is typed as a
  generic object rather than a `slide_type`-conditional schema (`cover` needs
  different fields than `infographic`). The per-type field list is documented
  in DC-003-T002 §2 and mirrored in `config/templates.json`'s `variable`
  layer lists; enforcing it as JSON Schema `if`/`then` logic is deferred to
  when the Payload Mapper is actually built.
- **Templated Payload Object** — `layers` is typed as a generic object rather
  than enumerating every possible layer key, since the valid key set is
  per-template config, not a schema concern.

## Validation

`tests/validation/validate.mjs` is a minimal, **dependency-free** JSON Schema
validator — plain Node.js, no npm packages. It enforces `type`, `required`,
`properties`, `items`, `enum`, `minItems`/`maxItems`, and
`additionalProperties: false`. It does **not** enforce `format`, `pattern`,
`minLength`, `minimum`/`maximum`, or conditional (`if`/`then`) keywords —
those remain in the schema files as documentation for a future Ajv-based
validator, once the project needs full JSON Schema spec coverage. This is a
deliberate foundation-phase trade-off: real validation logic, zero
dependency-installation risk, nothing to outgrow — swapping in Ajv later is
an addition, not a rewrite.

Run it against the five example fixtures in `tests/fixtures/`:

```bash
npm run validate
```

**Implementation note:** this environment has no Node.js runtime available,
so `validate.mjs` could not be executed here. Every fixture was traced by
hand against its schema's `required`, `properties`, and `additionalProperties`
rules field-by-field to confirm it validates cleanly — run `npm run validate`
in an environment with Node.js installed to confirm mechanically before
relying on it further.

There is no business logic anywhere in this repository — no prompt calls,
no payload mapping, no rendering, no retries. Validation only.

## Implementation status

| Area | Status |
|---|---|
| Repository structure | Done (DC-003-I001) |
| Configuration (env, templates, constants, versions) | Done (DC-003-I001) |
| Template registry | Done (DC-003-I001) — all six templates, verified live |
| JSON schemas | Done (DC-003-I001) — all five objects |
| Schema validation | Done (DC-003-I001) — dependency-free validator + fixtures |
| LLM prompt | Not started |
| Payload mapping | Not started |
| Templated rendering calls | Not started |
| n8n workflow | Not started |
| Error handling / retries | Not started |
| Approval workflow | Not started (fields reserved only, per DC-003-T002 §7) |

Nothing above "Schema validation" should require restructuring this
foundation — it should only add to it.
