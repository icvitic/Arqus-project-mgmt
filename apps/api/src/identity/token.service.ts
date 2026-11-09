import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

export interface AccessClaims { sub: string; tid: string; perms: string[]; sid: string }

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  private readonly ttl: string;
  constructor() {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') throw new Error('AUTH_JWT_SECRET nije postavljen');
    this.key = new TextEncoder().encode(secret ?? 'dev-only-secret-change-me-0123456789');
    this.ttl = process.env.AUTH_TOKEN_TTL ?? '8h';
  }
  async sign(claims: AccessClaims): Promise<string> {
    return new SignJWT({ tid: claims.tid, perms: claims.perms, sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(claims.sub).setIssuedAt().setIssuer('arqus-projekti').setExpirationTime(this.ttl).sign(this.key);
  }
  async verify(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.key, { issuer: 'arqus-projekti' });
    return { sub: String(payload.sub), tid: String(payload.tid), perms: (payload.perms as string[]) ?? [], sid: String(payload.sid) };
  }
}
