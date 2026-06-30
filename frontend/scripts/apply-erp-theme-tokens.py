#!/usr/bin/env python3
"""Apply shared ERP design-token class replacements to list-style pages."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

SKIP_DIR_NAMES = {".next", "node_modules", "__pycache__", "fonts"}
SKIP_FILE_NAMES = {"globals.css"}


def discover_targets() -> list[str]:
    paths: list[str] = []
    for ext in ("*.tsx", "*.ts"):
        for path in SRC.rglob(ext):
            if any(part in SKIP_DIR_NAMES for part in path.parts):
                continue
            if path.name in SKIP_FILE_NAMES:
                continue
            rel = path.relative_to(ROOT).as_posix()
            paths.append(rel)
    return sorted(set(paths))

TEXT_REPLACEMENTS = [
    ("text-gray-900", "text-foreground"),
    ("text-gray-800", "text-foreground"),
    ("text-gray-700", "text-foreground/85"),
    ("text-gray-600", "text-muted-foreground"),
    ("text-gray-500", "text-muted-foreground"),
    ("text-gray-400", "text-muted-foreground/70"),
    ("text-gray-300", "text-muted-foreground/40"),
    ("text-slate-900", "text-foreground"),
    ("text-slate-800", "text-foreground"),
    ("text-slate-700", "text-foreground/85"),
    ("text-slate-600", "text-muted-foreground"),
    ("text-slate-500", "text-muted-foreground"),
    ("text-slate-400", "text-muted-foreground/70"),
    ("border-gray-300", "border-border"),
    ("border-gray-200", "border-border"),
    ("border-gray-100", "border-border/70"),
    ("border-slate-200/90", "border-border/80"),
    ("border-slate-200", "border-border"),
    ("bg-gray-50", "bg-muted/40"),
    ("bg-gray-100", "bg-muted"),
    ("bg-gray-200", "bg-muted"),
    ("bg-slate-50/80", "bg-muted/50"),
    ("bg-slate-50/50", "bg-muted/40"),
    ("bg-slate-50/90", "bg-muted/50"),
    ("bg-slate-50", "bg-muted/40"),
    ("font-bold text-blue-600", "erp-stat-highlight"),
    ("font-medium text-blue-600 hover:underline", "erp-link hover:underline"),
    ("font-medium text-blue-600 underline decoration-blue-600/30 hover:decoration-blue-600", "font-medium text-primary underline decoration-primary/30 hover:decoration-primary"),
    ("bg-indigo-600 text-white", "bg-primary text-primary-foreground"),
    ("border-t-teal-600", "border-t-primary"),
    ("text-teal-600", "text-primary"),
    ("text-teal-700", "text-primary"),
    ("text-teal-900", "text-primary"),
    ("hover:border-teal-300", "hover:border-primary/30"),
    ("hover:bg-teal-50", "hover:bg-accent"),
    ("hover:text-teal-900", "hover:text-accent-foreground"),
    ("focus-visible:outline-teal-600", "focus-visible:outline-ring"),
    ("ring-teal-500/25", "ring-primary/20"),
    ("border-teal-300", "border-primary/35"),
    ("border-teal-200", "border-primary/25"),
    ("bg-teal-50", "bg-accent"),
    ("text-indigo-600", "text-primary"),
    ("text-indigo-800", "text-primary"),
    ("text-indigo-950", "text-foreground"),
    ("text-indigo-900/80", "text-foreground/80"),
    ("text-indigo-900", "text-foreground/85"),
    ("border-indigo-200", "border-primary/25"),
    ("border-indigo-100", "border-primary/15"),
    ("bg-indigo-50/40", "bg-accent/60"),
    ("bg-indigo-50", "bg-accent"),
    ("bg-indigo-100", "bg-accent"),
    ("from-indigo-50", "from-accent"),
    ("to-indigo-50", "to-accent"),
    ("divide-slate-100", "divide-border/70"),
    ("divide-gray-200", "divide-border"),
    ("border-slate-100", "border-border/70"),
    ("border-blue-200", "border-primary/25"),
    ("from-blue-50", "from-accent"),
    ("to-blue-50", "to-accent"),
    ("text-blue-600", "text-primary"),
    ("hover:text-blue-800", "hover:text-primary/80"),
    ("hover:bg-blue-50", "hover:bg-accent"),
    ("focus:ring-blue-500", "focus:ring-ring"),
    ("bg-green-100", "bg-success/15"),
    ("text-green-800", "text-success"),
    ("disabled:bg-gray-400", "disabled:opacity-50"),
    ("ring-slate-200", "ring-border"),
    ("text-blue-700", "text-primary"),
    ("text-blue-800", "text-primary"),
    ("hover:text-blue-700", "hover:text-primary/90"),
    ("bg-blue-600", "bg-primary"),
    ("bg-blue-700", "bg-primary"),
    ("hover:bg-blue-700", "hover:bg-primary/90"),
    ("hover:bg-indigo-700", "hover:bg-primary/90"),
    ("hover:bg-indigo-500", "hover:bg-primary/90"),
    ("bg-indigo-700", "bg-primary"),
    ("bg-indigo-500", "bg-primary"),
    ("border-amber-200", "border-warning/30"),
    ("bg-amber-50", "bg-warning/10"),
    ("text-amber-950", "text-warning-foreground"),
    ("text-amber-900", "text-warning-foreground"),
    ("text-amber-800", "text-warning-foreground"),
    ("text-amber-700", "text-warning-foreground"),
    ("bg-red-50", "bg-destructive/5"),
    ("border-red-200", "border-destructive/25"),
    ("border-red-300", "border-destructive/30"),
    ("text-red-600", "text-destructive"),
    ("text-red-700", "text-destructive"),
    ("text-red-800", "text-destructive"),
    ("bg-red-100", "bg-destructive/10"),
    ("hover:bg-red-50", "hover:bg-destructive/10"),
    ("hover:bg-red-100", "hover:bg-destructive/10"),
    ("hover:bg-red-700", "hover:bg-destructive/90"),
    ("bg-red-600", "bg-destructive"),
    ("bg-green-600", "bg-success"),
    ("hover:bg-green-700", "hover:bg-success/90"),
    ("text-green-600", "text-success"),
    ("text-green-700", "text-success"),
    ("border-green-200", "border-success/25"),
    ("bg-teal-600", "bg-primary"),
    ("bg-teal-700", "bg-primary"),
    ("hover:bg-teal-800", "hover:bg-primary/90"),
    ("hover:bg-teal-500", "hover:bg-primary/90"),
    ("border-slate-300", "border-border"),
    ("focus:ring-green-500", "focus:ring-success"),
    ("focus:ring-yellow-500", "focus:ring-warning"),
    ("focus:ring-indigo-500", "focus:ring-ring"),
    ("focus:border-transparent", "focus:border-ring"),
    ("hover:text-gray-800", "hover:text-foreground"),
    ("hover:bg-gray-50", "hover:bg-muted"),
    ("hover:bg-gray-100", "hover:bg-muted"),
    ("bg-gray-600", "bg-muted-foreground"),
    ("bg-gray-700", "bg-muted-foreground"),
    ("bg-gray-800", "bg-foreground"),
    ("bg-gray-900", "bg-foreground"),
    ("hover:bg-gray-700", "hover:bg-muted-foreground/90"),
    ("hover:bg-gray-900", "hover:bg-foreground/90"),
    ("bg-slate-100", "bg-muted"),
    ("bg-slate-900", "bg-foreground"),
    ("hover:bg-slate-800", "hover:bg-foreground/90"),
    ("hover:bg-slate-100", "hover:bg-muted"),
    ("text-slate-300", "text-muted-foreground/40"),
    ("divide-gray-100", "divide-border/70"),
    ("divide-slate-200", "divide-border"),
    ("from-gray-50", "from-muted/40"),
    ("to-gray-100", "to-muted"),
    ("from-slate-50", "from-muted/40"),
    ("to-white", "to-card"),
    ("bg-indigo-200", "bg-accent"),
    ("bg-indigo-600", "bg-primary"),
    ("border-indigo-300", "border-primary/30"),
    ("border-indigo-600", "border-primary"),
    ("focus:border-indigo-500", "focus:border-ring"),
    ("focus:border-indigo-400", "focus:border-ring"),
    ("ring-indigo-500/30", "ring-primary/30"),
    ("text-indigo-700", "text-primary"),
    ("to-indigo-100", "to-accent"),
    ("disabled:bg-slate-100", "disabled:bg-muted"),
    ("border-gray-50", "border-border/50"),
    ("border-b-2 border-blue-600", "border-b-2 border-primary"),
    ("hover:bg-white/80", "hover:bg-card/80"),
    ("text-teal-800", "text-primary"),
    ("operator: 'bg-teal-100 text-teal-800'", "operator: 'bg-accent text-primary'"),
    ("hover:bg-slate-200", "hover:bg-muted"),
    ("hover:bg-slate-200/80", "hover:bg-muted/80"),
    ("bg-slate-200", "bg-muted"),
    ("bg-slate-300", "bg-muted"),
    ("bg-slate-400", "bg-muted-foreground/50"),
    ("bg-slate-600", "bg-muted-foreground"),
    ("bg-slate-800", "bg-foreground"),
    ("bg-gray-300", "bg-muted"),
    ("bg-gray-400", "bg-muted-foreground/50"),
    ("hover:bg-gray-300", "hover:bg-muted"),
    ("hover:bg-gray-400", "hover:bg-muted-foreground/50"),
    ("border-slate-50", "border-border/50"),
    ("hover:border-gray-400", "hover:border-border"),
    ("hover:border-slate-400", "hover:border-border"),
    ("ring-indigo-500/0", "ring-primary/0"),
    ("focus-visible:ring-indigo-500", "focus-visible:ring-ring"),
    ("from-indigo-600", "from-[hsl(var(--hero-from))]"),
    ("via-indigo-700", "via-[hsl(var(--hero-via))]"),
    ("to-slate-900", "to-[hsl(var(--hero-from))]"),
    ("text-slate-200", "text-white/85"),
    ("border-gray-400", "border-border"),
]

REPLACEMENTS: list[tuple[str, str]] = [
    ('PageLayout className="bg-slate-50"', "PageLayout"),
    (
        'className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"',
        'className="erp-btn-cta"',
    ),
    (
        'className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-colors font-medium shadow-sm shrink-0 disabled:cursor-not-allowed disabled:bg-slate-500/50 disabled:hover:bg-slate-500/50"',
        'className="erp-btn-cta shrink-0 disabled:cursor-not-allowed disabled:opacity-50"',
    ),
    (
        'className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm"',
        'className="erp-field pl-10 shadow-sm"',
    ),
    (
        'className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"',
        'className="erp-field pl-10"',
    ),
    (
        'className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"',
        'className="erp-field w-auto min-w-[12rem]"',
    ),
    (
        'className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"',
        'className="erp-btn-cta"',
    ),
    (
        'className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:cursor-not-allowed disabled:bg-gray-300"',
        'className="erp-btn-cta disabled:cursor-not-allowed disabled:opacity-50"',
    ),
    (
        'className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"',
        'className="erp-btn-primary"',
    ),
    (
        'className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"',
        'className="erp-btn-primary"',
    ),
    (
        'className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"',
        'className="erp-btn-secondary"',
    ),
    (
        'className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"',
        'className="erp-btn-secondary-lg"',
    ),
    (
        'className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"',
        'className="erp-btn-danger"',
    ),
    (
        'className="px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors"',
        'className="erp-btn-danger"',
    ),
    (
        "station.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'",
        "station.is_active ? 'erp-badge--success' : 'erp-badge--danger'",
    ),
    (
        "dispenser.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'",
        "dispenser.is_active ? 'erp-badge--success' : 'erp-badge--danger'",
    ),
    (
        "meter.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'",
        "meter.is_active ? 'erp-badge--success' : 'erp-badge--danger'",
    ),
    (
        "tank.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'",
        "tank.is_active ? 'erp-badge--success' : 'erp-badge--danger'",
    ),
    (
        "island.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'",
        "island.is_active ? 'erp-badge--success' : 'erp-badge--danger'",
    ),
    (
        'className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"',
        'className="erp-icon-btn-primary"',
    ),
    (
        'className="p-2 text-blue-600 hover:bg-blue-50 rounded"',
        'className="erp-icon-btn-primary"',
    ),
    (
        'className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"',
        'className="erp-icon-btn-danger"',
    ),
    (
        'className="p-2 text-red-600 hover:bg-red-50 rounded"',
        'className="erp-icon-btn-danger"',
    ),
    (
        'className="text-sm text-blue-600 hover:text-blue-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"',
        'className="erp-link"',
    ),
    (
        'className="text-sm text-blue-600 hover:text-blue-800 font-medium"',
        'className="erp-link"',
    ),
    (
        'className={`${fontSize.label} text-blue-600 hover:text-blue-800 font-medium`}',
        'className={`erp-link ${fontSize.label}`}',
    ),
    (
        'className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"',
        'className="erp-loading-spinner h-12 w-12"',
    ),
    (
        'className="bg-white rounded-lg shadow p-12 text-center"',
        'className="erp-empty-state"',
    ),
    (
        'className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center"',
        'className="erp-empty-state"',
    ),
    (
        'className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"',
        'className="erp-alert-warning mb-6"',
    ),
    (
        'className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"',
        'className="erp-modal-backdrop"',
    ),
    (
        'className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"',
        'className="erp-modal-backdrop"',
    ),
    (
        'className="bg-white rounded-lg app-modal-pad max-w-2xl w-full"',
        'className="erp-modal max-w-2xl"',
    ),
    (
        'className="bg-white rounded-xl shadow-xl app-modal-pad max-w-2xl w-full max-h-[90vh] overflow-y-auto"',
        'className="erp-modal max-w-2xl"',
    ),
    (
        'className="bg-white rounded-lg app-modal-pad max-w-md w-full"',
        'className="erp-modal max-w-md"',
    ),
    (
        'className="bg-white rounded-xl shadow-xl app-modal-pad max-w-md w-full"',
        'className="erp-modal max-w-md"',
    ),
    (
        'className="block text-sm font-medium text-gray-700 mb-2"',
        'className="mb-2 block text-sm font-medium text-foreground"',
    ),
    (
        'className="block text-sm font-medium text-gray-700 mb-1.5"',
        'className="mb-1.5 block text-sm font-medium text-foreground"',
    ),
    (
        'className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"',
        'className="erp-field"',
    ),
    (
        'className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"',
        'className="erp-field"',
    ),
    (
        'className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"',
        'className="erp-field"',
    ),
    (
        'className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"',
        'className="rounded border-input text-primary focus:ring-ring"',
    ),
    (
        'className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"',
        'className="rounded border-input text-primary focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"',
    ),
    (
        'className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"',
        'className="h-4 w-4 rounded border-input text-primary focus:ring-ring"',
    ),
    (
        'className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"',
        'className="rounded border-input text-primary focus:ring-ring"',
    ),
    (
        'className="text-2xl font-bold mb-6"',
        'className="mb-6 text-2xl font-bold text-foreground"',
    ),
    (
        'className="text-2xl font-bold text-gray-900 mb-6"',
        'className="mb-6 text-2xl font-bold text-foreground"',
    ),
    (
        'className="text-2xl font-bold mb-4 text-red-600"',
        'className="mb-4 text-2xl font-bold text-destructive"',
    ),
    (
        'className="text-xl font-bold text-red-600 mb-4"',
        'className="mb-4 text-xl font-bold text-destructive"',
    ),
    (
        'className="text-gray-700 mb-6"',
        'className="mb-6 text-foreground/85"',
    ),
    (
        'className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"',
        'className="erp-surface mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"',
    ),
    (
        'className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"',
        'className="erp-alert-warning mb-4"',
    ),
    (
        'className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5"',
        'className="erp-panel"',
    ),
    (
        'className="group flex flex-col items-center rounded-2xl border border-slate-200/90 bg-slate-50/50 p-4 text-center transition hover:border-teal-300 hover:bg-white hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"',
        'className="erp-quick-app-tile"',
    ),
    (
        'className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white px-5 py-4 shadow-sm transition hover:border-teal-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"',
        'className="erp-action-card max-w-none px-5 py-4"',
    ),
    (
        'className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900"',
        'className="erp-btn-secondary inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5"',
    ),
    (
        'className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"',
        'className="erp-panel"',
    ),
    (
        'className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2"',
        'className="erp-panel lg:col-span-2"',
    ),
    (
        'className={`flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 ${fontSize.label}`}',
        'className={`erp-btn-primary flex-1 ${fontSize.label}`}',
    ),
    (
        'className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500"',
        'className="erp-field"',
    ),
    (
        'className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5"',
        'className="erp-search-icon"',
    ),
    (
        'className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"',
        'className="erp-btn-primary px-6 py-2 font-medium"',
    ),
    (
        'className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"',
        'className="erp-btn-primary flex items-center space-x-2 transition-colors"',
    ),
    (
        'className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"',
        'className="erp-btn-primary transition-colors"',
    ),
    (
        'className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"',
        'className="erp-btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"',
    ),
    (
        'className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"',
        'className="erp-btn-primary mt-3 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"',
    ),
    (
        'className="w-full bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition-colors"',
        'className="erp-btn-success-lg flex items-center justify-center space-x-2"',
    ),
    (
        'className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"',
        'className="erp-btn-success-lg flex-1"',
    ),
    (
        'className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"',
        'className="erp-alert-warning mb-4"',
    ),
    (
        'className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"',
        'className="erp-alert-warning"',
    ),
    (
        'className="mb-6 rounded-xl border-2 border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-5 shadow-sm scroll-mt-4"',
        'className="erp-callout-primary mb-6 scroll-mt-4"',
    ),
    (
        'className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl"',
        'className="erp-hero-strip"',
    ),
    (
        'className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 mb-6 border border-blue-200"',
        'className="erp-callout-primary mb-6 rounded-lg p-6"',
    ),
    (
        'className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900"',
        'className="erp-badge erp-badge--warning inline-flex items-center gap-1 px-2 py-0.5 text-[11px]"',
    ),
    (
        'className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800"',
        'className="erp-badge erp-badge--success px-2 py-0.5 text-xs"',
    ),
    (
        'className="bg-white rounded-xl border border-border shadow-sm p-6 animate-pulse"',
        'className="erp-surface animate-pulse p-6"',
    ),
    (
        'className="bg-white rounded-xl border border-border shadow-sm p-6 animate-pulse h-56"',
        'className="erp-surface h-56 animate-pulse p-6"',
    ),
    (
        'className="bg-white rounded-lg shadow p-6 border border-slate-100"',
        'className="erp-surface p-6"',
    ),
    (
        'className="flex-1 text-xs text-blue-600 hover:text-blue-800 font-medium mr-2"',
        'className="erp-link mr-2 flex-1 text-xs"',
    ),
    (
        'className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"',
        'className="erp-icon-btn-primary p-1.5"',
    ),
    (
        'className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"',
        'className="erp-btn-primary rounded-md px-4 py-2.5 text-sm font-medium"',
    ),
    (
        'className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"',
        'className="erp-btn-secondary flex items-center space-x-2 bg-muted-foreground text-primary-foreground transition-colors"',
    ),
    (
        'className="w-full py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"',
        'className="erp-btn-primary w-full py-2"',
    ),
    (
        'className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 sm:w-auto sm:min-w-[10rem]"',
        'className="erp-btn-primary w-full rounded-lg py-2.5 text-sm font-semibold shadow-sm sm:w-auto sm:min-w-[10rem]"',
    ),
    (
        'className="min-w-[12rem] rounded-md border border-cyan-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"',
        'className="erp-field min-w-[12rem] rounded-md px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-muted"',
    ),
]

REGEX_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r'className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-6 flex flex-col"'
        ),
        'className="erp-surface-interactive flex flex-col p-6"',
    ),
    (
        re.compile(
            r'className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6"'
        ),
        'className="erp-surface-interactive p-6"',
    ),
    (
        re.compile(
            r'className=\{\`bg-white rounded-xl border-2 border-gray-200 shadow hover:shadow-lg transition-shadow \$\{cardPadding\}\`\}'
        ),
        'className={`erp-surface-interactive border-2 ${cardPadding}`}',
    ),
    (
        re.compile(r'className="p-3 bg-blue-100 rounded-lg shrink-0"'),
        'className="erp-metric-icon erp-metric-icon--info h-12 w-12 shrink-0"',
    ),
    (
        re.compile(r'className="p-3 bg-purple-100 rounded-lg"'),
        'className="erp-metric-icon erp-metric-icon--accent h-12 w-12"',
    ),
    (
        re.compile(r'className="p-3 bg-green-100 rounded-lg"'),
        'className="erp-metric-icon erp-metric-icon--success h-12 w-12"',
    ),
    (
        re.compile(r'<Building2 className="h-6 w-6 text-blue-600" />'),
        '<Building2 className="h-6 w-6" />',
    ),
    (
        re.compile(r'<Zap className=\{\`\$\{fontSize\.icon\} text-green-600\`\} />'),
        '<Zap className={`${fontSize.icon}`} />',
    ),
    (
        re.compile(r'className="p-3 bg-indigo-100 rounded-lg"'),
        'className="erp-metric-icon erp-metric-icon--primary h-12 w-12"',
    ),
    (
        re.compile(r'<Gauge className=\{\`\$\{fontSize\.icon\} text-indigo-600\`\} />'),
        '<Gauge className={`${fontSize.icon}`} />',
    ),
]


def transform(content: str) -> str:
    for old, new in REPLACEMENTS:
        content = content.replace(old, new)
    for old, new in TEXT_REPLACEMENTS:
        content = content.replace(old, new)
    for pattern, repl in REGEX_REPLACEMENTS:
        content = pattern.sub(repl, content)
    return content


def main() -> int:
    targets = discover_targets()
    changed = 0
    for rel in targets:
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        updated = transform(original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            changed += 1
            print(f"updated: {rel}")
    print(f"done ({changed}/{len(targets)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
