import { useEffect, useId, useRef, useState } from 'react'

export function InfoTip({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  function close() {
    setOpen(false)
    window.requestAnimationFrame(() => trigger.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      window.requestAnimationFrame(() => trigger.current?.focus())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-panel text-[13px] font-semibold text-brass"
        aria-label={`Info: ${title}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        i
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label="Hinweis schließen" onClick={close} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-2xl"
          >
            <h2 id={titleId} className="font-display text-2xl leading-tight text-ink">
              {title}
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{body}</p>
            <button
              ref={closeButton}
              type="button"
              className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brass px-4 text-base font-medium text-[#1c1408]"
              onClick={close}
            >
              Verstanden
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
