#!/usr/bin/env node
'use strict';

/**
 * Mystic Witch Live — ComfyUI test-image generator.
 *
 * One script, one shared workflow, several art-direction variants. It submits
 * exactly ONE text-to-image workflow built from nodes that already exist on the
 * remote ComfyUI install, waits for it to finish, and saves the PNG into
 * assets/mystic-witch/tests/.
 *
 * Model choice: RealVisXL V5.0 Lightning (SDXL, photorealistic, distilled for
 * 4-8 steps) — it loads UNet + CLIP + VAE from a single checkpoint file, which
 * is the simplest graph that fits an RTX 3060 12 GB at 832x1216.
 *
 * Usage:
 *   node tools/comfyui-generate-test.js --variant=test-01 --dry-run
 *   node tools/comfyui-generate-test.js --variant=test-02
 *   node tools/comfyui-generate-test.js --variant=test-02 --force   # replace that variant
 *
 * Safety: refuses to run if that variant's file already exists (so a repeat run
 * can never silently produce a second image), submits one prompt, and asserts
 * the history entry contains exactly one output image.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ComfyUIClient } = require('../comfyui-client');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'assets', 'mystic-witch', 'tests');

/** Shared generation settings — identical for every variant. */
const BASE = {
  checkpoint: 'RealVisXL_V5.0_Lightning_fp16.safetensors',
  width: 832,
  height: 1216,
  steps: 8,
  cfg: 1.5,
  sampler: 'dpmpp_sde',
  scheduler: 'karras',
  timeoutMs: 240000
};

/**
 * Art-direction variants. `test-01` is the original character study (a visible
 * face). `test-02` is the approved direction: a faceless hooded entity, framed
 * full-length so the model cannot fall back to a beauty portrait.
 */
const VARIANTS = {
  'test-01': {
    label: 'visible-face witch study (superseded)',
    file: 'test-01-witch-832x1216.png',
    prefix: 'mystic-witch-test/test-01-witch',
    seed: 20261103,
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
    ].join(' ')
  },
  'test-02': {
    label: 'faceless hooded witch entity',
    file: 'test-02-hooded-witch.png',
    prefix: 'mystic-witch-test/test-02-hooded-witch',
    seed: 20261104,
    positive: [
      'An ancient supernatural witch entity in a dark gothic tarot chamber,',
      'tall elegant intimidating silhouette, full length wide shot, full body visible,',
      'floor-length black gothic hooded robe with heavy flowing fabric and layered folds,',
      'deep oversized pointed hood pulled low, face completely hidden in absolute darkness inside the hood,',
      'empty black void under the cowl, no eyes no nose no lips, featureless shadowed head,',
      'faceless, no skin visible, black gloves, ancient and powerful supernatural presence,',
      'glowing purple magical energy streaming from both hands, violet arcane light,',
      'several translucent ghost spirits floating around her, ethereal souls with soft glowing pale eyes,',
      'abstract ghostly wisp forms, drifting spirits made of pale mist,',
      'purple smoke and floating magical particles, embers in the air,',
      'ancient occult chamber, crystal ball on a carved stone altar, melted candles,',
      'esoteric symbols and runes engraved across the walls and floor,',
      'photorealistic dark gothic fantasy, cinematic lighting, deep shadows, purple and violet highlights,',
      'volumetric fog, dramatic backlight rim light, high detail, 35mm lens, atmospheric and supernatural'
    ].join(' '),
    negative: [
      'beautiful woman, pretty face, visible face, portrait, fashion model, makeup, glamour photography,',
      'cosplay, smiling, exposed skin, anime, cartoon, illustration, low quality,',
      'close-up, face closeup, headshot, human face, detailed facial features, visible eyes, nose, lips,',
      'cleavage, bare shoulders, bare arms, blonde hair, long hair visible, jewellery, tiara, crown,',
      'blurry, jpeg artifacts, oversaturated, watermark, signature, text,',
      'extra limbs, extra fingers, deformed hands, mutated, duplicate body, cropped'
    ].join(' ')
  }
};

const DEFAULT_VARIANT = 'test-01';

function variantConfig(name) {
  const variant = VARIANTS[name];
  if (!variant) {
    throw new Error(`Unknown variant "${name}". Available: ${Object.keys(VARIANTS).join(', ')}`);
  }
  return {
    ...BASE,
    ...variant,
    outputFile: path.join(OUTPUT_DIR, variant.file)
  };
}

/**
 * Standard ComfyUI API-format graph: checkpoint -> 2x CLIP -> latent -> KSampler
 * -> VAE decode -> SaveImage.
 *
 * Link ids are written as STRINGS on purpose: ComfyUI validates a link with
 * `prompt[o_id]['class_type']` while JSON object keys are always strings, so a
 * numeric link id fails validation with a KeyError ("Exception when validating
 * node: 6" / VAEDecode) on this server.
 */
function buildWorkflow(config = variantConfig(DEFAULT_VARIANT)) {
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
      inputs: { filename_prefix: config.prefix, images: ['6', 0] }
    }
  };
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    force: false,
    variant: DEFAULT_VARIANT,
    baseUrl: process.env.COMFYUI_BASE_URL
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg.startsWith('--variant=')) options.variant = arg.slice('--variant='.length);
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
    console.log('Usage: node tools/comfyui-generate-test.js [--variant=test-01|test-02] [--dry-run] [--force] [--url=http://host:port]');
    return 0;
  }

  const config = variantConfig(options.variant);
  const workflow = buildWorkflow(config);
  const client = new ComfyUIClient({
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    timeoutMs: 20000
  });

  console.log('============================================================');
  console.log(`🔮 Mystic Witch Live — ${options.variant} · ${config.label}`);
  console.log('============================================================');
  console.log(`ComfyUI      : ${client.baseUrl}`);
  console.log(`Checkpoint   : ${config.checkpoint}`);
  console.log(`Resolution   : ${config.width} x ${config.height} (batch 1)`);
  console.log(`Sampler      : ${config.sampler} / ${config.scheduler} · ${config.steps} steps · cfg ${config.cfg} · seed ${config.seed}`);
  console.log(`Output       : ${path.relative(PROJECT_ROOT, config.outputFile)}`);
  console.log('------------------------------------------------------------');

  if (options.dryRun) {
    console.log('DRY RUN — workflow that would be submitted:');
    console.log(JSON.stringify(workflow, null, 2));
    console.log('Nothing was queued.');
    return 0;
  }

  if (fs.existsSync(config.outputFile) && !options.force) {
    console.error(`Refusing to run: ${path.relative(PROJECT_ROOT, config.outputFile)} already exists.`);
    console.error('Pass --force only if you intend to replace that test image.');
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
  while (Date.now() - startedAt < config.timeoutMs) {
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
  await downloadToFile(viewUrl.toString(), config.outputFile);
  const bytes = fs.statSync(config.outputFile).size;
  const elapsedMs = Date.now() - startedAt;

  console.log('------------------------------------------------------------');
  console.log('✅ Generated exactly one image.');
  console.log(`Saved          : ${path.relative(PROJECT_ROOT, config.outputFile)} (${(bytes / 1024).toFixed(0)} KB)`);
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

module.exports = { buildWorkflow, VARIANTS, BASE, variantConfig, OUTPUT_DIR };
