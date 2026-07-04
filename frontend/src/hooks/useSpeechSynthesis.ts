'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { stripMarkdownForSpeech } from '@/lib/stripMarkdownForSpeech'
import {
  canUseSpeechSynthesis,
  pickSpeechVoice,
  primarySpeechLang,
  type SpeechVoiceLang,
} from '@/lib/voiceCapabilities'

const MAX_SPEECH_CHARS = 4000

export function useSpeechSynthesis(voiceLang: SpeechVoiceLang) {
  const [supported, setSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [speakingMessageId, setSpeakingMessageId] = useState<number | null>(null)
  const voicesReadyRef = useRef(false)

  useEffect(() => {
    setSupported(canUseSpeechSynthesis())
    if (typeof window === 'undefined' || !window.speechSynthesis) return

    const primeVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) voicesReadyRef.current = true
    }
    primeVoices()
    window.speechSynthesis.addEventListener('voiceschanged', primeVoices)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', primeVoices)
      window.speechSynthesis.cancel()
    }
  }, [])

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setSpeaking(false)
    setSpeakingMessageId(null)
  }, [])

  const speak = useCallback(
    (text: string, messageId?: number) => {
      if (!canUseSpeechSynthesis()) return false

      const plain = stripMarkdownForSpeech(text).slice(0, MAX_SPEECH_CHARS)
      if (!plain) return false

      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(plain)
      utterance.lang = primarySpeechLang(voiceLang)
      const voice = pickSpeechVoice(voiceLang)
      if (voice) utterance.voice = voice
      utterance.rate = 1
      utterance.pitch = 1

      utterance.onstart = () => {
        setSpeaking(true)
        setSpeakingMessageId(messageId ?? null)
      }
      utterance.onend = () => {
        setSpeaking(false)
        setSpeakingMessageId(null)
      }
      utterance.onerror = () => {
        setSpeaking(false)
        setSpeakingMessageId(null)
      }

      window.speechSynthesis.speak(utterance)
      return true
    },
    [voiceLang],
  )

  return { supported, speaking, speakingMessageId, speak, stop }
}
