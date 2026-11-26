// The welcome sigil: an identifier picks four syllables, which name an Urbit
// point, drawn the way Urbit draws one - a tile per syllable, two by two.
// The tiles are Tlon's (sigil-tiles.js), loaded when a sigil is first
// needed. This draws them exactly as @tlon/sigil-js 1.4.5 did.

import { seededPick } from './random.js'

export async function createSigil(agentId) {
    const prefix1 = seededPick(prefixes, agentId)
    const prefix2 = seededPick(prefixes, agentId + 'a')
    const suffix1 = seededPick(suffixes, agentId + 'b')
    const suffix2 = seededPick(suffixes, agentId + 'c')
    return drawSigil([prefix1, suffix1, prefix2, suffix2], {
        size: 512,
        colors: ['black', 'white'],
        className: 'logo'
    })
}

// One, two or four syllables, as an SVG string. Each tile is 128 units
// square; they sit side by side, then wrap, scaled together to `size`.
export async function drawSigil(
    syllables,
    { size = 128, colors: [bg, fg] = ['#000', '#fff'], className = '' } = {}
) {
    const { TILES } = await import('./sigil-tiles.js')
    const scale = (syllables.length === 1 ? size : size / 2) / 128
    const strokeWidth = `${size / 128 + 0.33}px`
    const color = (code) => (code === '@FG' ? fg : bg)

    // Colors in, and every stroke square, one width, unscaled by the zoom.
    // Attributes keep their order; new ones go last.
    const paint = (tile) =>
        tile.replace(/<(\w+) ([^>]*)\/>/g, (_, name, list) => {
            const attrs = new Map(
                Array.from(list.matchAll(/([\w-]+)="([^"]*)"/g), (m) => [
                    m[1],
                    m[2]
                ])
            )
            if (attrs.get('fill') !== 'none')
                attrs.set('fill', color(attrs.get('fill')))
            if (attrs.has('stroke')) {
                attrs.set('stroke', color(attrs.get('stroke')))
                attrs.set('stroke-width', strokeWidth)
                attrs.set('stroke-linecap', 'square')
                attrs.set('vector-effect', 'non-scaling-stroke')
            }
            return `<${name} ${Array.from(attrs, ([k, v]) => `${k}="${v}"`).join(' ')}/>`
        })

    const tiles = syllables.map(
        (syllable, i) =>
            `<g fill="none" transform="matrix(1,0,0,1,${(i % 2) * 128},${Math.floor(i / 2) * 128})">` +
            `${paint(TILES[syllable])}</g>`
    )
    return (
        `<svg viewBox="0 0 ${size} ${size}" version="1.1" xmlns="http://www.w3.org/2000/svg" class="${className}">` +
        `<rect fill="${bg}" width="${size}px" height="${size}px" x="0px" y="0px"/>` +
        `<g transform="matrix(${scale},0,0,${scale},0,0)">${tiles.join('')}</g></svg>`
    )
}

// prettier-ignore
const prefixes = [
    'doz', 'mar', 'bin', 'wan', 'sam', 'lit', 'sig', 'hid', 'fid', 'lis', 'sog',
    'dir', 'wac', 'sab', 'wis', 'sib', 'rig', 'sol', 'dop', 'mod', 'fog', 'lid',
    'hop', 'dar', 'dor', 'lor', 'hod', 'fol', 'rin', 'tog', 'sil', 'mir', 'hol',
    'pas', 'lac', 'rov', 'liv', 'dal', 'sat', 'lib', 'tab', 'han', 'tic', 'pid',
    'tor', 'bol', 'fos', 'dot', 'los', 'dil', 'for', 'pil', 'ram', 'tir', 'win',
    'tad', 'bic', 'dif', 'roc', 'wid', 'bis', 'das', 'mid', 'lop', 'ril', 'nar',
    'dap', 'mol', 'san', 'loc', 'nov', 'sit', 'nid', 'tip', 'sic', 'rop', 'wit',
    'nat', 'pan', 'min', 'rit', 'pod', 'mot', 'tam', 'tol', 'sav', 'pos', 'nap',
    'nop', 'som', 'fin', 'fon', 'ban', 'mor', 'wor', 'sip', 'ron', 'nor', 'bot',
    'wic', 'soc', 'wat', 'dol', 'mag', 'pic', 'dav', 'bid', 'bal', 'tim', 'tas',
    'mal', 'lig', 'siv', 'tag', 'pad', 'sal', 'div', 'dac', 'tan', 'sid', 'fab',
    'tar', 'mon', 'ran', 'nis', 'wol', 'mis', 'pal', 'las', 'dis', 'map', 'rab',
    'tob', 'rol', 'lat', 'lon', 'nod', 'nav', 'fig', 'nom', 'nib', 'pag', 'sop',
    'ral', 'bil', 'had', 'doc', 'rid', 'moc', 'pac', 'rav', 'rip', 'fal', 'tod',
    'til', 'tin', 'hap', 'mic', 'fan', 'pat', 'tac', 'lab', 'mog', 'sim', 'son',
    'pin', 'lom', 'ric', 'tap', 'fir', 'has', 'bos', 'bat', 'poc', 'hac', 'tid',
    'hav', 'sap', 'lin', 'dib', 'hos', 'dab', 'bit', 'bar', 'rac', 'par', 'lod',
    'dos', 'bor', 'toc', 'hil', 'mac', 'tom', 'dig', 'fil', 'fas', 'mit', 'hob',
    'har', 'mig', 'hin', 'rad', 'mas', 'hal', 'rag', 'lag', 'fad', 'top', 'mop',
    'hab', 'nil', 'nos', 'mil', 'fop', 'fam', 'dat', 'nol', 'din', 'hat', 'nac',
    'ris', 'fot', 'rib', 'hoc', 'nim', 'lar', 'fit', 'wal', 'rap', 'sar', 'nal',
    'mos', 'lan', 'don', 'dan', 'lad', 'dov', 'riv', 'bac', 'pol', 'lap', 'tal',
    'pit', 'nam', 'bon', 'ros', 'ton', 'fod', 'pon', 'sov', 'noc', 'sor', 'lav',
    'mat', 'mip', 'fip'
]

