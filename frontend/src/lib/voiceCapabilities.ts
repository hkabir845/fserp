/** Voice input capability detection — Web Speech API + MediaRecorder fallback. */

export type SpeechVoiceLang = 'bn' | 'en'

/** Minimal Web Speech API shape — DOM lib does not ship SpeechRecognition in all TS configs. */
type BrowserSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition

export function isSecureVoiceContext(): boolean {
  if (typeof window === 'undefined') return false
  return window.isSecureContext === true
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function speechLangCandidates(voiceLang: SpeechVoiceLang): string[] {
  if (voiceLang === 'bn') {
    return ['bn-BD', 'bn-IN', 'bn']
  }
  return ['en-US', 'en-GB', 'en-IN', 'en']
}

export function primarySpeechLang(voiceLang: SpeechVoiceLang): string {
  return speechLangCandidates(voiceLang)[0]
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  )
}

export function pickMediaRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return undefined
}

export function canUseMediaRecorder(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    !!pickMediaRecorderMime()
  )
}

export type VoiceInputMode = 'browser' | 'server' | 'none'

export function detectVoiceInputMode(): VoiceInputMode {
  if (!isSecureVoiceContext()) return 'none'
  if (getSpeechRecognitionCtor()) return 'browser'
  if (canUseMediaRecorder()) return 'server'
  return 'none'
}

export async function requestMicrophonePermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unsupported'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch (err) {
    const name = (err as DOMException)?.name || ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied'
    return 'unsupported'
  }
}

export function canUseSpeechSynthesis(): boolean {
  if (typeof window === 'undefined') return false
  return isSecureVoiceContext() && 'speechSynthesis' in window
}

export function pickSpeechVoice(voiceLang: SpeechVoiceLang): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  const candidates = speechLangCandidates(voiceLang)
  for (const lang of candidates) {
    const match = voices.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()))
    if (match) return match
  }

  if (voiceLang === 'bn') {
    const bnVoice = voices.find((v) => /bn|beng|bangla|bangladesh/i.test(`${v.lang} ${v.name}`))
    if (bnVoice) return bnVoice
  }

  const enVoice = voices.find((v) => v.lang.toLowerCase().startsWith('en'))
  return enVoice || voices[0] || null
}

