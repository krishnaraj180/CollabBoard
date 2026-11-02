"use client";

export default function GlobalError({ reset }) {
  return (
    <div className="status-page">
      <div className="status-code">Oops</div>
      <h1>Something went wrong</h1>
      <p className="muted">The page hit an unexpected error. Your data is safe.</p>
      <button className="btn" onClick={() => reset()}>Try again</button>
    </div>
  );
}
