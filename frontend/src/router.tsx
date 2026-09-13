import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from 'react';

interface RouteContextValue {
  path: string;
  search: string;
  searchParams: URLSearchParams;
  navigate: (path: string) => void;
  params: Record<string, string>;
}

const RouteContext = createContext<RouteContextValue | null>(null);
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function locationSnapshot(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function parseLocation(snapshot: string): { path: string; search: string } {
  const url = new URL(snapshot, window.location.origin);
  return { path: url.pathname || '/', search: url.search };
}

function useRouterState(): RouteContextValue {
  const snapshot = useSyncExternalStore(subscribe, locationSnapshot, locationSnapshot);
  const location = parseLocation(snapshot);
  const pattern = routePattern(location.path);
  return useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return {
      path: location.path,
      search: location.search,
      searchParams,
      navigate(nextPath: string) {
        if (locationSnapshot() !== nextPath) {
          window.history.pushState({}, '', nextPath);
          notify();
        }
      },
      params: matchParams(location.path, location.path)
    };
  }, [location, pattern.source, pattern.flags]);
}

export function useRouter(): RouteContextValue {
  const routeContext = useContext(RouteContext);
  if (routeContext) return routeContext;
  return useRouterState();
}

export function Route({ path, children }: { path: string; children: ReactNode }) {
  const router = useRouter();
  const pattern = routePattern(path);
  return pattern.test(router.path)
    ? <RouteContext.Provider value={{ ...router, params: matchParams(router.path, path) }}>{children}</RouteContext.Provider>
    : null;
}

export function useNavigate() { return useRouter().navigate; }
export function useLocation() { return useRouter().path; }
export function useSearchParams() { return useRouter().searchParams; }
export function useParams<T = Record<string, string>>(): T { return useRouter().params as T; }

function routePattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/:[^/]+/g, '([^/]+)')}$`);
}

function matchParams(path: string, routePath: string): Record<string, string> {
  const parameterNames = [...routePath.matchAll(/:([^/]+)/g)].map(match => match[1]);
  if (!parameterNames.length) return {};
  const values = path.match(routePattern(routePath));
  if (!values) return {};
  return Object.fromEntries(parameterNames.map((name, index) => [name, values[index + 1] ?? '']));
}

window.addEventListener('popstate', notify);
