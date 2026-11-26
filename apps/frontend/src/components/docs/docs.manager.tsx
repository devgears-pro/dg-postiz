'use client';

import React, { FC, useCallback, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { DropFiles } from '@gitroom/frontend/components/layout/drop.files';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { PlusIcon, TrashIcon } from '@gitroom/frontend/components/ui/icons';

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

const RASTER_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TEXT_PREVIEW_EXTS = new Set(['md', 'txt', 'json', 'csv']);

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveUploadTargetFolder(baseFolder: string, file: File): string | null {
  const withRel = file as File & { webkitRelativePath?: string; path?: string };
  const rawRel = (withRel.webkitRelativePath || withRel.path || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '');
  const segments = rawRel.split('/').filter(Boolean);
  if (
    segments.length > 1 &&
    (file.name === '.DS_Store' ||
      file.name === 'Thumbs.db' ||
      segments.some((s) => s.startsWith('.')))
  ) {
    return null;
  }
  if (segments.length <= 1) {
    return baseFolder;
  }
  const relDir = segments.slice(0, -1).join('/');
  return baseFolder === '/' ? `/${relDir}` : `${baseFolder}/${relDir}`;
}

const NamePromptModal: FC<{
  initialValue: string;
  placeholder: string;
  submitLabel: string;
  helperText?: string;
  onSubmit: (value: string) => Promise<boolean>;
  closeModal: () => void;
}> = ({ initialValue, placeholder, submitLabel, helperText, onSubmit, closeModal }) => {
  const t = useT();
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const ok = await onSubmit(trimmed);
      if (ok) {
        closeModal();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[16px] w-full sm:min-w-[340px]">
      <div className="flex flex-col gap-[6px]">
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full px-[12px] py-[10px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[14px] outline-none focus:border-btnPrimary"
        />
        {helperText && (
          <div className="text-[12px] opacity-60">{helperText}</div>
        )}
      </div>
      <div className="flex justify-end gap-[8px]">
        <Button type="button" secondary onClick={closeModal}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button type="submit" loading={submitting} disabled={!value.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};

const DocPreviewModal: FC<{
  item: DocItemResponse;
  fileUrl: string;
  downloadUrl: string;
  closeModal: () => void;
}> = ({ item, fileUrl, downloadUrl, closeModal }) => {
  const fetch = useFetch();
  const t = useT();
  const ext = getExt(item.name);
  const isImage = RASTER_IMAGE_EXTS.has(ext);
  const isText = TEXT_PREVIEW_EXTS.has(ext);
  const [imageError, setImageError] = useState(false);

  const {
    data: textContent,
    error: textError,
    isLoading: loadingText,
  } = useSWR<string>(
    isText ? ['docs-preview', item.path, item.date] : null,
    async () => {
      const res = await fetch(`/documents/file?path=${encodeURIComponent(item.path)}`);
      if (!res.ok) {
        throw new Error('Failed to load preview');
      }
      return res.text();
    },
    { revalidateOnFocus: false }
  );

  return (
    <div className="flex flex-col gap-[16px] w-full sm:min-w-[420px] max-w-[780px]">
      {isImage && !imageError && (
        <div className="flex items-center justify-center bg-newBgColor rounded-[8px] border border-newTableBorder p-[16px] max-h-[60vh] overflow-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl}
            alt={item.name}
            onError={() => setImageError(true)}
            className="max-w-full max-h-[54vh] object-contain rounded-[4px]"
          />
        </div>
      )}
      {isText && (
        <div className="bg-newBgColor rounded-[8px] border border-newTableBorder p-[14px] max-h-[60vh] overflow-auto">
          {loadingText ? (
            <div className="text-[14px] opacity-60">{t('loading', 'Loading...')}</div>
          ) : textError ? (
            <div className="text-[14px] text-red-400">
              {t('docs_preview_failed', 'Could not load document preview.')}
            </div>
          ) : (
            <pre className="text-[13px] leading-[1.5] whitespace-pre-wrap break-words font-mono">
              {textContent}
            </pre>
          )}
        </div>
      )}
      {((!isImage && !isText) || imageError) && (
        <div className="bg-newBgColor rounded-[8px] border border-newTableBorder p-[24px] flex flex-col items-center gap-[8px] text-center">
          <span className="px-[10px] py-[4px] rounded-[6px] bg-btnPrimary/20 border border-btnPrimary/30 text-[13px] font-[600] uppercase">
            {ext || 'FILE'}
          </span>
          <div className="text-[14px] font-[500] break-all">{item.name}</div>
          <div className="text-[12px] opacity-60">{formatBytes(item.size)}</div>
        </div>
      )}
      <div className="flex justify-end gap-[8px]">
        <Button type="button" secondary onClick={closeModal}>
          {t('close', 'Close')}
        </Button>
        <a href={downloadUrl} download={item.name}>
          <Button type="button">{t('download', 'Download')}</Button>
        </a>
      </div>
    </div>
  );
};

export const DocsManager: FC = () => {
  const fetch = useFetch();
  const { backendUrl } = useVariables();
  const toaster = useToaster();
  const modals = useModals();
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [currentFolder, setCurrentFolder] = useState<string>('/');
  const [uploading, setUploading] = useState(false);

  const loadDocs = useCallback(async () => {
    const res = await fetch(
      `/documents?path=${encodeURIComponent(currentFolder)}&recursive=false`
    );
    if (!res.ok) {
      throw new Error('Failed to load documents');
    }
    const json = (await res.json()) as { items?: DocItemResponse[] };
    return json.items ?? [];
  }, [currentFolder, fetch]);

  const {
    data: items = [],
    error: loadError,
    isLoading,
    mutate,
  } = useSWR<DocItemResponse[]>(['docs-list', currentFolder], loadDocs, {
    revalidateOnFocus: false,
  });

  const breadcrumbs = useMemo(() => {
    const parts = currentFolder.split('/').filter(Boolean);
    return parts.map((part, idx) => ({
      label: part,
      path: '/' + parts.slice(0, idx + 1).join('/'),
    }));
  }, [currentFolder]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      try {
        for (const file of files) {
          const targetFolder = resolveUploadTargetFolder(currentFolder, file);
          if (!targetFolder) continue;
          const body = new FormData();
          body.append('path', targetFolder);
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
          }
        }
        await mutate();
      } finally {
        setUploading(false);
      }
    },
    [currentFolder, fetch, mutate, t, toaster]
  );

  const handleUploadInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      await uploadFiles(files);
    },
    [uploadFiles]
  );

  const openCreateFolderModal = useCallback(() => {
    modals.openModal({
      title: t('docs_new_folder', 'New folder'),
      size: '420px',
      children: (close) => (
        <NamePromptModal
          initialValue=""
          placeholder={t('docs_folder_name', 'Folder name')}
          submitLabel={t('create', 'Create')}
          closeModal={close}
          onSubmit={async (name) => {
            const target =
              currentFolder === '/' ? `/${name}` : `${currentFolder}/${name}`;
            const res = await fetch('/documents/folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: target }),
            });
            if (!res.ok) {
              const errBody = (await res.json().catch(() => ({}))) as {
                message?: string;
              };
              toaster.show(
                typeof errBody.message === 'string'
                  ? errBody.message
                  : t('docs_folder_failed', 'Could not create folder'),
                'warning'
              );
              return false;
            }
            await mutate();
            return true;
          }}
        />
      ),
    });
  }, [currentFolder, fetch, modals, mutate, t, toaster]);

  const openRenameModal = useCallback(
    (item: DocItemResponse) => {
      const ext = item.type === 'file' ? getExt(item.name) : '';
      modals.openModal({
        title: t('rename', 'Rename'),
        size: '420px',
        children: (close) => (
          <NamePromptModal
            initialValue={item.name}
            placeholder={t('docs_new_name', 'New name')}
            helperText={
              ext
                ? t(
                    'docs_keep_extension',
                    'Keep the .{{ext}} file extension',
                    { ext }
                  )
                : undefined
            }
            submitLabel={t('save', 'Save')}
            closeModal={close}
            onSubmit={async (newName) => {
              const res = await fetch('/documents/rename', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: item.path, newName }),
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
                return false;
              }
              await mutate();
              return true;
            }}
          />
        ),
      });
    },
    [fetch, modals, mutate, t, toaster]
  );

  const handleDelete = useCallback(
    async (item: DocItemResponse) => {
      const confirmed = await deleteDialog(
        t('docs_delete_confirm', 'Are you sure you want to delete this item?'),
        t('delete', 'Delete')
      );
      if (!confirmed) return;
      const res = await fetch(
        `/documents?path=${encodeURIComponent(item.path)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        toaster.show(
          typeof errBody.message === 'string'
            ? errBody.message
            : t('docs_delete_failed', 'Could not delete item'),
          'warning'
        );
        return;
      }
      await mutate();
    },
    [fetch, mutate, t, toaster]
  );

  const openFilePreview = useCallback(
    (item: DocItemResponse) => {
      const fileUrl = `${backendUrl}/documents/file?path=${encodeURIComponent(item.path)}`;
      const downloadUrl = `${fileUrl}&download=true`;
      modals.openModal({
        title: item.name,
        size: '720px',
        children: (close) => (
          <DocPreviewModal
            item={item}
            fileUrl={fileUrl}
            downloadUrl={downloadUrl}
            closeModal={close}
          />
        ),
      });
    },
    [backendUrl, modals]
  );

  return (
    <div
      data-testid="docs-file-manager"
      className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[16px] min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-[12px]">
        <nav
          aria-label={t('docs_breadcrumb', 'Breadcrumb')}
          className="flex flex-wrap items-center gap-[6px] text-[14px] min-w-0"
        >
          <button
            type="button"
            aria-current={breadcrumbs.length === 0 ? 'page' : undefined}
            onClick={() => setCurrentFolder('/')}
            className="px-[8px] py-[4px] rounded-[6px] hover:bg-newBgColor cursor-pointer font-[500]"
          >
            {t('docs_root', 'Root')}
          </button>
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.path}>
              <span className="opacity-40">/</span>
              <button
                type="button"
                aria-current={
                  idx === breadcrumbs.length - 1 ? 'page' : undefined
                }
                onClick={() => setCurrentFolder(crumb.path)}
                title={crumb.label}
                className="px-[8px] py-[4px] rounded-[6px] hover:bg-newBgColor cursor-pointer font-[500] truncate max-w-[160px]"
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </nav>

        <div className="flex items-center gap-[8px]">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUploadInput}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUploadInput}
            {...({
              webkitdirectory: '',
              directory: '',
            } as React.InputHTMLAttributes<HTMLInputElement>)}
          />
          <Button type="button" secondary onClick={openCreateFolderModal}>
            <span className="flex items-center gap-[6px]">
              <PlusIcon />
              {t('docs_new_folder', 'New folder')}
            </span>
          </Button>
          <Button
            type="button"
            secondary
            disabled={uploading}
            onClick={() => folderInputRef.current?.click()}
          >
            {t('docs_upload_folder', 'Upload folder')}
          </Button>
          <Button
            type="button"
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('docs_upload_file', 'Upload file')}
          </Button>
        </div>
      </div>

      <DropFiles
        onDrop={uploadFiles}
        disabled={uploading}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-h-[420px] rounded-[8px] border border-newTableBorder bg-newBgColor p-[16px] overflow-y-auto"
        >
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <LoadingComponent />
            </div>
          ) : loadError ? (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-[8px] text-center text-red-400">
              <div className="text-[15px] font-[500]">
                {t('docs_load_failed', 'Could not load documents.')}
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-[8px] text-center opacity-60">
              <div className="text-[15px] font-[500]">
                {t('docs_empty', 'No documents uploaded yet.')}
              </div>
              <div className="text-[13px]">
                {t(
                  'docs_drop_hint',
                  'Drag and drop files here or use Upload file.'
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-[12px]">
              {items.map((item) => {
                const ext = getExt(item.name);
                const isImage =
                  item.type === 'file' && RASTER_IMAGE_EXTS.has(ext);
                return (
                  <div
                    key={item.id}
                    data-testid="doc-card"
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      item.type === 'folder'
                        ? setCurrentFolder(item.path)
                        : openFilePreview(item)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (item.type === 'folder') {
                          setCurrentFolder(item.path);
                        } else {
                          openFilePreview(item);
                        }
                      }
                    }}
                    className="group relative flex flex-col rounded-[8px] border border-newTableBorder bg-newBgColorInner hover:border-btnPrimary transition-colors cursor-pointer overflow-hidden"
                  >
                    <div className="absolute top-[6px] end-[6px] z-[2] flex sm:hidden sm:group-hover:flex sm:group-focus-within:flex items-center gap-[4px]">
                      <button
                        type="button"
                        aria-label={`${t('rename', 'Rename')} ${item.name}`}
                        title={t('rename', 'Rename')}
                        onClick={(e) => {
                          e.stopPropagation();
                          openRenameModal(item);
                        }}
                        className="p-[5px] rounded-[6px] bg-newBgColor/90 border border-newTableBorder hover:border-btnPrimary text-[12px] cursor-pointer"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label={`${t('delete', 'Delete')} ${item.name}`}
                        title={t('delete', 'Delete')}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item);
                        }}
                        className="p-[5px] rounded-[6px] bg-newBgColor/90 border border-newTableBorder hover:border-red-500 text-red-400 cursor-pointer"
                      >
                        <TrashIcon />
                      </button>
                    </div>

                    <div className="h-[112px] w-full flex items-center justify-center bg-newBgColor border-b border-newTableBorder overflow-hidden">
                      {item.type === 'folder' ? (
                        <svg
                          width="42"
                          height="42"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="text-btnPrimary"
                        >
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                        </svg>
                      ) : isImage ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${backendUrl}/documents/file?path=${encodeURIComponent(item.path)}`}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </>
                      ) : (
                        <span className="px-[10px] py-[4px] rounded-[6px] bg-btnPrimary/15 border border-btnPrimary/30 text-[12px] font-[600] uppercase tracking-wide">
                          {ext || 'FILE'}
                        </span>
                      )}
                    </div>

                    <div className="p-[10px] flex flex-col gap-[2px]">
                      <div
                        className="text-[13px] font-[500] truncate"
                        title={item.name}
                      >
                        {item.name}
                      </div>
                      <div className="text-[11px] opacity-55">
                        {item.type === 'folder'
                          ? t('docs_folder', 'Folder')
                          : formatBytes(item.size)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DropFiles>
    </div>
  );
};
