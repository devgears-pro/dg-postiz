'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { IApi, IEntity, IFile, TID } from '@svar-ui/react-filemanager';
import '@svar-ui/react-filemanager/all.css';

interface DocItemResponse {
  id: string;
  name: string;
  path: string;
  parent: string;
  type: 'file' | 'folder';
  size: number;
  mimeType?: string;
  date: string;
}

const SvarFilemanager = dynamic(
  () =>
    import('@svar-ui/react-filemanager').then((mod) => {
      const Inner: FC<{
        data: IEntity[];
        init: (api: IApi) => void;
        previews: (file: { id?: string; type: string }) => string | null;
      }> = ({ data, init, previews }) => (
        <mod.WillowDark fonts={false}>
          <mod.Filemanager
            data={data}
            init={init}
            previews={previews}
            preview={true}
            mode="cards"
          />
        </mod.WillowDark>
      );
      return Inner;
    }),
  { ssr: false }
);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

export const DocsManager: FC = () => {
  const fetch = useFetch();
  const { backendUrl } = useVariables();
  const toaster = useToaster();
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFolderRef = useRef<string>('/');
  const [currentFolder, setCurrentFolder] = useState<string>('/');

  const loadDocs = useCallback(async () => {
    const res = await fetch('/documents?recursive=true');
    if (!res.ok) {
      throw new Error('Failed to load documents');
    }
    const json = (await res.json()) as { items?: DocItemResponse[] };
    return (json.items ?? []).map(
      (item): IEntity => ({
        id: item.id,
        name: item.name,
        parent: item.parent,
        type: item.type,
        size: item.size,
        date: new Date(item.date),
      })
    );
  }, [fetch]);

  const { data = [], isLoading, mutate } = useSWR<IEntity[]>('docs-tree', loadDocs, {
    revalidateOnFocus: false,
  });

  const uploadOne = useCallback(
    async (folderPath: string, file: File) => {
      const body = new FormData();
      body.append('path', folderPath);
      body.append('file', file);
      const res = await fetch('/documents/upload', {
        method: 'POST',
        body,
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        toaster.show(
          typeof errBody.message === 'string'
            ? errBody.message
            : t('docs_upload_failed', 'Could not upload document'),
          'warning'
        );
        return false;
      }
      return true;
    },
    [fetch, toaster, t]
  );

  const handleUploadInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (!files.length) return;
      for (const file of files) {
        await uploadOne(currentFolderRef.current, file);
      }
      await mutate();
    },
    [uploadOne, mutate]
  );

  const initApi = useCallback(
    (api: IApi) => {
      api.on('set-path', (ev: { id: TID }) => {
        const next = ev.id || '/';
        currentFolderRef.current = next;
        setCurrentFolder(next);
      });

      api.intercept(
        'create-file',
        async (ev: { file: IFile; parent: TID }) => {
          const parent = ev.parent && ev.parent !== '/' ? ev.parent : '/';
          if (ev.file.file) {
            await uploadOne(parent, ev.file.file);
            await mutate();
            return false;
          }
          if (ev.file.type === 'folder') {
            const folderPath =
              parent === '/' ? `/${ev.file.name}` : `${parent}/${ev.file.name}`;
            const res = await fetch('/documents/folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: folderPath }),
            });
            if (!res.ok) {
              toaster.show(
                t('docs_folder_failed', 'Could not create folder'),
                'warning'
              );
            }
            await mutate();
            return false;
          }
          return false;
        }
      );

      api.intercept('rename-file', async (ev: { id: TID; name: string }) => {
        const res = await fetch('/documents/rename', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: ev.id, newName: ev.name }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          toaster.show(
            typeof errBody.message === 'string'
              ? errBody.message
              : t('docs_rename_failed', 'Could not rename item'),
            'warning'
          );
        }
        await mutate();
        return false;
      });

      api.intercept('delete-files', async (ev: { ids: TID[] }) => {
        for (const id of ev.ids) {
          const res = await fetch(
            `/documents?path=${encodeURIComponent(id)}`,
            { method: 'DELETE' }
          );
          if (!res.ok) {
            toaster.show(
              t('docs_delete_failed', 'Could not delete item'),
              'warning'
            );
          }
        }
        await mutate();
        return false;
      });

      api.intercept('download-file', (ev: { id: TID }) => {
        const url = `${backendUrl}/documents/file?path=${encodeURIComponent(ev.id)}&download=true`;
        window.open(url, '_blank', 'noopener,noreferrer');
        return false;
      });
    },
    [backendUrl, fetch, mutate, t, toaster, uploadOne]
  );

  useEffect(() => {
    currentFolderRef.current = currentFolder;
  }, [currentFolder]);

  const previews = useCallback(
    (file: { id?: string; type: string }) => {
      if (file.type !== 'file' || !file.id) return null;
      const ext = file.id.split('.').pop()?.toLowerCase() ?? '';
      if (!IMAGE_EXTS.has(ext)) return null;
      return `${backendUrl}/documents/file?path=${encodeURIComponent(file.id)}`;
    },
    [backendUrl]
  );

  return (
    <div
      data-testid="docs-file-manager"
      className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[12px] min-h-0"
    >
      <div className="flex items-center justify-between gap-[12px]">
        <h1 className="text-[20px] font-[500]">{t('docs', 'Docs')}</h1>
        <div className="flex items-center gap-[8px]">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUploadInput}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="bg-btnPrimary text-white rounded-[8px] px-[14px] py-[8px] text-[14px] cursor-pointer"
          >
            {t('docs_upload_file', 'Upload file')}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-[560px] rounded-[8px] overflow-hidden border border-newTableBorder">
        {!isLoading && (
          <SvarFilemanager
            key={data.map((item) => item.id).join('|')}
            data={data}
            init={initApi}
            previews={previews}
          />
        )}
      </div>
    </div>
  );
};
