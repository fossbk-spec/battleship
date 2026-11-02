// Simple Vercel-compatible backend entry point
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Basic routing
  const { url, method } = req;

  // Health check endpoint
  if (url === '/api/health' || url === '/health') {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Battleship Backend API is running on Vercel',
      version: '1.0.0'
    });
  }

  // Root endpoint
  if (url === '/' || url === '/api') {
    return res.json({
      message: 'Battleship Backend API',
      version: '1.0.0',
      status: 'running',
      platform: 'Vercel Serverless',
      timestamp: new Date().toISOString(),
      endpoints: [
        'GET /health - Health check',
        'GET / - API info',
        'GET /docs - API documentation'
      ],
      note: 'Gameplay is served by the persistent Socket.IO backend.'
    });
  }

  // Documentation endpoint
  if (url === '/docs' || url === '/api/docs') {
    return res.json({
      title: 'Battleship Backend API Documentation',
      version: '1.0.0',
      baseUrl: `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`,
      endpoints: {
        'GET /': 'API information',
        'GET /health': 'Health check',
        'GET /docs': 'API documentation'
      },
      gameplay: 'Socket.IO backend',
      cors: `Enabled for ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`
    });
  }

  // 404 for unknown endpoints
  return res.status(404).json({
    error: 'Endpoint not found',
    url: url,
    method: method,
    availableEndpoints: ['/', '/health', '/api/health', '/docs']
  });
}
