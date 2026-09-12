# Deployment acceptance and rollback

## Verified locally

- Full backend audit: 1,360 passed, four skipped at that time. All four skips were
  subsequently fixed; the Brain analytics module passed all 43 tests.
- Latest concurrent invoice/bill changes: 186 affected tests passed.
- Frontend build, lint, type checking and regression scripts passed in the audit.
- Deployment preflight, missing-backup guards, and login health gates: ten tests passed.
- Bash syntax checks passed for deployment and environment setup.
- Local PostgreSQL rehearsal passed: fresh migrations through 0194, SQL dump,
  restore into a separate empty database, migration-record and marker-data checks.
  Temporary databases were removed. An initial helper connection problem and a
  subsequent restore failure preceded the successful retry; this is local evidence,
  not verification of the target VPS or its backup.

## Server preparation

Read-only VPS verification on 12 September 2026 succeeded using the existing
`viptap_vps_deploy` SSH identity for `sas@mahasoftcorporation.com`:

- Checkout: `/home/sas/fserp/fserp`, clean, commit `610edc6`.
- Django production checks passed without warnings.
- SMTP connection/authentication passed; no email was sent.
- Applied API migrations end at 0193. Migration 0194 is pending release transfer.
- Ten gzip backups exist. Latest observed: `fserp-20260911-103052.sql.gz`
  (1,367,923 bytes); gzip integrity passed. This is not a restore test of that backup.
- No production files, configuration, database records, or running FSERP processes
  were changed during these checks. A fresh backup remains required at deployment.

Run from the intended release checkout on the VPS. Do not copy the development
environment to production. Keep `backend/.env` private and use shell-compatible quoting
for values containing spaces, as shown in `backend/env.production.example`.

1. Record the current running commit, deployment directory, and PM2 configuration.
   Keep the previous working release and its dependencies/build available for rollback.
2. Set a strong `DJANGO_SECRET_KEY`, real PostgreSQL connection, production hosts,
   HTTPS origins, and SMTP credentials in the server environment. Avoid casually
   rotating an existing production key: it can invalidate sessions and signed tokens.
3. From `backend`, run `venv/bin/python manage.py deployment_preflight`. It performs
   strict Django deployment checks and connects/authenticates to SMTP without sending
   messages. Successful authentication alone does not establish inbox delivery.
4. Run the deployment in staging first. Use a maintenance window for this existing
   in-place deployment script: dependency installation and frontend rebuilding are
   not an atomic release switch.
5. Run `bash scripts/deploy-vps.sh`. Leave `FSERP_SKIP_BACKUP` unset. The script takes
   a restricted-permission backup, checks its gzip integrity, applies pending migrations
   including 0194, builds the frontend, reloads PM2, and requires healthy endpoints.

## Backup acceptance and rollback

A gzip integrity check is not a restore rehearsal. Before accepting production,
restore the deployment backup into a newly created, separate PostgreSQL database
using matching server/client versions. For a DBA-managed local PostgreSQL connection:

```bash
createdb fserp_restorecheck_20260912
set -o pipefail
gzip -dc /absolute/path/to/the-selected-backup.sql.gz | \
  psql -X --set ON_ERROR_STOP=1 --single-transaction --dbname=fserp_restorecheck_20260912
```

Use the correct PostgreSQL role and host for the installation. Verify migration
records, representative tenant counts and balances in this isolated copy. Never
point this restore command at the active business database.

If rollout fails, stop FSERP writes, retain the failed database for diagnosis, and
restore the selected pre-deployment backup into a separate recovery database. Start
the preserved previous release against that recovery database and verify health,
login and balances before reopening traffic. Writes made after the backup require
reconciliation; restoring a backup does not preserve them automatically. Do not
blindly reverse migration 0194 after saving 100% tax rates, since the old field is
too narrow for them.

## Final acceptance still required

On staging, exercise login/logout, password reset with actual email receipt, role
restrictions, invoice and bill creation/posting, payments, aquaculture inputs/harvest,
and both income-statement bases. Check displayed totals and browser errors. Use test
tenants and records. No browser is currently connected to this agent, so these
interactive checks have not been completed. A restore rehearsal of the actual server
backup and applying the new release/migration remain outstanding. Nothing has been
deployed by this preparation work.
