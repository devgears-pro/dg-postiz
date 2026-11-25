'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { AgentMemoryView } from '@gitroom/helpers/agent/agent.config.schema';

export const AgentMemorySettings: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const user = useUser();
  const orgId = user?.orgId;

  const load = useCallback(
    async () => (await fetch('/agent-config/memory')).json(),
    [fetch]
  );

  const { data, mutate, isLoading } = useSWR<AgentMemoryView>(
    orgId ? ['agent-config-memory', orgId] : null,
    load,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const proverbs = data?.proverbs ?? [];
  const [isFolded, setIsFolded] = useState(true);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [newText, setNewText] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const saveMemory = async (next: string[]) => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/agent-config/memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proverbs: next }),
      });
      if (!response.ok) {
        setStatus({
          kind: 'error',
          text: t('agent_memory_save_error', 'Could not save memory.'),
        });
        return;
      }
      await mutate({ proverbs: next }, { revalidate: true });
      setStatus({ kind: 'ok', text: t('agent_memory_saved', 'Memory updated.') });
    } catch {
      setStatus({
        kind: 'error',
        text: t('agent_memory_save_error', 'Could not save memory.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditingText(proverbs[index] ?? '');
  };

  const handleSaveEdit = async () => {
    if (editingIndex === null) return;
    const trimmed = editingText.trim();
    if (!trimmed) return;
    const next = [...proverbs];
    next[editingIndex] = trimmed;
    setEditingIndex(null);
    await saveMemory(next);
  };

  const handleDelete = async (index: number) => {
    const next = proverbs.filter((_, i) => i !== index);
    if (editingIndex === index) {
      setEditingIndex(null);
    }
    await saveMemory(next);
  };

  const handleAdd = async () => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    const next = [...proverbs, trimmed];
    setNewText('');
    setIsAdding(false);
    await saveMemory(next);
  };

  const handleClear = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch('/agent-config/memory', {
        method: 'DELETE',
      });
      if (!response.ok) {
        setStatus({
          kind: 'error',
          text: t('agent_memory_clear_error', 'Could not clear memory.'),
        });
        return;
      }
      await mutate({ proverbs: [] }, { revalidate: true });
      setEditingIndex(null);
      setStatus({ kind: 'ok', text: t('agent_memory_cleared', 'Memory cleared.') });
    } catch {
      setStatus({
        kind: 'error',
        text: t('agent_memory_clear_error', 'Could not clear memory.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-[12px]">
      <header>
        <h3 className="text-[18px] font-[500]" data-agent-section="memory">
          {t('agent_memory_title', 'Working memory')}
        </h3>
        <p className="text-[14px] opacity-70">
          {t(
            'agent_memory_hint',
            'Fact-based memory accumulated by the assistant across conversations. You can review, edit, add, or clear remembered facts.'
          )}
        </p>
      </header>

      {status && (
        <div
          className={`text-[14px] p-[8px] rounded-[6px] ${
            status.kind === 'ok'
              ? 'bg-green-500/10 text-green-500'
              : 'bg-red-500/10 text-red-500'
          }`}
        >
          {status.text}
        </div>
      )}

      {isLoading ? (
        <div className="text-[14px] opacity-60">{t('loading', 'Loading...')}</div>
      ) : proverbs.length === 0 && !isAdding ? (
        <div className="text-[14px] opacity-60 p-[12px] border border-newTableBorder rounded-[8px]">
          {t('agent_memory_empty', 'No memory items recorded yet.')}
        </div>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {proverbs.length > 0 && !isAdding && editingIndex === null && (
            <div className="flex items-center justify-between p-[10px] bg-newBgColorInner border border-newTableBorder rounded-[8px]">
              <span className="text-[13px] opacity-80">
                {t('agent_memory_count', 'Saved facts: {{count}}', {
                  count: proverbs.length,
                })}
              </span>
              <button
                type="button"
                className="text-[13px] underline opacity-80 hover:opacity-100"
                onClick={() => setIsFolded(!isFolded)}
              >
                {isFolded
                  ? t('agent_memory_show', 'Show facts')
                  : t('agent_memory_hide', 'Hide facts')}
              </button>
            </div>
          )}

          {(!isFolded || editingIndex !== null || isAdding) &&
            proverbs.map((item, index) => (
              <div
                key={index}
                className="flex flex-col gap-[8px] border border-newTableBorder rounded-[8px] p-[12px]"
              >
                {editingIndex === index ? (
                  <div className="flex flex-col gap-[8px]">
                    <textarea
                      rows={3}
                      className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[14px]"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                    />
                    <div className="flex gap-[8px]">
                      <button
                        type="button"
                        disabled={saving || !editingText.trim()}
                        className="bg-btnPrimary text-white rounded-[8px] px-[12px] py-[6px] text-[13px] disabled:opacity-40"
                        onClick={handleSaveEdit}
                      >
                        {t('agent_save', 'Save')}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        className="bg-btnSimple text-btnText rounded-[8px] px-[12px] py-[6px] text-[13px]"
                        onClick={() => setEditingIndex(null)}
                      >
                        {t('agent_cancel', 'Cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-[8px] justify-between">
                    <p className="text-[14px] flex-1 whitespace-pre-wrap">{item}</p>
                    <div className="flex items-center gap-[8px] shrink-0">
                      <button
                        type="button"
                        disabled={saving}
                        className="text-[13px] underline opacity-80 hover:opacity-100"
                        onClick={() => handleEdit(index)}
                      >
                        {t('agent_edit', 'Edit')}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        className="text-[13px] underline text-red-400 opacity-80 hover:opacity-100"
                        onClick={() => handleDelete(index)}
                      >
                        {t('agent_remove', 'Remove')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {isAdding ? (
        <div className="flex flex-col gap-[8px] border border-newTableBorder rounded-[8px] p-[12px]">
          <textarea
            rows={3}
            className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[14px]"
            placeholder={t(
              'agent_memory_add_placeholder',
              'Enter a rule or fact to remember (e.g. Always respond in Ukrainian)'
            )}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
          />
          <div className="flex gap-[8px]">
            <button
              type="button"
              disabled={saving || !newText.trim()}
              className="bg-btnPrimary text-white rounded-[8px] px-[12px] py-[6px] text-[13px] disabled:opacity-40"
              onClick={handleAdd}
            >
              {t('agent_save', 'Save')}
            </button>
            <button
              type="button"
              disabled={saving}
              className="bg-btnSimple text-btnText rounded-[8px] px-[12px] py-[6px] text-[13px]"
              onClick={() => {
                setIsAdding(false);
                setNewText('');
              }}
            >
              {t('agent_cancel', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-[12px] flex-wrap">
          <button
            type="button"
            disabled={saving}
            className="bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px] text-[14px]"
            onClick={() => {
              setIsAdding(true);
              setIsFolded(false);
            }}
          >
            {t('agent_memory_add_button', 'Add fact')}
          </button>
          {proverbs.length > 0 && (
            <button
              type="button"
              disabled={saving}
              className="text-[13px] underline text-red-400 opacity-80 hover:opacity-100"
              onClick={handleClear}
            >
              {t('agent_memory_clear_all', 'Clear all memory')}
            </button>
          )}
        </div>
      )}
    </section>
  );
};
