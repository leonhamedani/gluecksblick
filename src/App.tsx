import { Clapperboard, Download, ImagePlus, Share2, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Field } from './components/Field.tsx'
import { InfoTip } from './components/InfoTip.tsx'
import { help } from './content/help.ts'
import { QualityChart } from './components/QualityChart.tsx'
import { Segmented } from './components/Segmented.tsx'
import { Thumb } from './components/Thumb.tsx'
import { Button } from './components/ui/button.tsx'
import { Label } from './components/ui/label.tsx'
import { Slider } from './components/ui/slider.tsx'
import { Switch } from './components/ui/switch.tsx'
import { keepIndices, type FrameShift, type Motive, type ProcessOptions, type ReferenceMode } from './lib/align.ts'
import { WEAK_ALIGN_MESSAGE, clock, type TrackMode } from './lib/track.ts'
import { gentleEnhance, type EnhanceSettings, floatRgbToRgba } from './lib/enhance.ts'
import { acquireWakeLock, downloadBlob, releaseWakeLock, rgbaToPng, sharePng } from './lib/export.ts'
import { deInt, deNumber, stampName } from './lib/format.ts'
import { warpRgba } from './lib/image.ts'
import { isAbort, Processor } from './lib/processor.ts'
import { makePlanetSequence } from './lib/synthetic.ts'
import { cn } from './lib/utils.ts'
import { loadMany, loadMemory, probeVideo, type BatchEntry, type LoadedSource } from './media/decode.ts'

const STEPS = ['Aufnahme', 'Schärfe', 'Deckung', 'Ergebnis'] as const

type Busy = { label: string; ratio: number }
type Summary = {
  label: string
  kind: LoadedSource['kind']
  w: number
  h: number
  count: number
  thumbW: number
  thumbH: number
  thumbs: Uint8ClampedArray[]
  origins: { name: string; count: number }[]
}

type Clip = {
  id: string
  file: File
  kind: 'video' | 'bild'
  name: string
  detail: string
}
type StackView = {
  rgb: Float32Array
  w: number
  h: number
  used: number
  single: Uint8ClampedArray
  shifts: FrameShift[]
  key: string
}

function settingsKey(input: {
  keepRatio: number
  motive: Motive
  reference: ReferenceMode
  localOn: boolean
  grid: number
  patch: number
  minPeak: number
  minLocal: number
  stackMode: 'mean' | 'sigma'
  kappa: number
}): string {
  return JSON.stringify(input)
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Das hat nicht geklappt.'
}

