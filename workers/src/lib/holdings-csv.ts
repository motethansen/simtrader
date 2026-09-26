// Parsing an uploaded holdings CSV — W3 / ST-015.
//
// This is the only place a member's file is turned into rows, and it is deliberately pure: no
// database, no request, so every rule below is testable and none of them are enforced twice.
//
// The governing rule is **refuse, never guess.** A holdings file is a claim about money, and the
// cost of asking someone to fix a line is far lower than the cost of storing a number that is
// wrong by a factor of a thousand. So:
//
//   - an unrecognised column is an error, not something to ignore — `quantity` instead of `units`
//     means the file was written for a different tool, and ignoring it would store no units at all;
//   - `1,234.56` is refused rather than read, because the same string is 1.23456 in most of the
//     countries this product targets;
//   - the same instrument twice in one file is refused, because nothing here can know which line
//     the member meant;
//   - numbers stay **strings** all the way to Postgres NUMERIC. Parsing to a JS number would make
//     0.1 + 0.2 the member's problem.

/** One validated row, ready to hand to Postgres. Numbers are strings on purpose. */
export interface ParsedHolding {
  symbol: string
  mic: string
  units: string
  avgCost: string
  currency: string
}

export interface CsvError {
  /** 1-based line in the uploaded file, so the message points at what the member can see. */
  line: number
  message: string
}

export interface ParseResult {
  holdings: ParsedHolding[]
  errors: CsvError[]
}

export const HOLDINGS_CSV_HEADER = 'symbol,mic,units,avg_cost,currency'
export const HOLDINGS_CSV_TEMPLATE = `${HOLDINGS_CSV_HEADER}
AAPL,XNAS,10,182.50,USD
VWRL,XAMS,25,105.20,EUR
`

/** Guards against a file that would take the Worker's whole CPU budget to validate. */
export const MAX_ROWS = 500

const COLUMNS = ['symbol', 'mic', 'units', 'avg_cost', 'currency'] as const
type Column = (typeof COLUMNS)[number]

const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}$/
const MIC_RE = /^[A-Z0-9]{4}$/
const CURRENCY_RE = /^[A-Z]{3}$/
// Plain decimal only: no sign, no exponent, no separators. Bounded to what NUMERIC(24,8) holds.
const DECIMAL_RE = /^\d{1,16}(\.\d{1,8})?$/

/** Split one CSV line, honouring double quotes and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields.map((f) => f.trim())
}

function describeNumber(value: string, what: string): string | null {
  if (value === '') return `${what} is empty`
  if (value.includes(',')) {
    return `${what} "${value}" contains a comma — write 1234.56, not 1,234.56 or 1.234,56`
  }
  if (/^[-+]/.test(value)) return `${what} "${value}" must not be signed`
  if (/e/i.test(value)) return `${what} "${value}" must be a plain decimal, not exponent notation`
  if (!DECIMAL_RE.test(value)) {
    return `${what} "${value}" is not a decimal with at most 8 decimal places`
  }
  return null
}

const isZero = (value: string) => /^0+(\.0+)?$/.test(value)

/**
 * Parse a holdings CSV. Returns every error it can find rather than stopping at the first, so one
 * round trip tells the member everything they have to fix. Callers should store nothing unless
 * `errors` is empty — a partial import is how a portfolio ends up silently half right.
 */
export function parseHoldingsCsv(text: string): ParseResult {
  const errors: CsvError[] = []
  const holdings: ParsedHolding[] = []

  // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become part of the first header.
  const clean = text.replace(/^﻿/, '')
  const lines = clean.split(/\r\n|\n|\r/)

  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() !== '') {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) {
    return { holdings, errors: [{ line: 1, message: 'The file is empty' }] }
  }

  const header = splitCsvLine(lines[headerIndex] ?? '').map((h) => h.toLowerCase())
  const index = {} as Record<Column, number>
  const missing: string[] = []
  for (const col of COLUMNS) {
    const at = header.indexOf(col)
    if (at === -1) missing.push(col)
    else index[col] = at
  }
  const unknown = header.filter((h) => h !== '' && !(COLUMNS as readonly string[]).includes(h))

  if (missing.length > 0) {
    errors.push({
      line: headerIndex + 1,
      message: `Missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. The header must be: ${HOLDINGS_CSV_HEADER}`,
    })
  }
  if (unknown.length > 0) {
    errors.push({
      line: headerIndex + 1,
      message: `Unrecognised column${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}. Download the template rather than renaming your own columns — a column this parser does not know is a column it would not store`,
    })
  }
  if (errors.length > 0) return { holdings, errors }

  const seen = new Map<string, number>()

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    if (raw.trim() === '') continue
    const line = i + 1

    if (holdings.length >= MAX_ROWS) {
      errors.push({
        line,
        message: `More than ${MAX_ROWS} holdings in one file. Split it, or ask for a larger limit`,
      })
      break
    }

    const fields = splitCsvLine(raw)
    if (fields.length !== header.length) {
      errors.push({
        line,
        message: `Expected ${header.length} columns, found ${fields.length}`,
      })
      continue
    }

    const symbol = (fields[index.symbol] ?? '').toUpperCase()
    const mic = (fields[index.mic] ?? '').toUpperCase()
    const currency = (fields[index.currency] ?? '').toUpperCase()
    const units = fields[index.units] ?? ''
    const avgCost = fields[index.avg_cost] ?? ''

    const rowErrors: string[] = []
    if (!SYMBOL_RE.test(symbol)) {
      rowErrors.push(
        symbol === ''
          ? 'symbol is empty'
          : `symbol "${symbol}" is not 1–20 characters of A–Z, 0–9, dot or hyphen`,
      )
    }
    if (!MIC_RE.test(mic)) {
      rowErrors.push(
        mic === ''
          ? 'mic is empty — it is the four-letter exchange code, e.g. XNAS for Nasdaq'
          : `mic "${mic}" is not a four-character exchange code, e.g. XNAS`,
      )
    }
    if (!CURRENCY_RE.test(currency)) {
      rowErrors.push(
        currency === ''
          ? 'currency is empty'
          : `currency "${currency}" is not a three-letter code, e.g. USD`,
      )
    }
    const unitsError = describeNumber(units, 'units')
    if (unitsError) rowErrors.push(unitsError)
    else if (isZero(units)) rowErrors.push('units is zero — remove the row instead')
    const costError = describeNumber(avgCost, 'avg_cost')
    if (costError) rowErrors.push(costError)

    if (rowErrors.length > 0) {
      for (const message of rowErrors) errors.push({ line, message })
      continue
    }

    const key = `${symbol}:${mic}`
    const first = seen.get(key)
    if (first !== undefined) {
      errors.push({
        line,
        message: `${key} appears again — it is already on line ${first}. Combine the two rows; this parser will not choose between them`,
      })
      continue
    }
    seen.set(key, line)

    holdings.push({ symbol, mic, units, avgCost, currency })
  }

  if (errors.length === 0 && holdings.length === 0) {
    errors.push({ line: headerIndex + 1, message: 'The file has a header but no holdings' })
  }

  return { holdings, errors }
}
