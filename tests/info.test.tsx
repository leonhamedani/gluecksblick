/**
 * @vitest-environment happy-dom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { InfoTip } from '../src/components/InfoTip.tsx'

describe('Info', () => {
  it('öffnet und schließt den Hinweis, ohne den Knopf zu entfernen', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let root: Root
    await act(async () => {
      root = createRoot(host)
      root.render(<InfoTip title="Motiv" body="Eine helle Scheibe vor dunklem Himmel." />)
    })
    const info = () => host.querySelector('button[aria-label="Info: Motiv"]') as HTMLButtonElement | null
    expect(info()).toBeTruthy()

    await act(async () => {
      info()!.click()
    })
    expect(document.body.textContent).toContain('Verstanden')
    expect(document.body.textContent).toContain('Eine helle Scheibe')

    const understood = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Verstanden')
    await act(async () => {
      understood?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.body.textContent).not.toContain('Verstanden')
    expect(info()).toBeTruthy()

    await act(async () => {
      info()!.click()
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.body.textContent).not.toContain('Verstanden')
    expect(info()).toBeTruthy()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
