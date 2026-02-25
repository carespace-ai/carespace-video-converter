const dropZone = document.getElementById('dropZone');
const fileList = document.getElementById('fileList');
const btnConvert = document.getElementById('btnConvert');
const btnOutputDir = document.getElementById('btnOutputDir');
const outputPath = document.getElementById('outputPath');
const optWebM = document.getElementById('optWebM');
const optHEVC = document.getElementById('optHEVC');
const bitrateSelect = document.getElementById('bitrate');
const crfSelect = document.getElementById('crf');

let files = []; // { path, probe, progress: { webm, hevc }, status }
let outputDir = null;

// ── Format toggles ──

optWebM.addEventListener('click', () => optWebM.classList.toggle('selected'));
optHEVC.addEventListener('click', () => optHEVC.classList.toggle('selected'));

// ── Output directory ──

btnOutputDir.addEventListener('click', async () => {
  const dir = await window.api.selectOutputDir();
  if (dir) {
    outputDir = dir;
    outputPath.textContent = dir;
  }
});

// ── Drop zone ──

dropZone.addEventListener('click', async () => {
  const paths = await window.api.selectFiles();
  if (paths.length) await addFiles(paths);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const paths = [...e.dataTransfer.files]
    .filter((f) => f.name.endsWith('.mov'))
    .map((f) => f.path);
  if (paths.length) await addFiles(paths);
});

// ── File management ──

async function addFiles(paths) {
  for (const p of paths) {
    if (files.some((f) => f.path === p)) continue;

    try {
      const probe = await window.api.probeFile(p);
      files.push({
        path: p,
        probe,
        progress: { webm: 0, hevc: 0 },
        status: null,
      });
    } catch (err) {
      files.push({
        path: p,
        probe: null,
        progress: { webm: 0, hevc: 0 },
        status: { type: 'error', message: `Probe failed: ${err.message}` },
      });
    }
  }
  render();
}

function removeFile(path) {
  files = files.filter((f) => f.path !== path);
  render();
}

// ── Progress listener ──

window.api.onProgress(({ filePath, format, progress }) => {
  const file = files.find((f) => f.path === filePath);
  if (file) {
    file.progress[format] = progress;
    render();
  }
});

// ── Convert ──

btnConvert.addEventListener('click', async () => {
  const webm = optWebM.classList.contains('selected');
  const hevc = optHEVC.classList.contains('selected');

  if (!webm && !hevc) return;

  btnConvert.disabled = true;
  btnConvert.textContent = 'Converting...';

  for (const file of files) {
    if (file.status?.type === 'success') continue;

    file.status = { type: 'converting', message: 'Converting...' };
    render();

    const dir = outputDir || file.path.substring(0, file.path.lastIndexOf('/'));

    try {
      const results = await window.api.convert({
        filePath: file.path,
        outputDir: dir,
        options: {
          webm,
          hevc,
          bitrate: bitrateSelect.value,
          crf: parseInt(crfSelect.value),
        },
      });

      const failed = results.filter((r) => !r.success);
      if (failed.length) {
        file.status = { type: 'error', message: failed.map((f) => `${f.format}: ${f.error}`).join('; ') };
      } else {
        file.status = { type: 'success', message: 'Done' };
        file.progress = { webm: 100, hevc: 100 };
      }
    } catch (err) {
      file.status = { type: 'error', message: err.message };
    }

    render();
  }

  btnConvert.disabled = false;
  btnConvert.textContent = 'Convert';
  render();
});

// ── Render ──

function render() {
  btnConvert.disabled = files.length === 0;

  fileList.innerHTML = files
    .map(
      (f, i) => `
      <div class="file-item">
        <span class="name" title="${f.path}">${f.probe?.fileName || f.path.split('/').pop()}</span>
        ${
          f.probe
            ? `<span class="meta">${f.probe.width}x${f.probe.height}</span>
               <span class="alpha-badge ${f.probe.hasAlpha ? 'has-alpha' : 'no-alpha'}">
                 ${f.probe.hasAlpha ? 'ALPHA' : 'NO ALPHA'}
               </span>`
            : ''
        }
        <button class="remove" data-idx="${i}">&times;</button>
      </div>
      ${
        f.status?.type === 'converting'
          ? `<div class="progress-bar"><div class="fill" style="width:${Math.max(f.progress.webm, f.progress.hevc)}%"></div></div>
             <div class="status converting">Converting... ${Math.max(f.progress.webm, f.progress.hevc)}%</div>`
          : ''
      }
      ${f.status?.type === 'success' ? `<div class="status success">Converted successfully</div>` : ''}
      ${f.status?.type === 'error' ? `<div class="status error">${f.status.message}</div>` : ''}
    `
    )
    .join('');

  fileList.querySelectorAll('.remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeFile(files[parseInt(btn.dataset.idx)].path);
    });
  });
}
