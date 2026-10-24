# Postman v3 fixtures (constructed)

Written for Testnizer's Postman v3 import / export tests (issues #276, #277).
Nothing here is copied from a Postman export or a third-party repository: the
files are constructed from the public v3 JSON Schema
(`../v3-schema/collection.json`) and Postman's documented folder layout.

- `workspace/` — a Native Git workspace folder: `postman/collections/<name>/`
  (two collections), `postman/environments/*.environment.yaml`,
  `postman/globals/workspace.globals.yaml`, plus side content that is
  reported, not imported (`postman/specs/`, `.postman/`). It mixes the list
  and `key: value` map forms seen in repositories, multi-auth, path-backed
  scripts (one inside, one climbing out of the collection), examples and
  saved messages under `.resources/<request>.resources/`, and request kinds
  Testnizer skips (MQTT, Kafka, an unknown kind).
- `collection-only/` — one collection folder without a definition file.
- `all-kinds.v3.json` — a monolithic v3 JSON collection (the shape the JSON
  Schema validates) with one item per kind.
