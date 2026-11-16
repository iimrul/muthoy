# Backup and host inspection helper sources

Imported individually from `D:/MuthoyAudit-20261109/implementation/tools` on
2026-11-15. The eight PowerShell files retain their reviewed bytes; the
integration receipt records source/import SHA-256. Their companion documentation
is [the historical operator guide](../../docs/operations/DEV_CONNECTION_SETUP_README.md).

These files are source preservation, not an activated runtime. They are not run
by the application, package scripts or this integration's verification. Existing
private-path/identity/hash/ACL checks intentionally remain intact. No relocation
of the original protected execution package is implied. Running a copied helper
may correctly refuse its new location; do not relax the check to make it run.

The `.ps1` helpers are machine-bound by design: each one refuses to run unless
the Windows account SID and private paths match this machine. Those values are
personal, so `.gitignore` keeps the helpers local and this README is the only
file here that is published. Do not parametrize the SID to publish them; that
would remove the identity check they exist to enforce.

Credential entry, host inspection/elevation, encryption, hosted connections,
backup exports and restores require their own explicit operational authorization.
No passfile, service configuration, CA/private-key material or credential is
included in this directory. Original runtimes and evidence stay external.
