/* Minimal HTTP server so `npm run dev` works */
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: 'backend-hmm', env: process.env.NODE_ENV || 'development' }));
  } else {
    res.writeHead(200);
    res.end(JSON.stringify({ message: 'hmmchat backend placeholder', domain: 'hmmchat.live' }));
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
