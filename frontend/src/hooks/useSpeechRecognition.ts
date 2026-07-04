'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type SpeechVoiceLang = 'bn' | 'en'

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

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

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function speechLangCode(voiceLang: SpeechVoiceLang): string {
  return voiceLang === 'bn' ? 'bn-BD' : 'en-US'
}

export type UseSpeechRecognitionOptions = {
  voiceLang: SpeechVoiceLang
  onInterim?: (text: string) => void
  onFinal?: (text: string) => void
  onEnd?: (finalText: string) => void
  onError?: (code: string) => void
}

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

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return false

    recognitionRef.current?.abort()

    const recognition = new Ctor()
    recognition.lang = speechLangCode(voiceLang)
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    finalBufferRef.current = ''

    recognition.onstart = () => setListening(true)

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
      const display = finalBufferRef.current + (interim ? (finalBufferRef.current ? ' ' : '') + interim : '')
      onInterimRef.current?.(display)
    }

    recognition.onerror = (event) => {
      setListening(false)
      onErrorRef.current?.(event.error || 'unknown')
    }

    recognition.onend = () => {
      setListening(false)
      const text = finalBufferRef.current.trim()
      onEndRef.current?.(text)
      finalBufferRef.current = ''
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      return true
    } catch {
      setListening(false)
      return false
    }
  }, [voiceLang])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  return { supported, listening, start, stop }
}
