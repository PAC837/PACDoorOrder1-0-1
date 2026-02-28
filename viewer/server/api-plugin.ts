import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFromContent } from './pipeline.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewerRoot = resolve(__dirname, '..');
const projectRoot = resolve(viewerRoot, '..');
const publicDataDir = resolve(viewerRoot, 'public', 'data');

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export function pacAdminPlugin(): Plugin {
  return {
    name: 'pac-admin-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // POST /api/parse — accepts raw XML content, parses, writes JSON
        if (req.method === 'POST' && req.url === '/api/parse') {
          try {
            const body = await readJsonBody(req);
            const { doors, toolGroups, toolLib } = body;

            if (!doors || !toolGroups || !toolLib) {
              jsonResponse(res, 400, {
                success: false,
                error: 'Missing required fields: doors, toolGroups, toolLib (raw XML strings)',
              });
              return;
            }

            const result = await parseFromContent(
              doors, toolGroups, toolLib,
              publicDataDir, projectRoot,
            );

            jsonResponse(res, result.success ? 200 : 500, result);
          } catch (e) {
            jsonResponse(res, 500, {
              success: false,
              error: e instanceof Error ? e.message : 'Parse request failed',
            });
          }
          return;
        }

        next();
      });
    },
  };
}
