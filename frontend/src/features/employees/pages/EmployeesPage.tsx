import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Employee,
  EmployeeDraft,
  Options,
  Session,
  employeeDraft,
  exportDraft,
  fetchEmployees,
  request,
} from "../../../api/client";
import { Guard, useDebounced, useWorkspace } from "../../../hooks/useWorkspace";
import { Feedback, Pagination, QueryError } from "../../../components/Feedback";
const blank = (): EmployeeDraft => ({
  name: "",
  email: "",
  position: "",
  startDate: "",
  departmentId: "",
  managerId: null,
  active: true,
});
export function EmployeesPage({
  session,
  onGuardChange,
}: {
  session: Session;
  onGuardChange: (guard: Guard) => void;
}) {
  const canEdit = session.user.role === "HR_ADMIN",
    cache = useQueryClient();
  const [selected, setSelected] = useState<Employee | "new" | null>(null),
    [draft, setDraft] = useState<EmployeeDraft>(blank),
    [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [active, setActive] = useState("");
  const query = useDebounced(search),
    workspace = useWorkspace(dirty, onGuardChange);
  const prefix = [session.user.id, "employees"];
  useEffect(() => setPage(1), [query, active]);
  const listing = useQuery({
    queryKey: [...prefix, query, page, active],
    queryFn: ({ signal }) =>
      fetchEmployees(
        session.token,
        { q: query, page: String(page), active },
        signal,
      ),
  });
  const options = useQuery({
    queryKey: [session.user.id, "employee-options"],
    enabled: canEdit,
    queryFn: ({ signal }) =>
      request<Options>("/employees/options", session.token, { signal }),
  });
  useEffect(() => {
    if (listing.data && page > Math.max(1, Math.ceil(listing.data.total / 20)))
      setPage(Math.max(1, Math.ceil(listing.data.total / 20)));
  }, [listing.data, page]);
  const change = <K extends keyof EmployeeDraft>(
    key: K,
    value: EmployeeDraft[K],
  ) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };
  function adopt(row: Employee) {
    setSelected(row);
    setDraft(employeeDraft(row));
    setDirty(false);
  }
  function close() {
    workspace.setError("");
    workspace.setNotice("");
    setSelected(null);
    setDraft(blank());
    setDirty(false);
  }
  async function refresh() {
    await cache.invalidateQueries({ queryKey: [session.user.id] });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || !canEdit) return;
    const base = selected,
      value = { ...draft };
    void workspace.run(async () => {
      const row = await request<Employee>(
        "/employees" + (base === "new" ? "" : "/" + base.id),
        session.token,
        {
          method: base === "new" ? "POST" : "PUT",
          body: JSON.stringify(
            base === "new" ? value : { version: base.version, employee: value },
          ),
        },
      );
      if (workspace.alive.current) {
        adopt(row);
        workspace.setNotice("Employee saved at version " + row.version + ".");
        await refresh();
      }
    });
  }
  const current = selected && selected !== "new" ? selected : null;
  const departments = options.data?.departments || [],
    managers = options.data?.managers || [];
  return (
    <section aria-label="People directory">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">PEOPLE DIRECTORY</p>
          <h2>Know the people and their teams.</h2>
          <p className="muted">
            {canEdit
              ? "Manage employee records and reporting relationships."
              : session.user.role === "MANAGER"
                ? "Your profile and direct reports are available here."
                : "Your employee profile is available here."}
          </p>
        </div>
        {canEdit && (
          <button
            className="primary"
            disabled={workspace.busy}
            onClick={() => {
              if (workspace.mayDiscard()) {
                setSelected("new");
                setDraft(blank());
                setDirty(true);
                workspace.setError("");
                workspace.setNotice("");
              }
            }}
          >
            New employee
          </button>
        )}
      </div>
      <Feedback error={workspace.error} notice={workspace.notice} />
      <div className="workspace-grid">
        <section className="panel" aria-label="Employee library">
          <div className="section-title">
            <h3>Employee library</h3>
            <button
              disabled={listing.isFetching}
              onClick={() => void listing.refetch()}
            >
              Refresh people
            </button>
          </div>
          <label>
            Search people
            <input
              type="search"
              maxLength={120}
              placeholder="Name, email, or position"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Employee status filter
            <select
              aria-label="Employee status filter"
              value={active}
              onChange={(event) => setActive(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          {listing.isPending && <p role="status">Loading employees...</p>}
          <QueryError error={listing.error} hasData={Boolean(listing.data)} />
          {listing.data && (
            <>
              <p className="muted">
                {listing.data.total}{" "}
                {listing.data.total === 1 ? "employee" : "employees"} within
                your access
              </p>
              {listing.data.items.map((row) => (
                <article className="record" key={row.id}>
                  <span className="badge">
                    {row.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <h4>{row.name}</h4>
                  <p>
                    {row.position}
                    <br />
                    {row.department.name}
                  </p>
                  <button
                    disabled={workspace.busy}
                    onClick={() => {
                      if (workspace.mayDiscard())
                        void workspace.run(async () => {
                          const current = await request<Employee>(
                            "/employees/" + row.id,
                            session.token,
                          );
                          if (workspace.alive.current) adopt(current);
                        });
                    }}
                  >
                    Review {row.name}
                  </button>
                </article>
              ))}
              {!listing.data.items.length && (
                <p>No employees match these filters.</p>
              )}
              <Pagination
                page={page}
                total={listing.data.total}
                busy={listing.isFetching}
                label="people"
                onChange={setPage}
              />
            </>
          )}
        </section>
        <section className="panel" aria-label="Employee editor">
          {!selected ? (
            <>
              <p className="eyebrow">A CLEAR RECORD</p>
              <h3>Choose an employee to review</h3>
              <p>
                Keep role details, departments, and reporting relationships
                accurate. Existing leave and review history stays linked to the
                same employee identity.
              </p>
            </>
          ) : (
            <>
              <div className="section-title">
                <h3>{current ? current.name : "New employee"}</h3>
                <span className="badge">
                  {current ? "Version " + current.version : "DRAFT"}
                </span>
              </div>
              <p className="draft-state">
                {dirty
                  ? "Unsaved employee changes"
                  : "Showing saved employee values"}
              </p>
              {selected === "new" && (
                <p className="message info">
                  This creates an employee record. Login credentials are not
                  provisioned by this form.
                </p>
              )}
              <QueryError error={options.error} />
              {options.data?.truncated && (
                <p className="message info">
                  The first 500 reference choices are shown. Review the
                  reference catalogue before selecting an omitted value.
                </p>
              )}
              <form onSubmit={save}>
                <fieldset disabled={workspace.busy || !canEdit}>
                  <label>
                    Employee name
                    <input
                      required
                      maxLength={120}
                      value={draft.name}
                      onChange={(event) => change("name", event.target.value)}
                    />
                  </label>
                  <label>
                    Employee email
                    <input
                      required
                      type="email"
                      maxLength={254}
                      value={draft.email}
                      onChange={(event) => change("email", event.target.value)}
                    />
                  </label>
                  <label>
                    Position
                    <input
                      required
                      maxLength={160}
                      value={draft.position}
                      onChange={(event) =>
                        change("position", event.target.value)
                      }
                    />
                  </label>
                  <div className="field-grid">
                    <label>
                      Start date
                      <input
                        required
                        type="date"
                        min="1970-01-01"
                        max="2100-12-31"
                        value={draft.startDate}
                        onChange={(event) =>
                          change("startDate", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Employee active status
                      <select
                        aria-label="Employee active status"
                        value={String(draft.active)}
                        onChange={(event) =>
                          change("active", event.target.value === "true")
                        }
                      >
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Department
                    <select
                      aria-label="Department"
                      required
                      value={draft.departmentId}
                      onChange={(event) =>
                        change("departmentId", event.target.value)
                      }
                    >
                      <option value="">Choose a department</option>
                      {current &&
                        !departments.some(
                          (item) => item.id === current.departmentId,
                        ) && (
                          <option value={current.departmentId}>
                            {current.department.name}
                          </option>
                        )}
                      {departments.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Direct manager
                    <select
                      aria-label="Direct manager"
                      value={draft.managerId || ""}
                      onChange={(event) =>
                        change("managerId", event.target.value || null)
                      }
                    >
                      <option value="">No manager</option>
                      {current?.managerId &&
                        !managers.some(
                          (item) => item.id === current.managerId,
                        ) && (
                          <option value={current.managerId}>
                            {current.managerName || "Current manager"}
                          </option>
                        )}
                      {managers
                        .filter((item) => item.id !== current?.id)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </fieldset>
                <div className="actions">
                  {canEdit && (
                    <button
                      className="primary"
                      disabled={workspace.busy || options.isPending}
                    >
                      Save employee
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      exportDraft("employee-draft.json", {
                        id: current?.id || null,
                        version: current?.version || null,
                        employee: draft,
                      })
                    }
                  >
                    Export employee draft
                  </button>
                  {current && (
                    <button
                      type="button"
                      disabled={workspace.busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Replace the employee editor with saved values? Export the draft first.",
                          )
                        )
                          void workspace.run(async () => {
                            const row = await request<Employee>(
                              "/employees/" + current.id,
                              session.token,
                            );
                            if (workspace.alive.current) adopt(row);
                          });
                      }}
                    >
                      Load current employee
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={workspace.busy}
                    onClick={() => {
                      if (workspace.mayDiscard()) close();
                    }}
                  >
                    Close employee
                  </button>
                </div>
              </form>
              {current && canEdit && (
                <div className="record-actions">
                  <p className="muted">
                    Referenced employees retain their history. Deactivate
                    records that should no longer be active.
                  </p>
                  <button
                    className="danger"
                    disabled={workspace.busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Delete this unreferenced employee and its account? Referenced or privileged records cannot be deleted here.",
                        )
                      )
                        void workspace.run(async () => {
                          await request(
                            "/employees/" + current.id,
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
                            workspace.setNotice("Employee deleted.");
                            await refresh();
                          }
                        });
                    }}
                  >
                    Delete employee
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
