// Tests for the holdings CSV parser (W3 / ST-015).
//
// The parser is the only thing standing between a member's spreadsheet and a NUMERIC column, so
// the cases that matter are the ones where a wrong answer would be *plausible*: a European decimal
// comma, a renamed column, the same instrument twice, and a number that survives the trip only
// because it was never turned into a float.

import { describe, it, expect } from 'vitest'
import {
  parseHoldingsCsv,
  splitCsvLine,
  HOLDINGS_CSV_TEMPLATE,
  MAX_ROWS,
} from '../src/lib/holdings-csv'

const HEADER = 'symbol,mic,units,avg_cost,currency'
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n')

describe('splitCsvLine', () => {
  it('splits plain fields and trims them', () => {
    expect(splitCsvLine('AAPL, XNAS ,10,182.50,USD')).toEqual(['AAPL', 'XNAS', '10', '182.50', 'USD'])
  })

  it('keeps a comma inside quotes out of the field split', () => {
    expect(splitCsvLine('"Nvidia, Inc.",XNAS,1,2,USD')).toEqual(['Nvidia, Inc.', 'XNAS', '1', '2', 'USD'])
  })

  it('reads "" as one literal quote', () => {
    expect(splitCsvLine('"a""b",c')).toEqual(['a"b', 'c'])
  })

  it('returns an empty field for an empty line', () => {
    expect(splitCsvLine('')).toEqual([''])
  })
})

