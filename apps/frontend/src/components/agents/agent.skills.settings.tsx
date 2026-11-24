'use client';

import React, { FC, useState } from 'react';
import type {
  AgentConfigOverrides,
  AgentConfigView,
  SkillDefinition,
} from '@gitroom/helpers/agent/agent.config.schema';
import {
  formSkills,
  removeSkill,
  setSkillEnabled,
  upsertSkill,
} from '@gitroom/frontend/components/agents/agent.settings.state';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const AgentSkillsSettings: FC<{
  view: AgentConfigView;
  overrides: AgentConfigOverrides;
  onChange: (overrides: AgentConfigOverrides) => void;
}> = ({ view, overrides, onChange }) => {
  const t = useT();
  const [editing, setEditing] = useState<SkillDefinition | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const skills = formSkills({ ...view, overrides });

  return (
    <section className="flex flex-col gap-[12px]">
      <header>
        <h3 className="text-[18px] font-[500]" data-agent-section="skills">
          {t('agent_skills_title', 'Skills')}
        </h3>
        <p className="text-[14px] opacity-70">
          {t(
            'agent_skills_hint',
            'The agent loads a skill only when it needs it. Skills are instructions, not executable code.'
          )}
        </p>
      </header>

      {skills.map((skill) => (
        <div
          key={skill.name}
          data-skill={skill.name}
          className="flex flex-col gap-[6px] border border-newTableBorder rounded-[8px] p-[12px]"
        >
          <div className="flex items-center gap-[8px] flex-wrap">
            <strong className="flex-1">{skill.name}</strong>
            <span className="text-[12px] opacity-60">
              {skill.inherited
                ? t('agent_inherited', 'shared')
                : t('agent_local', 'organization')}
            </span>
            {skill.inherited ? (
              <label className="flex items-center gap-[6px] text-[14px]">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(event) =>
                    onChange(
                      setSkillEnabled(
                        view,
                        overrides,
                        skill.name,
                        event.target.checked
                      )
                    )
                  }
                />
                {t('agent_enabled', 'Enabled')}
              </label>
            ) : (
              <div className="flex items-center gap-[8px]">
                <button
                  type="button"
                  className="text-[13px] underline opacity-80 hover:opacity-100"
                  onClick={() => setEditing(skill)}
                >
                  {t('agent_edit', 'Edit')}
                </button>
                <button
                  type="button"
                  className="text-[13px] underline text-red-400 opacity-80 hover:opacity-100"
                  onClick={() => onChange(removeSkill(view, overrides, skill.name))}
                >
                  {t('agent_remove', 'Remove')}
                </button>
              </div>
            )}
          </div>
          <p className="text-[14px] opacity-80">{skill.description}</p>
          <div className="flex items-center gap-[8px] mt-[4px]">
            <button
              type="button"
              className="text-[12px] underline opacity-70 hover:opacity-100"
              onClick={() =>
                setExpanded((prev) => ({
                  ...prev,
                  [skill.name]: !prev[skill.name],
                }))
              }
            >
              {expanded[skill.name]
                ? t('agent_skill_hide_instructions', 'Hide instructions')
                : t('agent_skill_view_instructions', 'View instructions')}
            </button>
          </div>

          {expanded[skill.name] && (
            <div className="mt-[8px] bg-newBgColorInner border border-newTableBorder rounded-[6px] p-[10px]">
              <div className="text-[12px] font-semibold opacity-70 mb-[4px]">
                {t('agent_skill_instructions_preview', 'Instructions:')}
              </div>
              <pre className="text-[13px] whitespace-pre-wrap font-mono opacity-90 max-h-[300px] overflow-auto">
                {skill.instructions}
              </pre>
              {skill.references && Object.keys(skill.references).length > 0 && (
                <div className="mt-[8px] border-t border-newTableBorder pt-[8px]">
                  <div className="text-[12px] font-semibold opacity-70 mb-[4px]">
                    {t('agent_skill_references', 'References:')}
                  </div>
                  <div className="flex flex-col gap-[6px]">
                    {Object.entries(skill.references).map(
                      ([refName, refContent]) => (
                        <details key={refName} className="text-[12px]">
                          <summary className="cursor-pointer font-mono font-medium opacity-80 hover:opacity-100">
                            {refName}
                          </summary>
                          <pre className="mt-[4px] p-[6px] bg-black/10 rounded-[4px] whitespace-pre-wrap font-mono max-h-[200px] overflow-auto">
                            {refContent}
                          </pre>
                        </details>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {editing ? (
        <SkillEditor
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={(skill) => {
            onChange(upsertSkill(overrides, skill));
            setEditing(null);
          }}
        />
      ) : (
        <button
          type="button"
          className="self-start bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px]"
          onClick={() =>
            setEditing({
              name: '',
              description: '',
              instructions: '',
            })
          }
        >
          {t('agent_skill_add', 'Add skill')}
        </button>
      )}
    </section>
  );
};

const SkillEditor: FC<{
  value: SkillDefinition;
  onSave: (skill: SkillDefinition) => void;
  onCancel: () => void;
}> = ({ value, onSave, onCancel }) => {
  const t = useT();
  const [skill, setSkill] = useState(value);
  const isNew = !value.name;
  const valid =
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name) &&
    skill.description.trim().length > 0 &&
    skill.instructions.trim().length > 0;

  return (
    <div className="flex flex-col gap-[8px] border border-newTableBorder rounded-[8px] p-[12px]">
      <input
        disabled={!isNew}
        className={`bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] ${
          !isNew ? 'opacity-60 cursor-not-allowed' : ''
        }`}
        placeholder={t('agent_skill_name', 'Name, lowercase with hyphens')}
        value={skill.name}
        onChange={(event) => setSkill({ ...skill, name: event.target.value })}
      />
      <input
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px]"
        placeholder={t('agent_skill_description', 'When should the agent use it?')}
        value={skill.description}
        onChange={(event) =>
          setSkill({ ...skill, description: event.target.value })
        }
      />
      <textarea
        rows={8}
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px]"
        placeholder={t('agent_skill_instructions', 'Skill instructions (Markdown)')}
        value={skill.instructions}
        onChange={(event) =>
          setSkill({ ...skill, instructions: event.target.value })
        }
      />
      <div className="flex gap-[8px]">
        <button
          type="button"
          disabled={!valid}
          className="bg-btnPrimary text-white rounded-[8px] px-[14px] py-[8px] disabled:opacity-40"
          onClick={() => onSave(skill)}
        >
          {t('agent_apply', 'Apply')}
        </button>
        <button
          type="button"
          className="bg-btnSimple text-btnText rounded-[8px] px-[14px] py-[8px]"
          onClick={onCancel}
        >
          {t('agent_cancel', 'Cancel')}
        </button>
      </div>
    </div>
  );
};
