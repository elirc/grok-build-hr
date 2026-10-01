export function Feedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
export function QueryError({
  error,
  hasData = false,
}: {
  error: unknown;
  hasData?: boolean;
}) {
  return error ? (
    <p className="message error" role="alert">
      {error instanceof Error ? error.message : "Unable to load records."}
      {hasData && " Previously loaded records are still shown."}
    </p>
  ) : null;
}
export function Pagination({
  page,
  total,
  busy,
  label,
  onChange,
}: {
  page: number;
  total: number;
  busy: boolean;
  label: string;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <button disabled={busy || page <= 1} onClick={() => onChange(page - 1)}>
        Previous {label}
      </button>
      <span>
        Page {page} of {Math.max(1, Math.ceil(total / 20))}
      </span>
      <button
        disabled={busy || page * 20 >= total}
        onClick={() => onChange(page + 1)}
      >
        Next {label}
      </button>
    </div>
  );
}
