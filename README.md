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
- **Deployment ready:** Dockerfiles for API and web app, full-stack `docker compose --profile full`, health check, graceful shutdown, multi-origin CORS.

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
- Team & roles page: owners change roles, owners/admins invite, rename the workspace and remove people; members see a read-only view. Removing someone also unassigns their tasks.

**Admin controls**
- Owners/admins set project status and target date, and delete projects. Members can create projects, add and edit tasks, comment, and delete tasks they created; admins can delete any task or comment.

**Notifications & activity**
- Assignment, completion, comment, role-change and project-status notifications (click to open the board).
- Every meaningful action is written to an activity log and pushed live (`activity:new`).

**Responsive + accessible UI**
- Mobile drawer navigation, swipeable kanban columns with a "Move to" control on every card (touch devices cannot drag), full-screen task sheet on phones, light/dark theme toggle, keyboard focus styles and reduced-motion support.
- Signed-out visitors are redirected to the login page.

### Roles

| Role | Capabilities |
| --- | --- |
| owner | Everything, including role changes |
| admin | Invite/remove members (not other admins), edit workspace, set project status/due date, delete projects, delete any task |
| member | Create projects, add/edit/comment on tasks, delete their own tasks, use channels they belong to |

## Run everything with Docker (recommended for a real deployment)

```bash
cp .env.example .env          # set JWT_SECRET to a long random string
docker compose --profile full up --build -d
docker compose exec server node src/seed.js   # optional demo data (wipes the database)
```

Web app: http://localhost:3000 · API: http://localhost:5000/api/health.
For a public deployment put both behind HTTPS, set `CLIENT_ORIGIN` to your web URL and `PUBLIC_API_URL` to your API URL (Socket.IO connects there from the browser), and keep `DEMO_LOGIN=false`.

## Local development setup

Requirements: Node.js 20+, MongoDB (local or Docker), Git.

```bash
# MongoDB via Docker
docker compose up -d

cd server
copy .env.example .env   # Windows (macOS/Linux: cp .env.example .env)
# set JWT_SECRET to a long random string
npm install
npm run seed
npm run dev

# another terminal
cd client
npm install
npm run dev
```

Open http://localhost:3000

### Demo users (after seed)

| Email | Password |
| --- | --- |
| krishna@collabboard.dev | Demo1234! |
| maya@collabboard.dev | Demo1234! |
| leo@collabboard.dev | Demo1234! |

Never commit `.env`. `server/.env` is gitignored. Use `.env.example` in interviews to show how secrets are injected.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` in `server/` | API + Socket.IO on port 5000 |
| `npm run dev` in `client/` | Next.js on 3000; `/api` is rewritten to Express, Socket.IO connects to port 5000 |
| `npm test` in `server/` | Auth, permissions, invalid input, realtime, project management |
| `npm run seed` in `server/` | Demo workspace, board, chat |

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
| DELETE | `/workspaces/:id/members/:userId` | Self, or admin/owner |

### Projects and tasks

| Method | Path |
| --- | --- |
| GET/POST | `/workspaces/:workspaceId/projects` |
| GET | `/projects/:id` | board, tasks, stats, `myRole` |
| PATCH | `/projects/:id` | Owner/admin `{ name?, description?, status?, dueDate? }` |
| DELETE | `/projects/:id` | Owner/admin (also deletes tasks) |
| GET | `/projects/:id/activity` | Recent activity |
| POST | `/projects/:id/tasks` | `{ title, columnId?, priority?, assignees?, labels?, checklist?, dueDate? }` |
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

1. Register two users or use the seed accounts in two browser profiles.
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

No migration is required. Projects created before this version default to status `active`, tasks default to `medium` priority, and boards without a flagged done column treat the column with id `done` (or the last column) as finished. Run `npm run seed` for fresh demo data that exercises every new feature (this wipes existing data).
