import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Department,
  Page,
  Session,
  exportDraft,
  request,
} from "../../../api/client";
import { Guard, useDebounced, useWorkspace } from "../../../hooks/useWorkspace";
import { Feedback, Pagination, QueryError } from "../../../components/Feedback";
export function DepartmentsPage({
  session,
  onGuardChange,
}: {
  session: Session;
  onGuardChange: (guard: Guard) => void;
}) {
  const canEdit = session.user.role === "HR_ADMIN",
    cache = useQueryClient();
  const [selected, setSelected] = useState<Department | "new" | null>(null),
    [name, setName] = useState(""),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const query = useDebounced(search),
    workspace = useWorkspace(dirty, onGuardChange);
  useEffect(() => setPage(1), [query]);
  const listing = useQuery({
    queryKey: [session.user.id, "departments", query, page],
    queryFn: ({ signal }) =>
      request<Page<Department>>(
        "/departments?" + new URLSearchParams({ q: query, page: String(page) }),
        session.token,
        { signal },
      ),
  });
  useEffect(() => {
    if (listing.data && page > Math.max(1, Math.ceil(listing.data.total / 20)))
      setPage(Math.max(1, Math.ceil(listing.data.total / 20)));
  }, [listing.data, page]);
  function adopt(row: Department) {
    setSelected(row);
    setName(row.name);
    setDirty(false);
  }
  function close() {
    workspace.setError("");
    workspace.setNotice("");
    setSelected(null);
    setName("");
    setDirty(false);
  }
  async function refresh() {
    await cache.invalidateQueries({ queryKey: [session.user.id] });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || !canEdit) return;
    const baseline = selected;
    void workspace.run(async () => {
      const row = await request<Department>(
        "/departments" + (baseline === "new" ? "" : "/" + baseline.id),
        session.token,
        {
          method: baseline === "new" ? "POST" : "PUT",
          body: JSON.stringify(
            baseline === "new"
              ? { name }
              : { version: baseline.version, department: { name } },
          ),
        },
      );
      if (workspace.alive.current) {
        adopt(row);
        workspace.setNotice("Department saved at version " + row.version + ".");
        await refresh();
      }
    });
  }
  const current = selected && selected !== "new" ? selected : null;
  return (
    <section aria-label="Departments workspace">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">DEPARTMENTS</p>
          <h2>Give every team a clear home.</h2>
        </div>
        {canEdit && (
          <button
            className="primary"
            disabled={workspace.busy}
            onClick={() => {
              if (workspace.mayDiscard()) {
                setSelected("new");
                setName("");
                setDirty(true);
                workspace.setError("");
                workspace.setNotice("");
              }
            }}
          >
            New department
          </button>
        )}
      </div>
      <Feedback error={workspace.error} notice={workspace.notice} />
      <div className="workspace-grid">
        <section className="panel" aria-label="Department library">
          <div className="section-title">
            <h3>Department library</h3>
            <button
              disabled={listing.isFetching}
              onClick={() => void listing.refetch()}
            >
              Refresh departments
            </button>
          </div>
          <label>
            Search departments
            <input
              type="search"
              maxLength={120}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {listing.isPending && <p role="status">Loading departments...</p>}
          <QueryError error={listing.error} hasData={Boolean(listing.data)} />
          {listing.data && (
            <>
              {listing.data.items.map((row) => (
                <article className="record" key={row.id}>
                  <h4>{row.name}</h4>
                  <p>{row._count?.employees || 0} employees</p>
                  <button
                    disabled={workspace.busy}
                    onClick={() => {
                      if (workspace.mayDiscard())
                        void workspace.run(async () => {
                          const value = await request<Department>(
                            "/departments/" + row.id,
                            session.token,
                          );
                          if (workspace.alive.current) adopt(value);
                        });
                    }}
                  >
                    Review {row.name}
                  </button>
                </article>
              ))}
              {!listing.data.items.length && (
                <p>No departments match this search.</p>
              )}
              <Pagination
                page={page}
                total={listing.data.total}
                busy={listing.isFetching}
                label="departments"
                onChange={setPage}
              />
            </>
          )}
        </section>
        <section className="panel" aria-label="Department editor">
          {!selected ? (
            <>
              <h3>Choose a department</h3>
              <p>
                Department identities remain stable when names change. Employee
                references must be moved or removed before a department can be
                deleted.
              </p>
            </>
          ) : (
            <>
              <div className="section-title">
                <h3>{current ? current.name : "New department"}</h3>
                <span className="badge">
                  {current ? "Version " + current.version : "DRAFT"}
                </span>
              </div>
              <p className="draft-state">
                {dirty
                  ? "Unsaved department changes"
                  : "Showing saved department values"}
              </p>
              <form onSubmit={save}>
                <fieldset disabled={workspace.busy || !canEdit}>
                  <label>
                    Department name
                    <input
                      required
                      maxLength={120}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        setDirty(true);
                      }}
                    />
                  </label>
                </fieldset>
                <div className="actions">
                  {canEdit && (
                    <button className="primary" disabled={workspace.busy}>
                      Save department
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      exportDraft("department-draft.json", {
                        id: current?.id || null,
                        version: current?.version || null,
                        department: { name },
                      })
                    }
                  >
                    Export department draft
                  </button>
                  {current && (
                    <button
                      type="button"
                      disabled={workspace.busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Replace the department editor with saved values? Export the draft first.",
                          )
                        )
                          void workspace.run(async () => {
                            const row = await request<Department>(
                              "/departments/" + current.id,
                              session.token,
                            );
                            if (workspace.alive.current) adopt(row);
                          });
                      }}
                    >
                      Load current department
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={workspace.busy}
                    onClick={() => {
                      if (workspace.mayDiscard()) close();
                    }}
                  >
                    Close department
                  </button>
                </div>
              </form>
              {current && canEdit && (
                <button
                  className="danger"
                  disabled={workspace.busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Delete this department? Departments with employees cannot be deleted.",
                      )
                    )
                      void workspace.run(async () => {
                        await request(
                          "/departments/" + current.id,
                          session.token,
                          {
                            method: "DELETE",
                            body: JSON.stringify({ version: current.version }),
                          },
                        );
                        if (workspace.alive.current) {
                          close();
                          workspace.setNotice("Department deleted.");
                          await refresh();
                        }
                      });
                  }}
                >
                  Delete department
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