// prettier-ignore
const suffixes = [
    'zod', 'nec', 'bud', 'wes', 'sev', 'per', 'sut', 'let', 'ful', 'pen', 'syt',
    'dur', 'wep', 'ser', 'wyl', 'sun', 'ryp', 'syx', 'dyr', 'nup', 'heb', 'peg',
    'lup', 'dep', 'dys', 'put', 'lug', 'hec', 'ryt', 'tyv', 'syd', 'nex', 'lun',
    'mep', 'lut', 'sep', 'pes', 'del', 'sul', 'ped', 'tem', 'led', 'tul', 'met',
    'wen', 'byn', 'hex', 'feb', 'pyl', 'dul', 'het', 'mev', 'rut', 'tyl', 'wyd',
    'tep', 'bes', 'dex', 'sef', 'wyc', 'bur', 'der', 'nep', 'pur', 'rys', 'reb',
    'den', 'nut', 'sub', 'pet', 'rul', 'syn', 'reg', 'tyd', 'sup', 'sem', 'wyn',
    'rec', 'meg', 'net', 'sec', 'mul', 'nym', 'tev', 'web', 'sum', 'mut', 'nyx',
    'rex', 'teb', 'fus', 'hep', 'ben', 'mus', 'wyx', 'sym', 'sel', 'ruc', 'dec',
    'wex', 'syr', 'wet', 'dyl', 'myn', 'mes', 'det', 'bet', 'bel', 'tux', 'tug',
    'myr', 'pel', 'syp', 'ter', 'meb', 'set', 'dut', 'deg', 'tex', 'sur', 'fel',
    'tud', 'nux', 'rux', 'ren', 'wyt', 'nub', 'med', 'lyt', 'dus', 'neb', 'rum',
    'tyn', 'seg', 'lyx', 'pun', 'res', 'red', 'fun', 'rev', 'ref', 'mec', 'ted',
    'rus', 'bex', 'leb', 'dux', 'ryn', 'num', 'pyx', 'ryg', 'ryx', 'fep', 'tyr',
    'tus', 'tyc', 'leg', 'nem', 'fer', 'mer', 'ten', 'lus', 'nus', 'syl', 'tec',
    'mex', 'pub', 'rym', 'tuc', 'fyl', 'lep', 'deb', 'ber', 'mug', 'hut', 'tun',
    'byl', 'sud', 'pem', 'dev', 'lur', 'def', 'bus', 'bep', 'run', 'mel', 'pex',
    'dyt', 'byt', 'typ', 'lev', 'myl', 'wed', 'duc', 'fur', 'fex', 'nul', 'luc',
    'len', 'ner', 'lex', 'rup', 'ned', 'lec', 'ryd', 'lyd', 'fen', 'wel', 'nyd',
    'hus', 'rel', 'rud', 'nes', 'hes', 'fet', 'des', 'ret', 'dun', 'ler', 'nyr',
    'seb', 'hul', 'ryl', 'lud', 'rem', 'lys', 'fyn', 'wer', 'ryc', 'sug', 'nys',
    'nyl', 'lyn', 'dyn', 'dem', 'lux', 'fed', 'sed', 'bec', 'mun', 'lyr', 'tes',
    'mud', 'nyt', 'byr', 'sen', 'weg', 'fyr', 'mur', 'tel', 'rep', 'teg', 'pec',
    'nel', 'nev', 'fes'
]
