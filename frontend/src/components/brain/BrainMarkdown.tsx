'use client'

import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'

/** Render Brain answer_bn markdown (ChatGPT-style) — bold, headings, lists, tables. */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<Fragment key={`${keyPrefix}-t-${i++}`}>{text.slice(last, m.index)}</Fragment>)
    }
    const token = m[0]
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i++}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${i++}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (linkMatch) {
        const [, label, href] = linkMatch
        const external = href.startsWith('http')
        nodes.push(
          external ? (
            <a
              key={`${keyPrefix}-a-${i++}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {label}
            </a>
          ) : (
            <Link
              key={`${keyPrefix}-a-${i++}`}
              href={href}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {label}
            </Link>
          )
        )
      }
    }
    last = m.index + token.length
  }
  if (last < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-t-${i++}`}>{text.slice(last)}</Fragment>)
  }
  return nodes.length ? nodes : [text]
}

function isTableBlock(block: string): boolean {
  const lines = block.trim().split('\n')
  return lines.length >= 2 && lines.every((l) => l.includes('|')) && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(lines[1].trim())
}

function MarkdownTable({ block }: { block: string }) {
  const lines = block.trim().split('\n').filter(Boolean)
  const splitRow = (row: string) =>
    row
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())

  const headers = splitRow(lines[0])
  const rows = lines.slice(2).map(splitRow)

  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[240px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-foreground">
                {renderInline(h, `th-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/60 last:border-0">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-foreground/90">
                  {renderInline(cell, `td-${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MarkdownList({ lines, ordered }: { lines: string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul'
  const className = ordered ? 'list-decimal pl-5 space-y-1.5' : 'list-disc pl-5 space-y-1.5'
  return (
    <Tag className={className}>
      {lines.map((line, i) => {
        const text = ordered
          ? line.replace(/^\d+\.\s+/, '')
          : line.replace(/^[-•*]\s+/, '')
        return (
          <li key={i} className="text-foreground/95">
            {renderInline(text, `li-${i}`)}
          </li>
        )
      })}
    </Tag>
  )
}

function MarkdownBlock({ block }: { block: string }) {
  const trimmed = block.trim()
  if (!trimmed) return null

  if (trimmed === '---' || trimmed === '***') {
    return <hr className="my-3 border-border" />
  }

  if (isTableBlock(trimmed)) {
    return <MarkdownTable block={trimmed} />
  }

  const lines = trimmed.split('\n')

  if (lines[0].startsWith('### ')) {
    return (
      <h3 className="text-sm font-semibold tracking-tight text-foreground mt-1 first:mt-0">
        {renderInline(lines[0].slice(4), 'h3')}
      </h3>
    )
  }
  if (lines[0].startsWith('## ')) {
    return (
      <h2 className="text-base font-semibold tracking-tight text-foreground mt-1 first:mt-0">
        {renderInline(lines[0].slice(3), 'h2')}
      </h2>
    )
  }

  const isBulletList = lines.every((l) => !l.trim() || /^[-•*]\s+/.test(l.trim()))
  if (isBulletList && lines.some((l) => /^[-•*]\s+/.test(l.trim()))) {
    return <MarkdownList lines={lines.filter((l) => l.trim())} />
  }

  const isOrderedList = lines.every((l) => !l.trim() || /^\d+\.\s+/.test(l.trim()))
  if (isOrderedList && lines.some((l) => /^\d+\.\s+/.test(l.trim()))) {
    return <MarkdownList lines={lines.filter((l) => l.trim())} ordered />
  }

  return (
    <p className="text-foreground/95 leading-relaxed">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {renderInline(line, `p-${i}`)}
        </Fragment>
      ))}
    </p>
  )
}

export function BrainMarkdown({ content }: { content: string }) {
  const blocks = content.split(/\n\n+/)
  return (
    <div className="brain-markdown space-y-3 text-sm leading-relaxed [&>*:first-child]:mt-0">
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} block={block} />
      ))}
    </div>
  )
}
