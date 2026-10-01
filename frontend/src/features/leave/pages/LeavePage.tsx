import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Audit,
  Leave,
  LeaveDraft,
  Session,
  createLeaveRequest,
  exportDraft,
  fetchLeaveRequests,
  request,
} from "../../../api/client";
import { Guard, useDebounced, useWorkspace } from "../../../hooks/useWorkspace";
import { Feedback, Pagination, QueryError } from "../../../components/Feedback";
const blank = (): LeaveDraft => ({
  startDate: "",
  endDate: "",
  type: "VACATION",
  reason: "",
});
const values = (row: Leave): LeaveDraft => ({
  startDate: row.startDate,
  endDate: row.endDate,
  type: row.type,
  reason: row.reason,
});
export function LeavePage({
  session,
  onGuardChange,
}: {
  session: Session;
  onGuardChange: (guard: Guard) => void;
}) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<Leave | "new" | null>(null),
    [draft, setDraft] = useState<LeaveDraft>(blank),
    [decisionNote, setDecisionNote] = useState(""),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1);
  const query = useDebounced(search),
    workspace = useWorkspace(dirty, onGuardChange);
  const current = selected && selected !== "new" ? selected : null,
    own = selected === "new" || current?.employee.userId === session.user.id,
    canEdit = own && (!current || current.status === "PENDING");
  const canDecide = Boolean(
    current &&
      current.status === "PENDING" &&
      !own &&
      (session.user.role === "HR_ADMIN" ||
        (session.user.role === "MANAGER" &&
          current.employee.managerId === session.user.employee?.id)),
  );
  const listing = useQuery({
    queryKey: [session.user.id, "leave", query, status, page],
    queryFn: ({ signal }) =>
      fetchLeaveRequests(
        session.token,
        { q: query, status, page: String(page) },
        signal,
      ),
  });
  const history = useQuery({
    queryKey: [session.user.id, "leave-audit", current?.id],
    enabled: Boolean(current),
    queryFn: ({ signal }) =>
      request<{ items: Audit[] }>(
        "/leave/" + current!.id + "/audit",
        session.token,
        { signal },
      ),
  });
  useEffect(() => setPage(1), [query, status]);
  useEffect(() => {
    if (listing.data && page > Math.max(1, Math.ceil(listing.data.total / 20)))
      setPage(Math.max(1, Math.ceil(listing.data.total / 20)));
  }, [listing.data, page]);
  const change = <K extends keyof LeaveDraft>(key: K, value: LeaveDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };
  function adopt(row: Leave) {
    setSelected(row);
    setDraft(values(row));
    setDecisionNote("");
    setDirty(false);
  }
  function close() {
    workspace.setError("");
    workspace.setNotice("");
    setSelected(null);
    setDraft(blank());
    setDecisionNote("");
    setDirty(false);
  }
  async function refresh() {
    await cache.invalidateQueries({ queryKey: [session.user.id] });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || !canEdit) return;
    const baseline = selected,
      value = { ...draft };
    void workspace.run(async () => {
      const row =
        baseline === "new"
          ? await createLeaveRequest(session.token, value)
          : await request<Leave>("/leave/" + baseline.id, session.token, {
              method: "PUT",
              body: JSON.stringify({ version: baseline.version, leave: value }),
            });
      if (workspace.alive.current) {
        adopt(row);
        workspace.setNotice(
          "Leave request saved at version " + row.version + ".",
        );
        await refresh();
      }
    });
  }
  function decide(choice: "APPROVED" | "REJECTED") {
    if (
      !current ||
      !canDecide ||
      !confirm(
        (choice === "APPROVED" ? "Approve" : "Reject") +
          " this leave request? The decision will be recorded.",
      )
    )
      return;
    const baseline = current,
      note = decisionNote;
    void workspace.run(async () => {
      const row = await request<Leave>(
        "/leave/" + baseline.id + "/decision",
        session.token,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: baseline.version,
            status: choice,
            note,
          }),
        },
      );
      if (workspace.alive.current) {
        adopt(row);
        workspace.setNotice(
          "Decision saved: " + row.status.toLowerCase() + ".",
        );
        await refresh();
      }
    });
  }
  return (
    <section aria-label="Leave workspace">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">LEAVE REQUESTS</p>
          <h2>Plan time away with a clear next step.</h2>
          <p className="muted">
            {session.user.role === "HR_ADMIN"
              ? "Review requests across the organization."
              : session.user.role === "MANAGER"
                ? "Review your requests and those of your direct reports."
                : "Create and review your own leave requests."}
          </p>
        </div>
        {session.user.employee && (
          <button
            className="primary"
            disabled={workspace.busy}
            onClick={() => {
              if (workspace.mayDiscard()) {
                setSelected("new");
                setDraft(blank());
                setDecisionNote("");
                setDirty(true);
                workspace.setError("");
                workspace.setNotice("");
              }
            }}
          >
            New leave request
          </button>
        )}
      </div>
      <Feedback error={workspace.error} notice={workspace.notice} />
      <div className="workspace-grid">
        <section className="panel" aria-label="Leave library">
          <div className="section-title">
            <h3>Request library</h3>
            <button
              disabled={listing.isFetching}
              onClick={() => void listing.refetch()}
            >
              Refresh requests
            </button>
          </div>
          <label>
            Search employee or position
            <input
              type="search"
              maxLength={120}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Request status filter
            <select
              aria-label="Request status filter"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          {listing.isPending && <p role="status">Loading requests...</p>}
          <QueryError error={listing.error} hasData={Boolean(listing.data)} />
          {listing.data && (
            <>
              <p className="muted">
                {listing.data.total}{" "}
                {listing.data.total === 1 ? "request" : "requests"} within your
                access
              </p>
              {listing.data.items.map((row) => (
                <article className="record" key={row.id}>
                  <span className={"badge status-" + row.status.toLowerCase()}>
                    {row.status}
                  </span>
                  <h4>{row.employee.name}</h4>
                  <p>
                    {row.type.toLowerCase()}
                    <br />
                    {row.startDate} to {row.endDate}
                  </p>
                  <button
                    disabled={workspace.busy}
                    onClick={() => {
                      if (workspace.mayDiscard())
                        void workspace.run(async () => {
                          const value = await request<Leave>(
                            "/leave/" + row.id,
                            session.token,
                          );
                          if (workspace.alive.current) adopt(value);
                        });
                    }}
                  >
                    Review {row.employee.name} {row.startDate}
                  </button>
                </article>
              ))}
              {!listing.data.items.length && (
                <p>No requests match these filters.</p>
              )}
              <Pagination
                page={page}
                total={listing.data.total}
                busy={listing.isFetching}
                label="requests"
                onChange={setPage}
              />
            </>
          )}
        </section>
        <section className="panel" aria-label="Leave editor">
          {!selected ? (
            <>
              <p className="eyebrow">MAKE THE NEXT STEP CLEAR</p>
              <h3>Choose a request to review</h3>
              <p>
                Pending requests can be edited by their employee. A direct
                manager or HR administrator can record a decision for someone
                else.
              </p>
              <div className="tip">
                <strong>Dates include both the first and last day.</strong>
                <p>
                  Pending and approved requests cannot overlap for the same
                  employee. Cancelling a request retains its decision history.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="section-title">
                <h3>
                  {current
                    ? current.employee.name + " - " + current.type.toLowerCase()
                    : "New leave request"}
                </h3>
                <span className="badge">
                  {current ? "Version " + current.version : "DRAFT"}
                </span>
              </div>
              {current && (
                <p>
                  <span
                    className={"badge status-" + current.status.toLowerCase()}
                  >
                    {current.status}
                  </span>
                </p>
              )}
              <p className="draft-state">
                {dirty
                  ? "Unsaved leave or decision changes"
                  : "Showing saved request values"}
              </p>
              <form onSubmit={save}>
                <fieldset disabled={workspace.busy || !canEdit}>
                  <div className="field-grid">
                    <label>
                      Leave start date
                      <input
                        type="date"
                        required
                        min="1970-01-01"
                        max="2100-12-31"
                        value={draft.startDate}
                        onChange={(event) =>
                          change("startDate", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Leave end date
                      <input
                        type="date"
                        required
                        min={draft.startDate || "1970-01-01"}
                        max="2100-12-31"
                        value={draft.endDate}
                        onChange={(event) =>
                          change("endDate", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Leave type
                    <select
                      aria-label="Leave type"
                      value={draft.type}
                      onChange={(event) =>
                        change("type", event.target.value as LeaveDraft["type"])
                      }
                    >
                      <option value="VACATION">Vacation</option>
                      <option value="SICK">Sick</option>
                      <option value="PERSONAL">Personal</option>
                    </select>
                  </label>
                  <label>
                    Request reason
                    <textarea
                      rows={6}
                      maxLength={2000}
                      value={draft.reason}
                      onChange={(event) => change("reason", event.target.value)}
                    />
                  </label>
                </fieldset>
                <div className="actions">
                  {canEdit && (
                    <button className="primary" disabled={workspace.busy}>
                      Save leave request
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      exportDraft("leave-draft.json", {
                        id: current?.id || null,
                        version: current?.version || null,
                        employeeId:
                          current?.employeeId || session.user.employee?.id,
                        leave: draft,
                        decisionNote,
                      })
                    }
                  >
                    Export leave draft
                  </button>
                  {current && (
                    <button
                      type="button"
                      disabled={workspace.busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Replace the request editor and decision note with saved values? Export the draft first.",
                          )
                        )
                          void workspace.run(async () => {
                            const value = await request<Leave>(
                              "/leave/" + current.id,
                              session.token,
                            );
                            if (workspace.alive.current) adopt(value);
                          });
                      }}
                    >
                      Load current request
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={workspace.busy}
                    onClick={() => {
                      if (workspace.mayDiscard()) close();
                    }}
                  >
                    Close request
                  </button>
                </div>
              </form>
              {canDecide && (
                <section
                  className="decision-panel"
                  aria-label="Request decision"
                >
                  <h4>Record a decision</h4>
                  <p>
                    Review the dates and coordinate the next steps before
                    deciding.
                  </p>
                  <label>
                    Decision note
                    <textarea
                      rows={4}
                      maxLength={1000}
                      disabled={workspace.busy}
                      value={decisionNote}
                      onChange={(event) => {
                        setDecisionNote(event.target.value);
                        setDirty(true);
                      }}
                    />
                  </label>
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={workspace.busy}
                      onClick={() => decide("APPROVED")}
                    >
                      Approve request
                    </button>
                    <button
                      className="danger"
                      disabled={workspace.busy}
                      onClick={() => decide("REJECTED")}
                    >
                      Reject request
                    </button>
                  </div>
                </section>
              )}
              {current?.decidedBy && (
                <div className="decision-summary">
                  <h4>Saved decision</h4>
                  <p>Recorded by {current.decidedBy.name}</p>
                  <p className="preserve-lines">
                    {current.decisionNote || "No decision note was added."}
                  </p>
                </div>
              )}
              {current && own && (
                <div className="record-actions">
                  {current.status === "PENDING" && (
                    <button
                      className="danger"
                      disabled={workspace.busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Delete this pending leave request? Its minimal audit history remains.",
                          )
                        )
                          void workspace.run(async () => {
                            await request(
                              "/leave/" + current.id,
                              session.token,
                              {
                                method: "DELETE",
                                body: JSON.stringify({
                                  version: current.version,
                                }),
                              },
                            );
                            if (workspace.alive.current) {
                              close();
                              workspace.setNotice("Leave request deleted.");
                              await refresh();
                            }
                          });
                      }}
                    >
                      Delete pending request
                    </button>
                  )}
                  {["PENDING", "APPROVED"].includes(current.status) && (
                    <button
                      disabled={workspace.busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Cancel the saved request and discard unsaved edits? Export the draft first if needed. Its history will remain.",
                          )
                        )
                          void workspace.run(async () => {
                            const row = await request<Leave>(
                              "/leave/" + current.id + "/cancel",
                              session.token,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  version: current.version,
                                }),
                              },
                            );
                            if (workspace.alive.current) {
                              adopt(row);
                              workspace.setNotice("Leave request cancelled.");
                              await refresh();
                            }
                          });
                      }}
                    >
                      Cancel request
                    </button>
                  )}
                </div>
              )}
              {current && (
                <section className="audit-panel">
                  <h4>Recent request changes</h4>
                  <QueryError error={history.error} />
                  <ol>
                    {history.data?.items.map((row) => (
                      <li key={row.id}>
                        {row.action.toLowerCase()} - version {row.version} -{" "}
                        {new Date(row.createdAt).toLocaleString()}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
