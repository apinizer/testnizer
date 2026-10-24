# Postman collection v3.0.0 JSON Schema

`collection.json` is Postman's published JSON Schema for the collection
format v3.0.0 (draft-07), unchanged:

- served at <https://schema.postman.com/collection/json/v3.0.0/draft-07/collection.json>
- source: [postmanlabs/schemas](https://github.com/postmanlabs/schemas),
  `schemas/draft-07/v3.0.0/collection.json`, commit
  `efc55447e939d1d2362e0d07e150f82cc29d8beb` (2026-10-15)

Copyright Postman, Inc. Licensed under the Apache License, Version 2.0:
<http://www.apache.org/licenses/LICENSE-2.0>. The file is distributed on an
"AS IS" basis, without warranties or conditions of any kind.

Used by `tests/main/export-postman-v3.test.ts`: the monolithic v3 JSON that
Testnizer exports (issue #277) must validate against it (ajv, `strict: false`),
and so must the constructed import fixture `../v3/all-kinds.v3.json`.
