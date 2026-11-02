import Link from "next/link";

export default function NotFound() {
  return (
    <div className="status-page">
      <div className="status-code">404</div>
      <h1>We couldn&apos;t find that page</h1>
      <p className="muted">The link may be old, or the board was deleted.</p>
      <Link className="btn" href="/app">Back to your workspaces</Link>
    </div>
  );
}
