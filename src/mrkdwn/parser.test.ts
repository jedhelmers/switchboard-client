import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { parse, plainText } from './parser.js'
import type { MrkdwnNode } from './types.js'

interface Fixture {
  name: string
  input: string
  ast: MrkdwnNode[]
  plain_text: string
}

interface FixtureFile {
  fixtures: Fixture[]
}

const here = dirname(fileURLToPath(import.meta.url))
// .../switchboard-client/src/mrkdwn/  →  ../../../Stack/MRKDWN_FIXTURES.json
const fixturesPath = resolve(here, '../../../Stack/MRKDWN_FIXTURES.json')

const raw = readFileSync(fixturesPath, 'utf-8')
const { fixtures } = JSON.parse(raw) as FixtureFile

for (const fx of fixtures) {
  test(fx.name, () => {
    // Strip undefined / extra keys by round-tripping through JSON so the
    // comparison only sees fields the parser actually emitted.
    const gotAst = JSON.parse(JSON.stringify(parse(fx.input)))
    assert.deepStrictEqual(gotAst, fx.ast, `AST mismatch for ${fx.name}`)

    const gotPlain = plainText(fx.input)
    assert.equal(gotPlain, fx.plain_text, `plainText mismatch for ${fx.name}`)
  })
}
