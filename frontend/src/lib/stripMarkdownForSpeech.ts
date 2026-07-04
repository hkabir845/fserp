/** Strip markdown so TTS reads natural speech, not formatting symbols. */
export function stripMarkdownForSpeech(text: string): string {
  let s = text || ''
  s = s.replace(/^#{1,6}\s+/gm, '')
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/`([^`]+)`/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  s = s.replace(/^\|.+\|$/gm, ' ')
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  s = s.replace(/[⚠️🔴🟢📊]/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}
