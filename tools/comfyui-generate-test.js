#!/usr/bin/env node
'use strict';

/**
 * Mystic Witch Live — single-image ComfyUI smoke test.
 *
 * Submits exactly ONE text-to-image workflow built from nodes that already
 * exist on the remote ComfyUI install, waits for it to finish, and saves the
 * resulting PNG into assets/mystic-witch/tests/.
 *
 * Model choice: RealVisXL V5.0 Lightning (SDXL, photorealistic, distilled for
 * 4-8 steps) — it loads UNet + CLIP + VAE from a single checkpoint file, which
 * is the simplest graph that fits an RTX 3060 12 GB at 832x1216.
 *
 * Usage:
 *   node tools/comfyui-generate-test.js --dry-run     # print graph, queue nothing
 *   node tools/comfyui-generate-test.js               # generate the single test image
 *   node tools/comfyui-generate-test.js --force       # overwrite an earlier test image
 *
 * Safety: refuses to run if the target file already exists (so repeat runs can
 * never silently produce a second image), submits one prompt, and asserts the
 * history entry contains exactly one output image.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ComfyUIClient } = require('../comfyui-client');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'assets', 'mystic-witch', 'tests');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'test-01-witch-832x1216.png');

const CONFIG = {
  checkpoint: 'RealVisXL_V5.0_Lightning_fp16.safetensors',
  positive: [
    'A mysterious, powerful female witch in a dark gothic fantasy chamber,',
    'photorealistic cinematic lighting, purple magical smoke, glowing crystals,',
    'floating ethereal spirits, intricate black lace gown, ornate silver jewellery,',
    'antique tarot table with crystal ball and candles, volumetric god rays,',
    'shallow depth of field, 85mm lens, ultra detailed skin texture, dramatic chiaroscuro,',
    'deep purples and violets, high detail'
  ].join(' '),
  negative: [
    'cartoon, anime, illustration, painting, 3d render, plastic skin,',
    'blurry, low quality, jpeg artifacts, oversaturated, watermark, signature, text,',
    'extra limbs, extra fingers, deformed hands, mutated, duplicate face, cropped'
  ].join(' '),
  width: 832,
  height: 1216,
  steps: 8,
  cfg: 1.5,
  sampler: 'dpmpp_sde',
  scheduler: 'karras',
  seed: 20261103,
  filenamePrefix: 'mystic-witch-test/test-01-witch',
  timeoutMs: 240000
};

/**
 * Standard ComfyUI API-format graph: checkpoint -> 2x CLIP -> latent -> KSampler
 * -> VAE decode -> SaveImage.
 *
 * Link ids are written as STRINGS on purpose: ComfyUI validates a link with
 * `prompt[o_id]['class_type']` while JSON object keys are always strings, so a
 * numeric link id fails validation with a KeyError ("Exception when validating
 * node: 6" / VAEDecode) on this server.
 */
function buildWorkflow(config = CONFIG) {
  return {
    1: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: config.checkpoint }
    },
    2: {
      class_type: 'CLIPTextEncode',
      inputs: { text: config.positive, clip: ['1', 1] }
    },
    3: {
      class_type: 'CLIPTextEncode',
      inputs: { text: config.negative, clip: ['1', 1] }
    },
    4: {
      class_type: 'EmptyLatentImage',
      inputs: { width: config.width, height: config.height, batch_size: 1 }
    },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed: config.seed,
        steps: config.steps,
        cfg: config.cfg,
        sampler_name: config.sampler,
        scheduler: config.scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0]
      }
    },
    6: {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] }
    },
    7: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: config.filenamePrefix, images: ['6', 0] }
    }
  };
}

