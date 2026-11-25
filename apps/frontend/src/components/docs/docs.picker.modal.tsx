'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';

export interface SelectedDoc {
  path: string;
  name: string;
}

interface DocListItem {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
}

export const DocsPickerModal: FC<{
  onSelect: (docs: SelectedDoc[]) => void;
  closeModal: () => void;
}> = ({ onSelect, closeModal }) => {
  const fetch = useFetch();
  const t = useT();
  const [selected, setSelected] = useState<SelectedDoc[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/documents?recursive=true');
    if (!res.ok) {
      throw new Error('Failed to load documents');
    }
    const json = (await res.json()) as { items?: DocListItem[] };
    return (json.items ?? []).filter((item) => item.type === 'file');
  }, [fetch]);

  const {
    data: files = [],
    error,
    isLoading,
  } = useSWR<DocListItem[]>('docs-picker-files', load, {
    revalidateOnMount: true,
  });

  const toggle = (item: DocListItem) => {
    setSelected((prev) =>
      prev.some((p) => p.path === item.path)
        ? prev.filter((p) => p.path !== item.path)
        : [...prev, { path: item.path, name: item.name }]
    );
  };

  return (
    <div
      data-testid="docs-picker-modal"
      className="flex flex-col gap-[12px] w-full sm:min-w-[360px] max-h-[480px]"
    >
      <div className="flex-1 overflow-y-auto flex flex-col gap-[6px] border border-newTableBorder rounded-[8px] p-[10px]">
        {isLoading && (
          <div className="text-[14px] opacity-60">{t('loading', 'Loading...')}</div>
        )}
        {!isLoading && error && (
          <div className="text-[14px] text-red-400">
            {t('docs_load_failed', 'Could not load documents.')}
          </div>
        )}
        {!isLoading && !error && files.length === 0 && (
          <div className="text-[14px] opacity-60">
            {t('docs_empty', 'No documents uploaded yet.')}
          </div>
        )}
        {files.map((item) => {
          const isSelected = selected.some((p) => p.path === item.path);
          return (
            <button
              key={item.path}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggle(item)}
              className={`text-left px-[10px] py-[8px] rounded-[6px] border text-[14px] cursor-pointer flex items-center justify-between ${
                isSelected
                  ? 'border-btnPrimary bg-btnPrimary/15'
                  : 'border-transparent hover:bg-newBgColor'
              }`}
            >
              <span className="truncate" title={item.path}>
                {item.path}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-end gap-[8px]">
        <Button type="button" secondary onClick={closeModal}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          disabled={selected.length === 0}
          onClick={() => {
            onSelect(selected);
            closeModal();
          }}
        >
          {t('attach_selected_document', 'Attach selected document')}
        </Button>
      </div>
    </div>
  );
};
