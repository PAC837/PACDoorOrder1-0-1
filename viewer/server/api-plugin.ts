import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { readConfig, writeConfig } from './config.js';
import { loadFromFolders, validateToolsFolder, listLibraries, validateTexturesFolder, scanTextures } from './pipeline.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewerRoot = resolve(__dirname, '..');
const projectRoot = resolve(viewerRoot, '..');
const publicDataDir = resolve(viewerRoot, 'public', 'data');

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
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
        // GET /api/config
        if (req.method === 'GET' && req.url === '/api/config') {
          jsonResponse(res, 200, readConfig(viewerRoot));
          return;
        }

        // POST /api/config — partial update
        if (req.method === 'POST' && req.url === '/api/config') {
          try {
            const body = await readJsonBody(req);
            const config = readConfig(viewerRoot);
            if ('toolsFolderPath' in body) config.toolsFolderPath = body.toolsFolderPath;
            if ('librariesFolderPath' in body) config.librariesFolderPath = body.librariesFolderPath;
            if ('selectedLibrary' in body) config.selectedLibrary = body.selectedLibrary;
            if ('texturesFolderPath' in body) config.texturesFolderPath = body.texturesFolderPath;
            if ('selectedTextures' in body) config.selectedTextures = { ...config.selectedTextures, ...body.selectedTextures };
            if ('activeTextureCategory' in body) config.activeTextureCategory = body.activeTextureCategory;
            writeConfig(viewerRoot, config);
            jsonResponse(res, 200, { success: true, config });
          } catch {
            jsonResponse(res, 400, { success: false, error: 'Invalid request body' });
          }
          return;
        }

        // POST /api/validate-tools — check ToolGroups.dat + ToolLib.dat
        if (req.method === 'POST' && req.url === '/api/validate-tools') {
          try {
            const body = await readJsonBody(req);
            const result = validateToolsFolder(body.toolsFolderPath || '');
            jsonResponse(res, 200, result);
          } catch {
            jsonResponse(res, 400, { toolGroups: false, toolLib: false, allPresent: false });
          }
          return;
        }

        // POST /api/validate-libraries — scan folder for .dat files
        if (req.method === 'POST' && req.url === '/api/validate-libraries') {
          try {
            const body = await readJsonBody(req);
            const libraries = listLibraries(body.librariesFolderPath || '');
            jsonResponse(res, 200, { libraries, count: libraries.length });
          } catch {
            jsonResponse(res, 400, { libraries: [], count: 0 });
          }
          return;
        }

        // GET /api/libraries — list .dat files from configured libraries folder
        if (req.method === 'GET' && req.url === '/api/libraries') {
          const config = readConfig(viewerRoot);
          if (!config.librariesFolderPath) {
            jsonResponse(res, 200, { libraries: [] });
            return;
          }
          const libraries = listLibraries(config.librariesFolderPath);
          jsonResponse(res, 200, { libraries });
          return;
        }

        // POST /api/load — run pipeline with specific library file
        if (req.method === 'POST' && req.url === '/api/load') {
          const config = readConfig(viewerRoot);

          let body: any = {};
          try { body = await readJsonBody(req); } catch { /* empty body OK */ }

          if (!config.toolsFolderPath) {
            jsonResponse(res, 400, { success: false, error: 'No CNC Tools folder configured.' });
            return;
          }
          if (!config.librariesFolderPath) {
            jsonResponse(res, 400, { success: false, error: 'No Door Libraries folder configured.' });
            return;
          }

          const library = body.library || config.selectedLibrary;
          if (!library) {
            jsonResponse(res, 400, { success: false, error: 'No library specified.' });
            return;
          }

          const result = await loadFromFolders(
            config.toolsFolderPath, config.librariesFolderPath,
            library, publicDataDir, projectRoot,
          );

          // Persist selected library + load status
          config.selectedLibrary = library;
          config.lastLoadedAt = result.success ? new Date().toISOString() : config.lastLoadedAt;
          config.lastLoadError = result.error ?? null;
          writeConfig(viewerRoot, config);

          jsonResponse(res, result.success ? 200 : 500, result);
          return;
        }

        // POST /api/validate-textures — check for PAC Door Order/ subfolder
        if (req.method === 'POST' && req.url === '/api/validate-textures') {
          try {
            const body = await readJsonBody(req);
            const result = validateTexturesFolder(body.folderPath || '');
            jsonResponse(res, 200, result);
          } catch {
            jsonResponse(res, 400, { valid: false, pacPath: '' });
          }
          return;
        }

        // GET /api/textures — scan texture categories and return manifest
        if (req.method === 'GET' && req.url === '/api/textures') {
          const config = readConfig(viewerRoot);
          if (!config.texturesFolderPath) {
            jsonResponse(res, 200, { painted: {}, primed: [], raw: [], sanded: [], categories: { painted: false, primed: false, raw: false, sanded: false } });
            return;
          }
          const { valid, pacPath } = validateTexturesFolder(config.texturesFolderPath);
          if (!valid) {
            jsonResponse(res, 200, { painted: {}, primed: [], raw: [], sanded: [], categories: { painted: false, primed: false, raw: false, sanded: false } });
            return;
          }
          const manifest = scanTextures(pacPath);
          jsonResponse(res, 200, manifest);
          return;
        }

        // GET /api/texture-image?path=... — serve texture JPG from disk
        if (req.method === 'GET' && req.url?.startsWith('/api/texture-image?')) {
          const config = readConfig(viewerRoot);
          const url = new URL(req.url, 'http://localhost');
          const relPath = url.searchParams.get('path');

          if (!config.texturesFolderPath || !relPath) {
            res.statusCode = 400;
            res.end('Missing texture path');
            return;
          }

          const { valid, pacPath } = validateTexturesFolder(config.texturesFolderPath);
          if (!valid) {
            res.statusCode = 404;
            res.end('PAC Door Order folder not found');
            return;
          }

          const filePath = resolve(pacPath, relPath);
          // Security: ensure resolved path is within the PAC Door Order folder
          if (!filePath.startsWith(pacPath)) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
          }

          if (!existsSync(filePath)) {
            res.statusCode = 404;
            res.end('Texture not found');
            return;
          }

          try {
            const data = readFileSync(filePath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.end(data);
          } catch {
            res.statusCode = 500;
            res.end('Error reading texture file');
          }
          return;
        }

        // POST /api/browse-folder — open native Windows folder picker
        if (req.method === 'POST' && req.url === '/api/browse-folder') {
          const tmpScript = resolve(viewerRoot, '.browse-folder.ps1');
          try {
            let body: any = {};
            try { body = await readJsonBody(req); } catch { /* empty body OK */ }

            const initialDir = body.initialPath || '';
            const description = body.description || 'Select Folder';

            // Write a temp .ps1 script to avoid cmd.exe quoting issues.
            // -STA required for Windows Forms dialogs.
            const scriptLines = [
              'Add-Type -AssemblyName System.Windows.Forms',
              '[System.Windows.Forms.Application]::EnableVisualStyles()',
              '$owner = New-Object System.Windows.Forms.Form',
              '$owner.TopMost = $true',
              '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
              `$d.Description = '${description.replace(/'/g, "''")}'`,
              '$d.ShowNewFolderButton = $false',
              ...(initialDir
                ? [`$d.SelectedPath = '${initialDir.replace(/'/g, "''")}'`]
                : []),
              "if ($d.ShowDialog($owner) -eq 'OK') { Write-Output $d.SelectedPath }",
              '$owner.Dispose()',
            ];
            writeFileSync(tmpScript, scriptLines.join('\r\n'), 'utf-8');

            const result = execSync(
              `powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"`,
              { encoding: 'utf-8', timeout: 60000 },
            ).trim();

            if (result) {
              jsonResponse(res, 200, { success: true, folderPath: result });
            } else {
              jsonResponse(res, 200, { success: false, error: 'No folder selected' });
            }
          } catch (e: any) {
            const stderr = e.stderr?.toString?.() || '';
            const msg = stderr || (e instanceof Error ? e.message : 'Folder picker failed');
            jsonResponse(res, 200, { success: false, error: msg });
          } finally {
            try { unlinkSync(tmpScript); } catch { /* cleanup best-effort */ }
          }
          return;
        }

        next();
      });
    },
  };
}
