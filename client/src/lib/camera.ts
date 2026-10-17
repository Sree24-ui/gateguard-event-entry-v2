import { useCallback, useEffect, useRef, useState } from 'react';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export type CameraStatus = 'idle' | 'starting' | 'scanning' | 'error';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

let detectorPromise: Promise<Detector> | undefined;

/** Native BarcodeDetector where available (Chrome/Android); otherwise ZXing WebAssembly served from our own origin (works offline). */
function getDetector(): Promise<Detector> {
  return (detectorPromise ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: { new (o: object): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
    if (Native && (await Native.getSupportedFormats().catch((): string[] => [])).includes('qr_code')) {
      return new Native({ formats: ['qr_code'] });
    }
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
    return new BarcodeDetector({ formats: ['qr_code'] });
  })());
}

function describeError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (!window.isSecureContext) return 'The camera needs a secure (HTTPS) connection.';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera permission was denied. Allow camera access in your browser’s site settings, then press Start camera again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Use manual code entry below.';
  if (name === 'NotReadableError') return 'The camera is busy in another app or tab. Close it and try again.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t access the camera. Use manual code entry below.';
  return 'The camera could not start. Try again or use manual code entry.';
}

/**
 * Continuous QR scanning with the same-code guard: a code held in view fires once, and only fires
 * again after it has been out of view for `repeatAfterMs`. `onDetect` is not called while a previous
 * call is still being processed.
 */
export function useQrCamera(onDetect: (value: string) => Promise<void> | void, repeatAfterMs = 2500) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastRef = useRef<{ value: string; seenAt: number } | null>(null);
  const busyRef = useRef(false);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  const stop = useCallback(() => {
    if (loopRef.current) clearTimeout(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus((s) => (s === 'error' ? s : 'idle'));
  }, []);

  const start = useCallback(
    async (mode = facing) => {
      stop();
      setError(null);
      setStatus('starting');
      try {
        const [stream, detector] = await Promise.all([
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
          getDetector(),
        ]);
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStatus('scanning');
        const tick = async () => {
          if (!streamRef.current) return;
          try {
            if (!busyRef.current && video.readyState >= 2) {
              const codes = await detector.detect(video);
              const now = Date.now();
              const value = codes[0]?.rawValue;
              if (value) {
                const last = lastRef.current;
                const repeat = last && last.value === value && now - last.seenAt < repeatAfterMs;
                lastRef.current = { value, seenAt: now };
                if (!repeat) {
                  busyRef.current = true;
                  try {
                    await onDetectRef.current(value);
                  } finally {
                    busyRef.current = false;
                  }
                }
              }
            }
          } catch {
            /* a single failed frame is not an error worth surfacing */
          }
          if (streamRef.current) loopRef.current = window.setTimeout(tick, 120);
        };
        tick();
      } catch (e) {
        stop();
        setError(describeError(e));
        setStatus('error');
      }
    },
    [facing, stop],
  );

  const flip = useCallback(() => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    if (streamRef.current) start(next);
  }, [facing, start]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, error, start, stop, flip };
}