export default function App() {
  const processorRef = useRef<Processor | null>(null)
  const sourceRef = useRef<LoadedSource | null>(null)
  const runRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const previewToken = useRef(0)
  const videoInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const processor = useCallback(() => {
    if (!processorRef.current) processorRef.current = new Processor()
    return processorRef.current
  }, [])

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [accel, setAccel] = useState('Prozessor')
  const [canInstall, setCanInstall] = useState(false)
  const installEvent = useRef<BeforeInstallPromptEvent | null>(null)

  const [maxFrames, setMaxFrames] = useState(40)
  const [longEdge, setLongEdge] = useState(480)
  const [crop, setCrop] = useState(100)
  const [track, setTrack] = useState<TrackMode>('zoom')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(1)
  const [duration, setDuration] = useState(0)
  const [clips, setClips] = useState<Clip[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [scores, setScores] = useState<number[] | null>(null)
  const [picked, setPicked] = useState(0)
  const [keepRatio, setKeepRatio] = useState(0.3)
  const [motive, setMotive] = useState<Motive>('planet')
  const [reference, setReference] = useState<ReferenceMode>('average')
  const [localOn, setLocalOn] = useState(true)
  const [grid, setGrid] = useState(3)
  const [patch, setPatch] = useState(64)
  const [minPeak, setMinPeak] = useState(0.08)
  const [minLocal, setMinLocal] = useState(0.06)
  const [stackMode, setStackMode] = useState<'mean' | 'sigma'>('sigma')
  const [kappa, setKappa] = useState(2.2)
  const [enhance, setEnhance] = useState<EnhanceSettings>(gentleEnhance)
  const [result, setResult] = useState<StackView | null>(null)
  const [preview, setPreview] = useState<Uint8ClampedArray | null>(null)
  const [view, setView] = useState<'stack' | 'single'>('stack')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const key = settingsKey({ keepRatio, motive, reference, localOn, grid, patch, minPeak, minLocal, stackMode, kappa })

  useEffect(() => {
    const unit = processor()
    unit.onReady = (value) => setAccel(value)
    const onPrompt = (event: Event) => {
      event.preventDefault()
      installEvent.current = event as BeforeInstallPromptEvent
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => {
      unit.onReady = null
      window.removeEventListener('beforeinstallprompt', onPrompt)
      sourceRef.current?.close()
      processorRef.current?.cancel()
      void releaseWakeLock()
    }
  }, [processor])

  useEffect(() => {
    if (!result) return
    const token = ++previewToken.current
    const handle = window.setTimeout(() => {
      void processor()
        .enhance(result.rgb, result.w, result.h, enhance)
        .then((rgba) => {
          if (token === previewToken.current) setPreview(rgba)
        })
        .catch((reason) => {
          if (!isAbort(reason) && token === previewToken.current) setError(messageOf(reason))
        })
    }, 80)
    return () => window.clearTimeout(handle)
  }, [enhance, processor, result])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !result) return
    const image = view === 'single' ? result.single : preview
    if (!image) return
    canvas.width = result.w
    canvas.height = result.h
    const pixels = new Uint8ClampedArray(result.w * result.h * 4)
    pixels.set(image)
    canvas.getContext('2d')?.putImageData(new ImageData(pixels, result.w, result.h), 0, 0)
  }, [preview, result, view])

  const kept = useMemo(() => (scores ? keepIndices(scores, keepRatio) : []), [scores, keepRatio])

  function stopWork() {
    abortRef.current?.abort()
    processor().cancel()
    void releaseWakeLock()
  }

  function begin() {
    stopWork()
    runRef.current += 1
    const id = runRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    return { signal: controller.signal, alive: () => runRef.current === id }
  }

  function cancel() {
    runRef.current += 1
    stopWork()
    setBusy(null)
  }

  async function adopt(source: LoadedSource, job: { alive: () => boolean }, nextRatio = 0.35) {
    sourceRef.current?.close()
    sourceRef.current = source
    setSummary({
      label: source.label,
      kind: source.kind,
      w: source.w,
      h: source.h,
      count: source.count,
      thumbW: source.thumbW,
      thumbH: source.thumbH,
      thumbs: source.thumbs,
      origins: source.origins,
    })
    setResult(null)
    setPreview(null)
    setScores(null)
    const measured = await processor().score(source.grays, source.w, source.h, (ratio, label) => {
      setBusy({ label, ratio: nextRatio + ratio * (1 - nextRatio) })
    })
    if (!job.alive()) return
    setScores(measured)
    setPicked(measured.indexOf(Math.max(...measured)))
    setNotice(source.note || null)
    setStep(1)
  }

  function limitsFor(trimA: number, trimB: number) {
    return {
      maxFrames,
      longEdge,
      crop: crop / 100,
      trimStart: trimA,
      trimEnd: trimB,
      motive,
      track,
    }
  }

  async function addVideos(list: File[]) {
    const next: Clip[] = []
    for (const file of list) {
      let detail = 'Video'
      try {
        const probe = await probeVideo(file)
        detail = `${probe.width}×${probe.height} · ${clock(probe.duration)}`
        setDuration((value) => Math.max(value, probe.duration))
      } catch {
        detail = 'Nicht lesbar'
      }
      next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`, file, kind: 'video', name: file.name, detail })
    }
    setClips((current) => [...current, ...next])
    setError(null)
  }

  async function addImages(list: File[]) {
    const next = [...list].map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      kind: 'bild' as const,
      name: file.name,
      detail: 'Bild',
    }))
    setClips((current) => [...current, ...next])
    setError(null)
  }

  async function runBatch(trimA = trimStart, trimB = trimEnd) {
    if (clips.length === 0) return
    const entries: BatchEntry[] = clips.map((clip) => ({ file: clip.file, kind: clip.kind }))
    const job = begin()
    setBusy({ label: 'Dateien werden gelesen', ratio: 0.02 })
    await acquireWakeLock()
    try {
      const source = await loadMany(
        entries,
        limitsFor(trimA, trimB),
        {
          signal: job.signal,
          onProgress: (ratio, label) => setBusy({ label, ratio: ratio * 0.72 }),
        },
      )
      if (!job.alive()) {
        source.close()
        return
      }
      await adopt(source, job, 0.72)
    } catch (reason) {
      if (job.alive() && !isAbort(reason)) setError(messageOf(reason))
    } finally {
      if (job.alive()) {
        setBusy(null)
        void releaseWakeLock()
      }
    }
  }

  async function runDemo() {
    const job = begin()
    setBusy({ label: 'Beispiel wird gezeichnet', ratio: 0.04 })
    await acquireWakeLock()
    setKeepRatio(0.4)
    setMotive('planet')
    setReference('average')
    setLocalOn(true)
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 30))
      if (!job.alive()) return
      const sequence = makePlanetSequence({ w: 192, h: 192, count: 16, seed: 7 })
      const source = await loadMemory(sequence.frames, sequence.w, sequence.h, 'Jupiter-Beispiel', {
        signal: job.signal,
        onProgress: (ratio, label) => setBusy({ label, ratio: 0.08 + ratio * 0.5 }),
      })
      if (!job.alive()) return
      await adopt(source, job, 0.6)
    } catch (reason) {
      if (job.alive() && !isAbort(reason)) setError(messageOf(reason))
    } finally {
      if (job.alive()) {
        setBusy(null)
        void releaseWakeLock()
      }
    }
  }

  async function runStack() {
    const source = sourceRef.current
    if (!source || !scores) return
    const job = begin()
    setBusy({ label: 'Bilder werden ausgerichtet', ratio: 0.04 })
    await acquireWakeLock()
    const options: ProcessOptions = {
      motive,
      reference,
      localGrid: localOn ? grid : 0,
      patchSize: patch,
      minPeak,
      minLocalPeak: minLocal,
      stackMode,
      sigmaKappa: kappa,
    }
    try {
      const shifts = await processor().align(
        source.grays,
        source.w,
        source.h,
        scores,
        kept,
        options,
        (ratio, label) => setBusy({ label, ratio: ratio * 0.45 }),
      )
      if (!job.alive()) return
      const usable = shifts.filter((shift) => !shift.rejected)
      if (usable.length < 2) {
        setError(WEAK_ALIGN_MESSAGE)
        return
      }
      let mode = stackMode
      const bytes = usable.length * source.w * source.h * 4
      const dropped = shifts.length - usable.length
      if (mode === 'sigma' && bytes > 80 * 1024 * 1024) {
        mode = 'mean'
        setNotice('Sigma-Clipping würde den Speicher sprengen. Es wird der Mittelwert verwendet.')
      } else if (dropped > 0) {
        setNotice(`${dropped} Bilder ohne sichere Deckung weggelassen.`)
      }
      await processor().stackInit(source.w, source.h, mode, kappa)
      const best = usable.reduce((a, b) => ((scores[b.index] ?? 0) > (scores[a.index] ?? 0) ? b : a), usable[0])
      let single = new Uint8ClampedArray(source.w * source.h * 4)
      for (let index = 0; index < usable.length; index++) {
        if (!job.alive()) return
        const shift = usable[index]
        if (!shift) continue
        setBusy({
          label: `Bild ${index + 1} von ${usable.length} stapeln`,
          ratio: 0.45 + (index / usable.length) * 0.5,
        })
        const rgba = await source.readFrame(shift.index, job.signal)
        if (shift.index === best?.index) {
          const warped = warpRgba(rgba, source.w, source.h, shift.dx, shift.dy, shift.field, shift.fieldW, shift.fieldH, shift.step)
          single = new Uint8ClampedArray(warped)
        }
        await processor().stackAdd(rgba, shift)
      }
      const stacked = await processor().stackFinish()
      if (!job.alive()) return
      const viewResult: StackView = {
        rgb: stacked.rgb,
        w: source.w,
        h: source.h,
        used: stacked.used,
        single,
        shifts,
        key,
      }
      setResult(viewResult)
      setPreview(floatRgbToRgba(stacked.rgb))
      setView('stack')
      setStep(3)
    } catch (reason) {
      if (job.alive() && !isAbort(reason)) setError(messageOf(reason))
    } finally {
      if (job.alive()) {
        setBusy(null)
        void releaseWakeLock()
      }
    }
  }

  async function exportPng() {
    if (!preview || !result) return
    try {
      const blob = await rgbaToPng(preview, result.w, result.h)
      downloadBlob(blob, stampName('png'))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function exportTiff() {
    if (!result) return
    setBusy({ label: 'TIFF wird geschrieben', ratio: 0.4 })
    try {
      const bytes = await processor().tiff(result.rgb, result.w, result.h, enhance)
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'image/tiff' }), stampName('tif'))
    } catch (reason) {
      if (!isAbort(reason)) setError(messageOf(reason))
    } finally {
      setBusy(null)
    }
  }

  async function share() {
    if (!preview || !result) return
    try {
      const blob = await rgbaToPng(preview, result.w, result.h)
      await sharePng(blob)
    } catch (reason) {
      if (!isAbort(reason)) setError(messageOf(reason))
    }
  }

  const memoryMb = (maxFrames * longEdge * longEdge * 0.75) / (1024 * 1024)
  const stats = result ? describe(result.shifts) : null

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Logo />
          <div className="w-auto min-w-0 flex-1">
            <p className="font-display text-2xl leading-none text-ink">Glücksblick</p>
            <p className="mt-1 text-xs tracking-wide text-dim">Lucky Imaging, nur auf diesem Gerät</p>
          </div>
          {canInstall ? (
            <Button
              variant="secondary"
              size="auto"
              className="min-h-10"
              onClick={() => {
                void installEvent.current?.prompt()
                setCanInstall(false)
              }}
            >
              Installieren
            </Button>
          ) : null}
        </div>
        <ol className="mx-auto grid max-w-lg grid-cols-4 gap-1.5 px-4 pb-3">
          {STEPS.map((label, index) => {
            const open = index === 0 || (index < 3 && scores) || (index === 3 && result)
            return (
              <li key={label} className="min-w-0">
                <button
                  type="button"
                  disabled={!open || !!busy}
                  onClick={() => setStep(index)}
                  className={cn(
                    'flex min-h-10 w-full items-center justify-center gap-1 rounded-full border px-1 text-[12px]',
                    step === index ? 'border-brass bg-brass/15 text-ink' : 'border-line text-dim',
                  )}
                >
                  <span className="font-display tabular-nums">{index + 1}</span>
                  <span className="truncate">{label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 pt-5 pb-32">
        {error ? (
          <p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-xl border border-sea/30 bg-sea/10 px-3 py-2 text-sm text-sea">
            {notice}
          </p>
        ) : null}

        {step === 0 ? (
          <section className="space-y-5">
            <div className="space-y-2">
              <h1 className="font-display text-4xl leading-tight font-medium text-ink">Ruhige Momente stapeln</h1>
              <p className="text-[15px] leading-relaxed text-muted">
                Mehrere Videos und Bilder derselben Scheibe lassen sich zusammen stapeln. Alles bleibt auf diesem Telefon.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1">
                <Button className="w-auto min-w-0 flex-1" onClick={() => videoInput.current?.click()} disabled={!!busy}>
                  <Clapperboard aria-hidden /> Videos
                </Button>
                <InfoTip title="Videos" body={help.videos} />
              </div>
              <div className="flex items-center gap-1">
                <Button className="w-auto min-w-0 flex-1" variant="secondary" onClick={() => imageInput.current?.click()} disabled={!!busy}>
                  <ImagePlus aria-hidden /> Bilder
                </Button>
                <InfoTip title="Bilder" body={help.images} />
              </div>
            </div>
            <input
              ref={videoInput}
              className="sr-only"
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              multiple
              onChange={(event) => {
                const list = [...(event.target.files ?? [])]
                event.target.value = ''
                if (list.length) void addVideos(list)
              }}
            />
            <input
              ref={imageInput}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/bmp"
              multiple
              onChange={(event) => {
                const list = [...(event.target.files ?? [])]
                event.target.value = ''
                if (list.length) void addImages(list)
              }}
            />
            <div className="flex items-center gap-1">
              <Button className="w-auto min-w-0 flex-1" variant="secondary" onClick={() => void runDemo()} disabled={!!busy}>
                <Sparkles aria-hidden /> Beispiel: Jupiter mit Seeing
              </Button>
              <InfoTip title="Beispiel" body={help.beispiel} />
            </div>
            <Segmented
              label="Motiv"
              info={help.motiv}
              value={motive}
              onChange={setMotive}
              disabled={!!busy}
              options={[
                { value: 'planet', label: 'Planet' },
                { value: 'surface', label: 'Mond / Sonne' },
              ]}
            />
            {motive === 'planet' ? (
              <Segmented
                label="Wie der Planet verfolgt wird"
                info={help.verfolgen}
                value={track}
                onChange={setTrack}
                disabled={!!busy}
                options={[
                  { value: 'zoom', label: 'Großer Zoom' },
                  { value: 'match', label: 'Gleich groß' },
                  { value: 'all', label: 'Alles' },
                ]}
              />
            ) : null}
            {clips.length > 0 ? (
              <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink">Gewählte Dateien</p>
                <InfoTip title="Dateiliste" body={help.dateiliste} />
              </div>
              <ul className="max-h-52 space-y-2 overflow-y-auto">
                {clips.map((clip) => (
                  <li key={clip.id} className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2">
                    <div className="w-auto min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{clip.name}</p>
                      <p className="text-xs text-dim">{clip.kind === 'video' ? 'Video' : 'Bild'} · {clip.detail}</p>
                    </div>
                    <button
                      type="button"
                      className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-panel-2 hover:text-ink"
                      aria-label={`${clip.name} entfernen`}
                      disabled={!!busy}
                      onClick={() => setClips((current) => current.filter((item) => item.id !== clip.id))}
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              </div>
            ) : (
              <p className="text-sm text-dim">Noch keine Datei. Videos und Bilder lassen sich nacheinander hinzufügen.</p>
            )}
            <Field label="Bilder auswerten" info={help.maxFrames} value={deInt(maxFrames)} hint="Pro Video, gleichmäßig über den Zeitraum.">
              <Slider min={8} max={160} step={1} value={[maxFrames]} onValueChange={(value) => setMaxFrames(value[0] ?? 8)} disabled={!!busy} />
            </Field>
            <Field label="Lange Kante" info={help.longEdge} value={`${deInt(longEdge)} px`} hint="Kleinere Kante, weniger Speicher.">
              <Slider
                min={256}
                max={768}
                step={64}
                value={[longEdge]}
                onValueChange={(value) => setLongEdge(value[0] ?? 256)}
                disabled={!!busy}
              />
            </Field>
            {motive === 'planet' ? (
              <p className="text-sm leading-relaxed text-muted">
                Der Planet wird in jeder Datei gesucht und mittig ausgeschnitten. „Großer Zoom“ behält nur den größten ähnlichen Abschnitt, oft aus einem einzigen Video; die anderen Dateien fallen dann absichtlich weg. „Gleich groß“ nimmt brauchbare Bilder aus allen Videos und zieht sie auf dieselbe Scheibengröße. „Alles“ nimmt jede vollständige Scheibe aus allen Videos, auch wenn die Größen verschieden sind.
              </p>
            ) : (
              <Field label="Ausschnitt in der Mitte" info={help.crop} value={`${deInt(crop)} %`}>
                <Slider min={50} max={100} step={5} value={[crop]} onValueChange={(value) => setCrop(value[0] ?? 100)} disabled={!!busy} />
              </Field>
            )}
            {clips.some((clip) => clip.kind === 'video') && duration > 0 ? (
              <>
                <Field label="Anfang" info={help.trimStart} value={clock(duration * trimStart)}>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[Math.round(trimStart * 100)]}
                    onValueChange={(value) => setTrimStart(Math.min((value[0] ?? 0) / 100, trimEnd - 0.02))}
                    disabled={!!busy}
                  />
                </Field>
                <Field label="Ende" info={help.trimEnd} value={clock(duration * trimEnd)}>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[Math.round(trimEnd * 100)]}
                    onValueChange={(value) => setTrimEnd(Math.max((value[0] ?? 100) / 100, trimStart + 0.02))}
                    disabled={!!busy}
                  />
                </Field>
              </>
            ) : null}
            <div className="flex items-center gap-1">
              <Button className="w-auto min-w-0 flex-1" disabled={!!busy || clips.length === 0} onClick={() => void runBatch(trimStart, trimEnd)}>
                {clips.length > 1 ? `${clips.length} Dateien auswerten` : 'Auswerten'}
              </Button>
              <InfoTip title="Auswerten" body={help.auswerten} />
            </div>
            {memoryMb > 32 ? (
              <p className="text-sm text-brass">
                Das wird eng auf dem Handy. Weniger Bilder oder eine kürzere Kante schonen den Speicher.
              </p>
            ) : (
              <p className="text-sm text-dim">Auf dem Telefon reichen oft 40 Bilder und 480 Pixel Kantenlänge.</p>
            )}
            <p className="text-xs leading-relaxed text-dim">
              iPhone: Teilen, dann „Zum Home-Bildschirm“. Die App bleibt danach auch ohne Netz benutzbar.
            </p>
          </section>
        ) : null}

        {step === 1 && scores && summary ? (
          <section className="space-y-5">
            <div className="space-y-2">
              <h1 className="font-display text-4xl leading-tight font-medium">Die ruhigen Momente</h1>
              <p className="text-[15px] leading-relaxed text-muted">
                Jedes Bild bekommt einen Schärfewert: die Varianz des Laplace-Filters auf einer leicht weichgezeichneten
                Graustufe. Messing bleibt, Oliv fällt weg.
              </p>
            </div>
            <p className="text-sm text-dim">
              {summary.count} Bilder · {summary.w}×{summary.h}
              {summary.origins.length > 1 ? ` · ${summary.origins.length} Dateien` : ''}
            </p>
            {summary.origins.length > 0 ? (
              <ul className="space-y-1 text-sm text-muted">
                {summary.origins.map((origin) => (
                  <li key={origin.name}>
                    {origin.name}: {deInt(origin.count)} Bilder
                  </li>
                ))}
              </ul>
            ) : null}
            <QualityChart scores={scores} keepRatio={keepRatio} />
            <div className="flex gap-2 overflow-x-auto pb-1">
              {summary.thumbs.map((thumb, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setPicked(index)}
                  className={cn(
                    'shrink-0 rounded-lg p-0.5',
                    kept.includes(index) ? 'opacity-100 ring-1 ring-brass' : 'opacity-35',
                    picked === index ? 'ring-2 ring-sea' : '',
                  )}
                  aria-label={`Bild ${index + 1}, Schärfe ${deNumber(scores[index] ?? 0, 4)}`}
                >
                  <Thumb data={thumb} width={summary.thumbW} height={summary.thumbH} className="h-14 w-auto rounded-md" />
                </button>
              ))}
            </div>
            <p className="text-sm text-muted">
              Bild {picked + 1}: Schärfe {deNumber(scores[picked] ?? 0, 5)}
              {picked === scores.indexOf(Math.max(...scores)) ? ' · das schärfste' : ''}
            </p>
            <Field
              label="Beste Bilder behalten"
              info={help.qualitaet}
              value={`${deInt(keepRatio * 100)} %`}
              hint={`${deInt(kept.length)} von ${deInt(scores.length)} Bildern kommen in den Stapel.`}
            >
              <Slider
                min={5}
                max={100}
                step={1}
                value={[Math.round(keepRatio * 100)]}
                onValueChange={(value) => setKeepRatio((value[0] ?? 5) / 100)}
                disabled={!!busy}
              />
            </Field>
            <div className="flex items-center gap-1">
              <Button className="w-auto min-w-0 flex-1" onClick={() => setStep(2)} disabled={!!busy}>
                Weiter zur Deckung
              </Button>
              <InfoTip title="Weiter zur Deckung" body={help.weiter} />
            </div>
          </section>
        ) : null}

        {step === 2 && scores ? (
          <section className="space-y-5">
            <div className="space-y-2">
              <h1 className="font-display text-4xl leading-tight font-medium">Zur Deckung bringen</h1>
              <p className="text-[15px] leading-relaxed text-muted">
                Zuerst eine globale Verschiebung per Phasenkorrelation. Danach optional ein Raster lokaler Punkte, deren
                Verschiebungen weich ineinander übergehen. So bleibt das Seeing nicht als Matsch im Stapel.
              </p>
            </div>
            <Segmented
              label="Motiv"
              info={help.motiv}
              value={motive}
              onChange={setMotive}
              disabled={!!busy}
              options={[
                { value: 'planet', label: 'Planet' },
                { value: 'surface', label: 'Mond / Sonne' },
              ]}
            />
            <Segmented
              label="Referenz"
              info={help.referenz}
              value={reference}
              onChange={setReference}
              disabled={!!busy}
              options={[
                { value: 'best', label: 'Schärfstes Bild' },
                { value: 'average', label: 'Mittel der besten' },
              ]}
            />
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-panel px-3 py-3">
              <span className="flex items-center gap-2">
                <Label htmlFor="local">Lokale Punkte</Label>
                <InfoTip title="Lokale Punkte" body={help.lokal} />
              </span>
              <Switch id="local" checked={localOn} onCheckedChange={setLocalOn} disabled={!!busy} />
            </div>
            {localOn ? (
              <>
                <Field label="Raster" info={help.raster} value={`${grid}×${grid}`}>
                  <Slider min={2} max={6} step={1} value={[grid]} onValueChange={(value) => setGrid(value[0] ?? 2)} disabled={!!busy} />
                </Field>
                <Segmented
                  label="Kachelgröße"
                  info={help.kachel}
                  value={String(patch)}
                  onChange={(value) => setPatch(Number(value))}
                  disabled={!!busy}
                  options={[
                    { value: '32', label: '32 px' },
                    { value: '64', label: '64 px' },
                    { value: '96', label: '96 px' },
                  ]}
                />
              </>
            ) : null}
            {localOn ? (
              <Field label="Mindestwert eines Punktes" info={help.punktWert} value={deNumber(minLocal, 2)} hint="Schwache Kacheln werden aus dem Raster gelassen.">
                <Slider
                  min={0}
                  max={0.4}
                  step={0.01}
                  value={[minLocal]}
                  onValueChange={(value) => setMinLocal(value[0] ?? 0)}
                  disabled={!!busy}
                />
              </Field>
            ) : null}
            <Field label="Mindest-Korrelation" info={help.korrelation} value={deNumber(minPeak, 2)} hint="Darunter wird ein Bild verworfen.">
              <Slider
                min={0}
                max={0.4}
                step={0.01}
                value={[minPeak]}
                onValueChange={(value) => setMinPeak(value[0] ?? 0)}
                disabled={!!busy}
              />
            </Field>
            <Segmented
              label="Stapel"
              info={help.stapelArt}
              value={stackMode}
              onChange={setStackMode}
              disabled={!!busy}
              options={[
                { value: 'mean', label: 'Mittelwert' },
                { value: 'sigma', label: 'Sigma-Clip' },
              ]}
            />
            {stackMode === 'sigma' ? (
              <Field label="Sigma" info={help.sigma} value={deNumber(kappa, 1)} hint="Höher behält mehr Ausreißer.">
                <Slider min={1} max={5} step={0.1} value={[kappa]} onValueChange={(value) => setKappa(value[0] ?? 2)} disabled={!!busy} />
              </Field>
            ) : null}
            <div className="flex items-center gap-1">
              <Button className="w-auto min-w-0 flex-1" onClick={() => void runStack()} disabled={!!busy || kept.length === 0}>
                {kept.length} Bilder stapeln
              </Button>
              <InfoTip title="Stapeln" body={help.stapeln} />
            </div>
          </section>
        ) : null}

        {step === 3 && result && stats ? (
          <section className="space-y-5">
            <div className="space-y-2">
              <h1 className="font-display text-4xl leading-tight font-medium">Der Stapel</h1>
              <p className="text-[15px] leading-relaxed text-muted">
                {deInt(result.used)} Bilder, Farbe bleibt erhalten. Die Regler zeichnen nur die Ansicht neu.
              </p>
            </div>
            <div className="sticky top-28 z-10 -mx-4 bg-canvas/90 px-4 py-2 backdrop-blur">
              <canvas ref={canvasRef} className="h-auto w-full rounded-2xl bg-black ring-1 ring-brass/40" />
              <div className="mt-2 flex items-center gap-1">
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1 rounded-xl bg-panel-2 p-1">
                <button
                  type="button"
                  className={cn('min-h-10 rounded-lg text-sm', view === 'single' ? 'bg-brass text-[#1c1408]' : 'text-muted')}
                  onClick={() => setView('single')}
                >
                  Schärfstes Bild
                </button>
                <button
                  type="button"
                  className={cn('min-h-10 rounded-lg text-sm', view === 'stack' ? 'bg-brass text-[#1c1408]' : 'text-muted')}
                  onClick={() => setView('stack')}
                >
                  Stapel
                </button>
              </div>
              <InfoTip title="Vergleich" body={help.vergleich} />
              </div>
            </div>
            <p className="text-sm leading-relaxed text-dim">
              Verschiebung im Mittel {deNumber(stats.shift)} px · Korrelation {deNumber(stats.peak, 2)}
              {stats.localTotal ? ` · lokale Punkte ${deNumber(stats.local, 1)} von ${stats.localTotal}` : ''}
              {stats.dropped ? ` · ${deInt(stats.dropped)} verworfen` : ''} · Rechnung mit {accel}
            </p>
            {result.key !== key ? (
              <p className="text-sm text-brass">Die Einstellungen haben sich geändert. Zum Übernehmen neu stapeln.</p>
            ) : null}
            <Field label="Wellen, fein" info={help.wellenFein} value={deNumber(enhance.fine, 2)}>
              <Slider min={0} max={2} step={0.01} value={[enhance.fine]} onValueChange={(value) => setEnhance({ ...enhance, fine: value[0] ?? 0 })} />
            </Field>
            <Field label="Wellen, mittel" info={help.wellenMittel} value={deNumber(enhance.mid, 2)}>
              <Slider min={0} max={2} step={0.01} value={[enhance.mid]} onValueChange={(value) => setEnhance({ ...enhance, mid: value[0] ?? 0 })} />
            </Field>
            <Field label="Wellen, grob" info={help.wellenGrob} value={deNumber(enhance.coarse, 2)}>
              <Slider min={0} max={2} step={0.01} value={[enhance.coarse]} onValueChange={(value) => setEnhance({ ...enhance, coarse: value[0] ?? 0 })} />
            </Field>
            <Field label="Unscharf maskieren" info={help.unscharf} value={deNumber(enhance.unsharpAmount, 2)}>
              <Slider
                min={0}
                max={2}
                step={0.01}
                value={[enhance.unsharpAmount]}
                onValueChange={(value) => setEnhance({ ...enhance, unsharpAmount: value[0] ?? 0 })}
              />
            </Field>
            <Field label="Maskenradius" info={help.radius} value={deNumber(enhance.unsharpRadius, 1)}>
              <Slider
                min={0.6}
                max={3}
                step={0.1}
                value={[enhance.unsharpRadius]}
                onValueChange={(value) => setEnhance({ ...enhance, unsharpRadius: value[0] ?? 1 })}
              />
            </Field>
            <Field label="Helligkeit" info={help.helligkeit} value={deNumber(enhance.brightness, 2)}>
              <Slider
                min={-0.3}
                max={0.3}
                step={0.01}
                value={[enhance.brightness]}
                onValueChange={(value) => setEnhance({ ...enhance, brightness: value[0] ?? 0 })}
              />
            </Field>
            <Field label="Kontrast" info={help.kontrast} value={deNumber(enhance.contrast, 2)}>
              <Slider
                min={0.5}
                max={1.8}
                step={0.01}
                value={[enhance.contrast]}
                onValueChange={(value) => setEnhance({ ...enhance, contrast: value[0] ?? 1 })}
              />
            </Field>
            <Field label="Gamma" info={help.gamma} value={deNumber(enhance.gamma, 2)}>
              <Slider min={0.4} max={2.2} step={0.01} value={[enhance.gamma]} onValueChange={(value) => setEnhance({ ...enhance, gamma: value[0] ?? 1 })} />
            </Field>
            <Field label="Sättigung" info={help.saettigung} value={deNumber(enhance.saturation, 2)}>
              <Slider
                min={0}
                max={2}
                step={0.01}
                value={[enhance.saturation]}
                onValueChange={(value) => setEnhance({ ...enhance, saturation: value[0] ?? 1 })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1">
                <Button className="w-auto min-w-0 flex-1" onClick={() => void exportPng()} disabled={!preview}>
                  <Download aria-hidden /> PNG
                </Button>
                <InfoTip title="PNG" body={help.png} />
              </div>
              <div className="flex items-center gap-1">
                <Button className="w-auto min-w-0 flex-1" variant="secondary" onClick={() => void exportTiff()}>
                  TIFF
                </Button>
                <InfoTip title="TIFF 16-bit" body={help.tiff} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button className="w-auto min-w-0 flex-1" variant="secondary" onClick={() => void share()} disabled={!preview}>
                <Share2 aria-hidden /> Teilen
              </Button>
              <InfoTip title="Teilen" body={help.teilen} />
            </div>
            <div className="flex items-center gap-1">
              <Button
                className="w-auto min-w-0 flex-1"
                variant="ghost"
                onClick={() => {
                  setStep(0)
                }}
              >
                Andere Aufnahme
              </Button>
              <InfoTip title="Andere Aufnahme" body={help.andere} />
            </div>
          </section>
        ) : null}
      </main>

      {busy ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="w-auto min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{busy.label}</p>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(busy.ratio * 100)}
              >
                <div className="h-full bg-brass transition-[width]" style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="auto" onClick={cancel}>
                <X aria-hidden /> Abbrechen
              </Button>
              <InfoTip title="Abbrechen" body={help.abbrechen} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function describe(shifts: FrameShift[]) {
  const used = shifts.filter((shift) => !shift.rejected)
  const list = used.length ? used : shifts
  const shift = list.reduce((sum, item) => sum + Math.hypot(item.dx, item.dy), 0) / Math.max(1, list.length)
  const peak = list.reduce((sum, item) => sum + item.peak, 0) / Math.max(1, list.length)
  const local = list.reduce((sum, item) => sum + item.localValid, 0) / Math.max(1, list.length)
  return { shift, peak, local, localTotal: list[0]?.localTotal ?? 0, dropped: shifts.length - list.length }
}

function Logo() {
  return (
    <svg width="42" height="42" viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="16" fill="#1c1f18" />
      <circle cx="32" cy="32" r="14" fill="#c9843a" />
      <ellipse cx="37" cy="28" rx="4" ry="2.6" fill="#8c3d2a" />
      <path d="M32 8v8M32 48v8M8 32h8M48 32h8" stroke="#e2a84a" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="32" r="20" fill="none" stroke="#e2a84a" strokeWidth="1.4" opacity="0.85" />
    </svg>
  )
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