function parseArgs(argv) {
  const options = { dryRun: false, force: false, baseUrl: process.env.COMFYUI_BASE_URL };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg.startsWith('--url=')) options.baseUrl = arg.slice('--url='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      options.help = true;
    }
  }
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Download raw bytes (the /view endpoint returns an image, not JSON). */
function downloadToFile(urlString, destination) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`/view returned HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(destination)));
      file.on('error', reject);
    });
    request.setTimeout(60000, () => request.destroy(new Error('/view download timed out')));
    request.on('error', reject);
  });
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log('Usage: node tools/comfyui-generate-test.js [--dry-run] [--force] [--url=http://host:port]');
    return 0;
  }

  const workflow = buildWorkflow();
  const client = new ComfyUIClient({
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    timeoutMs: 20000
  });

  console.log('============================================================');
  console.log('🔮 Mystic Witch Live — single test image');
  console.log('============================================================');
  console.log(`ComfyUI      : ${client.baseUrl}`);
  console.log(`Checkpoint   : ${CONFIG.checkpoint}`);
  console.log(`Resolution   : ${CONFIG.width} x ${CONFIG.height} (batch 1)`);
  console.log(`Sampler      : ${CONFIG.sampler} / ${CONFIG.scheduler} · ${CONFIG.steps} steps · cfg ${CONFIG.cfg} · seed ${CONFIG.seed}`);
  console.log(`Output       : ${path.relative(PROJECT_ROOT, OUTPUT_FILE)}`);
  console.log('------------------------------------------------------------');

  if (options.dryRun) {
    console.log('DRY RUN — workflow that would be submitted:');
    console.log(JSON.stringify(workflow, null, 2));
    console.log('Nothing was queued.');
    return 0;
  }

  if (fs.existsSync(OUTPUT_FILE) && !options.force) {
    console.error(`Refusing to run: ${path.relative(PROJECT_ROOT, OUTPUT_FILE)} already exists.`);
    console.error('Pass --force only if you intend to replace the existing test image.');
    return 1;
  }

  const health = await client.checkHealth({ webSocketTimeoutMs: 5000 });
  if (!health.systemStats.ok) {
    console.error(`ComfyUI is not reachable: ${health.systemStats.error}`);
    return 1;
  }
  console.log(`Server ready (ComfyUI ${health.systemStats.comfyuiVersion}, queue ${health.queue.runningCount}/${health.queue.pendingCount})`);

  const startedAt = Date.now();
  const queued = await client.enqueuePrompt(workflow);
  const promptId = queued.prompt_id;
  console.log(`Queued prompt_id : ${promptId}`);
  console.log('Waiting for the single image…');

  let entry = null;
  while (Date.now() - startedAt < CONFIG.timeoutMs) {
    const history = await client.getHistory(promptId);
    const candidate = history && history[promptId];
    if (candidate && candidate.status && candidate.status.status_str === 'error') {
      console.error(`ComfyUI reported an execution error: ${JSON.stringify(candidate.status.messages || candidate.status)}`);
      return 1;
    }
    if (candidate && candidate.outputs && Object.keys(candidate.outputs).length > 0) {
      entry = candidate;
      break;
    }
    await sleep(1200);
  }

  if (!entry) {
    console.error(`Timed out after ${Math.round((Date.now() - startedAt) / 1000)}s waiting for prompt ${promptId}.`);
    return 1;
  }

  const images = Object.values(entry.outputs)
    .flatMap((output) => (Array.isArray(output.images) ? output.images : []))
    .filter((image) => image && image.filename);

  if (images.length !== 1) {
    console.error(`Expected exactly one output image, ComfyUI returned ${images.length}. Nothing saved.`);
    return 1;
  }

  const [image] = images;
  const viewUrl = new URL('/view', client.baseUrl);
  viewUrl.searchParams.set('filename', image.filename);
  viewUrl.searchParams.set('subfolder', image.subfolder || '');
  viewUrl.searchParams.set('type', image.type || 'output');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await downloadToFile(viewUrl.toString(), OUTPUT_FILE);
  const bytes = fs.statSync(OUTPUT_FILE).size;
  const elapsedMs = Date.now() - startedAt;

  console.log('------------------------------------------------------------');
  console.log('✅ Generated exactly one image.');
  console.log(`Saved          : ${path.relative(PROJECT_ROOT, OUTPUT_FILE)} (${(bytes / 1024).toFixed(0)} KB)`);
  console.log(`Server copy    : ${image.subfolder ? `${image.subfolder}/` : ''}${image.filename}`);
  console.log(`Elapsed        : ${(elapsedMs / 1000).toFixed(1)}s`);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`Generation failed: ${error && error.message ? error.message : error}`);
      if (error && error.body) console.error(`Server response: ${error.body}`);
      process.exit(1);
    });
}

module.exports = { buildWorkflow, CONFIG, OUTPUT_FILE, OUTPUT_DIR };
