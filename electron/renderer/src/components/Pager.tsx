/**
 * Previous / "page of pages" / next, for any list cut into pages.
 *
 * Extracted from PlayerSection so every long list pages the same way. The
 * page size belongs to each list (PLAYER_LIST, EDITING_LIST -- HC.1); the
 * caller clamps `page` and owns the state. `prevAction`/`nextAction` carry
 * the parity inventory codes only where the Tkinter app had such buttons.
 */
interface PagerProps {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  prevAction?: string;
  nextAction?: string;
  pageClassName?: string;
}

export default function Pager({ page, pageCount, onPage, prevAction, nextAction, pageClassName }: PagerProps) {
  return (
    <>
      <button
        type="button"
        className="chip"
        aria-label="Previous page"
        title="Go to previous page"
        disabled={page === 0}
        data-action={prevAction} onClick={() => onPage(Math.max(0, page - 1))}
      >
        ‹
      </button>
      <span className={pageClassName ? `lab ${pageClassName}` : "lab"}>
        {page + 1} / {pageCount}
      </span>
      <button
        type="button"
        className="chip"
        aria-label="Next page"
        title="Go to next page"
        disabled={page >= pageCount - 1}
        data-action={nextAction} onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
      >
        ›
      </button>
    </>
  );
}
