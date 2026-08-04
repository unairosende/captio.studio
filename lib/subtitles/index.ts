/**
 * Subtitle core — pure logic, no DOM, no network, no framework.
 *
 * Everything the product actually knows about subtitling lives here: timecode
 * arithmetic, format parsing and writing, and quality checks. It is the one
 * part of the codebase that cannot be bought or regenerated, so it is kept
 * free of React, Next and the database on purpose, and covered by tests.
 */
export * from './types.ts'
export * from './timecode.ts'
export * from './parse.ts'
export * from './format.ts'
export * from './qc.ts'
