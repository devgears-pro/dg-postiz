import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, posix, resolve, sep } from 'node:path';
import type { DocEntry, IDocsStorage } from './docs.storage.interface';
import {
  mimeForDocPath,
  normalizeDocPath,
  sanitizeDocName,
} from './docs.validation';

const ORG_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

@Injectable()
export class LocalDocsStorage implements IDocsStorage {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = resolve(
      rootDir ?? process.env.DOCS_DIRECTORY ?? '/data/documents'
    );
  }

  private resolveOrgBase(orgId: string): string {
    if (!ORG_ID_PATTERN.test(orgId)) {
      throw new BadRequestException('Invalid organization id');
    }
    const orgBase = resolve(this.rootDir, orgId);
    if (!orgBase.startsWith(this.rootDir + sep)) {
      throw new BadRequestException('Invalid organization path');
    }
    return orgBase;
  }

  private resolveTarget(
    orgId: string,
    rawPath?: string
  ): { orgBase: string; normalized: string; fsPath: string } {
    const orgBase = this.resolveOrgBase(orgId);
    const normalized = normalizeDocPath(rawPath);
    const relative = normalized.slice(1);
    const fsPath = relative ? resolve(orgBase, relative) : orgBase;
    if (fsPath !== orgBase && !fsPath.startsWith(orgBase + sep)) {
      throw new BadRequestException('Path escapes organization root');
    }
    return { orgBase, normalized, fsPath };
  }

  private async ensureOrgBase(orgId: string): Promise<string> {
    const orgBase = this.resolveOrgBase(orgId);
    await mkdir(orgBase, { recursive: true });
    return orgBase;
  }

  private toEntry(
    normalizedPath: string,
    info: { isDirectory: () => boolean; size: number; mtime: Date }
  ): DocEntry {
    const isDir = info.isDirectory();
    const name =
      normalizedPath === '/' ? '/' : posix.basename(normalizedPath);
    const parent =
      normalizedPath === '/' ? '/' : posix.dirname(normalizedPath);
    return {
      id: normalizedPath,
      name,
      path: normalizedPath,
      parent,
      type: isDir ? 'folder' : 'file',
      size: isDir ? 0 : info.size,
      ...(isDir ? {} : { mimeType: mimeForDocPath(normalizedPath) }),
      date: info.mtime.toISOString(),
    };
  }

  async list(
    orgId: string,
    dirPath = '/',
    recursive = false
  ): Promise<DocEntry[]> {
    await this.ensureOrgBase(orgId);
    const { normalized, fsPath } = this.resolveTarget(orgId, dirPath);

    let dirInfo;
    try {
      dirInfo = await stat(fsPath);
    } catch {
      return [];
    }
    if (!dirInfo.isDirectory()) {
      throw new BadRequestException('Target path is not a folder');
    }

    const items: DocEntry[] = [];
    const walk = async (currentFs: string, currentNorm: string) => {
      const entries = await readdir(currentFs, { withFileTypes: true });
      for (const dirent of entries) {
        if (dirent.name.startsWith('.')) continue;
        const childNorm =
          currentNorm === '/'
            ? `/${dirent.name}`
            : `${currentNorm}/${dirent.name}`;
        const childFs = join(currentFs, dirent.name);
        const info = await stat(childFs);
        items.push(this.toEntry(childNorm, info));
        if (recursive && info.isDirectory()) {
          await walk(childFs, childNorm);
        }
      }
    };

    await walk(fsPath, normalized);
    return items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  async stat(orgId: string, targetPath: string): Promise<DocEntry | null> {
    const { normalized, fsPath } = this.resolveTarget(orgId, targetPath);
    try {
      const info = await stat(fsPath);
      return this.toEntry(normalized, info);
    } catch {
      return null;
    }
  }

  async createFolder(orgId: string, folderPath: string): Promise<DocEntry> {
    await this.ensureOrgBase(orgId);
    const { normalized, fsPath } = this.resolveTarget(orgId, folderPath);
    if (normalized === '/') {
      throw new BadRequestException('Cannot create root folder');
    }
    for (const segment of normalized.slice(1).split('/')) {
      sanitizeDocName(segment);
    }

    await mkdir(fsPath, { recursive: true });
    const info = await stat(fsPath);
    return this.toEntry(normalized, info);
  }

  async writeFile(
    orgId: string,
    filePath: string,
    content: Buffer
  ): Promise<DocEntry> {
    await this.ensureOrgBase(orgId);
    const { normalized, fsPath } = this.resolveTarget(orgId, filePath);
    if (normalized === '/') {
      throw new BadRequestException('Invalid file path');
    }
    const parentFs = resolve(fsPath, '..');
    await mkdir(parentFs, { recursive: true });
    await writeFile(fsPath, content);
    const info = await stat(fsPath);
    return this.toEntry(normalized, info);
  }

  async readFile(
    orgId: string,
    filePath: string
  ): Promise<{ buffer: Buffer; entry: DocEntry }> {
    const { normalized, fsPath } = this.resolveTarget(orgId, filePath);
    if (normalized === '/') {
      throw new NotFoundException('Document not found');
    }
    let info;
    try {
      info = await stat(fsPath);
    } catch {
      throw new NotFoundException('Document not found');
    }
    if (info.isDirectory()) {
      throw new BadRequestException('Cannot read a folder as a file');
    }
    const buffer = await readFile(fsPath);
    return {
      buffer,
      entry: this.toEntry(normalized, info),
    };
  }

  async rename(
    orgId: string,
    targetPath: string,
    newName: string
  ): Promise<DocEntry> {
    const { normalized, fsPath } = this.resolveTarget(orgId, targetPath);
    if (normalized === '/') {
      throw new BadRequestException('Cannot rename root folder');
    }
    const cleanName = sanitizeDocName(newName);
    const parentNorm = posix.dirname(normalized);
    const nextNorm =
      parentNorm === '/' ? `/${cleanName}` : `${parentNorm}/${cleanName}`;
    const { fsPath: nextFs } = this.resolveTarget(orgId, nextNorm);

    try {
      await stat(fsPath);
    } catch {
      throw new NotFoundException('Document or folder not found');
    }

    if (nextFs !== fsPath) {
      const exists = await stat(nextFs)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        throw new ConflictException('A file or folder with this name already exists');
      }
      await rename(fsPath, nextFs);
    }

    const info = await stat(nextFs);
    return this.toEntry(nextNorm, info);
  }

  async delete(orgId: string, targetPath: string): Promise<void> {
    const { normalized, fsPath } = this.resolveTarget(orgId, targetPath);
    if (normalized === '/') {
      throw new BadRequestException('Cannot delete root folder');
    }
    let info;
    try {
      info = await stat(fsPath);
    } catch {
      throw new NotFoundException('Document or folder not found');
    }
    if (info.isDirectory()) {
      await rm(fsPath, { recursive: true, force: false });
    } else {
      await rm(fsPath, { force: false });
    }
  }
}
