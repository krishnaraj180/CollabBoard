import Link from "next/link";
import { Logo } from "./ui";

export default function AuthLayout({ title, subtitle, badge = "Enterprise Workspace", children, footer }) {
  return (
    <div className="auth-portal">
      <div className="auth-backdrop" />
      <div className="auth-card-wrap">
        <header className="auth-header">
          <Link href="/login" className="auth-brand" aria-label="CollabBoard Home"><Logo /></Link>
          {badge && <span className="auth-badge">{badge}</span>}
          <h1>{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        </header>
        <main className="auth-card">{children}</main>
        {footer && <footer className="auth-card-footer">{footer}</footer>}
      </div>
    </div>
  );
}
