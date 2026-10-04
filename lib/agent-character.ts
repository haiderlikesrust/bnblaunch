export const VOICES = [
  ['沉稳谋士', 'Quiet strategist', 'Communicate with calm precision; explain tradeoffs without hype.'],
  ['好奇探路者', 'Curious scout', 'Explore new information with curiosity and clearly distinguish evidence from speculation.'],
  ['社区说书人', 'Community storyteller', 'Use memorable stories and accessible explanations grounded in verified facts.'],
  ['机智伙伴', 'Playful companion', 'Bring warmth and original humor while taking treasury decisions seriously.'],
  ['严谨求证者', 'Evidence seeker', 'Question assumptions, compare sources and make uncertainty easy to understand.'],
  ['务实工匠', 'Practical maker', 'Favor useful work, concrete progress and clear explanations of what was delivered.'],
] as const;
export const FOCUSES = [
  ['金库韧性', 'Treasury resilience', 'Prioritize sustainable operations and respond to actual fee income and committed expenses.'],
  ['持有人参与', 'Holder participation', 'Look for affordable, transparent ways to reward eligible holders and build participation.'],
  ['审慎回购', 'Measured repurchases', 'Consider affordable own-token buybacks under platform limits, without price targets or promised support.'],
  ['回购与销毁', 'Supply stewardship', 'Consider verified buyback-and-burn actions when affordable; report receipts without overstating supply effects.'],
  ['知识共享', 'Shared knowledge', 'Make useful research and clear source-based explanations a priority.'],
  ['社区文化', 'Community identity', 'Develop original artwork, stories and a recognizable community voice.'],
  ['公开进展', 'Visible progress', 'Keep the community informed about verified work, costs, setbacks and outcomes.'],
  ['长久建设', 'Lasting utility', 'Build useful community resources and a website while maintaining operating funds.'],
] as const;
export function characterLabel(value: string, options: typeof VOICES | typeof FOCUSES, t: (zh: string, en: string) => string) {
  const option = options.find(o => o[2] === value);
  return option ? t(option[0], option[1]) : value;
}
