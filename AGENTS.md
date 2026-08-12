# Encontrarnos

- Use TypeScript strict and App Router. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before delivery.
- Public pages may only query `public_case_cards`, `get_public_case`, `search_public_people`, and `submit_public_report` RPCs. Never expose private tables, storage paths, contacts, exact locations, audit logs, or service keys.
- No public action may update a case status. `deceased_confirmed` is admin-only, requires a reason and authority reference, and must be audited.
- Test data is fictional and is seeded only after explicitly setting `ENABLE_TEST_DATA=true` in a development/demo environment.
