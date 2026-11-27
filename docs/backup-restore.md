# MongoDB backup and restore

CollabBoard uses a scheduled, provider-neutral `mongodump` workflow. It does not require Docker.

## Backup

The `MongoDB backup` GitHub Actions workflow runs daily at 02:17 UTC and can also be started manually. Configure the protected `production-backups` environment with the `PRODUCTION_MONGODB_URI` secret. The job creates a gzip-compressed archive and retains it as a GitHub artifact for 30 days.

For an operator-run backup:

```powershell
$env:MONGODB_URI = "<production URI>"
$env:BACKUP_DIR = "backups"
cd server
npm run backup:mongodb
```

Keep the archive outside the application host and follow the retention policy of the MongoDB provider or object-storage destination used by the team.

## Restore test into a separate database

Never restore over production for a recovery test. Provision a separate database name or isolated MongoDB cluster, download an archive artifact, and run:

```powershell
$env:BACKUP_ARCHIVE = "D:\backups\collabboard-<timestamp>.archive.gz"
$env:RESTORE_MONGODB_URI = "<separate restore database URI>"
$env:RESTORE_CONFIRM = "collabboard-restore"
cd server
npm run restore:mongodb:test
```

The restore command uses `mongorestore --drop --archive --gzip` only against the explicitly supplied target URI. Afterward, validate the restored database with:

```powershell
$env:MONGODB_URI = $env:RESTORE_MONGODB_URI
npm run verify:tenant
```

Then start the API against the restored URI and check `/api/health`, `/api/ready`, authentication, a workspace list, a project board, chat history, and one file download. Record the archive ID, restore target, verification output, and elapsed restore time as the recovery test evidence.
