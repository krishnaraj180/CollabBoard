# CollabBoard

CollabBoard is a real-time team collaboration and project operations platform for organizations that need one place to plan work, communicate, manage people, and move projects through controlled delivery stages. It combines workspace-based collaboration with organization management, role-based access, live kanban boards, team chat, file sharing, notifications, workload reporting, and executive project approvals.

**Stack:** MongoDB, Express, Next.js (React), Node.js, Socket.IO, JWT.

## Product overview

CollabBoard supports the full project lifecycle:

- **Organizations and workspaces:** create organizations, manage members and departments, configure locations, link workspaces, and keep organization permissions separate from workspace membership.
- **People and access control:** assign scoped organization and workspace roles, reporting lines, project teams, department positions, and platform Super Admin access through an operator-controlled flow.
- **Project operations:** create projects, define budgets and timelines, assign project managers and teams, track status and completion, and manage milestones, sprints, dependencies, labels, checklists, comments, and due dates.
- **Controlled delivery workflow:** move proposals and projects through business approval, technical review, planning, design, development, code review, QA, deployment, launch, finance, delivery review, and final executive approval.
- **Real-time collaboration:** use live kanban updates, presence, team chat, typing indicators, notifications, activity feeds, and authenticated file attachments without refreshing the page.
- **Reporting and visibility:** review dashboards, personal tasks, project progress, team workload, overdue work, organization workload, and location-level project visibility.
- **Account and security:** use HttpOnly JWT cookies, session management, password changes, logout-all controls, email verification flows, protected uploads, scoped authorization, and state-changing request protection.
- **Responsive dark interface:** use the same fixed dark visual theme across the landing page, authentication screens, workspaces, project boards, chat, account settings, and mobile layouts.

## Architecture

```
[Next.js client] --REST HttpOnly cookie--> [Express API]
       |                                    |
       +-------- Socket.IO (cookie) --------+
                                            |
                                      MongoDB + /uploads
```

- **Auth:** register/login issue a JWT only in an HttpOnly cookie. REST and Socket.IO authenticate from that cookie; the browser does not store a bearer token in local storage. “Remember me” gives the JWT and cookie a 30-day lifetime. When unchecked, the cookie is a browser-session cookie and the JWT lifetime is `JWT_EXPIRES_IN` (7 days by default). Changing a password preserves the current session policy; logout, password changes, password resets and session revocation invalidate prior JWTs. State-changing requests with a browser Origin are restricted to configured `CLIENT_ORIGIN` values.
- **Permissions:** every workspace, project, task, channel, message, and file route checks membership and role on the server. Organization routes use separate organization membership and RBAC checks; organization roles do not bypass the requirement for workspace membership on project resources. Socket events do the same before joining a channel.
- **Realtime:** the API writes to MongoDB first, then emits `task:updated`, `chat:message`, `presence:update`, and `notification:new`. A second browser does not need a refresh. Chat history is loaded from MongoDB after reconnect.
- **Files:** multipart upload through the message route, stored under `server/uploads`, served only by the authenticated `/api/files/:filename` controller. New stored names are UUIDs with a safe MIME-derived extension; existing stored names are not renamed. File lookup is tenant-scoped through the message, channel, workspace, and organization chain, and unknown, foreign, revoked-member, and non-channel-member filenames return the same 404 response. Platform Super Admin file reads are the only cross-tenant exception and emit a structured audit event.
- **Chat access:** channel listings and message history remain membership-scoped for ordinary users. Super Admin cross-tenant chat reads are explicitly allowed, read-only, and logged. Socket.IO uses the same configured `CLIENT_ORIGIN` allowlist as REST; uploaded files are not exposed through static middleware.
- **MongoDB recovery:** the scheduled `MongoDB backup` workflow runs `mongodump --archive --gzip` without Docker and retains the encrypted GitHub artifact for 30 days. Restore only into a separate database with `BACKUP_ARCHIVE`, `RESTORE_MONGODB_URI`, and `RESTORE_CONFIRM=collabboard-restore`, then run the seeded verification and application smoke tests against that restored database.

## Version 3 highlights

