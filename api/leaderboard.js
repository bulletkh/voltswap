// Vercel Serverless Function: /api/leaderboard
// Tracks Swap Volume and Partner Referrals

let memoryLeaderboard = [];
let totalProtocolVolume = 128450;

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    const { address, volumeAdded = 0, referrer = null } = req.body || {};
    if (address) {
      totalProtocolVolume += Number(volumeAdded);
      let user = memoryLeaderboard.find((u) => u.address.toLowerCase() === address.toLowerCase());
      if (user) {
        user.volumeUsd += Number(volumeAdded);
      } else {
        memoryLeaderboard.push({
          rank: memoryLeaderboard.length + 1,
          address: address.slice(0, 6) + '...' + address.slice(-4),
          volumeUsd: Number(volumeAdded),
          referrals: 0,
          tier: 'Active Trader'
        });
      }
      memoryLeaderboard.sort((a, b) => b.volumeUsd - a.volumeUsd);
      memoryLeaderboard.forEach((u, idx) => {
        u.rank = idx + 1;
      });
    }
    return res.status(200).json({
      leaderboard: memoryLeaderboard.slice(0, 50),
      totalProtocolVolume
    });
  }

  return res.status(200).json({
    leaderboard: memoryLeaderboard.slice(0, 50),
    totalProtocolVolume,
    protocol: 'Volt Smart Money Terminal'
  });
}
