import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFromContent } from './pipeline.js';
import { getAllStylesWithParams, createDoorStyle, renameDoorStyle, deleteDoorStyle, upsertParam, clearOtherDefaults, reorderDoorStyles } from './db.js';
import { readConfig, writeConfig } from './config.js';
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

        // -------------------------------------------------------------------
        // Configuration database routes
        // -------------------------------------------------------------------

        // GET /api/config/matrix — full matrix of door styles + params
        if (req.method === 'GET' && req.url === '/api/config/matrix') {
          try {
            const styles = getAllStylesWithParams(viewerRoot);
            jsonResponse(res, 200, { styles });
          } catch (e) {
            jsonResponse(res, 500, { error: e instanceof Error ? e.message : 'DB read failed' });
          }
          return;
        }

        // POST /api/config/styles — create a new door style column
        if (req.method === 'POST' && req.url === '/api/config/styles') {
          try {
            const body = await readJsonBody(req);
            if (!body.displayName || typeof body.displayName !== 'string') {
              jsonResponse(res, 400, { error: 'displayName is required' });
              return;
            }
            const style = createDoorStyle(viewerRoot, body.displayName.trim());
            jsonResponse(res, 201, { style });
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Create failed';
            const status = msg.includes('UNIQUE constraint') ? 409 : 500;
            jsonResponse(res, status, { error: msg });
          }
          return;
        }

        // PATCH /api/config/styles/:id — rename a door style
        const patchMatch = req.method === 'PATCH' && req.url?.match(/^\/api\/config\/styles\/([^/]+)$/);
        if (patchMatch) {
          try {
            const body = await readJsonBody(req);
            if (!body.displayName || typeof body.displayName !== 'string') {
              jsonResponse(res, 400, { error: 'displayName is required' });
              return;
            }
            renameDoorStyle(viewerRoot, patchMatch[1], body.displayName.trim());
            jsonResponse(res, 200, { success: true });
          } catch (e) {
            jsonResponse(res, 500, { error: e instanceof Error ? e.message : 'Rename failed' });
          }
          return;
        }

        // DELETE /api/config/styles/:id — remove a door style column
        const deleteMatch = req.method === 'DELETE' && req.url?.match(/^\/api\/config\/styles\/([^/]+)$/);
        if (deleteMatch) {
          try {
            deleteDoorStyle(viewerRoot, deleteMatch[1]);
            jsonResponse(res, 200, { success: true });
          } catch (e) {
            jsonResponse(res, 500, { error: e instanceof Error ? e.message : 'Delete failed' });
          }
          return;
        }

        // PUT /api/config/styles/:id/params/:key — upsert one param value
        const paramMatch = req.method === 'PUT' && req.url?.match(/^\/api\/config\/styles\/([^/]+)\/params\/([^/]+)$/);
        if (paramMatch) {
          try {
            const body = await readJsonBody(req);
            const styleId = paramMatch[1];
            const paramKey = paramMatch[2];
            upsertParam(viewerRoot, styleId, paramKey, body.value);

            // Server-side radio enforcement: when isDefault is set to true, clear all others
            if (paramKey === 'isDefault' && body.value?.enabled === true) {
              clearOtherDefaults(viewerRoot, styleId);
            }

            jsonResponse(res, 200, { success: true });
          } catch (e) {
            jsonResponse(res, 500, { error: e instanceof Error ? e.message : 'Update failed' });
          }
          return;
        }

        // POST /api/config/styles/reorder — reorder style columns
        if (req.method === 'POST' && req.url === '/api/config/styles/reorder') {
          try {
            const body = await readJsonBody(req);
            if (!Array.isArray(body.styleIds)) {
              jsonResponse(res, 400, { error: 'styleIds array is required' });
              return;
            }
            reorderDoorStyles(viewerRoot, body.styleIds);
            jsonResponse(res, 200, { success: true });
          } catch (e) {
            jsonResponse(res, 500, { error: e instanceof Error ? e.message : 'Reorder failed' });
          }
          return;
        }

        // GET /api/config/param-order — get parameter display order
        if (req.method === 'GET' && req.url === '/api/config/param-order') {
          try {
            const config = readConfig(viewerRoot);
            jsonResponse(res, 200, { paramOrder: config.paramOrder });
          } catch (e) {
            jsonResponse(res, 500, { error: e instanceof Error ? e.message : 'Read failed' });
          }
          return;
        }

        // POST /api/config/param-order — save parameter display order
        if (req.method === 'POST' && req.url === '/api/config/param-order') {
          try {
            const body = await readJsonBody(req);
            if (!Array.isArray(body.paramOrder)) {
              jsonResponse(res, 400, { error: 'paramOrder array is required' });
              return;
            }
            const config = readConfig(viewerRoot);
            config.paramOrder = body.paramOrder;
            writeConfig(viewerRoot, config);
            jsonResponse(res, 200, { success: true });
          } catch (e) {
            jsonResponse(res, 500, { error: e instanceof Error ? e.message : 'Write failed' });
          }
          return;
        }

        next();
      });
    },
  };
}
