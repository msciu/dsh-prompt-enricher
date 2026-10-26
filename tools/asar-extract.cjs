/**
 * Extract selected files from an Electron .asar archive.
 *
 * The header pickle is located empirically (the JSON payload starts after the
 * 16-byte pickle prologue and carries 4 trailing padding bytes), and the
 * content base is validated against the first recorded file so a layout change
 * fails loudly instead of writing garbage.
 *
 * Usage: node asar-extract.cjs <archive> <substring> <outDir>
 */
const fs = require('node:fs')
const path = require('node:path')

const [archive, needle, outRoot] = process.argv.slice(2)
if (archive === undefined || needle === undefined || outRoot === undefined) {
  console.error('usage: node asar-extract.cjs <archive> <substring> <outDir>')
  process.exit(2)
}

const bytes = fs.readFileSync(archive)

function readHeader() {
  if (bytes.readUInt32LE(0) !== 4) throw new Error('unexpected asar prologue')
  const headerSize = bytes.readUInt32LE(4)
  const jsonSize = bytes.readUInt32LE(8)
  const candidates = [12, 16].map(start => ({ start, text: bytes.subarray(start, start + jsonSize).toString('utf8') }))
  for (const candidate of candidates) {
    for (const trim of [0, 4]) {
      const text = trim === 0 ? candidate.text : candidate.text.slice(0, candidate.text.length - trim)
      try {
        const parsed = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object' && parsed.files !== undefined) {
          // Content begins at the end of the pickle header, not at the end of
          // the JSON text: the pickle pads/truncates around the payload.
          return { header: parsed, base: 8 + headerSize }
        }
      } catch {
        /* try the next alignment */
      }
    }
  }
  // Fall back to the documented layout before giving up.
  const text = bytes.subarray(16, 16 + jsonSize).toString('utf8').replace(/\0+$/u, '')
  return { header: JSON.parse(text), base: 8 + headerSize }
}

const { header, base } = readHeader()

// Validate the content base against the first recorded file.
const first = Object.values(header.files ?? {}).find(entry => entry.files === undefined)
if (first !== undefined) {
  const head = bytes.subarray(base + Number(first.offset), base + Number(first.offset) + 1).toString('utf8')
  if (head !== '{' && head !== '[') {
    throw new Error(`content base ${base} does not start a file body (byte ${JSON.stringify(head)})`)
  }
}

let extracted = 0
const names = []

function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const entryPath = prefix === '' ? name : `${prefix}/${name}`
    if (child.files !== undefined) {
      walk(child, entryPath)
      continue
    }
    if (!entryPath.includes(needle)) continue
    const out = path.join(outRoot, entryPath)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, bytes.subarray(base + Number(child.offset), base + Number(child.offset) + child.size))
    extracted += 1
    if (names.length < 500) names.push(entryPath)
  }
}

walk(header, '')
fs.writeFileSync(path.join(outRoot, '_extracted.txt'), names.join('\n'), 'utf8')
console.log(`extracted ${extracted} from base ${base}`)
