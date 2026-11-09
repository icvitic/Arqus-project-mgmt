import { Injectable, NotFoundException } from '@nestjs/common';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateProgrammePackage, type ProgrammePackage, type ValidationIssue } from '@arqus/domain';

export interface LoadedPackage { pkg: ProgrammePackage; file: string }
export interface RejectedPackage { file: string; issues: ValidationIssue[] }

@Injectable()
export class ProgrammePackagesService {
  private readonly loaded = new Map<string, LoadedPackage>();
  private readonly rejected: RejectedPackage[] = [];

  constructor() {
    const dir = process.env.ARQUS_PACKAGES_DIR ?? this.defaultDir();
    if (dir && existsSync(dir)) this.loadDir(dir);
  }

  private defaultDir(): string | undefined {
    for (const p of [join(process.cwd(), 'docs', 'domena', 'paketi'), join(process.cwd(), '..', '..', 'docs', 'domena', 'paketi')]) {
      if (existsSync(p)) return p;
    }
    return undefined;
  }

  loadDir(dir: string): void {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('schema'))) {
      const result = validateProgrammePackage(JSON.parse(readFileSync(join(dir, file), 'utf-8')));
      if (result.ok) this.loaded.set(result.pkg.meta.id, { pkg: result.pkg, file });
      else this.rejected.push({ file, issues: result.issues });
    }
  }

  list(): { id: string; programme: string; version: string; status?: string; validFrom: string; validTo?: string }[] {
    return [...this.loaded.values()].map(({ pkg }) => ({
      id: pkg.meta.id, programme: pkg.meta.programme, version: pkg.meta.version, status: pkg.meta.status, validFrom: pkg.meta.validFrom, validTo: pkg.meta.validTo,
    }));
  }

  get(id: string): ProgrammePackage {
    const hit = this.loaded.get(id);
    if (!hit) throw new NotFoundException(`Paket programa "${id}" ne postoji`);
    return hit.pkg;
  }

  rejectedPackages(): RejectedPackage[] { return this.rejected; }
}
