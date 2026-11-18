/**
 * Paging under the History overview's table: "1–50 of 57", Previous / Next
 * and "page / pages". Shown only when the rows do not fit one page.
 */
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

export default function HistoryHomePager({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
}: {
  /** 0-based. */
  page: number
  pageCount: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-[var(--muted)]">
      <span data-testid="history-home-range">
        {t('historyHome.pageRange', {
          from: page * pageSize + 1,
          to: Math.min((page + 1) * pageSize, total),
          total,
        })}
      </span>
      <div className="flex items-center gap-2">
        <PageButton
          testId="history-home-prev"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={14} aria-hidden="true" /> {t('historyHome.prev')}
        </PageButton>
        <span data-testid="history-home-page">
          {t('historyHome.pageOf', { page: page + 1, pages: pageCount })}
        </span>
        <PageButton
          testId="history-home-next"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
        >
          {t('historyHome.next')} <ChevronRight size={14} aria-hidden="true" />
        </PageButton>
      </div>
    </div>
  )
}

function PageButton({
  testId,
  disabled,
  onClick,
  children,
}: {
  testId: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1 rounded-[6px] border border-[var(--border2)] bg-[var(--white)] px-2 py-1 text-sm text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
