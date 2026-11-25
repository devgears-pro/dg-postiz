export type DocEntryType = 'file' | 'folder';

export interface DocEntry {
  id: string;
  name: string;
  path: string;
  parent: string;
  type: DocEntryType;
  size: number;
  mimeType?: string;
  date: string;
}

export interface IDocsStorage {
  list(orgId: string, dirPath?: string, recursive?: boolean): Promise<DocEntry[]>;
  stat(orgId: string, targetPath: string): Promise<DocEntry | null>;
  createFolder(orgId: string, folderPath: string): Promise<DocEntry>;
  writeFile(orgId: string, filePath: string, content: Buffer): Promise<DocEntry>;
  readFile(orgId: string, filePath: string): Promise<{ buffer: Buffer; entry: DocEntry }>;
  rename(orgId: string, targetPath: string, newName: string): Promise<DocEntry>;
  delete(orgId: string, targetPath: string): Promise<void>;
}

export const DOCS_STORAGE = Symbol('DOCS_STORAGE');
