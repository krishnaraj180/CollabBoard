# Environment variables

Copy the relevant example file to `.env` or `.env.local`. Never commit real values.

## API (`server/.env`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | No | `development`, `test`, or `production`; production enables stricter checks. |
| `PORT` | No | API port; defaults to `5000`. |
| `MONGODB_URI` | Yes outside tests | MongoDB connection string. |
| `JWT_SECRET` | Yes outside tests | Signing secret; production requires at least 32 characters. |
| `CLIENT_ORIGIN` | Yes | Comma-separated allowed browser origins; production requires HTTPS. |
| `COOKIE_SAME_SITE` | No | `lax`, `strict`, or `none`; `none` requires HTTPS in cross-site deployments. |
| `SESSION_MAX_AGE_DAYS` | No | Session lifetime in days. |
| `PASSWORD_RESET_URL` | No | Frontend reset-password URL. |
| `UPLOAD_DIR` | No | Upload directory; defaults to `uploads`. |
| `MAX_FILE_MB` | No | Maximum upload size; defaults to `10`. |
| `SENTRY_DSN` | No | Server Sentry DSN. Sentry is disabled when empty. |
| `SENTRY_ENVIRONMENT` | No | Sentry environment label. |
| `TENANT_ENFORCEMENT` | No | `off`, `log`, or `on`. |
| `TENANT_ENFORCEMENT_OVERRIDE` | No | Explicit emergency override for tenant startup checks. |

The API validates required values before connecting to MongoDB or listening on its port. In production, missing or invalid values terminate startup with a list of errors.

## Web client (`client/.env.local`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `API_URL` | No | Server-side Next.js rewrite target; defaults to `http://localhost:5000`. |
| `NEXT_PUBLIC_API_URL` | No | Browser-facing API origin for cross-domain deployments. |
| `NEXT_PUBLIC_SOCKET_URL` | No | Browser-facing Socket.IO origin; defaults to `http://localhost:5000`. |
| `NEXT_PUBLIC_SENTRY_DSN` | No | Browser Sentry DSN. Sentry is disabled when empty. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | No | Browser Sentry environment label. |

## GitHub Actions secrets and environments

- `STAGING_DEPLOY_HOOK_URL` in the `staging` environment triggers the staging deployment.
- `PRODUCTION_DEPLOY_HOOK_URL` in the protected `production` environment triggers production after approval.
- `PRODUCTION_MONGODB_URI` in the protected `production-backups` environment is used only by the scheduled backup workflow.

Configure required reviewers on the `production` and `production-backups` environments. Deployment and backup jobs should use separate credentials with the minimum permissions needed.
