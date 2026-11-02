// Volume Society Macro Space — API on Netlify Functions.
// Port of server.py: FRED + calendar proxy, data-provider status and the
// Gemini macro agent (via Netlify AI Gateway).

import { GoogleGenAI } from '@google/genai'

// Only these series can be requested. Keeps the proxy from becoming an
// open fetch service.
const DEFAULT_SERIES = [
  'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5',
  'DGS7', 'DGS10', 'DGS20', 'DGS30', 'T10Y2Y', 'T10Y3M', 'T5YIFR',
  'DFII5', 'DFII10', 'DFII30', 'T5YIE', 'T10YIE',
  'DFF', 'EFFR', 'SOFR', 'IORB', 'DFEDTARU', 'DFEDTARL',
  'NFCI', 'NFCILEVERAGE', 'NFCICREDIT', 'NFCIRISK',
  'BAMLH0A0HYM2', 'BAMLC0A0CM', 'VIXCLS', 'SP500',
  'CPIAUCSL', 'CPILFESL', 'PCEPILFE', 'UNRATE', 'PAYEMS', 'GDPC1',
  'WALCL', 'RRPONTSYD', 'MORTGAGE30US', 'DTWEXBGS', 'DCOILWTICO',
]
const ALLOWED_SERIES = new Set(DEFAULT_SERIES)

const FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv'
const FF_CAL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
// Note: no spoofed browser User-Agent — FRED stalls requests that send one.

const GEMINI_MODEL = 'gemini-3-flash-preview'

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')

function json(obj, status = 200, cacheSeconds = 0) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  }
  if (cacheSeconds > 0) {
    // Cache at the CDN so FRED / calendar are not hit on every page view.
    headers['Netlify-CDN-Cache-Control'] =
      `public, durable, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 6}`
  }
  return new Response(JSON.stringify(obj), { status, headers })
}