- **New look:** fixed dark surfaces with violet and cyan accents, Inter typography, refined cards, badges and forms.
- **Sidebar that never goes blank:** workspace switcher, Dashboard / My tasks / Team, every project (with status dot and live % complete) and every channel stay visible on every page, update live over Socket.IO, and remember your last workspace.
- **Public landing page** at `/`, redesigned sign-in and register pages (password show/hide, strength meter), 404 and error pages.
- **Account page** (`/app/account`): change display name and avatar colour, change password (signs out other devices).
- **Chat redesign:** avatars, grouped messages, timestamps, attachment chips, send button disabled when empty.
- **Database-backed:** account credentials are hashed and saved in MongoDB; workspace, project, task, chat, notification, and activity changes are saved by the API.

## What's new in version 4

**Phase 2 — Organization and team management**
- Organizations have editable profiles/settings, members, departments, workload reports, and explicit links to workspaces. Existing workspaces remain unlinked until an organization administrator links them.
- Organization invitations are one-time, email-bound links that expire after seven days. The invited user must be signed in to the matching account to accept; organization invitations do not replace the existing workspace invitation flow.
- Organization departments can have positions and managers. Members can be assigned a department and title; linked project department assignments continue to use the existing project model.
- Organization roles are scoped separately from workspace roles: Organization Admin manages organization settings, membership, departments and workspace links; Project Manager manages assigned projects; Team Lead manages their assigned team; Developer and QA Tester work on projects where assigned; Viewer has read-only access.
- **Kyro Technologies locations and project approvals:** each location links to its own workspace, and an employee can belong to only one location. Location team leads can add or remove only members of their own role group. Business Management submits client proposals with a quotation, description and project period; the CEO/Company Owner reviews and assigns an approved proposal to one or more locations. Each selected location gets a separate project board, initially at Technical Review. Business Management can follow proposals but does not get access to location project boards; the CEO/Company Owner has company-wide read-only project visibility.
- Linked workspace project APIs accept organization-role permissions where applicable, while retaining workspace membership and project/team assignment checks. Organization workload reports aggregate pending, completed and overdue tasks from linked workspaces and display existing online presence and capacity estimates.
- Platform-wide Super Admin access is stored separately from organization membership and is granted only by an operator with database access: `cd server; npm run grant-super-admin -- user@example.com`. There is no HTTP self-promotion endpoint.

Existing data is preserved: organizations and invitations use separate collections, and `Workspace.organizationId` is optional. No migration or backfill is required; link legacy workspaces explicitly from an organization administrator account.

## What's new in version 2

**Phase 1 — Core project management**
- New projects start with Backlog → To do → In progress → Review → Done. Older boards keep their existing columns and receive Backlog on first board load.
- Accessible mouse and keyboard drag-and-drop persists task status and order; task search, assignee, priority, and done filters remain available.
- Tasks support start/end dates, 0–100 progress, sprint assignment, and same-project dependencies. Dependency cycles and cross-project references are rejected.
- Project managers and workspace leadership can create, edit, start, and complete date-validated sprints, and create, update, track, complete, and remove dated project milestones.
- A project timeline displays task durations, progress, dependency connectors, and milestone markers. Sprints report progress from their completed tasks.

**Project completion & status**
- Projects have a status (`planning`, `in progress`, `on hold`, `completed`), a target date and a live completion percentage computed from the tasks in the board's "done" column.
- Boards now ship with To do → In progress → Review → Done. Moving a card into Done stamps `completedAt`; moving it back clears it.
- Overdue and due-soon indicators on tasks and projects.

**Task detail drawer**
- Priority (low → urgent), due date, labels, multiple assignees, description, checklist sub-steps and a comment thread, all editable from one side sheet.
- Search, assignee, priority and "hide done" filters on the board.

**Dashboard, My tasks, Team**
- Workspace dashboard: totals, status filter, per-project progress, team workload bars (open / done / overdue), live activity feed.
- "My tasks" groups everything assigned to you (overdue, this week, later, no date) with one-click complete.
- Team & roles page: owners assign company roles, owners/admins invite, configure reporting lines and remove people. The organization defaults include CEO/MD leadership; CTO technology leadership; Development with Frontend and Backend teams; QA; Design; DevOps; Finance; Marketing; HR; and Project Management.

