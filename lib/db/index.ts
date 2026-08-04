/**
 * Data access, organisation-scoped by construction.
 *
 * Every exported function takes `orgId` first and every statement filters on
 * `org_id`. Nothing above this folder builds SQL, so "did we scope that query?"
 * is answerable by reading one directory — and `tests/tenancy` answers it
 * automatically.
 */
export * from './client.ts'
export * from './projects.ts'
export * from './billing.ts'
export * from './media.ts'
export * from './comments.ts'
