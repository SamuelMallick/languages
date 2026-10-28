// Tailscale Serve terminates HTTPS and proxies to our loopback-only listener.
// Never trust client-supplied Forwarded/X-Forwarded-* headers or enable Express
// trust proxy. Serve strips and replaces its identity headers for tailnet traffic.
export function createAccessPolicy({ tailscaleOrigin = '', tailscaleLogin = '' } = {}) {
  tailscaleOrigin = tailscaleOrigin.trim();
  tailscaleLogin = tailscaleLogin.trim();
  let remote;
  if (tailscaleOrigin || tailscaleLogin) {
    try {
      remote = new URL(tailscaleOrigin);
      if (remote.protocol !== 'https:' || remote.port || remote.username || remote.password ||
          remote.pathname !== '/' || remote.search || remote.hash ||
          !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net$/.test(remote.hostname) ||
          !tailscaleLogin || /[\r\n]/.test(tailscaleLogin)) throw new Error();
    } catch {
      throw new Error('Set both TAILSCALE_ORIGIN (https://computer.tailnet.ts.net, without a path) and TAILSCALE_LOGIN (your Tailscale login).');
    }
  }
  const isLoopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
  return function accessPolicy(req, res, next) {
    const host = req.headers.host || '';
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const identity = req.headers['tailscale-user-login'];
    // A proxied request must never fall back to localhost privileges, even if
    // its Host is rewritten. These headers are not used to establish origin.
    const proxied = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'tailscale-user-login']
      .some(name => req.headers[name] !== undefined);
    const local = localHost && !proxied;
    const viaTailscale = remote && host.toLowerCase() === remote.host && identity === tailscaleLogin;
    // Also enforce the proxy boundary if this app is accidentally rebound later.
    if (!isLoopback(req.socket.remoteAddress) || (!local && !viaTailscale)) {
      return res.status(403).json({ error: 'Access requires localhost or the configured Tailscale Serve connection and account.' });
    }
    req.localAccess = local;
    const origin = local ? `http://${host}` : remote.origin;
    // OAuth is a top-level cross-site GET with separate state/cookie validation.
    const protectedRoute = req.path.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method);
    if (protectedRoute && ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site')) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
