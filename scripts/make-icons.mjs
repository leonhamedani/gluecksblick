import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(resolve(root, 'public/icon.svg'))
await sharp(svg).resize(192, 192).png().toFile(resolve(root, 'public/icon-192.png'))
await sharp(svg).resize(512, 512).png().toFile(resolve(root, 'public/icon-512.png'))
