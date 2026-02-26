import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

export function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';
      const filePath = join(FIXTURES_DIR, url === '/' ? 'simple.html' : url);
      const ext = extname(filePath);
      const contentType = ext === '.html' ? 'text/html' : 'text/plain';

      try {
        const content = readFileSync(filePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
    };

    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
      }
    });
  });
}
