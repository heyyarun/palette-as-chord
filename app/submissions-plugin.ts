// A tiny /api/palettes endpoint inside the Vite dev and preview servers, so
// submissions have somewhere real to go before there is a hosted backend.
// Submissions are appended to submissions/palettes.json next to this file.
// Point the app at another backend with VITE_SUBMIT_URL.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { validateSubmission, type StoredSubmission } from './src/submission.ts'

const MAX_BODY = 16 * 1024
const MAX_STORED = 500

export function submissionsPlugin(file = resolve(import.meta.dirname, 'submissions/palettes.json')): Plugin {
  let queue: Promise<void> = Promise.resolve()

  async function read(): Promise<StoredSubmission[]> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as StoredSubmission[]
    } catch {
      return []
    }
  }

  async function append(entry: StoredSubmission) {
    const list = [entry, ...(await read())].slice(0, MAX_STORED)
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(list, null, 2))
    await rename(tmp, file)
  }

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((ok, fail) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) {
          fail(new Error('too large'))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
      req.on('error', fail)
    })

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/palettes') return next()
    if (req.method === 'GET') {
      read().then((list) => send(res, 200, list), () => send(res, 500, { error: 'Could not read submissions.' }))
      return
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' })
    readBody(req)
      .then((raw) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          return send(res, 400, { error: 'Body is not JSON.' })
        }
        const check = validateSubmission(parsed)
        if (!check.ok) return send(res, 400, { error: check.error })
        const entry: StoredSubmission = {
          ...check.value,
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          submittedAt: new Date().toISOString(),
        }
        // Serialise writes so two quick submissions cannot overwrite each other.
        const write = queue.catch(() => {}).then(() => append(entry))
        queue = write
        return write.then(
          () => send(res, 201, entry),
          () => send(res, 500, { error: 'Could not save the submission.' }),
        )
      })
      .catch(() => send(res, 413, { error: 'Submission is too large.' }))
  }

  return {
    name: 'palette-submissions',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}
