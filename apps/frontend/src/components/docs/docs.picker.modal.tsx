'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

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
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: DocListItem[] };
    return (json.items ?? []).filter((item) => item.type === 'file');
  }, [fetch]);

  const { data: files = [], isLoading } = useSWR<DocListItem[]>(
    'docs-picker-files',
    load,
    { revalidateOnMount: true }
  );

  const toggle = (item: DocListItem) => {
    setSelected((prev) =>
      prev.some((p) => p.path === item.path)
        ? prev.filter((p) => p.path !== item.path)
        : [...prev, { path: item.path, name: item.name }]
    );
  };

  return (
    <div className="flex flex-col gap-[12px] min-w-[360px] max-h-[480px]">
      <div className="flex-1 overflow-y-auto flex flex-col gap-[6px] border border-newTableBorder rounded-[8px] p-[10px]">
        {isLoading && (
          <div className="text-[14px] opacity-60">{t('loading', 'Loading...')}</div>
        )}
        {!isLoading && files.length === 0 && (
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
              onClick={() => toggle(item)}
              className={`text-left px-[10px] py-[8px] rounded-[6px] border text-[14px] cursor-pointer flex items-center justify-between ${
                isSelected
                  ? 'border-[#612BD3] bg-[#612BD3]/15'
                  : 'border-transparent hover:bg-newBgColor'
              }`}
            >
              <span className="truncate">{item.path}</span>
              <span className="text-[12px] opacity-60 shrink-0 ms-[8px]">
                {item.name}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-end gap-[8px]">
        <button
          type="button"
          onClick={closeModal}
          className="px-[14px] py-[8px] rounded-[8px] border border-newTableBorder text-[14px] cursor-pointer"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => {
            onSelect(selected);
            closeModal();
          }}
          className="px-[14px] py-[8px] rounded-[8px] bg-[#612BD3] text-white text-[14px] disabled:opacity-50 cursor-pointer"
        >
          {t('attach_selected_document', 'Attach selected document')}
        </button>
      </div>
    </div>
  );
};
