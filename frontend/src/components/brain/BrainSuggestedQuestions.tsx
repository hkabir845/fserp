'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'

type SuggestedQ = {
  q: string
  label_bn: string
  label_en: string
}

type Props = {
  language?: 'en' | 'bn'
  onSelect: (question: string) => void
  disabled?: boolean
}

export function BrainSuggestedQuestions({ language = 'bn', onSelect, disabled }: Props) {
  const [items, setItems] = useState<SuggestedQ[]>([])

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ questions: SuggestedQ[] }>('/brain/suggested-questions/')
        setItems(res.data.questions || [])
      } catch {
        setItems([
          { q: 'ajker sales koto?', label_bn: 'আজকের বিক্রি', label_en: "Today's sales" },
          { q: 'ke ke taka debe?', label_bn: 'বকেয়া কার?', label_en: 'Who owes?' },
          { q: 'profit trend kemon?', label_bn: 'লাভ ট্রেন্ড', label_en: 'Profit trend' },
        ])
      }
    })()
  }, [])

  const handleClick = useCallback(
    (q: string) => {
      if (!disabled) onSelect(q)
    },
    [disabled, onSelect],
  )

  if (!items.length) return null

  return (
    <div className="mb-3 flex flex-wrap justify-center gap-2">
      {items.slice(0, 6).map((item) => (
        <button
          key={item.q}
          type="button"
          disabled={disabled}
          onClick={() => handleClick(item.q)}
          className="rounded-full border border-indigo-200 bg-indigo-50/80 px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
        >
          {language === 'bn' ? item.label_bn : item.label_en}
        </button>
      ))}
    </div>
  )
}
