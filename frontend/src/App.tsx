import { FormEvent, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EmployeesPage } from "./features/employees/pages/EmployeesPage";
import { LeavePage } from "./features/leave/pages/LeavePage";
import { DepartmentsPage } from "./features/departments/pages/DepartmentsPage";
import { Session, request } from "./api/client";
import { Guard } from "./hooks/useWorkspace";
const cache = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [tab, setTab] = useState<"employees" | "leave" | "departments">("leave"),
    [guard, setGuard] = useState<Guard>({ dirty: false, busy: false });
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const mayLeave = () =>
    !guard.busy &&
    (!guard.dirty ||
      confirm("Discard unsaved changes? Export the draft first to keep it."));
  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<Session>("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      cache.clear();
      setSession(result);
      setPassword("");
      setTab("leave");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <QueryClientProvider client={cache}>
      <main>
        <header className="hero">
          <p className="eyebrow">PEOPLE & LEAVE WORKSPACE</p>
          <h1>Support the people behind the work.</h1>
          <p>
            A clear place for employee records, time-off requests, and
            thoughtful decisions.
          </p>
        </header>
        {!session ? (
          <section className="panel login-panel">
            <h2>Sign in to your local workspace</h2>
            <p>Use a fictional account created by the seed command.</p>
            <form onSubmit={login}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {error && (
                <p className="message error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Signing in..." : "Sign in"}
              </button>
            </form>
            <p className="muted">
              The session stays in this tab's memory. Refreshing signs you out.
            </p>
          </section>
        ) : (
          <>
            <div className="session-bar">
              <div>
                <p>
                  Signed in as <strong>{session.user.name}</strong>
                </p>
                <span className="badge">
                  {session.user.role.replaceAll("_", " ")}
                </span>
              </div>
              <button
                disabled={guard.busy}
                onClick={() => {
                  if (mayLeave()) {
                    cache.clear();
                    setSession(null);
                    setEmail("");
                    setError("");
                    setGuard({ dirty: false, busy: false });
                  }
                }}
              >
                Sign out
              </button>
            </div>
            <nav aria-label="Workspace sections">
              {(["leave", "employees", "departments"] as const).map((value) => (
                <button
                  key={value}
                  aria-current={tab === value ? "page" : undefined}
                  disabled={guard.busy}
                  onClick={() => {
                    if (value !== tab && mayLeave()) {
                      setTab(value);
                      setGuard({ dirty: false, busy: false });
                    }
                  }}
                >
                  {value === "leave"
                    ? "Leave requests"
                    : value === "employees"
                      ? "People directory"
                      : "Departments"}
                </button>
              ))}
            </nav>
            {tab === "employees" ? (
              <EmployeesPage
                key={session.user.id + tab}
                session={session}
                onGuardChange={setGuard}
              />
            ) : tab === "leave" ? (
              <LeavePage
                key={session.user.id + tab}
                session={session}
                onGuardChange={setGuard}
              />
            ) : (
              <DepartmentsPage
                key={session.user.id + tab}
                session={session}
                onGuardChange={setGuard}
              />
            )}
          </>
        )}
        <footer>
          Fictional local learning data. Request dates use calendar days;
          balances and policy entitlements are outside this demo.
        </footer>
      </main>
    </QueryClientProvider>
  );
}
