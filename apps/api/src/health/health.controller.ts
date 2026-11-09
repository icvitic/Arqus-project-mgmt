import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Public } from '../identity/auth.guard';

function readVersion(): string {
  for (const p of [join(__dirname, '..', '..', '..', '..', 'VERSION'), join(process.cwd(), 'VERSION'), join(process.cwd(), '..', '..', 'VERSION')]) {
    try { return readFileSync(p, 'utf-8').trim(); } catch { /* sljedeća lokacija */ }
  }
  return 'unknown';
}

@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();
  @Get()
  get(): { status: 'ok'; version: string; uptimeSeconds: number; time: string } {
    return { status: 'ok', version: readVersion(), uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), time: new Date().toISOString() };
  }
}
