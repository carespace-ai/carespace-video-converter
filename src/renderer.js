const dropZone = document.getElementById('dropZone');
const fileList = document.getElementById('fileList');
const btnConvert = document.getElementById('btnConvert');
const btnOutputDir = document.getElementById('btnOutputDir');
const outputPath = document.getElementById('outputPath');
const optWebM = document.getElementById('optWebM');
const optHEVC = document.getElementById('optHEVC');
const bitrateSelect = document.getElementById('bitrate');
const crfSelect = document.getElementById('crf');
const batchProgressEl = document.getElementById('batchProgress');
const batchSummaryEl = document.getElementById('batchSummary');

let files = []; // { path, probe, progress: { webm, hevc }, status }
let outputDir = null;

// ── Batch state ──

let batchActive = false;
let batchCancelled = false;
let batchFileIndex = -1; // index of currently converting file
let batchTotal = 0;
let batchDone = 0;

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
  if (batchActive) return;
  const paths = await window.api.selectFiles();
  if (paths.length) await addFiles(paths);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!batchActive) dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (batchActive) return;
  const paths = [...e.dataTransfer.files]
    .filter((f) => f.name.endsWith('.mov'))
    .map((f) => window.api.getFilePath(f));
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

// ── UI lock during batch ──

function setBatchUILock(locked) {
  dropZone.style.pointerEvents = locked ? 'none' : '';
  dropZone.style.opacity = locked ? '0.5' : '';
  optWebM.style.pointerEvents = locked ? 'none' : '';
  optHEVC.style.pointerEvents = locked ? 'none' : '';
  bitrateSelect.disabled = locked;
  crfSelect.disabled = locked;
  btnOutputDir.disabled = locked;
}

// ── Convert / Cancel ──

btnConvert.addEventListener('click', async () => {
  // If batch is active, this click means cancel
  if (batchActive) {
    batchCancelled = true;
    btnConvert.disabled = true;
    btnConvert.textContent = 'Cancelling...';
    await window.api.cancelConvert();
    return;
  }

  const webm = optWebM.classList.contains('selected');
  const hevc = optHEVC.classList.contains('selected');
  if (!webm && !hevc) return;

  // Start batch
  batchActive = true;
  batchCancelled = false;
  batchSummaryEl.innerHTML = '';

  const pendingFiles = files.filter((f) => f.status?.type !== 'success');
  batchTotal = pendingFiles.length;
  batchDone = 0;

  btnConvert.textContent = 'Cancel Batch';
  btnConvert.classList.add('cancel-mode');
  setBatchUILock(true);
  render();

  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.status?.type === 'success') continue;

    // Check cancel before starting this file
    if (batchCancelled) {
      file.status = { type: 'cancelled', message: 'Cancelled' };
      cancelled++;
      render();
      continue;
    }

    batchFileIndex = i;
    file.status = { type: 'converting', message: 'Converting...' };
    file.progress = { webm: 0, hevc: 0 };
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

      // After convert returns, check if we were cancelled mid-conversion
      if (batchCancelled) {
        const anyFailed = results.some((r) => !r.success);
        if (anyFailed) {
          file.status = { type: 'cancelled', message: 'Cancelled' };
          cancelled++;
        } else {
          // Conversion actually completed before kill took effect
          file.status = { type: 'success', message: 'Done' };
          file.progress = { webm: 100, hevc: 100 };
          succeeded++;
        }
      } else {
        const failedResults = results.filter((r) => !r.success);
        if (failedResults.length) {
          file.status = {
            type: 'error',
            message: failedResults.map((f) => `${f.format}: ${f.error}`).join('; '),
          };
          failed++;
        } else {
          file.status = { type: 'success', message: 'Done' };
          file.progress = { webm: 100, hevc: 100 };
          succeeded++;
        }
      }
    } catch (err) {
      if (batchCancelled) {
        file.status = { type: 'cancelled', message: 'Cancelled' };
        cancelled++;
      } else {
        file.status = { type: 'error', message: err.message };
        failed++;
      }
    }

    batchDone++;
    render();
  }

  // Reset batch state
  batchActive = false;
  batchCancelled = false;
  batchFileIndex = -1;

  btnConvert.textContent = 'Convert';
  btnConvert.classList.remove('cancel-mode');
  btnConvert.disabled = files.length === 0;
  setBatchUILock(false);

  showBatchSummary(succeeded, failed, cancelled);
  render();
});

// ── Batch summary ──

function showBatchSummary(succeeded, failed, cancelled) {
  const total = succeeded + failed + cancelled;
  batchSummaryEl.innerHTML = `
    <div class="batch-summary">
      <div class="counts">
        <span class="succeeded">${succeeded} succeeded</span>
        <span class="failed">${failed} failed</span>
        <span class="cancelled">${cancelled} cancelled</span>
        <span style="color:#666">${total} total</span>
      </div>
    </div>
  `;

  setTimeout(() => {
    batchSummaryEl.innerHTML = '';
  }, 10000);
}

// ── Render ──

function render() {
  btnConvert.disabled = files.length === 0 && !batchActive;

  // Overall batch progress
  if (batchActive) {
    const currentFile = files[batchFileIndex];
    const currentFileProgress = currentFile
      ? Math.max(currentFile.progress.webm, currentFile.progress.hevc)
      : 0;
    const overallPercent =
      batchTotal > 0 ? Math.round(((batchDone + currentFileProgress / 100) / batchTotal) * 100) : 0;

    batchProgressEl.innerHTML = `
      <div class="batch-progress">
        <div class="batch-counter">${batchDone}/${batchTotal} files — ${overallPercent}%</div>
        <div class="batch-bar"><div class="fill" style="width:${overallPercent}%"></div></div>
      </div>
    `;
  } else {
    batchProgressEl.innerHTML = '';
  }

  // File list
  fileList.innerHTML = files
    .map(
      (f, i) => `
      <div class="file-item${batchActive && i === batchFileIndex ? ' active' : ''}">
        <span class="name" title="${f.path}">${f.probe?.fileName || f.path.split('/').pop()}</span>
        ${
          f.probe
            ? `<span class="meta">${f.probe.width}x${f.probe.height}</span>
               <span class="alpha-badge ${f.probe.hasAlpha ? 'has-alpha' : 'no-alpha'}">
                 ${f.probe.hasAlpha ? 'ALPHA' : 'NO ALPHA'}
               </span>`
            : ''
        }
        ${canRemoveFile(f) ? `<button class="remove" data-idx="${i}">&times;</button>` : ''}
      </div>
      ${
        f.status?.type === 'converting'
          ? `<div class="progress-bar"><div class="fill" style="width:${Math.max(f.progress.webm, f.progress.hevc)}%"></div></div>
             <div class="status converting">Converting... ${Math.max(f.progress.webm, f.progress.hevc)}%</div>`
          : ''
      }
      ${f.status?.type === 'success' ? `<div class="status success">Converted successfully</div>` : ''}
      ${f.status?.type === 'error' ? `<div class="status error">${f.status.message}</div>` : ''}
      ${f.status?.type === 'cancelled' ? `<div class="status cancelled">Cancelled</div>` : ''}
    `
    )
    .join('');

  fileList.querySelectorAll('.remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeFile(files[parseInt(btn.dataset.idx)].path);
    });
  });
}

function canRemoveFile(file) {
  // During batch: only allow removal of pending files (no status yet)
  if (batchActive) {
    return !file.status;
  }
  // Outside batch: allow removal of any file
  return true;
}
