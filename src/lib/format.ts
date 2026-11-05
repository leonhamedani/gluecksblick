export function deNumber(value: number, digits = 1): string {
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function deInt(value: number): string {
  return Math.round(value).toLocaleString('de-DE')
}

export function stampName(extension: string): string {
  const date = new Date()
  const part = (value: number) => String(value).padStart(2, '0')
  return `gluecksblick-${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}.${extension}`
}
