'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import {
  detectVoiceInputMode,
  isSecureVoiceContext,
  pickMediaRecorderMime,
  requestMicrophonePermission,
  type SpeechVoiceLang,
  type VoiceInputMode,
} from '@/lib/voiceCapabilities'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'

export type UseBrainVoiceInputOptions = {
  voiceLang: SpeechVoiceLang
  onText: (text: string) => void
  onAutoSend?: (text: string) => void
  onError?: (code: string) => void
}

const MAX_RECORD_MS = 60_000

export function useBrainVoiceInput({
  voiceLang,
  onText,
  onAutoSend,
  onError,
}: UseBrainVoiceInputOptions) {
  const [mode, setMode] = useState<VoiceInputMode>('none')
  const [transcribing, setTranscribing] = useState(false)
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTextRef = useRef(onText)
  const onAutoSendRef = useRef(onAutoSend)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onTextRef.current = onText
    onAutoSendRef.current = onAutoSend
    onErrorRef.current = onError
  }, [onText, onAutoSend, onError])

  useEffect(() => {
    setMode(detectVoiceInputMode())
  }, [])

  const browser = useSpeechRecognition({
    voiceLang,
    onInterim: (text) => onTextRef.current(text),
    onFinal: (text) => onTextRef.current(text),
    onEnd: (text) => {
      if (text) {
        onTextRef.current(text)
        onAutoSendRef.current?.(text)
      }
    },
    onError: (code) => onErrorRef.current?.(code),
  })

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const clearRecordTimeout = useCallback(() => {
    if (recordTimeoutRef.current) {
      clearTimeout(recordTimeoutRef.current)
      recordTimeoutRef.current = null
    }
  }, [])

  const stopServerRecording = useCallback(async () => {
    clearRecordTimeout()
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      setRecording(false)
      cleanupStream()
      return
    }
    recorder.stop()
  }, [cleanupStream, clearRecordTimeout])

  const uploadAndTranscribe = useCallback(
    async (blob: Blob, mime: string) => {
      setTranscribing(true)
      try {
        const form = new FormData()
        form.append('audio', blob, `voice.${mime.includes('mp4') ? 'm4a' : 'webm'}`)
        form.append('language', voiceLang)
        const res = await api.post<{ transcript: string }>('/brain/transcribe/', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        const text = (res.data?.transcript || '').trim()
        if (text) {
          onTextRef.current(text)
          onAutoSendRef.current?.(text)
        } else {
          onErrorRef.current?.('no-speech')
        }
      } catch {
        onErrorRef.current?.('transcription-failed')
      } finally {
        setTranscribing(false)
        cleanupStream()
      }
    },
    [cleanupStream, voiceLang],
  )

  const startServerRecording = useCallback(async () => {
    const perm = await requestMicrophonePermission()
    if (perm === 'denied') {
      onErrorRef.current?.('not-allowed')
      return false
    }
    if (perm === 'unsupported') {
      onErrorRef.current?.('unsupported')
      return false
    }

    const mime = pickMediaRecorderMime()
    if (!mime) {
      onErrorRef.current?.('unsupported')
      return false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream, { mimeType: mime })
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      recorder.onstop = () => {
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: mime })
        chunksRef.current = []
        mediaRecorderRef.current = null
        if (blob.size > 0) {
          void uploadAndTranscribe(blob, mime)
        } else {
          onErrorRef.current?.('no-speech')
          cleanupStream()
        }
      }
      recorder.onerror = () => {
        setRecording(false)
        onErrorRef.current?.('audio-capture')
        cleanupStream()
      }

      mediaRecorderRef.current = recorder
      recorder.start(250)
      setRecording(true)
      clearRecordTimeout()
      recordTimeoutRef.current = setTimeout(() => {
        void stopServerRecording()
      }, MAX_RECORD_MS)
      return true
    } catch {
      onErrorRef.current?.('not-allowed')
      cleanupStream()
      return false
    }
  }, [cleanupStream, clearRecordTimeout, stopServerRecording, uploadAndTranscribe])

  const start = useCallback(async () => {
    if (!isSecureVoiceContext()) {
      onErrorRef.current?.('insecure-context')
      return false
    }
    if (mode === 'browser') {
      const perm = await requestMicrophonePermission()
      if (perm === 'denied') {
        onErrorRef.current?.('not-allowed')
        return false
      }
      return browser.start()
    }
    if (mode === 'server') {
      return startServerRecording()
    }
    onErrorRef.current?.('unsupported')
    return false
  }, [browser, mode, startServerRecording])

  const stop = useCallback(() => {
    if (mode === 'browser') {
      browser.stop()
      return
    }
    if (mode === 'server') {
      void stopServerRecording()
    }
  }, [browser, mode, stopServerRecording])

  const listening = mode === 'browser' ? browser.listening : recording

  const toggle = useCallback(async () => {
    if (listening || transcribing) {
      stop()
      return
    }
    await start()
  }, [listening, start, stop, transcribing])

  useEffect(() => {
    return () => {
      clearRecordTimeout()
      mediaRecorderRef.current?.stop()
      cleanupStream()
    }
  }, [cleanupStream, clearRecordTimeout])

  const available = mode !== 'none' && isSecureVoiceContext()

  return {
    mode,
    available,
    listening,
    transcribing,
    start,
    stop,
    toggle,
  }
}
