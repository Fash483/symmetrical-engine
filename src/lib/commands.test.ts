import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, buildCells, buildGroups, cmdKind, parseLinks } from './commands'

const cellsFor = (input: string, s = DEFAULT_SETTINGS) => {
  const items = parseLinks(input)
  return buildCells(items, buildGroups(items), s)
}

describe('parseLinks', () => {
  it('splits links glued together with no spaces', () => {
    const items = parseLinks('https://a.com/One.mkvhttps://b.com/Two.mp4?t=1https://c.com/x.zip')
    expect(items.map((f) => f.url)).toEqual([
      'https://a.com/One.mkv',
      'https://b.com/Two.mp4?t=1',
      'https://c.com/x.zip',
    ])
  })

  it('keeps the query string out of the file name', () => {
    const [f] = parseLinks('https://a.com/d/Film.2024.mkv?token=abc&exp=9')
    expect(f.hasQuery).toBe(true)
    expect(f.name).toBe('Film.2024.mkv')
  })

  it('uses a name line above the link', () => {
    const [f] = parseLinks('3. Real Name.mkv\nhttps://a.com/download/abc123')
    expect(f.name).toBe('Real Name.mkv')
  })
})

describe('commands', () => {
  it('puts each movie alone with --content-disposition when there is no query', () => {
    const cells = cellsFor('https://a.com/A.2020.mkv https://a.com/B.2021.mp4')
    expect(cells.map((c) => c.text)).toEqual([
      '! wget --content-disposition "https://a.com/A.2020.mkv"',
      '! wget --content-disposition "https://a.com/B.2021.mp4"',
    ])
  })

  it('forces the real file name when the link has query parameters', () => {
    const [c] = cellsFor('https://a.com/A.2020.mkv?sig=1')
    expect(c.text).toBe('! wget -O "A.2020.mkv" "https://a.com/A.2020.mkv?sig=1"')
  })
})

describe('filename in URL fragment', () => {
  const a =
    'https://filemirage.com/user/files/download/lez45o1k#Carrie%20S01E01%20FIRST%20PERIOD%20720p%20AMZN%20WEB-DL%20DDP5%201%20Atmos%20H%20264-RAWR%5BEZTVx.to%5D_part01.zip'
  const b = a.replace('lez45o1k', 'j1jtrcbg').replace('part01', 'part02')

  it('uses the #name as the file name and classifies it as zip', () => {
    const items = parseLinks(`${a}\n${b}`)
    expect(items).toHaveLength(2)
    expect(items[0].name).toBe('Carrie S01E01 FIRST PERIOD 720p AMZN WEB-DL DDP5 1 Atmos H 264-RAWR[EZTVx.to]_part01.zip')
    expect(items.every((f) => f.type === 'zip')).toBe(true)
    expect(items.every((f) => cmdKind(f) === 'zip')).toBe(true)
  })
})
