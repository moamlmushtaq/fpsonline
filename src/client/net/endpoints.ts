// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — game server endpoints (pure; unit-tested).
//   ?server=wss://host/ws | ws://host:port | https://host   → that server
//   otherwise the page origin: ws(s)://<host>/ws + <origin>/api/status
//   file:// (or any non-http page) → no server (offline).
// ─────────────────────────────────────────────────────────────────────────────

export interface LocationLike {
  search: string;
  protocol: string;
  host: string;
  origin: string;
  href: string;
}

export interface ServerEndpoints {
  /** WebSocket URL ('' when no server can exist, e.g. file://). */
  ws: string;
  /** Status endpoint URL ('' when unknown). */
  status: string;
}

/** Resolves the server endpoints from `?server=` or the page origin. */
export function resolveServerEndpoints(loc: LocationLike = (globalThis as unknown as { location: LocationLike }).location): ServerEndpoints {
  const override = new URLSearchParams(loc.search).get('server');
  if (override) {
    try {
      const u = new URL(override, loc.href);
      const secure = u.protocol === 'https:' || u.protocol === 'wss:';
      const wsPath = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '/ws';
      const base = wsPath.replace(/\/ws$/, '');
      return {
        ws: `${secure ? 'wss:' : 'ws:'}//${u.host}${wsPath}`,
        status: `${secure ? 'https:' : 'http:'}//${u.host}${base}/api/status`,
      };
    } catch {
      console.warn('[net] ignoring invalid ?server=', override);
    }
  }
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return { ws: '', status: '' };
  return {
    ws: `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`,
    status: `${loc.origin}/api/status`,
  };
}

