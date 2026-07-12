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
    if (next !== window.location.pathname) {
      window.history.pushState({}, "", next);
    }
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
