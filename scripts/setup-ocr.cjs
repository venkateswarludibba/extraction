
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const target = path.join(root, 'public', 'ocr');

function copyIfChanged(source, destination) {
  const sourceStat = fs.statSync(source);

  if (fs.existsSync(destination)) {
    const targetStat = fs.statSync(destination);

    if (
      sourceStat.size === targetStat.size &&
      sourceStat.mtimeMs <= targetStat.mtimeMs
    ) {
      console.log('Already available:', path.basename(destination));
      return;
    }
  }

  fs.copyFileSync(source, destination);
  console.log('Copied:', path.basename(destination));
}

async function downloadIfMissing(url, destination) {
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
    console.log('Already downloaded:', path.basename(destination));
    return;
  }

  console.log('Downloading:', url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const temp = destination + '.tmp';

  try {
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, destination);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }

  console.log('Downloaded:', path.basename(destination));
}

async function setup() {
  fs.mkdirSync(target, { recursive: true });

  const workerSource = require.resolve(
    'tesseract.js/dist/worker.min.js'
  );

  copyIfChanged(
    workerSource,
    path.join(target, 'worker.min.js')
  );

  const coreDir = path.dirname(
    require.resolve('tesseract.js-core/package.json')
  );

  const coreFiles = fs.readdirSync(coreDir).filter(file =>
    file.startsWith('tesseract-core') &&
    (file.endsWith('.js') || file.endsWith('.wasm'))
  );

  if (coreFiles.length === 0) {
    throw new Error('No Tesseract core files found.');
  }

  for (const file of coreFiles) {
    copyIfChanged(
      path.join(coreDir, file),
      path.join(target, file)
    );
  }

  await downloadIfMissing(
    'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz',
    path.join(target, 'eng.traineddata.gz')
  );

  console.log('\nOCR setup completed:', target);
}

setup().catch(error => {
  console.error('OCR setup failed:', error);
  process.exitCode = 1;
});
