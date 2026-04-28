module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  var url = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return res.status(200).json({
    url: url ? 'SET' : 'MISSING',
    token: token ? 'SET' : 'MISSING',
    allKeys: Object.keys(process.env)
  });
};
