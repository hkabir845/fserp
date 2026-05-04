import api from '@/lib/api'

export type PolicyBannerState = { title: string; lines: string[] }

export function bannerFromDeleteResponse(data: unknown): PolicyBannerState {
  const d = data as {
    detail?: string
    rollback?: { gl?: string; subledger?: string; documents?: string }
  }
  const rb = d?.rollback
  const lines = rb
    ? ([rb.gl, rb.subledger, rb.documents].filter(Boolean) as string[])
    : ['Payment removed; general ledger and subledgers were rolled back per policy.']
  return { title: d?.detail || 'Payment deleted.', lines }
}

export async function deletePaymentRequest(id: number): Promise<PolicyBannerState> {
  const res = await api.delete(`/payments/${id}/`)
  return bannerFromDeleteResponse(res.data)
}

export function confirmDeletePaymentDialog(paymentLabel: string): boolean {
  return window.confirm(
    [
      `Delete ${paymentLabel}?`,
      '',
      'Rollback (single database transaction):',
      '• Remove the posted AUTO-PAY journal from the general ledger.',
      '• Restore customer AR or vendor A/P subledger balances.',
      '• Recompute related invoice or bill paid / partial / open status.',
      '',
      'Receipts already on a bank deposit cannot be deleted from here.',
    ].join('\n')
  )
}
