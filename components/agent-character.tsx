"use client";
import { useState } from 'react';
import { VOICES, FOCUSES } from '@/lib/agent-character';
import type { T } from '@/lib/ui';
export default function AgentCharacter({ personality, focus, onChange, t }: { personality: string; focus: string; onChange: (value: { personality: string; focus: string }) => void; t: T }) {
  const [custom, setCustom] = useState({ personality: false, focus: false });
  return <div className="character-section"><div className="agent-field-heading"><div><span className="overline accent">03 / CHARACTER</span><h3>{t('赋予它自己的风格。', 'Give it a point of view.')}</h3></div><span className="developer-tag">{t('可选', 'Optional')}</span></div>
    <p className="character-intro">{t('选择表达风格与关注方向。它们影响判断，不强制执行交易。', 'Shape how it communicates and what it prioritizes. These preferences never force a trade.')}</p>
    <div className="character-columns">{(['personality', 'focus'] as const).map(key => {
      const options = key === 'personality' ? VOICES : FOCUSES, value = key === 'personality' ? personality : focus;
      const editing = custom[key] || (!!value && !options.some(o => o[2] === value));
      const change = (next: string) => onChange({ personality, focus, [key]: next });
      return <fieldset className="character-group" key={key}><legend>{key === 'personality' ? t('表达风格', 'Voice & temperament') : t('关注方向', 'Guiding focus')}</legend><div className="character-options">{options.map(option => <button key={option[1]} type="button" aria-pressed={value === option[2] && !editing} title={option[2]} onClick={() => { setCustom({ ...custom, [key]: false }); change(value === option[2] ? '' : option[2]); }}>{t(option[0], option[1])}</button>)}<button type="button" aria-pressed={editing} onClick={() => { setCustom({ ...custom, [key]: !editing }); change(''); }}>{t('自行定义', 'Write your own')}</button></div>{editing && <label className="form-field character-custom">{key === 'personality' ? t('自定义风格', 'Your agent’s voice') : t('自定义方向', 'Your agent’s priority')}<textarea rows={3} maxLength={300} value={value} onChange={e => change(e.target.value)}/><small>{value.length} / 300</small></label>}<p>{t('可留空；再次点击所选项可清除。', 'Leave open, or click your selection again to clear it.')}</p></fieldset>;
    })}</div></div>;
}
