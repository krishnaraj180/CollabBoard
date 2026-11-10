# CollabBoard

Real-time team collaboration: group chat, presence, file sharing, notifications, and kanban boards with project status tracking, task details, workload views and admin controls.

**Stack:** MongoDB, Express, Next.js (React), Node.js, Socket.IO, JWT.

## Architecture

```
[Next.js client] --REST cookies/JWT--> [Express API]
       |                                    |
       +-------- Socket.IO (JWT) -----------+
                                            |
                                      MongoDB + /uploads
```

- **Auth:** register/login issue a JWT in an httpOnly cookie and in the JSON body (Socket.IO handshake). Logout clears the cookie.
- **Permissions:** every workspace, project, task, channel, message, and file route loads the workspace and checks membership/role on the server. Socket events do the same before joining a channel.
- **Realtime:** the API writes to MongoDB first, then emits `task:updated`, `chat:message`, `presence:update`, and `notification:new`. A second browser does not need a refresh. Chat history is loaded from MongoDB after reconnect.
- **Files:** multipart upload through the message route, stored under `server/uploads`, served only to authenticated users.

## Version 3 highlights

- **New look:** off-white surfaces with a blue accent, Inter typography, light/dark themes, refined cards, badges and forms.
- **Sidebar that never goes blank:** workspace switcher, Dashboard / My tasks / Team, every project (with status dot and live % complete) and every channel stay visible on every page, update live over Socket.IO, and remember your last workspace.
- **Public landing page** at `/`, redesigned sign-in and register pages (password show/hide, strength meter), 404 and error pages.
- **Account page** (`/app/account`): change display name and avatar colour, change password (signs out other devices).
- **Chat redesign:** avatars, grouped messages, timestamps, attachment chips, send button disabled when empty.
- **Database-backed:** account credentials are hashed and saved in MongoDB; workspace, project, task, chat, notification, and activity changes are saved by the API.

## What's new in version 2

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
- Projects move through enforced MD business approval → CTO technical review → PM planning and team assignment → Design → Development → Code Review → QA. Failed QA creates a bug task and returns the project to bug fixing and review. Passed QA proceeds through DevOps deployment/release, Marketing launch, Finance review, PM delivery review and CEO/MD final approval.
- Each workflow step is restricted to its assigned workspace role. Completing the project by changing its status directly is blocked; only final executive approval completes the workflow.

**Notifications & activity**
- Assignment, completion, comment, role-change and project-status notifications (click to open the board).
- Every meaningful action is written to an activity log and pushed live (`activity:new`).

**Responsive + accessible UI**
- Mobile drawer navigation, swipeable kanban columns with a "Move to" control on every card (touch devices cannot drag), full-screen task sheet on phones, light/dark theme toggle, keyboard focus styles and reduced-motion support.
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

Requirements: Node.js 20+, Docker Desktop (or another MongoDB instance), Git.

Start MongoDB with a persistent Docker volume:

```bash
docker compose up -d mongodb
```

In one terminal, configure and start the API:

```powershell
cd server
copy .env.example .env   # Windows (macOS/Linux: cp .env.example .env)
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

Open http://localhost:3000. The web app sends `/api` requests to the Express API at `API_URL`; Socket.IO connects to `NEXT_PUBLIC_SOCKET_URL`. The API connects to the database selected by `MONGODB_URI`. The sample values connect all three services on the same computer.

Registration creates a MongoDB user record with a hashed password. Logging in verifies that record and creates a session; workspace and collaboration content is written to MongoDB by the API. Data survives app restarts as long as the MongoDB volume is retained. For MongoDB Atlas or another database, replace `MONGODB_URI` in `server/.env` with its connection string. Never commit real environment files or production secrets.

For a public deployment, set `CLIENT_ORIGIN` to the frontend origin, `MONGODB_URI` and `JWT_SECRET` on the API, `API_URL` for the Next.js server-side API rewrite, and `NEXT_PUBLIC_SOCKET_URL` to the browser-reachable Socket.IO URL. Use HTTPS and set `secure` production cookies. `NEXT_PUBLIC_SOCKET_URL` is embedded at build time.

Never commit `server/.env` or `client/.env.local`; both are gitignored. The checked-in `.env.example` files contain local-development values only.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` in `server/` | API + Socket.IO on port 5000 |
| `npm run dev` in `client/` | Next.js on 3000; `/api` is rewritten to Express and Socket.IO connects to the configured backend |
| `npm test` in `server/` | Auth, permissions, invalid input, realtime, project management |

## API

Base URL: `/api`. Cookie or `Authorization: Bearer <token>`.

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | `{ name, email, password }` |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/logout` | Clears cookie |
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

### Projects and tasks

| Method | Path |
| --- | --- |
| GET/POST | `/workspaces/:workspaceId/projects` | Lists scope to assigned PM/team projects; creation by owner/admin/PM |
| GET | `/projects/:id` | Board, tasks, stats, role and workflow; PM/team access is assignment-scoped |
| PATCH | `/projects/:id` | Project metadata, PM assignment, project setup or team assignments |
| POST | `/projects/:id/workflow` | `{ action, note? }`; validates the current stage and actor role |
| DELETE | `/projects/:id` | Workspace leadership (also deletes tasks) |
| GET | `/projects/:id/activity` | Recent activity |
| POST | `/projects/:id/tasks` | `{ title, columnId?, priority?, assignees?, labels?, checklist?, dueDate? }`; design/development/bug-fixing stages |
| PATCH | `/projects/:id/tasks/:taskId` | Any of the above plus `order` |
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

No migration is required. Projects created before this version default to status `active`, tasks default to `medium` priority, and boards without a flagged done column treat the column with id `done` (or the last column) as finished.
