'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getSpeechRecognitionCtor,
  isTouchDevice,
  primarySpeechLang,
  speechLangCandidates,
  type SpeechVoiceLang,
} from '@/lib/voiceCapabilities'

export type { SpeechVoiceLang }

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((ev: { error: string; message?: string }) => void) | null
  onresult: ((ev: SpeechRecognitionResultEvent) => void) | null
}

type SpeechRecognitionResultEvent = {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      0: { transcript: string }
    }
  }
}

export function speechLangCode(voiceLang: SpeechVoiceLang): string {
  return primarySpeechLang(voiceLang)
}

export type UseSpeechRecognitionOptions = {
  voiceLang: SpeechVoiceLang
  onInterim?: (text: string) => void
  onFinal?: (text: string) => void
  onEnd?: (finalText: string) => void
  onError?: (code: string) => void
}

const MAX_LISTEN_MS = 45_000

export function useSpeechRecognition({
  voiceLang,
  onInterim,
  onFinal,
  onEnd,
  onError,
}: UseSpeechRecognitionOptions) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const finalBufferRef = useRef('')
  const langIndexRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onInterimRef = useRef(onInterim)
  const onFinalRef = useRef(onFinal)
  const onEndRef = useRef(onEnd)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onInterimRef.current = onInterim
    onFinalRef.current = onFinal
    onEndRef.current = onEnd
    onErrorRef.current = onError
  }, [onInterim, onFinal, onEnd, onError])

  useEffect(() => {
    setSupported(!!getSpeechRecognitionCtor())
  }, [])

  const clearListenTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearListenTimeout()
    recognitionRef.current?.stop()
  }, [clearListenTimeout])

  const attachHandlers = useCallback(
    (recognition: SpeechRecognitionInstance) => {
      recognition.onstart = () => {
        setListening(true)
        clearListenTimeout()
        timeoutRef.current = setTimeout(() => {
          recognitionRef.current?.stop()
        }, MAX_LISTEN_MS)
      }

      recognition.onresult = (event) => {
        let interim = ''
        let finalChunk = ''
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const piece = event.results[i][0]?.transcript?.trim() || ''
          if (!piece) continue
          if (event.results[i].isFinal) {
            finalChunk += (finalChunk ? ' ' : '') + piece
          } else {
            interim += (interim ? ' ' : '') + piece
          }
        }
        if (finalChunk) {
          finalBufferRef.current += (finalBufferRef.current ? ' ' : '') + finalChunk
          onFinalRef.current?.(finalBufferRef.current)
        }
        const display =
          finalBufferRef.current + (interim ? (finalBufferRef.current ? ' ' : '') + interim : '')
        onInterimRef.current?.(display)
      }

      recognition.onerror = (event) => {
        const code = event.error || 'unknown'
        if (code === 'language-not-supported') {
          const candidates = speechLangCandidates(voiceLang)
          const next = langIndexRef.current + 1
          if (next < candidates.length) {
            langIndexRef.current = next
            recognition.lang = candidates[next]
            try {
              recognition.start()
              return
            } catch {
              /* fall through */
            }
          }
        }
        setListening(false)
        clearListenTimeout()
        onErrorRef.current?.(code)
      }

      recognition.onend = () => {
        setListening(false)
        clearListenTimeout()
        const text = finalBufferRef.current.trim()
        onEndRef.current?.(text)
        finalBufferRef.current = ''
      }
    },
    [clearListenTimeout, voiceLang],
  )

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return false

    recognitionRef.current?.abort()
    clearListenTimeout()

    const candidates = speechLangCandidates(voiceLang)
    langIndexRef.current = 0
    finalBufferRef.current = ''

    const recognition = new Ctor() as SpeechRecognitionInstance
    recognition.lang = candidates[0]
    recognition.continuous = isTouchDevice()
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    attachHandlers(recognition)
    recognitionRef.current = recognition

    try {
      recognition.start()
      return true
    } catch {
      setListening(false)
      return false
    }
  }, [attachHandlers, clearListenTimeout, voiceLang])

  useEffect(() => {
    return () => {
      clearListenTimeout()
      recognitionRef.current?.abort()
    }
  }, [clearListenTimeout])

  return { supported, listening, start, stop }
}
