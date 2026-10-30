# Postman transformer sample collection

`postman-echo.v1.json`, `postman-echo.v2.json` and `postman-echo.v21.json` hold
the same "Postman Echo" collection in the collection v1, v2.0.0 and v2.1.0
formats. They are the `v1`, `v2` and `v21` exports of the unit-test fixture
`test/unit/fixtures/sample-collection.js` of
[postmanlabs/postman-collection-transformer](https://github.com/postmanlabs/postman-collection-transformer)
(version 4.1.14), serialised to JSON without other changes.

Copyright Postman, Inc. Licensed under the Apache License, Version 2.0:
<http://www.apache.org/licenses/LICENSE-2.0>. The files are distributed on an
"AS IS" basis, without warranties or conditions of any kind.

Used by `tests/main/import-postman-276-artifacts.test.ts` as the oracle for the
v1 converter (`src/main/import/postman/v1.ts`, a TypeScript port of the same
project's v1 → v2 converter): importing our conversion of the v1 file must give
the same requests and examples as importing Postman's own v2.0 output.
