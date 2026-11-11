// Vercel Serverless Function: /api/telegram-whale-alert
// Scans live Sui whale transactions & cross-DEX spreads, posting alerts to @volt_swap

const TG_BOT_TOKEN = "8823047918:AAE9IesCCkFYV5jkcsUELc4DrDvZbWFbnHs";
const TG_CHANNEL_ID = "-1004482486964"; // @volt_swap

let postedDigests = new Set();
let lastArbSymbol = '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'voltswap.org';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const radarRes = await fetch(`${protocol}://${host}/api/whale-radar`);
    
    if (!radarRes.ok) {
      return res.status(500).json({ error: "Failed to fetch whale radar feed" });
    }

    const data = await radarRes.json();
    const trades = Array.isArray(data.trades) ? data.trades : [];
    const arbs = Array.isArray(data.crossDexArbs) ? data.crossDexArbs : [];

    // Filter large whale trades (>= $5,000 USD) that happened recently (within last 35 minutes)
    const now = Date.now();
    const freshLargeTrades = trades.filter(t => {
      if (t.usdVal < 5000) return false;
      if (postedDigests.has(t.digest)) return false;
      // Must be recent to avoid re-posting historical trades across cold starts
      const ageMs = now - (t.timestampMs || now);
      return ageMs <= 35 * 60 * 1000;
    });

    let alertSent = false;
    let alertDetails = null;

    if (freshLargeTrades.length > 0) {
      const topTrade = freshLargeTrades.sort((a, b) => b.usdVal - a.usdVal)[0];
      postedDigests.add(topTrade.digest);
      if (postedDigests.size > 200) {
        const first = postedDigests.values().next().value;
        postedDigests.delete(first);
      }

      const shortSender = topTrade.sender.slice(0, 6) + '...' + topTrade.sender.slice(-4);
      const actionVerb = topTrade.side === 'BUY' ? 'Accumulated' : 'Distributed';
      const emojiAction = topTrade.side === 'BUY' ? '🟢' : '🔴';

      const text = 
`🚨 <b>WHALE RADAR ALERT: $${Math.round(topTrade.usdVal).toLocaleString()} SWAP ON SUI!</b>

${emojiAction} <b>Action:</b> Whale ${actionVerb} <b>${topTrade.tokenAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${topTrade.token}</b>
💰 <b>Value:</b> $${Math.round(topTrade.usdVal).toLocaleString()} USD
🎯 <b>Execution Price:</b> $${topTrade.priceUsd < 0.01 ? topTrade.priceUsd.toFixed(6) : topTrade.priceUsd.toFixed(4)}
⚡ <b>Routing Engine:</b> DeepBook v3 CLOB + Cetus CLMM
👤 <b>Whale Wallet:</b> <code>${shortSender}</code>

💡 <b>Alpha Insight:</b> Atomic PTB split-routing eliminated front-running slippage.

👉 <a href="https://voltswap.org/?ref=tg_alpha"><b>Snipe at Whale Entry Price (-20% Fee Discount Active) ➔</b></a>
🔗 <a href="https://suiscan.xyz/mainnet/tx/${topTrade.digest}">View SuiScan Digest</a>`;

      const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHANNEL_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });

      const tgData = await tgRes.json();
      alertSent = tgData.ok;
      alertDetails = { type: 'whale_trade', trade: topTrade };
    } else if (arbs.length > 0) {
      // Pick an arb for a token different from the last one to keep variety
      const candidateArbs = arbs.filter(a => a.symbol !== lastArbSymbol);
      const topArb = candidateArbs.length > 0 ? candidateArbs[0] : arbs[0];
      lastArbSymbol = topArb.symbol;

      const text =
`⚡ <b>LIVE ARBITRAGE SIGNAL DETECTED (+${topArb.spreadPct}%)</b>

💱 <b>Token:</b> #${topArb.symbol}
📈 <b>Cross-Pool Spread:</b> +${topArb.spreadPct}%
🛒 <b>Best Buy Pool:</b> ${topArb.buyDex} ($${topArb.buyPrice.toFixed(4)})
🏷️ <b>Best Sell Pool:</b> ${topArb.sellDex} ($${topArb.sellPrice.toFixed(4)})
💵 <b>Est. Net Profit per $10k:</b> +$${(topArb.spreadPct * 100).toFixed(0)} USD

👉 <a href="https://voltswap.org/?ref=tg_arb"><b>Execute Instant Split Arbitrage (-20% Fee Discount) ➔</b></a>`;

      const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHANNEL_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      const tgData = await tgRes.json();
      alertSent = tgData.ok;
      alertDetails = { type: 'arbitrage_spread', arb: topArb };
    }

    return res.status(200).json({
      success: true,
      alertSent,
      alertDetails,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