**Admin controls**
- Owners/admins and Project Managers can create projects. Task changes are enabled during design, development and bug fixing; department team members only see projects they are assigned to.
- Project teams are assigned during the team-assignment workflow stage. Workspace leadership and the assigned Project Manager can add eligible department members during design, development or bug fixing without moving the project backward.
- Projects move through enforced MD business approval → CTO technical review → PM planning and team assignment → Design → Development → Code Review → QA. Failed QA creates a bug task and returns the project to bug fixing and review. Passed QA proceeds through DevOps deployment/release, Marketing launch, Finance review, PM delivery review and CEO/MD final approval.
- Each workflow step is restricted to its assigned workspace role. Completing the project by changing its status directly is blocked; only final executive approval completes the workflow.

**Notifications & activity**
- Assignment, completion, comment, role-change and project-status notifications (click to open the board).
- Every meaningful action is written to an activity log and pushed live (`activity:new`).

**Responsive + accessible UI**
- Mobile drawer navigation, swipeable kanban columns with a "Move to" control on every card (touch devices cannot drag), full-screen task sheet on phones, one consistent dark theme, keyboard focus styles and reduced-motion support.
- Signed-out visitors are redirected to the login page.

### Roles

| Role | Workflow responsibility |
| --- | --- |
| owner | Workspace superuser and workflow override |
| admin | Manage workspace members/settings and project controls |
| CEO | Final project review |
| Managing Director (MD) | Business approval and final project review |
| CTO | Technical feasibility review |
| Project Manager | Create projects, define scope/budget/timeline/milestones, assign departments and leads, and perform final delivery review |
| Engineering Manager / Development Team Lead | Lead development, coordinate shared frontend/backend work, review code and submit fixes |
| React Developer / UI Developer | Frontend development and bug fixes |
| Node.js Developer / Java Developer / Python Developer | Backend development and bug fixes |
| Design Manager / Design Team Lead / UI/UX Designer | Design stage |
| QA Manager / QA Team Lead / QA Engineer | QA pass/fail; failure automatically creates a bug task |
| DevOps Manager / DevOps Team Lead / DevOps Engineer | Deployment and production release |
| Finance Manager / Accountant / Finance Executive | Cost and budget review |
| Marketing Manager / Marketing Team Lead / Marketing Executive | Product launch |
| HR Manager / HR Executive / Recruiter | HR and recruitment |
| Member / Viewer | General workspace member / read-only access |

## Local development setup

Requirements: Node.js 20+, a reachable MongoDB instance (local or MongoDB Atlas), and Git.

In one terminal, configure and start the API:

```powershell
cd server
copy .env.example .env   # Windows (macOS/Linux: cp .env.example .env)
# Set MONGODB_URI in server/.env to your MongoDB connection string.
npm install
npm run dev
```

In another terminal, configure and start the web app:

```powershell
cd client
copy .env.example .env.local   # Windows (macOS/Linux: cp .env.example .env.local)
npm install
npm run dev
```

Open http://localhost:3000. The web app sends `/api` requests to the Express API at `API_URL`; Socket.IO connects to `NEXT_PUBLIC_SOCKET_URL`. The API connects to the database selected by `MONGODB_URI`. The sample MongoDB URI expects a MongoDB server running locally; for Atlas or another hosted database, use its connection string and ensure the API host is allowed to connect.

Registration creates a MongoDB user record with a hashed password. Logging in verifies that record and creates a session; workspace and collaboration content is written to MongoDB by the API. Data persistence depends on the configured MongoDB instance. Never commit real environment files or production secrets.

For a public deployment, set `CLIENT_ORIGIN` to the frontend origin, `MONGODB_URI` and `JWT_SECRET` on the API, `API_URL` for the Next.js server-side API rewrite, and `NEXT_PUBLIC_SOCKET_URL` to the browser-reachable Socket.IO URL. Use HTTPS and secure production cookies. If the frontend and API are on different sites, set `COOKIE_SAME_SITE=none`; this requires HTTPS. `NEXT_PUBLIC_SOCKET_URL` is embedded at build time.