describe('parseHoldingsCsv — the happy path', () => {
  it('parses the template it hands out', () => {
    const { holdings, errors } = parseHoldingsCsv(HOLDINGS_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(holdings).toEqual([
      { symbol: 'AAPL', mic: 'XNAS', units: '10', avgCost: '182.50', currency: 'USD' },
      { symbol: 'VWRL', mic: 'XAMS', units: '25', avgCost: '105.20', currency: 'EUR' },
    ])
  })

  it('keeps numbers as strings, digit for digit', () => {
    const { holdings, errors } = parseHoldingsCsv(csv('AAPL,XNAS,0.10000001,33.33333333,USD'))
    expect(errors).toEqual([])
    // Not 0.10000001000000001, and not 33.33333333000001: nothing here has been through a double.
    expect(holdings[0]!.units).toBe('0.10000001')
    expect(holdings[0]!.avgCost).toBe('33.33333333')
  })

  it('upper-cases symbol, mic and currency, and accepts columns in any order', () => {
    const { holdings, errors } = parseHoldingsCsv('currency,units,mic,avg_cost,symbol\nusd,10,xnas,1.5,aapl')
    expect(errors).toEqual([])
    expect(holdings[0]).toEqual({ symbol: 'AAPL', mic: 'XNAS', units: '10', avgCost: '1.5', currency: 'USD' })
  })

  it('survives CRLF, a BOM and blank lines', () => {
    const { holdings, errors } = parseHoldingsCsv(`﻿${HEADER}\r\n\r\nAAPL,XNAS,1,2,USD\r\n`)
    expect(errors).toEqual([])
    expect(holdings).toHaveLength(1)
  })

  it('allows a zero average cost — a gifted or vested holding cost nothing', () => {
    expect(parseHoldingsCsv(csv('AAPL,XNAS,5,0,USD')).errors).toEqual([])
  })

  it('accepts a dot or hyphen in a symbol, as European listings use', () => {
    expect(parseHoldingsCsv(csv('BRK.B,XNYS,1,400,USD', 'RDS-A,XLON,1,25,GBP')).errors).toEqual([])
  })
})

describe('parseHoldingsCsv — refusals', () => {
  it('refuses a decimal comma instead of reading it as a thousands separator', () => {
    const { holdings, errors } = parseHoldingsCsv(csv('AAPL,XNAS,"1,5",182.50,USD'))
    expect(holdings).toEqual([])
    expect(errors[0]!.message).toMatch(/comma/)
    // The point: 1,5 is 1.5 in half the world and 15000 in the other half. Guessing is the bug.
  })

  it('refuses an unrecognised column rather than silently ignoring it', () => {
    const { errors } = parseHoldingsCsv('symbol,mic,quantity,avg_cost,currency\nAAPL,XNAS,10,1,USD')
    expect(errors.some((e) => /Missing column units/.test(e.message))).toBe(true)
    expect(errors.some((e) => /Unrecognised column quantity/.test(e.message))).toBe(true)
  })

  it('refuses the same instrument twice and names the earlier line', () => {
    const { holdings, errors } = parseHoldingsCsv(csv('AAPL,XNAS,10,1,USD', 'AAPL,XNAS,5,2,USD'))
    expect(holdings).toHaveLength(1)
    expect(errors[0]!.line).toBe(3)
    expect(errors[0]!.message).toMatch(/already on line 2/)
  })

  it('treats the same symbol on two exchanges as two instruments', () => {
    const { holdings, errors } = parseHoldingsCsv(csv('AAPL,XNAS,10,1,USD', 'AAPL,XFRA,5,2,EUR'))
    expect(errors).toEqual([])
    expect(holdings).toHaveLength(2)
  })

  it('refuses negative and zero units', () => {
    expect(parseHoldingsCsv(csv('AAPL,XNAS,-10,1,USD')).errors[0]!.message).toMatch(/must not be signed/)
    expect(parseHoldingsCsv(csv('AAPL,XNAS,0,1,USD')).errors[0]!.message).toMatch(/zero/)
  })

  it('refuses exponent notation', () => {
    expect(parseHoldingsCsv(csv('AAPL,XNAS,1e3,1,USD')).errors[0]!.message).toMatch(/exponent/)
  })

  it('refuses more than eight decimal places, which the column cannot hold', () => {
    expect(parseHoldingsCsv(csv('AAPL,XNAS,1.123456789,1,USD')).errors[0]!.message).toMatch(/8 decimal places/)
  })

  it('refuses a currency or mic of the wrong shape, with the code it saw', () => {
    expect(parseHoldingsCsv(csv('AAPL,XNAS,1,1,DOLLARS')).errors[0]!.message).toMatch(/"DOLLARS"/)
    expect(parseHoldingsCsv(csv('AAPL,NASDAQ,1,1,USD')).errors[0]!.message).toMatch(/four-character/)
  })

  it('reports every bad row, not just the first', () => {
    const { holdings, errors } = parseHoldingsCsv(
      csv('AAPL,XNAS,1,1,USD', 'BAD ONE,XNAS,1,1,USD', 'MSFT,XNAS,x,1,USD'),
    )
    expect(holdings).toHaveLength(1) // AAPL parsed, but a caller must store nothing
    expect(errors.map((e) => e.line)).toEqual([3, 4])
  })

  it('reports a wrong column count instead of shifting the values along', () => {
    expect(parseHoldingsCsv(csv('AAPL,XNAS,1,USD')).errors[0]!.message).toMatch(/Expected 5 columns, found 4/)
  })

  it('refuses an empty file and a header with no rows', () => {
    expect(parseHoldingsCsv('').errors[0]!.message).toMatch(/empty/)
    expect(parseHoldingsCsv('   \n').errors[0]!.message).toMatch(/empty/)
    expect(parseHoldingsCsv(HEADER).errors[0]!.message).toMatch(/no holdings/)
  })

  it('stops at the row limit rather than working through a pasted database', () => {
    const rows = Array.from({ length: MAX_ROWS + 10 }, (_, i) => `SYM${i},XNAS,1,1,USD`)
    const { holdings, errors } = parseHoldingsCsv(csv(...rows))
    expect(holdings).toHaveLength(MAX_ROWS)
    expect(errors[0]!.message).toMatch(new RegExp(`More than ${MAX_ROWS}`))
  })

  it('does not let a header row of the wrong file look like holdings', () => {
    const { errors } = parseHoldingsCsv('Date,Description,Debit Amount,Credit Amount\n24 Sep 2026,COFFEE,4.50,')
    expect(errors.some((e) => /Missing columns/.test(e.message))).toBe(true)
  })
})