async function fetchText(url, timeoutMs = 8000) {
  const res = await fetch(url, {
    headers: { Accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.text()
  if (!body) throw new Error('empty response')
  return body
}

// --------------------------------------------------------------------------- //
// FRED
// --------------------------------------------------------------------------- //

function parseFredCsv(raw, sid) {
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const header = lines[0].split(',').map((h) => h.trim())
  if (!['observation_date', 'date'].includes((header[0] || '').toLowerCase())) return []

  let col = header.indexOf(sid, 1)
  if (col < 1) col = 1

  const out = []
  for (const line of lines.slice(1)) {
    const row = line.split(',')
    if (!row[0] || col >= row.length) continue
    const cell = row[col].trim()
    if (!cell || cell === '.') continue
    const val = Number(cell)
    if (!Number.isFinite(val)) continue
    const day = row[0].trim()
    if (out.length && out[out.length - 1][0] === day) out[out.length - 1] = [day, val]
    else out.push([day, val])
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return out
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function fredPayload(seriesIds, years = 6) {
  const startDate = new Date(Date.now() - (Math.floor(years * 365.25) + 45) * 86400000)
  const start = startDate.toISOString().slice(0, 10)
  const series = {}
  const errors = {}

  await mapLimit(seriesIds, 12, async (sid) => {
    const url = `${FRED_CSV}?id=${encodeURIComponent(sid)}&cosd=${start}`
    try {
      series[sid] = parseFredCsv(await fetchText(url), sid)
    } catch (err) {
      try {
        series[sid] = parseFredCsv(await fetchText(url), sid)
      } catch (err2) {
        series[sid] = []
        errors[sid] = String(err2?.message || err2)
      }
    }
  })

  const latestDates = Object.values(series).filter((p) => p.length).map((p) => p[p.length - 1][0])
  const payload = {
    ok: latestDates.length > 0,
    generated: nowIso(),
    start,
    latest: latestDates.length ? latestDates.sort().at(-1) : null,
    series,
    source: 'FRED / Federal Reserve Bank of St. Louis',
  }
  if (Object.keys(errors).length) {
    payload.errors = errors
    if (!latestDates.length) payload.error = Object.values(errors)[0]
  }
  return payload
}

// --------------------------------------------------------------------------- //
// calendar
// --------------------------------------------------------------------------- //

const IMPACTS = new Set(['High', 'Medium', 'Low', 'Holiday'])
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

async function calendarPayload() {
  try {
    const events = JSON.parse(await fetchText(FF_CAL))
    const clean = []
    for (const e of Array.isArray(events) ? events : []) {
      const title = String(e.title || '').trim()
      const when = String(e.date || '').trim()
      if (!title || !when) continue
      const impact = titleCase(String(e.impact || '').trim())
      clean.push({
        title,
        country: String(e.country || '').trim().toUpperCase(),
        date: when,
        impact: IMPACTS.has(impact) ? impact : 'Low',
        forecast: String(e.forecast || '').trim(),
        previous: String(e.previous || '').trim(),
        actual: String(e.actual || '').trim(),
      })
    }
    clean.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    return { ok: true, generated: nowIso(), events: clean, source: 'ForexFactory calendar (weekly feed)' }
  } catch (err) {
    return { ok: false, error: String(err?.message || err), events: [] }
  }
}

// --------------------------------------------------------------------------- //
// data providers
// --------------------------------------------------------------------------- //

const envFlag = (...names) => names.some((n) => (process.env[n] || '').trim())

function providersPayload() {
  const tradier = envFlag('TRADIER_TOKEN', 'TRADIER_API_KEY')
  const tiingo = envFlag('TIINGO_TOKEN', 'TIINGO_API_KEY')
  const iex = envFlag('IEX_TOKEN', 'IEX_API_KEY')
  const secUa = envFlag('SEC_USER_AGENT')
  const finviz = envFlag('FINVIZ_API_KEY')

  const providers = {
    fred: {
      label: 'FRED', status: 'LIVE', tone: 'live', connected: true, env: [],
      note: 'Public CSV endpoint, no key required.',
    },
    forexfactory: {
      label: 'ForexFactory', status: 'LIVE', tone: 'live', connected: true, env: [],
      note: 'Weekly calendar feed, no key required.',
    },
    tradier: {
      label: 'Tradier',
      status: tradier ? 'ACTIVE' : 'KEY REQUIRED',
      tone: tradier ? 'live' : 'key',
      connected: tradier,
      env: ['TRADIER_TOKEN'],
      note: tradier
        ? 'Real-time SIP quotes, options chains, Greeks and IV.'
        : 'Set TRADIER_TOKEN to enable real-time SIP quotes and options.',
    },
    tiingo_iex: {
      label: 'Tiingo & IEX',
      status: tiingo && iex ? 'ACTIVE' : tiingo || iex ? 'PARTIAL' : 'KEY REQUIRED',
      tone: tiingo && iex ? 'live' : 'key',
      connected: tiingo && iex,
      env: ['TIINGO_TOKEN', 'IEX_TOKEN'],
      note: tiingo && iex
        ? 'Supplementary market feeds ready.'
        : 'Set TIINGO_TOKEN and IEX_TOKEN for supplementary market feeds.',
    },
    sec_edgar: {
      label: 'SEC EDGAR',
      status: secUa ? 'UA SET' : 'FREE API',
      tone: 'free',
      connected: true,
      env: ['SEC_USER_AGENT'],
      note: 'Free public API. Set SEC_USER_AGENT for polite, identified requests.',
    },
    finviz_financedatabase: {
      label: 'Finviz & FinanceDatabase',
      status: finviz ? 'ACTIVE' : 'ATTRIBUTION',
      tone: finviz ? 'free' : 'attribution',
      connected: true,
      env: ['FINVIZ_API_KEY'],
      note: 'Screening and ETF indexing. FinanceDatabase is an optional Python package.',
    },
  }

  const list = Object.values(providers)
  const live = list.filter((p) => p.tone === 'live').length
  const keyed = list.filter((p) => p.tone === 'key').length
  const open = list.filter((p) => p.tone === 'free' || p.tone === 'attribution').length
  const missing = [...new Set(
    list.filter((p) => p.tone === 'key').flatMap((p) => p.env).filter((n) => !(process.env[n] || '').trim()),
  )]

  return {
    ok: true,
    generated: nowIso(),
    providers,
    counts: { live, keyed, open },
    summary: keyed === 0 ? `${live} ACTIVE · ALL FEEDS CONFIGURED` : `${live} LIVE · ${keyed} KEY OPTIONAL · ${open} OPEN`,
    detail: keyed === 0
      ? 'All keyed vendors are configured.'
      : 'Unlock real-time quotes & options: ' + missing.join(' · '),
  }
}

// --------------------------------------------------------------------------- //
// ai agent (Gemini via Netlify AI Gateway)
// --------------------------------------------------------------------------- //

const AGENT_SYSTEM =
  'You are the Gemini macro agent inside the Volume Society Macro Space, a ' +
  'transparent, cool-black macro dashboard. You answer concisely (2-4 sentences ' +
  'when asked for a read, longer only when asked for detail). Base every answer on ' +
  'the macro context supplied in the conversation. Never invent numbers, levels or ' +
  'trends that are not in the context. If the context is missing a value, say so ' +
  'honestly instead of guessing. Be direct, use short macro terms (real yields, ' +
  'curve, NFCI, credit, VIX, liquidity, policy) naturally. End every substantive ' +
  'answer with a brief one-line caveat that this is for information and research ' +
  'only, not investment advice.'

const round = (v, d) => (v == null || !Number.isFinite(Number(v)) ? v : Number(Number(v).toFixed(d)))

function localAgentReply(message, context) {
  const m = (message || '').toLowerCase()
  const mets = context?.metrics || {}
  const sent = context?.sentiment && typeof context.sentiment === 'object' ? context.sentiment : {}
  const brief = context?.brief || 'The macro tape is still loading — the dashboard is gathering its inputs.'
  const tail = ' For information and research only, not investment advice.'
  const has = (...words) => words.some((w) => m.includes(w))

  if (has('bitcoin', 'btc', 'risk-on', 'risk off', 'riskoff')) {
    const bias = sent.daily || sent.intraday || 'NEUTRAL'
    return `${brief} Right now the dashboard's model leans ${bias} on BTC — ${sent.net || ''} across horizons. This is derived from macro conditions, not a price forecast.${tail}`
  }
  if (has('nasdaq', 'ndx', 'sp500', 's&p', 'tech', 'equity', 'equities', 'growth')) {
    const bias = sent.daily || sent.intraday || 'NEUTRAL'
    return `${brief} The model currently leans ${String(bias).toLowerCase()} on the Nasdaq across horizons.${tail}`
  }
  if (has('curve', '2s10s', '2s3m', 'treasury', 'yield curve')) {
    const c = mets.curve2s10s
    return `The 2s10s spread is at ${round(c, 2)}% and the 2s3m at ${round(mets.curve2s3m, 2)}%. The dashboard classifies this as a ${(c || 0) < 0 ? 'restrictive' : 'supportive'} curve backdrop for risk assets.${tail}`
  }
  if (has('real', 'tips', 'breakeven', 'inflation', 'dfii')) {
    return `10Y real yields sit near ${round(mets.real10, 2)}%. The breakeven is near ${round(mets.breakeven10, 2)}%. Real yields are the main lever for growth multiples.${tail}`
  }
  if (has('vix', 'volatil', 'vol', 'fear', 'greed')) {
    return `VIX is around ${round(mets.vix, 1)}. Volatility readings stay inside the dashboard's calm-to-contained range.${tail}`
  }
  if (has('credit', 'hy', 'oas', 'spread', 'lend')) {
    return `HY OAS is around ${round(mets.hyOasBp, 0)}bp. Credit spreads are inside the dashboard's tolerance band for risk assets.${tail}`
  }
  if (has('liquidity', 'fed', 'balance', 'rrp', 'walcl', 'policy', 'fed funds', 'effr')) {
    return `Policy signals: Fed funds (EFFR) context and liquidity measures feed the dashboard's regime read.${tail}`
  }
  return brief
}

async function agentReply(message, context) {
  try {
    const ai = new GoogleGenAI({})
    const userText =
      'Dashboard context (live macro snapshot — do not treat as news):\n' +
      JSON.stringify(context || {}).slice(0, 1800) +
      '\n\nUser question: ' + (message || '')
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: userText,
      config: { systemInstruction: AGENT_SYSTEM, temperature: 0.45, maxOutputTokens: 600 },
    })
    const reply = (response.text || '').trim()
    if (!reply) throw new Error('empty Gemini response')
    return { ok: true, mode: 'gemini', model: GEMINI_MODEL, reply }
  } catch (err) {
    console.error('agent: falling back to local reply', err?.message || err)
    try {
      return { ok: true, mode: 'local', model: 'local-fallback', reply: localAgentReply(message, context) }
    } catch {
      return { ok: false, mode: 'error', reply: 'The macro agent could not answer right now. Try again in a moment.' }
    }
  }
}

function agentStatus() {
  return {
    ok: true,
    provider: 'gemini',
    configured: true,
    mode: 'gemini',
    model: GEMINI_MODEL,
    note: 'Gemini answers from the live dashboard context via Netlify AI Gateway; local fallback on error.',
  }
}

// --------------------------------------------------------------------------- //
// router
// --------------------------------------------------------------------------- //

export default async (req) => {
  const url = new URL(req.url)
  const route = url.pathname.replace(/\/+$/, '')

  if (req.method === 'POST') {
    let body = {}
    try { body = await req.json() } catch { body = {} }
    if (route === '/api/agent') return json(await agentReply(String(body.message || ''), body.context || {}))
    if (route === '/api/providers') return json(providersPayload())
    return json({ ok: false, error: 'not found' }, 404)
  }

  switch (route) {
    case '/api/health':
      return json({ ok: true, time: new Date().toISOString() })
    case '/api/macro': {
      const requested = []
      for (const chunk of url.searchParams.getAll('series').join(',').split(',')) {
        const sid = chunk.trim().toUpperCase()
        if (ALLOWED_SERIES.has(sid) && !requested.includes(sid)) requested.push(sid)
      }
      if (!requested.length) requested.push(...DEFAULT_SERIES)
      const y = parseInt(url.searchParams.get('years') || '6', 10)
      const years = Number.isNaN(y) ? 6 : Math.max(1, Math.min(12, y))
      try {
        const payload = await fredPayload(requested, years)
        return json(payload, 200, payload.ok ? 600 : 0)
      } catch (err) {
        return json({ ok: false, error: String(err?.message || err), series: {} }, 502)
      }
    }
    case '/api/calendar': {
      const payload = await calendarPayload()
      return json(payload, 200, payload.ok ? 1800 : 0)
    }
    case '/api/providers':
      return json(providersPayload())
    case '/api/agent':
      return json(agentStatus())
    default:
      return json({ ok: false, error: 'not found' }, 404)
  }
}

export const config = {
  path: '/api/*',
}
