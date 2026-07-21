import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

/**
 * A small hand-rolled router (History API pushState/popstate) covering
 * exactly the 4 required routes — no external routing dependency. This
 * is a deliberate choice: adding react-router-dom would require an
 * `npm install` this WSL session cannot safely run without repeating
 * the Windows-symlink corruption from earlier in this session (see the
 * UI rebuild's final report). docs/ui/UI_COMPONENT_ARCHITECTURE.md
 * explicitly allows "a lightweight router ... if justified."
 */
export type AppPath = "/" | "/review" | "/prepare" | "/settings";

interface RouterContextValue {
  path: string;
  navigate: (path: AppPath) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

/**
 * A single, module-level navigation guard — not React state, since it
 * needs to be readable synchronously from `navigate()` before any
 * re-render happens. A page with unsaved work (currently: Review Queue's
 * draft) registers a guard function; it returns true to allow the
 * navigation or false to block it (the guard itself is responsible for
 * asking the user, e.g. via `window.confirm`). Only one guard can be
 * active at a time, matching there only being one page mounted at once.
 *
 * Deliberately does not intercept browser back/forward (`popstate`) —
 * by the time that event fires the URL has already changed, and
 * reliably "undoing" it without confusing the user is a much bigger
 * change than this hand-rolled router's scope. Tab close/refresh is
 * handled separately via `window.beforeunload` in ReviewQueue.tsx.
 */
let navigationGuard: (() => boolean) | null = null;

export function setNavigationGuard(guard: (() => boolean) | null): void {
  navigationGuard = guard;
}

/**
 * A module-level "open this specific item next" request, same pattern
 * and rationale as `navigationGuard` above (must be readable
 * synchronously, outside React state) — set by the Review Suggestions
 * queue (Evidence Intelligence Phase 2) right before navigating to
 * "/review" so ReviewQueue.tsx's mount effect opens that exact item
 * instead of its normal "next unreviewed item" default. Consumed
 * (cleared) on read so a later plain visit to "/review" isn't affected.
 */
let pendingReviewItemId: string | null = null;

export function setPendingReviewItemId(itemId: string): void {
  pendingReviewItemId = itemId;
}

export function consumePendingReviewItemId(): string | null {
  const id = pendingReviewItemId;
  pendingReviewItemId = null;
  return id;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    function onPopState() {
      setPath(window.location.pathname);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(next: AppPath) {
    if (next === window.location.pathname) return;
    if (navigationGuard && !navigationGuard()) return;
    window.history.pushState({}, "", next);
    setPath(next);
  }

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error("useRouter must be used within a RouterProvider");
  }
  return ctx;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: AppPath;
  children: ReactNode;
}

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
