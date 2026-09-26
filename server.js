// CoinGabbarSignals — Backend API
// Simple Express server serving the dashboard's signal, market, and
// performance data as JSON. Swap the in-memory objects below for a
// real database (Postgres/Mongo) when you're ready.

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------
// In-memory data (mirrors the BTC/USDT card in the UI)
// ---------------------------------------------------------------------

const signals = {
  'btc-usdt': {
    id: 'sig_btcusdt_001',
    pair: 'BTC/USDT',
    baseAsset: 'Bitcoin',
    quoteAsset: 'TetherUS',
    direction: 'LONG',
    status: 'ACTIVE',
    generatedAt: '2025-04-26T14:32:00Z',
    tags: ['Spot', 'Futures', 'High Liquidity', 'Top Coin'],
    setupScore: 89,
    confidence: 'Strong Setup',
    timeframe: ['4H', '1H', '15M'],
    entryZone: { min: 65000, max: 65300 },
    stopLoss: 64500,
    takeProfit: [
      { level: 'TP1', price: 66000 },
      { level: 'TP2', price: 67000 },
      { level: 'TP3', price: 68200 }
    ],
    riskReward: '1:2.8',
    qualityClassification: [
      { label: 'Very Strong Setup', range: [90, 100] },
      { label: 'Strong Setup', range: [80, 89] },
      { label: 'Moderate Setup', range: [70, 79] },
      { label: 'Weak Setup', range: [60, 69] },
      { label: 'No Signal', range: [0, 59] }
    ],
    criticalFactors: [
      { label: 'Major security incident', triggered: false },
      { label: 'Extreme liquidity problem', triggered: false },
      { label: 'Entry already invalidated', triggered: false }
    ],
    reasons: [
      'Daily & 4H trend bullish',
      '1H bullish structure',
      'Support retest confirmed',
      'Liquidity sweep completed',
      'Volume increasing',
      'Price above VWAP',
      'EMA structure bullish',
      'OI supportive',
      'Funding neutral',
      'No major negative catalyst'
    ],
    market: {
      classification: 'BULLISH',
      btcTrend: 'Bullish',
      ethTrend: 'Bullish',
      btcDominance: 'Neutral',
      totalMarketCap: 'Uptrend',
      marketSentiment: 'Neutral-Bullish',
      macroEnvironment: 'No major negative'
    },
    technical: {
      classification: 'BULLISH',
      structure: 'HH + HL',
      bos: 'Bullish',
      rsi: 58,
      macd: 'Bullish',
      vwap: 'Above',
      ema: '20 > 50 > 200',
      atr: 'Moderate',
      divergence: 'None'
    },
    derivatives: {
      classification: 'SUPPORTIVE',
      openInterest: 'Increasing',
      fundingRate: 'Neutral',
      liquidations: 'Long squeeze done',
      longShortRatio: 'Balanced',
      orderBook: 'Bid support',
      spread: 'Low'
    },
    riskExecution: {
      classification: 'OPTIMAL',
      riskReward: '1:2.8',
      leverage: 'Low/Moderate',
      liquidity: 'High',
      positionSize: 'Risk-controlled',
      entryQuality: 'Support retest',
      slQuality: 'Structure-based',
      tpQuality: 'Resistance based',
      invalidation: '1H close < 64,500'
    },
    whatCanGoWrong: [
      'BTC loses major support',
      'Volume disappears',
      'Unexpected macro/news event',
      'OI becomes excessively crowded',
      'Breakout becomes false'
    ],
    position: {
      suggestedLeverage: '5x - 10x',
      positionSize: '1 - 3% (Risk)',
      type: 'Spot / Futures (Isolated)'
    },
    chart: {
      symbol: 'BTC/USDT',
      interval: '1h',
      open: 65210,
      high: 65398,
      low: 65120,
      close: 65348,
      change: 138,
      changePct: 0.21
    }
  }
};

const marketOverview = [
  { symbol: 'BTC', price: 65248, changePct: 2.12 },
  { symbol: 'ETH', price: 3482, changePct: 1.76 },
  { symbol: 'TOTAL CAP', price: '2.45T', changePct: 1.89 },
  { symbol: 'BTC DOM', price: '52.3%', changePct: 0.12 }
];

const afterTradeAnalysis = {
  recentSignals: [
    { id: 'BTC LONG #001', score: 89, result: 'TP2', maxPL: 5.2 },
    { id: 'ETH SHORT #002', score: 83, result: 'SL', maxPL: -2.1 },
    { id: 'SOL LONG #003', score: 76, result: 'TP1', maxPL: 2.4 }
  ],
  performanceSummary: {
    sampleSize: 100,
    tp1HitRate: 78,
    avgRMultiple: 1.82,
    winRate: 62,
    profitFactor: 1.46,
    maxDrawdown: 12.8,
    avgWin: 3.2,
    avgLoss: -1.4
  },
  performanceByScoreRange: [
    { range: '90-100', signals: 18, tp1HitRate: 89, avgR: 2.8 },
    { range: '80-89', signals: 32, tp1HitRate: 81, avgR: 2.1 },
    { range: '70-79', signals: 26, tp1HitRate: 65, avgR: 1.5 },
    { range: '60-69', signals: 14, tp1HitRate: 50, avgR: 0.9 }
  ]
};

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// List all signals (summary only)
app.get('/api/signals', (req, res) => {
  const list = Object.values(signals).map((s) => ({
    id: s.id,
    pair: s.pair,
    direction: s.direction,
    status: s.status,
    setupScore: s.setupScore,
    confidence: s.confidence,
    generatedAt: s.generatedAt
  }));
  res.json(list);
});

// Full detail for one signal, e.g. /api/signals/btc-usdt
app.get('/api/signals/:pairSlug', (req, res) => {
  const slug = req.params.pairSlug.toLowerCase();
  const signal = signals[slug];
  if (!signal) {
    return res.status(404).json({ error: `No signal found for "${req.params.pairSlug}"` });
  }
  res.json(signal);
});

// Market overview ticker (sidebar)
app.get('/api/market-overview', (req, res) => {
  res.json(marketOverview);
});

// After-trade analysis + performance stats (right sidebar)
app.get('/api/signals/:pairSlug/after-trade', (req, res) => {
  const slug = req.params.pairSlug.toLowerCase();
  if (!signals[slug]) {
    return res.status(404).json({ error: `No signal found for "${req.params.pairSlug}"` });
  }
  res.json(afterTradeAnalysis);
});

// Fallback 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`CoinGabbarSignals API running at http://localhost:${PORT}`);
});
