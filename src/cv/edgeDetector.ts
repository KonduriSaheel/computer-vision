import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import type { RawDetection } from './tracker.ts';

const CLASS_MAP: Record<string, string> = {
  person: 'person',
  car: 'car',
  motorcycle: 'motorcycle',
  bus: 'bus',
  truck: 'truck',
  bicycle: 'bicycle',
  backpack: 'backpack',
  handbag: 'bag',
  suitcase: 'bag',
};

let modelPromise: Promise<cocoSsd.ObjectDetection> | null = null;
let loadedModel: cocoSsd.ObjectDetection | null = null;

export async function ensureEdgeModelLoaded(): Promise<cocoSsd.ObjectDetection> {
  if (loadedModel) return loadedModel;
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.ready();
      const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      loadedModel = model;
      return model;
    })();
  }
  return modelPromise;
}

export function isEdgeModelLoaded(): boolean {
  return loadedModel !== null;
}

export async function runEdgeObjectDetection(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  confidenceThreshold: number
): Promise<{ detections: RawDetection[]; inferenceMs: number }> {
  const model = await ensureEdgeModelLoaded();
  const width =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : source.width;
  const height =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : source.height;

  if (!width || !height) {
    return { detections: [], inferenceMs: 0 };
  }

  const t0 = performance.now();
  const predictions = await model.detect(source, 20, confidenceThreshold);
  const inferenceMs = performance.now() - t0;

  const detections: RawDetection[] = [];
  for (const pred of predictions) {
    const mapped = CLASS_MAP[pred.class];
    if (!mapped) continue;
    const [x, y, w, h] = pred.bbox;
    const x1 = Math.max(0, Math.min(1, x / width));
    const y1 = Math.max(0, Math.min(1, y / height));
    const x2 = Math.max(0, Math.min(1, (x + w) / width));
    const y2 = Math.max(0, Math.min(1, (y + h) / height));
    if (x2 <= x1 || y2 <= y1) continue;
    detections.push({
      class_name: mapped,
      confidence: Number(pred.score.toFixed(3)),
      bbox: [
        Number(x1.toFixed(4)),
        Number(y1.toFixed(4)),
        Number(x2.toFixed(4)),
        Number(y2.toFixed(4)),
      ],
    });
  }

  return { detections, inferenceMs };
}

export function measureFrameQuality(canvas: HTMLCanvasElement): { brightness: number; contrast: number } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width === 0 || canvas.height === 0) {
    return { brightness: 0, contrast: 0 };
  }
  const sampleW = Math.min(96, canvas.width);
  const sampleH = Math.min(96, canvas.height);
  const imgData = ctx.getImageData(0, 0, sampleW, sampleH).data;
  let sum = 0;
  let sumSq = 0;
  const n = imgData.length / 4;
  for (let i = 0; i < imgData.length; i += 4) {
    const lum = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
    sum += lum;
    sumSq += lum * lum;
  }
  const mean = sum / Math.max(1, n);
  const variance = Math.max(0, sumSq / Math.max(1, n) - mean * mean);
  return {
    brightness: Number(mean.toFixed(1)),
    contrast: Number(Math.sqrt(variance).toFixed(1)),
  };
}
