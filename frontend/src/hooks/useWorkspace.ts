import { useEffect, useRef, useState } from "react";
export type Guard = { dirty: boolean; busy: boolean };
export function useWorkspace(
  dirty: boolean,
  onGuardChange: (guard: Guard) => void,
) {
  const alive = useRef(true),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => onGuardChange({ dirty, busy }), [dirty, busy, onGuardChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (problem) {
      if (alive.current)
        setError(
          (problem instanceof Error
            ? problem.message
            : "The operation failed.") +
            " Unsaved editor values remain available.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const mayDiscard = () =>
    !dirty ||
    confirm("Discard unsaved changes? Export the draft first to keep it.");
  return { busy, error, notice, setError, setNotice, alive, run, mayDiscard };
}
export function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 180);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}