Never commit `server/.env` or `client/.env.local`; both are gitignored. The checked-in `.env.example` files contain local-development values only.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` in `server/` | API + Socket.IO on port 5000 |
| `npm run dev` in `client/` | Next.js on 3000; `/api` is rewritten to Express and Socket.IO connects to the configured backend |
| `npm test` in `server/` | Auth, organization, permissions, invalid input, realtime, project management |

## API

Base URL: `/api`. Authentication uses the `cb_token` HttpOnly cookie.

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | `{ name, email, password }` |
| POST | `/auth/login` | `{ email, password, rememberMe? }`; `rememberMe` defaults to `true` |
| POST | `/auth/logout` | Clears cookie and invalidates existing sessions |
| PATCH | `/auth/me` | `{ name?, avatarColor? }` |
| POST | `/auth/password` | `{ currentPassword, newPassword }`, ends other sessions |
| GET | `/auth/me` | Current user |

### Workspaces

| Method | Path | Access |
| --- | --- | --- |
| GET | `/workspaces` | Member of |
| POST | `/workspaces` | Authenticated |
| GET | `/workspaces/:id` | Member |
| POST | `/workspaces/:id/invites` | Owner/admin `{ email, role }` |
| PATCH | `/workspaces/:id` | Owner/admin `{ name?, description? }` |
| PATCH | `/workspaces/:id/members/:userId` | Owner `{ role }` |
| PATCH | `/workspaces/:id/members/:userId/organization` | Owner/admin `{ department, title, reportsTo? }` |
| DELETE | `/workspaces/:id/members/:userId` | Self, or admin/owner |

### Organizations

All organization routes require authentication. Except for platform Super Admins, callers must belong to the organization; each route also enforces its organization-specific permission.

| Method | Path | Access / notes |
| --- | --- | --- |
| GET/POST | `/organizations` | List organizations or create one; creator becomes Organization Admin |
| GET/PATCH | `/organizations/:id` | Read organization or update its profile/settings |
| POST | `/organizations/:id/invitations` | Organization Admin; `{ email, role }`; invited account must already exist |
| GET/DELETE | `/organizations/:id/invitations` and `/organizations/:id/invitations/:invitationId` | Organization Admin; list or revoke pending invitations |
| POST | `/organizations/invitations/accept` | Authenticated target account; `{ token }`; one-time, email-bound, seven-day expiry |
| PATCH/DELETE | `/organizations/:id/members/:userId` | Organization Admin; update role/department/title or remove a member |
| POST/PATCH/DELETE | `/organizations/:id/departments` and `/organizations/:id/departments/:departmentId` | Organization Admin; manage departments, positions and managers |
| POST/PATCH/DELETE | `/organizations/:id/locations` and `/organizations/:id/locations/:locationId` | Organization Admin; create or update a location with its linked workspace, or remove a location without assigned projects |
| PUT/DELETE | `/organizations/:id/workspaces/:workspaceId` | Organization Admin links/unlinks a workspace; requires workspace owner/admin approval |
| GET/POST | `/organizations/:id/proposals` | Business Management submits proposals; CEO/Company Owner lists proposals for review |
| POST | `/organizations/:id/proposals/:proposalId/decision` | CEO/Company Owner approves with one or more linked location IDs, or rejects with an optional note |
| GET | `/organizations/:id/workload` | Organization reporting permission; aggregates linked workspace tasks and availability |

### Projects and tasks

| Method | Path |
| --- | --- |
| GET/POST | `/workspaces/:workspaceId/projects` | Lists scope to assigned PM/team projects; creation by owner/admin/PM |
| GET | `/projects/:id` | Board, tasks, stats, role and workflow; PM/team access is assignment-scoped |
| PATCH | `/projects/:id` | Project metadata, PM assignment, project setup or team assignments |
| POST | `/projects/:id/workflow` | `{ action, note? }`; validates the current stage and actor role |
| DELETE | `/projects/:id` | Workspace leadership (also deletes tasks) |
| GET | `/projects/:id/activity` | Recent activity |
| GET/POST | `/projects/:id/sprints` | List sprints with progress; create `{ name, goal?, startDate, endDate }` |
| PATCH | `/projects/:id/sprints/:sprintId` | Edit sprint details and dates |
| POST | `/projects/:id/sprints/:sprintId/start` | Start a planned sprint; only one active sprint per project |
| POST | `/projects/:id/sprints/:sprintId/complete` | Complete the active sprint |
| GET/POST | `/projects/:id/milestones` | List or create `{ title, description?, dueDate? }` |
| PATCH/DELETE | `/projects/:id/milestones/:milestoneId` | Update progress/details or remove a milestone |
| POST | `/projects/:id/milestones/:milestoneId/complete` | Mark a milestone complete |
| POST | `/projects/:id/tasks` | `{ title, columnId?, priority?, assignees?, labels?, checklist?, startDate?, dueDate?, progress?, sprintId?, dependencies? }`; design/development/bug-fixing stages |
| PATCH | `/projects/:id/tasks/:taskId` | Update task fields, including schedule, progress, sprint, and dependencies |
| PATCH | `/projects/:id/tasks/reorder` | Persist ordered `{ moves: [{ taskId, columnId, order }] }` |
| DELETE | `/projects/:id/tasks/:taskId` | Creator or owner/admin |
| POST | `/projects/:id/tasks/:taskId/comments` | `{ body }` |
| DELETE | `/projects/:id/tasks/:taskId/comments/:commentId` | Author or owner/admin |
| GET | `/workspaces/:workspaceId/dashboard` | Totals, status counts, workload, activity |
| GET | `/workspaces/:workspaceId/my-tasks` | Tasks assigned to the caller |
| GET | `/workspaces/:workspaceId/activity` | Audit trail |

### Chat, files, notifications

| Method | Path |
| --- | --- |
| GET/POST | `/workspaces/:workspaceId/channels` |
| GET | `/channels/:channelId/messages` |
| POST | `/channels/:channelId/messages` | multipart `body` + `files` |
| GET | `/files/:filename` | authenticated |
| GET | `/notifications` |
| POST | `/notifications/read` |

### Socket.IO events

Client sends: `channel:join`, `chat:typing`.

Server sends: `presence:snapshot`, `presence:update`, `task:updated`, `chat:message`, `channel:created`, `project:created`, `project:updated`, `project:deleted`, `activity:new`, `notification:new`.

## Interview demo

1. Register two users in separate browser profiles.
2. Invite the second user into a workspace.
3. Move a task on the board — the other session updates with no refresh, and the project percentage and dashboard change too.
3a. As the owner, set a project to "On hold" or "Completed" and watch the other user get a notification. Open the Team page to change a role.
4. Send a chat message, disconnect network, reconnect — history is still there.
5. Upload a file in chat; open notifications on the other user.
6. Call an API without a cookie (`401`) and as a non-member (`403`).

Screenshots: drop PNGs into `docs/screenshots/` (`login.png`, `board.png`, `chat.png`) before sharing the repo.

## Release checklist

See the original 9 items. Automated coverage lives in `server/tests`. Remaining manual items: live hosted demo URL and screenshot files.

## Next.js migration notes

The frontend uses the Next.js App Router under `client/app/`. Existing interactive page components remain in `client/src/pages/` and are mounted by App Router page files. Configure `API_URL` in `client/.env.local` for the Express API rewrite and `NEXT_PUBLIC_SOCKET_URL` for the browser Socket.IO connection. In production, set `CLIENT_ORIGIN` on the server to the deployed frontend origin, and set `API_URL` / `NEXT_PUBLIC_SOCKET_URL` to the deployed backend URL.

The original local `server/.env` is intentionally not included in the migrated ZIP. Copy `server/.env.example` to `server/.env` and supply your own database URL and a strong JWT secret.


## Upgrading an existing database

No manual migration is required. Existing projects keep their stored task and workflow data; their board receives the new Backlog column when first loaded. Workspace organization structures are upgraded on read by merging the expanded default departments while retaining custom departments. Projects default to status `active`, tasks default to `medium` priority, and boards without a flagged done column treat the column with id `done` (or the last column) as finished.
