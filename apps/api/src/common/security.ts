import type { NextFunction, Request, Response } from 'express';

/** Sigurnosna zaglavlja (OWASP ASVS V14). CSP dopušta samo vlastito podrijetlo; inline stil zbog React `style` atributa. */
export function securityHeaders(production: boolean) {
  const csp = ["default-src 'self'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", "script-src 'self'", "connect-src 'self'",
    "font-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', csp);
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
