import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * A file size as a person reads it.
 *
 * 1024-based with the short labels, because that is what every mail client
 * shows and therefore what the sender saw when they attached it — a size here
 * that disagrees with the one in Gmail reads as a bug in Dovis rather than as a
 * unit convention.
 *
 * Absence returns "", so a size nobody recorded renders as nothing rather than
 * as `0 B` — which would be a claim about an empty file.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  // One decimal below 10 and none above: 1.4 MB is useful, 1.43 MB is noise and
  // 240 KB does not need a point at all.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
