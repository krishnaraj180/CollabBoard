"use client";

import { PROJECT_STATUS, initials, timeAgo } from "../lib/format";

export function Logo({ compact = false }) {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--accent)" />
        <rect x="7" y="8" width="5" height="16" rx="2" fill="#fff" />
        <rect x="14" y="8" width="5" height="10" rx="2" fill="#fff" opacity="0.85" />
        <rect x="21" y="8" width="5" height="13" rx="2" fill="#fff" opacity="0.65" />
      </svg>
      {!compact && <span className="logo-text">CollabBoard</span>}
      {compact && <span className="logo-text">CollabBoard</span>}
    </span>
  );
}

export function Avatar({ user, size = 28 }) {
  if (!user) return null;
  return (
    <span
      className="avatar"
      title={user.name}
      style={{ background: user.avatarColor || "#c45c26", width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users = [], max = 3 }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((u) => (
        <Avatar key={u._id} user={u} size={24} />
      ))}
      {extra > 0 && <span className="avatar more">+{extra}</span>}
    </span>
  );
}

export function StatusBadge({ status }) {
  const meta = PROJECT_STATUS[status] || PROJECT_STATUS.active;
  return <span className={`status-badge ${meta.tone}`}>{meta.label}</span>;
}

export function ProgressBar({ percent = 0, label }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label || "Progress"}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function StatCard({ label, value, tone = "", hint }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="muted">{hint}</div>}
    </div>
  );
}

export function ActivityFeed({ items }) {
  if (!items.length) return <div className="empty">No activity yet. Things your team does will show up here.</div>;
  return (
    <ul className="activity">
      {items.map((a) => (
        <li key={a._id}>
          <Avatar user={a.actor} size={24} />
          <div>
            <span>
              <strong>{a.actor?.name}</strong> {a.summary}
            </span>
            <div className="muted">{timeAgo(a.createdAt)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
